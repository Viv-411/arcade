/**
 * Keyboard + gamepad + touch → simulation input bits, plus one-shot actions
 * (restart, pause, camera…). Driving inputs are DIGITAL by design — the same
 * bits on every device — so a keyboard player is never at a disadvantage.
 */
import { IN_DOWN, IN_LEFT, IN_RESPAWN, IN_RIGHT, IN_UP } from "@shared/hotlap/car";

export type Action = "restart" | "pause" | "camera" | "ghost" | "mute";

const DRIVE_KEYS: Record<string, number> = {
  ArrowUp: IN_UP, KeyW: IN_UP,
  ArrowDown: IN_DOWN, KeyS: IN_DOWN,
  ArrowLeft: IN_LEFT, KeyA: IN_LEFT,
  ArrowRight: IN_RIGHT, KeyD: IN_RIGHT,
  Enter: IN_RESPAWN, Backspace: IN_RESPAWN,
};
const ACTION_KEYS: Record<string, Action> = {
  KeyR: "restart",
  Escape: "pause",
  KeyP: "pause",
  KeyC: "camera",
  KeyG: "ghost",
  KeyM: "mute",
};

export class InputController {
  private keys = 0;
  private touch = 0;
  private padPrev: boolean[] = [];
  private listeners: ((a: Action) => void)[] = [];
  private firstGesture: (() => void) | null;
  enabled = true;

  constructor(onFirstGesture: () => void) {
    this.firstGesture = onFirstGesture;
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("keyup", this.onKeyUp, { capture: true });
    window.addEventListener("blur", this.onBlur);
  }

  onAction(cb: (a: Action) => void) {
    this.listeners.push(cb);
  }

  private gesture() {
    if (this.firstGesture) {
      const f = this.firstGesture;
      this.firstGesture = null;
      f();
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Don't steal keys from text fields (e.g. a future name box).
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const bit = DRIVE_KEYS[e.code];
    if (bit !== undefined) {
      e.preventDefault();
      this.gesture();
      this.keys |= bit;
      return;
    }
    const action = ACTION_KEYS[e.code];
    if (action && !e.repeat) {
      e.preventDefault();
      this.gesture();
      this.listeners.forEach((l) => l(action));
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const bit = DRIVE_KEYS[e.code];
    if (bit !== undefined) this.keys &= ~bit;
  };

  /** Losing focus must never leave a key "stuck down". */
  private onBlur = () => {
    this.keys = 0;
    this.touch = 0;
  };

  setTouch(bit: number, down: boolean) {
    this.gesture();
    if (down) this.touch |= bit;
    else this.touch &= ~bit;
  }

  /** Sample once per simulation tick. */
  sample(): number {
    if (!this.enabled) return 0;
    let bits = this.keys | this.touch;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const x = pad.axes[0] ?? 0;
      if (b(7) || b(0)) bits |= IN_UP;
      if (b(6) || b(1)) bits |= IN_DOWN;
      if (x < -0.35 || b(14)) bits |= IN_LEFT;
      if (x > 0.35 || b(15)) bits |= IN_RIGHT;
      if (b(3)) bits |= IN_RESPAWN;
      const edges: [number, Action][] = [[9, "pause"], [8, "restart"], [2, "camera"]];
      for (const [i, a] of edges) {
        const now = b(i);
        if (now && !this.padPrev[i]) {
          this.gesture();
          this.listeners.forEach((l) => l(a));
        }
        this.padPrev[i] = now;
      }
      if (bits) this.gesture();
      break; // first connected pad only
    }
    return bits;
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
    window.removeEventListener("blur", this.onBlur);
    this.listeners = [];
  }
}
