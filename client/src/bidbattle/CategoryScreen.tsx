import { useState } from "react";
import type { BidBattleSnapshot } from "@shared/bidbattle";
import { customApprovalThreshold } from "@shared/bidbattle";
import { useSecondsLeft } from "../core/hooks";
import Icon from "../components/Icon";

interface Props {
  room: BidBattleSnapshot;
  myVote: number | null;
  onSuggest: (text: string) => void;
  onVote: (optionId: number) => void;
}

export default function CategoryScreen({ room, myVote, onSuggest, onVote }: Props) {
  const [text, setText] = useState("");
  const secondsLeft = useSecondsLeft(room.ballot?.deadline ?? null);
  const threshold = customApprovalThreshold(room.settings.mode);

  if (room.category) {
    return (
      <div className="panel vote-screen">
        <h2 className="screen-title">Category</h2>
        <p className="chosen-category">{room.category}</p>
        <p className="hint">
          {room.categorySource === "custom" ? "Approved by vote" : "Drawn from the deck"} — bidding
          starts in a moment…
        </p>
      </div>
    );
  }

  if (room.isPublic || !room.ballot) {
    return (
      <div className="panel vote-screen">
        <div className="spinner" />
        <p className="hint">Drawing a category…</p>
      </div>
    );
  }

  return (
    <div className="panel vote-screen">
      <h2 className="screen-title">Pick the category</h2>
      <p className="hint">
        {secondsLeft !== null ? `${secondsLeft}s` : "…"} · a custom category needs{" "}
        {threshold} vote{threshold === 1 ? "" : "s"} or it's Random
      </p>
      <div className="vote-options">
        {room.ballot.options.map((o) => {
          const count = room.ballot!.tally[o.id] ?? 0;
          return (
            <button
              key={o.id}
              className={`btn vote-btn ${myVote === o.id ? "selected" : ""}`}
              onClick={() => onVote(o.id)}
            >
              <span className="vote-name">
                {o.kind === "random" && <><Icon name="shuffle" /> </>}
                {o.label}
                {o.suggestedBy && <span className="suggested-by"> — {o.suggestedBy}</span>}
              </span>
              {count > 0 && <span className="vote-count">{count} <Icon name="checkbox" /></span>}
            </button>
          );
        })}
      </div>
      <div className="word-row">
        <input
          value={text}
          maxLength={60}
          placeholder="Suggest a category… (max 2 each)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim().length >= 3) {
              onSuggest(text);
              setText("");
            }
          }}
        />
        <button
          className="btn"
          disabled={text.trim().length < 3}
          onClick={() => {
            onSuggest(text);
            setText("");
          }}
        >
          Add
        </button>
      </div>
      <div className="players-bar">
        {room.players.map((p) => (
          <div
            key={p.id}
            className={`player-chip ${p.voted ? "locked" : ""} ${p.connected ? "" : "disconnected"}`}
          >
            <span className={`dot ${p.connected ? "on" : "off"}`} />
            {p.name}
            <span className="lock-icon">{p.voted ? <Icon name="checkbox" /> : "…"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
