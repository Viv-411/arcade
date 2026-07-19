import { useEffect, useState } from "react";
import type { BidBattleSnapshot, TeamId } from "@shared/bidbattle";
import { useSecondsLeft } from "../core/hooks";
import Icon from "../components/Icon";

interface Props {
  room: BidBattleSnapshot;
  myTeam: TeamId | null;
  onRaise: (amount: number) => void;
  onChallenge: () => void;
}

export default function BiddingScreen({ room, myTeam, onRaise, onChallenge }: Props) {
  const bidding = room.bidding;
  const [amount, setAmount] = useState("");
  const secondsLeft = useSecondsLeft(bidding?.deadline ?? null);
  const myTurn = bidding !== null && myTeam !== null && bidding.turnTeam === myTeam;
  const minBid = (bidding?.currentBid ?? 0) + 1;

  useEffect(() => {
    setAmount(String(minBid));
  }, [minBid]);

  if (!bidding) return null;
  const parsed = Math.floor(Number(amount));
  const canRaise = myTurn && Number.isFinite(parsed) && parsed >= minBid;

  return (
    <div className="panel bidding-screen">
      <p className="category-banner">
        Category: <strong>{room.category}</strong>
      </p>

      <div className="bid-status">
        <div className="current-bid">
          {bidding.currentBid > 0 ? (
            <>
              <span className="bid-amount">{bidding.currentBid}</span>
              <span className="bid-holder">
                Team {bidding.lastBidTeam} says they can name {bidding.currentBid}
              </span>
            </>
          ) : (
            <span className="bid-holder">
              No bids yet — Team {bidding.turnTeam} opens
              {bidding.openingPassed ? " (first opener passed!)" : ""}
            </span>
          )}
        </div>
        <div className={`timer ${secondsLeft !== null && secondsLeft <= 3 ? "urgent" : ""}`}>
          {secondsLeft !== null ? `${secondsLeft}s` : "…"}
        </div>
      </div>

      <p className={`turn-banner ${myTurn ? "my-turn" : ""}`}>
        {myTurn ? <><Icon name="zap" /> Your team's turn!</> : `Team ${bidding.turnTeam} is thinking…`}
      </p>

      {myTurn && (
        <div className="bid-controls">
          <div className="word-row">
            <input
              type="number"
              min={minBid}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canRaise) onRaise(parsed);
              }}
            />
            <button className="btn primary" disabled={!canRaise} onClick={() => onRaise(parsed)}>
              Raise to {Number.isFinite(parsed) ? parsed : "?"}
            </button>
          </div>
          <button
            className="btn challenge-btn"
            disabled={bidding.currentBid < 1}
            onClick={onChallenge}
            title={bidding.currentBid < 1 ? "No bid to challenge yet — you must open" : ""}
          >
            <Icon name="sword" /> Make them name it
          </button>
          <p className="hint">
            Raise if your team can name more — or make Team{" "}
            {bidding.lastBidTeam ?? "?"} prove their {bidding.currentBid || "?"}. Timeout counts
            as declining.
          </p>
        </div>
      )}

      {bidding.history.length > 0 && (
        <div className="bid-history">
          {bidding.history.map((b, i) => (
            <span key={i} className={`word-chip bid-chip team-${b.team.toLowerCase()}`}>
              {b.team}: {b.amount}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
