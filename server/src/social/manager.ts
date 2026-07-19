import type { Namespace } from "socket.io";
import type { Ack, SocketData } from "../../../shared/events.js";
import {
  GAME_PATHS,
  type ChatMessageInfo,
  type ChatSummary,
  type FriendPresence,
  type GameKey,
  type SocialClientEvents,
  type SocialServerEvents,
} from "../../../shared/social.js";
import { MAX_PLAYERS } from "../../../shared/types.js";
import { TRIVIA_MAX_PLAYERS } from "../../../shared/trivia.js";
import { bidBattleModeSize } from "../../../shared/bidbattle.js";
import { IMPOSTER_MAX_PLAYERS } from "../../../shared/imposter.js";
import { CODEWORDS_REMOTE_MAX_PLAYERS } from "../../../shared/codewords.js";
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
      socket.on("listChats", (ack: Ack<ChatSummary[]>) =>
        void this.listChats(socket as AnySocket, ack),
      );
      socket.on("openDm", (p: { friendUserId: string }, ack: Ack<{ chatId: string }>) =>
        void this.openDm(socket as AnySocket, p, ack),
      );
      socket.on(
        "createGroup",
        (p: { name: string; memberUserIds: string[] }, ack: Ack<{ chatId: string }>) =>
          void this.createGroup(socket as AnySocket, p, ack),
      );
      socket.on("fetchMessages", (p: { chatId: string }, ack: Ack<ChatMessageInfo[]>) =>
        void this.fetchMessages(socket as AnySocket, p, ack),
      );
      socket.on("sendMessage", (p: { chatId: string; body: string }, ack: Ack<ChatMessageInfo>) =>
        void this.sendMessage(socket as AnySocket, p, ack),
      );
      socket.on(
        "sendChatInvite",
        (p: { chatId: string; game: GameKey; code: string }, ack: Ack<ChatMessageInfo>) =>
          void this.sendChatInvite(socket as AnySocket, p, ack),
      );
      socket.on("markRead", (p: { chatId: string }) => void this.markRead(socket as AnySocket, p));
      socket.on(
        "addToGroup",
        (p: { chatId: string; memberUserIds: string[] }, ack: Ack<{ added: number }>) =>
          void this.addToGroup(socket as AnySocket, p, ack),
      );
      socket.on("leaveGroup", (p: { chatId: string }, ack: Ack<{ left: true }>) =>
        void this.leaveGroup(socket as AnySocket, p, ack),
      );
      socket.on("deleteGroup", (p: { chatId: string }, ack: Ack<{ deleted: true }>) =>
        void this.deleteGroup(socket as AnySocket, p, ack),
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
        link: `${GAME_PATHS[game]}?room=${code}`,
      });
    }
    ack({ ok: true, data: { sent: true } });
  }

  // ---------------- chats (friend DMs + group chats) ----------------
  // All reads/writes go through the service role AFTER server-side validation
  // (friendship for DMs, membership for messages, lobby capacity for invites);
  // the chat tables have deny-all RLS so clients can't touch them directly.

  private async isMember(chatId: string, userId: string): Promise<boolean> {
    const admin = getSupabaseAdmin();
    if (!admin) return false;
    const { data } = await admin
      .from("chat_members")
      .select("user_id")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    return Boolean(data);
  }

  private async memberIdsOf(chatId: string): Promise<string[]> {
    const admin = getSupabaseAdmin();
    if (!admin) return [];
    const { data } = await admin.from("chat_members").select("user_id").eq("chat_id", chatId);
    return (data ?? []).map((r) => r.user_id);
  }

  private toMessageInfo(
    row: {
      id: string;
      chat_id: string;
      sender_id: string;
      kind: "text" | "invite";
      body: string;
      invite: unknown;
      created_at: string;
    },
    senderName: string,
  ): ChatMessageInfo {
    const inv = row.invite as { game?: GameKey; code?: string } | null;
    return {
      id: row.id,
      chatId: row.chat_id,
      senderId: row.sender_id,
      senderName,
      kind: row.kind,
      body: row.body,
      invite: inv?.game && inv?.code ? { game: inv.game, code: inv.code } : null,
      createdAt: row.created_at,
    };
  }

  private async broadcastToChat(
    chatId: string,
    exceptUserId: string | null,
    emit: (sid: string) => void,
  ): Promise<string[]> {
    const members = await this.memberIdsOf(chatId);
    for (const uid of members) {
      if (uid === exceptUserId) continue;
      for (const sid of presence.socketsOf(uid)) emit(sid);
    }
    return members;
  }

  private async listChats(socket: AnySocket, ack: Ack<ChatSummary[]>): Promise<void> {
    const userId = socket.data.userId;
    const admin = getSupabaseAdmin();
    if (!userId || !admin) return ack({ ok: false, error: "Sign in to use messages." });
    const { data: mine } = await admin
      .from("chat_members")
      .select("chat_id, last_read_at")
      .eq("user_id", userId);
    if (!mine || mine.length === 0) return ack({ ok: true, data: [] });
    const chatIds = mine.map((m) => m.chat_id);
    const lastReadByChat = new Map(mine.map((m) => [m.chat_id, m.last_read_at]));
    const [{ data: chats }, { data: members }] = await Promise.all([
      admin.from("chats").select("id, kind, name, created_by").in("id", chatIds),
      admin
        .from("chat_members")
        .select("chat_id, user_id, profile:profiles!chat_members_user_id_fkey(username)")
        .in("chat_id", chatIds),
    ]);
    const summaries: ChatSummary[] = [];
    for (const chat of chats ?? []) {
      const { data: last } = await admin
        .from("chat_messages")
        .select("*, sender:profiles!chat_messages_sender_id_fkey(username)")
        .eq("chat_id", chat.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastMessage = last
        ? this.toMessageInfo(last, (last.sender as { username?: string })?.username ?? "?")
        : null;
      const lastRead = lastReadByChat.get(chat.id) ?? "";
      summaries.push({
        id: chat.id,
        kind: chat.kind,
        name: chat.name,
        createdBy: chat.kind === "group" ? chat.created_by : null,
        members: (members ?? [])
          .filter((m) => m.chat_id === chat.id)
          .map((m) => ({
            userId: m.user_id,
            username: (m.profile as { username?: string })?.username ?? "?",
          })),
        lastMessage,
        unread: Boolean(
          lastMessage && lastMessage.senderId !== userId && lastMessage.createdAt > lastRead,
        ),
      });
    }
    summaries.sort((a, b) =>
      (b.lastMessage?.createdAt ?? "").localeCompare(a.lastMessage?.createdAt ?? ""),
    );
    ack({ ok: true, data: summaries });
  }

  private async openDm(
    socket: AnySocket,
    payload: { friendUserId: string },
    ack: Ack<{ chatId: string }>,
  ): Promise<void> {
    const userId = socket.data.userId;
    const admin = getSupabaseAdmin();
    if (!userId || !admin) return ack({ ok: false, error: "Sign in to use messages." });
    const friendUserId = String(payload?.friendUserId ?? "");
    // DMs exist only between ACCEPTED friends.
    const friends = await this.friendsOf(userId);
    if (!friends?.some((f) => f.userId === friendUserId)) {
      return ack({ ok: false, error: "You can only message accepted friends." });
    }
    const dmKey = [userId, friendUserId].sort().join(":");
    const { data: existing } = await admin
      .from("chats")
      .select("id")
      .eq("dm_key", dmKey)
      .maybeSingle();
    if (existing) return ack({ ok: true, data: { chatId: existing.id } });
    const { data: chat, error } = await admin
      .from("chats")
      .insert({ kind: "dm", created_by: userId, dm_key: dmKey })
      .select("id")
      .single();
    if (error || !chat) {
      // 23505 = a concurrent open created it first — re-read.
      const { data: raced } = await admin.from("chats").select("id").eq("dm_key", dmKey).maybeSingle();
      if (raced) return ack({ ok: true, data: { chatId: raced.id } });
      return ack({ ok: false, error: "Could not open the conversation." });
    }
    await admin.from("chat_members").insert([
      { chat_id: chat.id, user_id: userId },
      { chat_id: chat.id, user_id: friendUserId },
    ]);
    for (const sid of presence.socketsOf(friendUserId)) this.nsp.to(sid).emit("chatsChanged");
    ack({ ok: true, data: { chatId: chat.id } });
  }

  private async createGroup(
    socket: AnySocket,
    payload: { name: string; memberUserIds: string[] },
    ack: Ack<{ chatId: string }>,
  ): Promise<void> {
    const userId = socket.data.userId;
    const admin = getSupabaseAdmin();
    if (!userId || !admin) return ack({ ok: false, error: "Sign in to use messages." });
    const name = String(payload?.name ?? "").trim().slice(0, 40);
    if (name.length < 1) return ack({ ok: false, error: "Give the group a name." });
    const memberIds = [...new Set((payload?.memberUserIds ?? []).map(String))].filter(
      (id) => id !== userId,
    );
    if (memberIds.length < 1 || memberIds.length > 9) {
      return ack({ ok: false, error: "Groups need 1-9 friends besides you." });
    }
    // Every member must be YOUR accepted friend.
    const friends = await this.friendsOf(userId);
    if (!friends || !memberIds.every((id) => friends.some((f) => f.userId === id))) {
      return ack({ ok: false, error: "You can only add accepted friends." });
    }
    const { data: chat, error } = await admin
      .from("chats")
      .insert({ kind: "group", name, created_by: userId })
      .select("id")
      .single();
    if (error || !chat) return ack({ ok: false, error: "Could not create the group." });
    await admin
      .from("chat_members")
      .insert([userId, ...memberIds].map((uid) => ({ chat_id: chat.id, user_id: uid })));
    for (const uid of memberIds) {
      for (const sid of presence.socketsOf(uid)) this.nsp.to(sid).emit("chatsChanged");
    }
    ack({ ok: true, data: { chatId: chat.id } });
  }

  // ----- group membership management -----
  // Rules mirror creation: the CREATOR manages the roster (adds must be the
  // creator's accepted friends, 10 members max) and only the creator can
  // delete the group; any member may leave, and the last one out deletes it.

  private async groupOf(
    chatId: string,
  ): Promise<{ id: string; createdBy: string } | null> {
    const admin = getSupabaseAdmin();
    if (!admin) return null;
    const { data } = await admin
      .from("chats")
      .select("id, kind, created_by")
      .eq("id", chatId)
      .maybeSingle();
    if (!data || data.kind !== "group") return null;
    return { id: data.id, createdBy: data.created_by };
  }

  private emitChatsChanged(userIds: string[]): void {
    for (const uid of userIds) {
      for (const sid of presence.socketsOf(uid)) this.nsp.to(sid).emit("chatsChanged");
    }
  }

  private async addToGroup(
    socket: AnySocket,
    payload: { chatId: string; memberUserIds: string[] },
    ack: Ack<{ added: number }>,
  ): Promise<void> {
    const userId = socket.data.userId;
    const admin = getSupabaseAdmin();
    const chatId = String(payload?.chatId ?? "");
    if (!userId || !admin) return ack({ ok: false, error: "Sign in to use messages." });
    const group = await this.groupOf(chatId);
    if (!group) return ack({ ok: false, error: "Only group chats have a member list." });
    if (group.createdBy !== userId || !(await this.isMember(chatId, userId))) {
      return ack({ ok: false, error: "Only the group's creator can add people." });
    }
    const existing = await this.memberIdsOf(chatId);
    const newIds = [...new Set((payload?.memberUserIds ?? []).map(String))].filter(
      (id) => id && id !== userId && !existing.includes(id),
    );
    if (newIds.length === 0) {
      return ack({ ok: false, error: "Pick someone who isn't in the group yet." });
    }
    if (existing.length + newIds.length > 10) {
      return ack({ ok: false, error: "Groups max out at 10 people." });
    }
    // Additions follow the creation rule: the creator's accepted friends only.
    const friends = await this.friendsOf(userId);
    if (!friends || !newIds.every((id) => friends.some((f) => f.userId === id))) {
      return ack({ ok: false, error: "You can only add accepted friends." });
    }
    const { error } = await admin
      .from("chat_members")
      .insert(newIds.map((uid) => ({ chat_id: chatId, user_id: uid })));
    if (error) return ack({ ok: false, error: "Could not add them — try again." });
    this.emitChatsChanged([...existing, ...newIds]);
    ack({ ok: true, data: { added: newIds.length } });
  }

  private async leaveGroup(
    socket: AnySocket,
    payload: { chatId: string },
    ack: Ack<{ left: true }>,
  ): Promise<void> {
    const userId = socket.data.userId;
    const admin = getSupabaseAdmin();
    const chatId = String(payload?.chatId ?? "");
    if (!userId || !admin) return ack({ ok: false, error: "Sign in to use messages." });
    const group = await this.groupOf(chatId);
    if (!group) return ack({ ok: false, error: "You can't leave a direct message." });
    if (!(await this.isMember(chatId, userId))) {
      return ack({ ok: false, error: "You're not in that group." });
    }
    const { error } = await admin
      .from("chat_members")
      .delete()
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) return ack({ ok: false, error: "Could not leave — try again." });
    const remaining = await this.memberIdsOf(chatId);
    if (remaining.length === 0) {
      // Last one out turns off the lights (cascade cleans messages).
      await admin.from("chats").delete().eq("id", chatId);
    }
    this.emitChatsChanged(remaining);
    ack({ ok: true, data: { left: true } });
  }

  private async deleteGroup(
    socket: AnySocket,
    payload: { chatId: string },
    ack: Ack<{ deleted: true }>,
  ): Promise<void> {
    const userId = socket.data.userId;
    const admin = getSupabaseAdmin();
    const chatId = String(payload?.chatId ?? "");
    if (!userId || !admin) return ack({ ok: false, error: "Sign in to use messages." });
    const group = await this.groupOf(chatId);
    if (!group) return ack({ ok: false, error: "Only group chats can be deleted." });
    if (group.createdBy !== userId || !(await this.isMember(chatId, userId))) {
      return ack({ ok: false, error: "Only the group's creator can delete it." });
    }
    const members = await this.memberIdsOf(chatId);
    const { error } = await admin.from("chats").delete().eq("id", chatId);
    if (error) return ack({ ok: false, error: "Could not delete the group — try again." });
    this.emitChatsChanged(members.filter((id) => id !== userId));
    ack({ ok: true, data: { deleted: true } });
  }

  private async fetchMessages(
    socket: AnySocket,
    payload: { chatId: string },
    ack: Ack<ChatMessageInfo[]>,
  ): Promise<void> {
    const userId = socket.data.userId;
    const admin = getSupabaseAdmin();
    const chatId = String(payload?.chatId ?? "");
    if (!userId || !admin) return ack({ ok: false, error: "Sign in to use messages." });
    if (!(await this.isMember(chatId, userId))) {
      return ack({ ok: false, error: "Not your conversation." });
    }
    const { data } = await admin
      .from("chat_messages")
      .select("*, sender:profiles!chat_messages_sender_id_fkey(username)")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(100);
    ack({
      ok: true,
      data: (data ?? [])
        .reverse()
        .map((row) =>
          this.toMessageInfo(row, (row.sender as { username?: string })?.username ?? "?"),
        ),
    });
  }

  private async persistAndDeliver(
    userId: string,
    chatId: string,
    kind: "text" | "invite",
    body: string,
    invite: { game: GameKey; code: string } | null,
    ack: Ack<ChatMessageInfo>,
  ): Promise<ChatMessageInfo | null> {
    const admin = getSupabaseAdmin()!;
    const { data: row, error } = await admin
      .from("chat_messages")
      .insert({ chat_id: chatId, sender_id: userId, kind, body, invite })
      .select("*")
      .single();
    if (error || !row) {
      ack({ ok: false, error: "Could not send the message." });
      return null;
    }
    const { data: me } = await admin
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    const msg = this.toMessageInfo(row, me?.username ?? "?");
    await this.broadcastToChat(chatId, null, (sid) => this.nsp.to(sid).emit("chatMessage", msg));
    ack({ ok: true, data: msg });
    return msg;
  }

  private async sendMessage(
    socket: AnySocket,
    payload: { chatId: string; body: string },
    ack: Ack<ChatMessageInfo>,
  ): Promise<void> {
    const userId = socket.data.userId;
    const chatId = String(payload?.chatId ?? "");
    const body = String(payload?.body ?? "").trim().slice(0, 500);
    if (!userId || !getSupabaseAdmin()) return ack({ ok: false, error: "Sign in to use messages." });
    if (!body) return ack({ ok: false, error: "Say something first." });
    if (!(await this.isMember(chatId, userId))) {
      return ack({ ok: false, error: "Not your conversation." });
    }
    await this.persistAndDeliver(userId, chatId, "text", body, null, ack);
  }

  /** Seats a game's room still has open, given its per-game capacity rules. */
  private openSeatsOf(game: GameKey, room: RoomLike): number {
    const max =
      game === "mindmeld"
        ? MAX_PLAYERS
        : game === "trivia"
          ? TRIVIA_MAX_PLAYERS
          : game === "imposter"
            ? IMPOSTER_MAX_PLAYERS
            : game === "codewords"
              ? (room as { settings?: { mode?: string } }).settings?.mode === "board"
                ? 0 // shared-board rooms only admit QR-token spymaster phones
                : CODEWORDS_REMOTE_MAX_PLAYERS
              : bidBattleModeSize(
                  ((room as { settings?: { mode?: "1v1" | "2v2" } }).settings?.mode ?? "1v1"),
                );
    return Math.max(0, max - room.players.size);
  }

  private async sendChatInvite(
    socket: AnySocket,
    payload: { chatId: string; game: GameKey; code: string },
    ack: Ack<ChatMessageInfo>,
  ): Promise<void> {
    const userId = socket.data.userId;
    const chatId = String(payload?.chatId ?? "");
    const game = payload?.game;
    const code = String(payload?.code ?? "").toUpperCase();
    const store = game ? this.stores[game] : undefined;
    const admin = getSupabaseAdmin();
    if (!userId || !admin) return ack({ ok: false, error: "Sign in to use messages." });
    if (!store) return ack({ ok: false, error: "Invalid invite." });
    if (!(await this.isMember(chatId, userId))) {
      return ack({ ok: false, error: "Not your conversation." });
    }
    const room = store.get(code);
    if (!room || room.state !== "lobby") {
      return ack({ ok: false, error: "That lobby is no longer joinable." });
    }
    if (![...room.players.values()].some((p) => p.userId === userId)) {
      return ack({ ok: false, error: "You are not in that lobby." });
    }
    // Capacity rule: the chat's other members must all be able to fit.
    const members = await this.memberIdsOf(chatId);
    const recipients = members.filter((m) => m !== userId).length;
    const seats = this.openSeatsOf(game, room);
    if (recipients > seats) {
      return ack({
        ok: false,
        error: `This chat has ${recipients} people but the lobby only has ${seats} open seat${seats === 1 ? "" : "s"}.`,
      });
    }
    const rlKey = `${userId}:${chatId}:${code}`;
    const last = this.inviteTimestamps.get(rlKey) ?? 0;
    if (Date.now() - last < INVITE_COOLDOWN_MS) {
      return ack({ ok: false, error: "Invite already sent — give them a second." });
    }
    this.inviteTimestamps.set(rlKey, Date.now());
    const gameName = game.charAt(0).toUpperCase() + game.slice(1);
    const msg = await this.persistAndDeliver(
      userId,
      chatId,
      "invite",
      `Join my ${gameName} lobby — code ${code}`,
      { game, code },
      ack,
    );
    if (msg) {
      // Also surface as a live bell notification for online members.
      for (const uid of members) {
        if (uid === userId) continue;
        for (const sid of presence.socketsOf(uid)) {
          this.nsp.to(sid).emit("lobbyInvite", {
            from: { userId, username: msg.senderName },
            game,
            code,
            link: `${GAME_PATHS[game]}?room=${code}`,
          });
        }
      }
    }
  }

  private async markRead(socket: AnySocket, payload: { chatId: string }): Promise<void> {
    const userId = socket.data.userId;
    const admin = getSupabaseAdmin();
    if (!userId || !admin) return;
    await admin
      .from("chat_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("chat_id", String(payload?.chatId ?? ""))
      .eq("user_id", userId);
  }
}
