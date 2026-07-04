/**
 * All room state access goes through this interface so the in-memory
 * implementation can later be swapped for a Redis-backed one without
 * touching game logic. Note the game manager holds live timer handles on
 * room objects; a Redis move would also need to externalize timers.
 */
export interface RoomStore<T> {
  get(code: string): T | undefined;
  set(code: string, room: T): void;
  delete(code: string): void;
  has(code: string): boolean;
  values(): Iterable<T>;
  size(): number;
}

export class InMemoryRoomStore<T> implements RoomStore<T> {
  private rooms = new Map<string, T>();

  get(code: string): T | undefined {
    return this.rooms.get(code);
  }

  set(code: string, room: T): void {
    this.rooms.set(code, room);
  }

  delete(code: string): void {
    this.rooms.delete(code);
  }

  has(code: string): boolean {
    return this.rooms.has(code);
  }

  values(): Iterable<T> {
    return this.rooms.values();
  }

  size(): number {
    return this.rooms.size;
  }
}
