import type { CwIdentity, CwPublicCard } from "@shared/codewords";

interface Props {
  board: CwPublicCard[];
  /** Full key overlay (spymasters, or everyone at the final reveal). */
  cardKey?: CwIdentity[] | null;
  /** Live vote counts per card index (remote guess phase). */
  tally?: Record<number, number> | null;
  myVote?: number | "pass" | null;
  /** Board-mode two-tap confirm highlight. */
  selected?: number | null;
  /** Large layout for the shared screen. */
  big?: boolean;
  interactive?: boolean;
  onCard?: (index: number) => void;
}

/** The 5x5 word grid, shared by every Codewords surface. */
export default function BoardGrid({
  board,
  cardKey,
  tally,
  myVote,
  selected,
  big,
  interactive,
  onCard,
}: Props) {
  return (
    <div className={`cw-board ${big ? "cw-big" : ""}`}>
      {board.map((card, i) => {
        const identity = card.revealed ? card.identity : null;
        const keyTint = !card.revealed && cardKey ? cardKey[i] : null;
        const votes = tally?.[i] ?? 0;
        const classes = [
          "cw-card",
          card.revealed ? `cw-revealed cw-${identity}` : "",
          keyTint ? `cw-key-${keyTint}` : "",
          selected === i ? "cw-selected" : "",
          myVote === i ? "cw-my-vote" : "",
          interactive && !card.revealed ? "cw-tappable" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={i}
            type="button"
            className={classes}
            disabled={!interactive || card.revealed}
            onClick={() => onCard?.(i)}
          >
            <span className="cw-word">{card.word}</span>
            {card.revealed && identity === "assassin" && <span className="cw-mark">💀</span>}
            {card.revealed && identity === "bystander" && <span className="cw-mark">🚶</span>}
            {votes > 0 && !card.revealed && <span className="cw-votes">{votes}</span>}
          </button>
        );
      })}
    </div>
  );
}
