/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import type { FriendPresence, GameKey, LobbyInvitePayload } from "@shared/social";
import { supabase, getAccessToken } from "../auth/supabaseClient";
import { useAuth } from "../auth/AuthContext";

export interface FriendEntry {
  rowId: string;
  userId: string;
  username: string;
  displayName: string | null;
}

export interface RequestEntry extends FriendEntry {
  direction: "incoming" | "outgoing";
}

export interface LobbyInviteNotif extends LobbyInvitePayload {
  id: number;
  receivedAt: number;
}

interface SocialContextValue {
  ready: boolean;
  friends: FriendEntry[];
  incoming: RequestEntry[];
  outgoing: RequestEntry[];
  invites: LobbyInviteNotif[];
  /** Incoming requests + fresh lobby invites. */
  unreadCount: number;
  refresh: () => Promise<void>;
  sendRequest: (username: string) => Promise<string | null>;
  acceptRequest: (rowId: string) => Promise<void>;
  removeFriendship: (rowId: string) => Promise<void>;
  dismissInvite: (id: number) => void;
  fetchPresence: () => Promise<FriendPresence[]>;
  inviteToLobby: (friendUserId: string, game: GameKey, code: string) => Promise<string | null>;
}

const SocialContext = createContext<SocialContextValue>({
  ready: false,
  friends: [],
  incoming: [],
  outgoing: [],
  invites: [],
  unreadCount: 0,
  refresh: async () => {},
  sendRequest: async () => "Not available.",
  acceptRequest: async () => {},
  removeFriendship: async () => {},
  dismissInvite: () => {},
  fetchPresence: async () => [],
  inviteToLobby: async () => "Not available.",
});

export function useSocial(): SocialContextValue {
  return useContext(SocialContext);
}

const INVITE_TTL_MS = 5 * 60_000;
const POLL_MS = 45_000;
let inviteId = 0;

export function SocialProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [incoming, setIncoming] = useState<RequestEntry[]>([]);
  const [outgoing, setOutgoing] = useState<RequestEntry[]>([]);
  const [invites, setInvites] = useState<LobbyInviteNotif[]>([]);
  const socketRef = useRef<Socket<any, any> | null>(null);
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;

  const refresh = useCallback(async () => {
    const uid = userIdRef.current;
    if (!supabase || !uid) {
      setFriends([]);
      setIncoming([]);
      setOutgoing([]);
      return;
    }
    const { data, error } = await supabase
      .from("friendships")
      .select(
        `id, status, requester_id, addressee_id,
         requester:profiles!friendships_requester_id_fkey (id, username, display_name),
         addressee:profiles!friendships_addressee_id_fkey (id, username, display_name)`,
      );
    if (error || !data) return;
    const fr: FriendEntry[] = [];
    const inc: RequestEntry[] = [];
    const out: RequestEntry[] = [];
    for (const row of data as any[]) {
      const iAmRequester = row.requester_id === uid;
      const other = iAmRequester ? row.addressee : row.requester;
      if (!other) continue;
      const entry = {
        rowId: row.id as string,
        userId: other.id as string,
        username: other.username as string,
        displayName: (other.display_name as string | null) ?? null,
      };
      if (row.status === "accepted") fr.push(entry);
      else if (iAmRequester) out.push({ ...entry, direction: "outgoing" });
      else inc.push({ ...entry, direction: "incoming" });
    }
    setFriends(fr.sort((a, b) => a.username.localeCompare(b.username)));
    setIncoming(inc);
    setOutgoing(out);
  }, []);

  // Social socket lifecycle follows the auth session.
  useEffect(() => {
    if (!user) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setFriends([]);
      setIncoming([]);
      setOutgoing([]);
      setInvites([]);
      return;
    }
    const socket: Socket<any, any> = io("/social", {
      path: "/socket.io",
      auth: (cb: (d: object) => void) => cb({ token: getAccessToken() ?? undefined }),
    });
    socketRef.current = socket;
    socket.on("lobbyInvite", (p: LobbyInvitePayload) => {
      setInvites((prev) => [
        ...prev.filter((i) => Date.now() - i.receivedAt < INVITE_TTL_MS).slice(-9),
        { ...p, id: ++inviteId, receivedAt: Date.now() },
      ]);
    });
    void refresh();
    const poll = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearInterval(poll);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, refresh]);

  const sendRequest = useCallback(
    async (usernameRaw: string): Promise<string | null> => {
      const uid = userIdRef.current;
      if (!supabase || !uid) return "Sign in first.";
      const username = usernameRaw.trim().toLowerCase().replace(/^@/, "");
      if (!username) return "Enter a username.";
      const { data: target } = await supabase
        .from("profiles")
        .select("id, username")
        .eq("username", username)
        .maybeSingle();
      if (!target) return `No player named @${username}.`;
      if (target.id === uid) return "That's you!";
      const { error } = await supabase
        .from("friendships")
        .insert({ requester_id: uid, addressee_id: target.id });
      if (error) {
        return error.code === "23505"
          ? `You already have a request or friendship with @${username}.`
          : error.message;
      }
      await refresh();
      return null;
    },
    [refresh],
  );

  const acceptRequest = useCallback(
    async (rowId: string) => {
      if (!supabase) return;
      await supabase.from("friendships").update({ status: "accepted" }).eq("id", rowId);
      await refresh();
    },
    [refresh],
  );

  const removeFriendship = useCallback(
    async (rowId: string) => {
      if (!supabase) return;
      await supabase.from("friendships").delete().eq("id", rowId);
      await refresh();
    },
    [refresh],
  );

  const dismissInvite = useCallback((id: number) => {
    setInvites((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const fetchPresence = useCallback(async (): Promise<FriendPresence[]> => {
    const socket = socketRef.current;
    if (!socket) return [];
    return new Promise((resolve) => {
      socket.timeout(6000).emit("getFriends", (err: unknown, res: any) => {
        resolve(!err && res?.ok ? res.data : []);
      });
    });
  }, []);

  const inviteToLobby = useCallback(
    async (friendUserId: string, game: GameKey, code: string): Promise<string | null> => {
      const socket = socketRef.current;
      if (!socket) return "Not connected.";
      return new Promise((resolve) => {
        socket.timeout(6000).emit("inviteToLobby", { friendUserId, game, code }, (err: unknown, res: any) => {
          if (err) resolve("No response — try again.");
          else resolve(res.ok ? null : res.error);
        });
      });
    },
    [],
  );

  const freshInvites = invites.filter((i) => Date.now() - i.receivedAt < INVITE_TTL_MS);

  return (
    <SocialContext.Provider
      value={{
        ready: Boolean(user && supabase),
        friends,
        incoming,
        outgoing,
        invites: freshInvites,
        unreadCount: incoming.length + freshInvites.length,
        refresh,
        sendRequest,
        acceptRequest,
        removeFriendship,
        dismissInvite,
        fetchPresence,
        inviteToLobby,
      }}
    >
      {children}
    </SocialContext.Provider>
  );
}
