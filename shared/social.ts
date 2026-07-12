import type { Ack } from "./events.js";

/**
 * The /social namespace: presence + lobby invites for signed-in players.
 * Friend relationships themselves live in Supabase (friendships table, RLS);
 * this namespace only handles what needs to be real-time and
 * server-authoritative: who is online/where, and delivering lobby invites.
 * Anonymous sockets may connect but every event requires a verified userId.
 */

export type GameKey = "mindmeld" | "trivia" | "bidbattle";

export const GAME_NAMES: Record<GameKey, string> = {
  mindmeld: "Mind Meld",
  trivia: "Speed Trivia",
  bidbattle: "Bid Battle",
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

export interface SocialClientEvents {
  /** Accepted friends (server-authoritative from the DB) with live presence. */
  getFriends(ack: Ack<FriendPresence[]>): void;
  inviteToLobby(
    payload: { friendUserId: string; game: GameKey; code: string },
    ack: Ack<{ sent: true }>,
  ): void;
}

export interface SocialServerEvents {
  lobbyInvite(payload: LobbyInvitePayload): void;
  errorMsg(payload: { message: string }): void;
}
