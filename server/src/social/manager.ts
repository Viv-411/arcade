import type { Namespace } from "socket.io";
import type { Ack, SocketData } from "../../../shared/events.js";
import type {
  FriendPresence,
  GameKey,
  SocialClientEvents,
  SocialServerEvents,
} from "../../../shared/social.js";
import type { AnySocket } from "../core/roomManager.js";
import { presence } from "../core/presence.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";
import type { RoomStore } from "../store.js";
import { socketOptionalAuth } from "../auth.js";

type SocialNamespace = Namespace<
  SocialClientEvents,
  SocialServerEvents,
  Record<string, never>,
  SocketData
>;

/** Minimal view of a game room needed for invite validation. */
interface RoomLike {
  code: string;
  state: string;
  players: Map<string, { userId: string | null; name: string }>;
}

const INVITE_COOLDOWN_MS = 10_000;

/**
 * Presence + lobby invites. Friend data itself is read server-side with the
 * service role (never trusting client-supplied ids); invites are validated
 * against real friendships and real room membership before delivery.
 */
export class SocialManager {
  private inviteTimestamps = new Map<string, number>();

  constructor(
    private nsp: SocialNamespace,
    private stores: Record<GameKey, RoomStore<RoomLike>>,
  ) {
    nsp.use(socketOptionalAuth as Parameters<SocialNamespace["use"]>[0]);
    nsp.on("connection", (socket) => {
      const userId = socket.data.userId ?? null;
      if (userId) presence.addSocket(userId, socket.id);
      socket.on("disconnect", () => {
        if (userId) presence.removeSocket(userId, socket.id);
      });
      socket.on("getFriends", (ack: Ack<FriendPresence[]>) =>
        void this.getFriends(socket as AnySocket, ack),
      );
      socket.on(
        "inviteToLobby",
        (payload: { friendUserId: string; game: GameKey; code: string }, ack: Ack<{ sent: true }>) =>
          void this.inviteToLobby(socket as AnySocket, payload, ack),
      );
    });
  }

  /** Accepted friendships for a user, via the service role. */
  private async friendsOf(
    userId: string,
  ): Promise<{ userId: string; username: string; displayName: string | null }[] | null> {
    const admin = getSupabaseAdmin();
    if (!admin) return null;
    const { data: rows, error } = await admin
      .from("friendships")
      .select("requester_id, addressee_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
    if (error) {
      console.warn("[social] friendships query failed:", error.message);
      return null;
    }
    const otherIds = (rows ?? []).map((r) =>
      r.requester_id === userId ? r.addressee_id : r.requester_id,
    );
    if (otherIds.length === 0) return [];
    const { data: profiles, error: pErr } = await admin
      .from("profiles")
      .select("id, username, display_name")
      .in("id", otherIds);
    if (pErr) {
      console.warn("[social] profiles query failed:", pErr.message);
      return null;
    }
    return (profiles ?? []).map((p) => ({
      userId: p.id,
      username: p.username,
      displayName: p.display_name,
    }));
  }

  private activityOf(userId: string): FriendPresence["activity"] {
    const loc = presence.roomOf(userId);
    if (!loc) return null;
    const room = this.stores[loc.game]?.get(loc.code);
    if (!room) return null;
    const inLobby = room.state === "lobby";
    return {
      game: loc.game,
      code: inLobby ? room.code : null, // only share joinable rooms
      state: inLobby ? "lobby" : "playing",
    };
  }

  private async getFriends(socket: AnySocket, ack: Ack<FriendPresence[]>): Promise<void> {
    const userId = socket.data.userId;
    if (!userId) return ack({ ok: false, error: "Sign in to see friends." });
    const friends = await this.friendsOf(userId);
    if (friends === null) {
      return ack({ ok: false, error: "Friends are unavailable right now." });
    }
    ack({
      ok: true,
      data: friends
        .map((f) => ({
          ...f,
          online: presence.isOnline(f.userId),
          activity: this.activityOf(f.userId),
        }))
        .sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username)),
    });
  }

  private async inviteToLobby(
    socket: AnySocket,
    payload: { friendUserId: string; game: GameKey; code: string },
    ack: Ack<{ sent: true }>,
  ): Promise<void> {
    const userId = socket.data.userId;
    if (!userId) return ack({ ok: false, error: "Sign in to invite friends." });
    const friendUserId = String(payload?.friendUserId ?? "");
    const game = payload?.game;
    const code = String(payload?.code ?? "").toUpperCase();
    const store = game ? this.stores[game] : undefined;
    if (!store || !friendUserId) return ack({ ok: false, error: "Invalid invite." });

    // The room must exist, be joinable, and actually contain the inviter.
    const room = store.get(code);
    if (!room || room.state !== "lobby") {
      return ack({ ok: false, error: "That lobby is no longer joinable." });
    }
    if (![...room.players.values()].some((p) => p.userId === userId)) {
      return ack({ ok: false, error: "You are not in that lobby." });
    }

    // Must be an accepted friend (service-role check, not client-trusted).
    const friends = await this.friendsOf(userId);
    if (friends === null) return ack({ ok: false, error: "Friends are unavailable right now." });
    const friend = friends.find((f) => f.userId === friendUserId);
    if (!friend) return ack({ ok: false, error: "You can only invite friends." });

    if (!presence.isOnline(friendUserId)) {
      return ack({ ok: false, error: `@${friend.username} is offline.` });
    }

    const rlKey = `${userId}:${friendUserId}`;
    const last = this.inviteTimestamps.get(rlKey) ?? 0;
    if (Date.now() - last < INVITE_COOLDOWN_MS) {
      return ack({ ok: false, error: "Give them a second — invite already sent." });
    }
    this.inviteTimestamps.set(rlKey, Date.now());

    // Inviter's username for the notification.
    const admin = getSupabaseAdmin();
    const { data: me } = admin
      ? await admin.from("profiles").select("username").eq("id", userId).maybeSingle()
      : { data: null };

    for (const sid of presence.socketsOf(friendUserId)) {
      this.nsp.to(sid).emit("lobbyInvite", {
        from: { userId, username: me?.username ?? "a friend" },
        game,
        code,
        link: `/${game}?room=${code}`,
      });
    }
    ack({ ok: true, data: { sent: true } });
  }
}
