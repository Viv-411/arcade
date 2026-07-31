import type { Ack } from "./events.js";

/**
 * The /social namespace: presence + lobby invites for signed-in players.
 * Friend relationships themselves live in Supabase (friendships table, RLS);
 * this namespace only handles what needs to be real-time and
 * server-authoritative: who is online/where, and delivering lobby invites.
 * Anonymous sockets may connect but every event requires a verified userId.
 */

export type GameKey =
  | "mindmeld"
  | "trivia"
  | "bidbattle"
  | "imposter"
  | "codewords"
  | "chess";

export const GAME_NAMES: Record<GameKey, string> = {
  mindmeld: "Mind Meld",
  trivia: "Speed Trivia",
  bidbattle: "Bid Battle",
  imposter: "Imposter",
  codewords: "Codewords",
  chess: "Chess",
};

/** Client routes per game (imposter's online route differs from its key). */
export const GAME_PATHS: Record<GameKey, string> = {
  mindmeld: "/mindmeld",
  trivia: "/trivia",
  bidbattle: "/bidbattle",
  imposter: "/imposter-online",
  codewords: "/codewords/remote",
  chess: "/chess/online",
};

export interface FriendPresence {
  userId: string;
  username: string;
  displayName: string | null;
  online: boolean;
  /** Set when the friend is currently in a room. */
  activity: {
    game: GameKey;
    /** Room code, included only while the room is joinable (in lobby). */
    code: string | null;
    state: "lobby" | "playing";
  } | null;
}

export interface LobbyInvitePayload {
  from: { userId: string; username: string };
  game: GameKey;
  code: string;
  /** Client route to join, e.g. /trivia?room=ABCD */
  link: string;
}

export interface ChatMemberInfo {
  userId: string;
  username: string;
}

export interface ChatMessageInfo {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  kind: "text" | "invite";
  body: string;
  invite: { game: GameKey; code: string } | null;
  createdAt: string;
}

export interface ChatSummary {
  id: string;
  kind: "dm" | "group";
  /** Group name; DMs display the other member's username. */
  name: string | null;
  /** Group creator — the only member who can add people or delete the group. */
  createdBy: string | null;
  members: ChatMemberInfo[];
  lastMessage: ChatMessageInfo | null;
  unread: boolean;
}

export interface SocialClientEvents {
  /** Accepted friends (server-authoritative from the DB) with live presence. */
  getFriends(ack: Ack<FriendPresence[]>): void;
  inviteToLobby(
    payload: { friendUserId: string; game: GameKey; code: string },
    ack: Ack<{ sent: true }>,
  ): void;
  // ----- chats (friend DMs + group chats; all validated server-side) -----
  listChats(ack: Ack<ChatSummary[]>): void;
  /** Get-or-create the DM with an ACCEPTED friend. */
  openDm(payload: { friendUserId: string }, ack: Ack<{ chatId: string }>): void;
  createGroup(
    payload: { name: string; memberUserIds: string[] },
    ack: Ack<{ chatId: string }>,
  ): void;
  fetchMessages(payload: { chatId: string }, ack: Ack<ChatMessageInfo[]>): void;
  sendMessage(payload: { chatId: string; body: string }, ack: Ack<ChatMessageInfo>): void;
  /** Post a lobby invite into a chat (capacity-checked for groups). */
  sendChatInvite(
    payload: { chatId: string; game: GameKey; code: string },
    ack: Ack<ChatMessageInfo>,
  ): void;
  markRead(payload: { chatId: string }): void;
  /** Creator only: add accepted friends to a group (10 members max). */
  addToGroup(
    payload: { chatId: string; memberUserIds: string[] },
    ack: Ack<{ added: number }>,
  ): void;
  /** Any member: leave a group (the last member out deletes it). */
  leaveGroup(payload: { chatId: string }, ack: Ack<{ left: true }>): void;
  /** Creator only: delete a group for everyone. */
  deleteGroup(payload: { chatId: string }, ack: Ack<{ deleted: true }>): void;
}

export interface SocialServerEvents {
  lobbyInvite(payload: LobbyInvitePayload): void;
  chatMessage(payload: ChatMessageInfo): void;
  /** Membership changed (e.g. you were added to a group) — refresh the list. */
  chatsChanged(): void;
  errorMsg(payload: { message: string }): void;
}
