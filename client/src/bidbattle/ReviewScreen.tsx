import type { BidBattleSnapshot, ReviewItemStatus, TeamId } from "@shared/bidbattle";
import { useSecondsLeft } from "../core/hooks";

interface Props {
  room: BidBattleSnapshot;
  myTeam: TeamId | null;
  onFlag: (index: number) => void;
  onRespond: (index: number, action: "concede" | "defend") => void;
  onFinalize: (index: number, action: "accept" | "uphold") => void;
}

const STATUS_LABEL: Record<ReviewItemStatus, string> = {
  ok: "counts",
  flagged: "flagged 🚩",
  conceded: "conceded ✗",
  defended: "defended 🛡",
  accepted: "accepted ✓",
  upheld: "rejected ✗",
};

export default function ReviewScreen({ room, myTeam, onFlag, onRespond, onFinalize }: Props) {
  const review = room.review;
  const secondsLeft = useSecondsLeft(review?.deadline ?? null);
  if (!review) return null;
  const delivering = myTeam === review.deliveringTeam;
  const counts = review.items.filter((i) =>
    ["ok", "defended", "accepted"].includes(i.status),
  ).length;
  const anyFlagged = review.items.some((i) => i.status === "flagged");

  return (
    <div className="panel review-screen">
      <p className="category-banner">
        Review: <strong>{room.category}</strong> — Team {review.deliveringTeam} bid{" "}
        {review.target}
      </p>
      <div className="delivery-status">
        <div className="delivery-count-box">
          <span className="delivery-count">{counts}</span>
          <span className="delivery-target">/ {review.target} standing</span>
        </div>
        <div className={`timer ${secondsLeft !== null && secondsLeft <= 10 ? "urgent" : ""}`}>
          {secondsLeft !== null ? `${secondsLeft}s` : "…"}
        </div>
      </div>
      <p className="hint">
        {delivering
          ? "Defend or concede anything the other team flags."
          : "Tap 🚩 on anything that isn't in the category or is a duplicate. Unflagged items count."}
      </p>

      <ul className="review-list">
        {review.items.map((item, i) => (
          <li key={i} className={`review-item status-${item.status}`}>
            <span className="review-word">{item.raw}</span>
            <span className="review-status">{STATUS_LABEL[item.status]}</span>
            {!delivering && item.status === "ok" && (
              <button className="btn small" onClick={() => onFlag(i)}>
                🚩 Flag
              </button>
            )}
            {delivering && item.status === "flagged" && (
              <span className="review-actions">
                <button className="btn small" onClick={() => onRespond(i, "defend")}>
                  🛡 Defend
                </button>
                <button className="btn small danger" onClick={() => onRespond(i, "concede")}>
                  Concede
                </button>
              </span>
            )}
            {!delivering && item.status === "defended" && (
              <span className="review-actions">
                <button className="btn small" onClick={() => onFinalize(i, "accept")}>
                  ✓ Accept
                </button>
                <button className="btn small danger" onClick={() => onFinalize(i, "uphold")}>
                  ✗ Uphold
                </button>
              </span>
            )}
          </li>
        ))}
        {review.items.length === 0 && <li className="empty-slot">No items were named 😬</li>}
      </ul>

      {delivering && anyFlagged && (
        <div className="lobby-buttons">
          <button className="btn danger small" onClick={() => onRespond(-1, "concede")}>
            Concede all flags
          </button>
        </div>
      )}
    </div>
  );
}
