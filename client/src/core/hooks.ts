import { useEffect, useState } from "react";

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
