import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Following an invite/share link (?room=CODE) while already in a DIFFERENT
 * room of the same game should honor the link: leave the current room so the
 * entry screen (with the code prefilled) can take over. Without this, tapping
 * a friend's invite while in a room silently did nothing.
 */
export function useJoinLinkOverride(
  currentCode: string | null | undefined,
  leaveRoom: () => void,
): void {
  const [params] = useSearchParams();
  const target = (params.get("room") ?? "").toUpperCase();
  useEffect(() => {
    if (currentCode && target && target !== currentCode) leaveRoom();
  }, [target, currentCode, leaveRoom]);
}

/** Whole seconds remaining until an epoch-ms deadline (null when no deadline). */
export function useSecondsLeft(deadline: number | null | undefined): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!deadline) {
      setLeft(null);
      return;
    }
    const update = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    const t = setInterval(update, 250);
    return () => clearInterval(t);
  }, [deadline]);
  return left;
}

/** Fraction of time remaining (1 -> 0) for a deadline of known duration. */
export function useTimeFraction(
  deadline: number | null | undefined,
  durationMs: number,
): number {
  const [fraction, setFraction] = useState(1);
  useEffect(() => {
    if (!deadline || durationMs <= 0) {
      setFraction(0);
      return;
    }
    const update = () =>
      setFraction(Math.max(0, Math.min(1, (deadline - Date.now()) / durationMs)));
    update();
    const t = setInterval(update, 100);
    return () => clearInterval(t);
  }, [deadline, durationMs]);
  return fraction;
}
