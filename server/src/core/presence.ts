import type { GameKey } from "../../../shared/social.js";

/**
 * In-memory presence for signed-in players (single-process, like room state):
 * - online: which userIds have a live /social socket (set by the social
 *   namespace on connect/disconnect).
 * - rooms: which game room a userId is currently in (set server-side by the
 *   room core on join/rejoin/removal — never client-reported).
 */
class PresenceRegistry {
  private online = new Map<string, Set<string>>();
  private rooms = new Map<string, { game: GameKey; code: string }>();

  addSocket(userId: string, socketId: string): void {
    let set = this.online.get(userId);
    if (!set) {
      set = new Set();
      this.online.set(userId, set);
    }
    set.add(socketId);
  }

  removeSocket(userId: string, socketId: string): void {
    const set = this.online.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) this.online.delete(userId);
  }

  isOnline(userId: string): boolean {
    return this.online.has(userId);
  }

  socketsOf(userId: string): string[] {
    return [...(this.online.get(userId) ?? [])];
  }

  setRoom(userId: string, game: GameKey, code: string): void {
    this.rooms.set(userId, { game, code });
  }

  /** Clear only if the user's current room is the one being left. */
  clearRoom(userId: string, code: string): void {
    if (this.rooms.get(userId)?.code === code) this.rooms.delete(userId);
  }

  roomOf(userId: string): { game: GameKey; code: string } | null {
    return this.rooms.get(userId) ?? null;
  }
}

export const presence = new PresenceRegistry();
