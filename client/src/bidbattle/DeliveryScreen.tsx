import { useRef, useState } from "react";
import type { BidBattleSnapshot, TeamId } from "@shared/bidbattle";
import { normalizeWord } from "@shared/normalize";
import { useSecondsLeft } from "../core/hooks";

interface Props {
  room: BidBattleSnapshot;
  myTeam: TeamId | null;
  liveItems: { raw: string; normalized: string }[];
  onSubmitItem: (text: string, onResult?: (ok: boolean) => void) => void;
  onDone: () => void;
}

export default function DeliveryScreen({ room, myTeam, liveItems, onSubmitItem, onDone }: Props) {
  const delivery = room.delivery;
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const secondsLeft = useSecondsLeft(delivery?.deadline ?? null);

  if (!delivery) return null;
  const delivering = myTeam === delivery.deliveringTeam;
  const normalized = normalizeWord(text);
  const alreadySaid = normalized.length > 0 && liveItems.some((i) => i.normalized === normalized);

  const submit = () => {
    if (!normalized || alreadySaid) return;
    onSubmitItem(text);
    setText("");
    inputRef.current?.focus();
  };

  return (
    <div className="panel delivery-screen">
      <p className="category-banner">
        Category: <strong>{room.category}</strong>
      </p>
      <div className="delivery-status">
        <div className="delivery-count-box">
          <span className="delivery-count">{delivery.count}</span>
          <span className="delivery-target">/ {delivery.target} needed</span>
        </div>
        <div className={`timer ${secondsLeft !== null && secondsLeft <= 10 ? "urgent" : ""}`}>
          {secondsLeft !== null ? `${secondsLeft}s` : "…"}
        </div>
      </div>

      {delivering ? (
        <>
          <div className="word-row">
            <input
              ref={inputRef}
              value={text}
              maxLength={60}
              placeholder="Name one…"
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button className="btn primary" disabled={!normalized || alreadySaid} onClick={submit}>
              Add
            </button>
          </div>
          {alreadySaid && <p className="used-warning">⚠ already said — doesn't count</p>}
          <p className="hint">
            Name at least {delivery.target}. Extras build a buffer for the review. Your whole team
            shares this list — and the other team is watching it live.
          </p>
          <div className="word-chips delivery-list">
            {liveItems.map((i, idx) => (
              <span key={idx} className="word-chip">
                {i.raw}
              </span>
            ))}
          </div>
          <div className="lobby-buttons">
            <button className="btn" onClick={onDone}>
              ✅ Done — send to review
            </button>
          </div>
        </>
      ) : (
        <div className="opposing-wait">
          <p>
            Team {delivery.deliveringTeam} is naming <strong>{room.category}</strong> — watch
            their list and get your flags ready for the review!
          </p>
          <div className="word-chips delivery-list">
            {liveItems.map((i, idx) => (
              <span key={idx} className="word-chip">
                {i.raw}
              </span>
            ))}
            {liveItems.length === 0 && <span className="hint">Nothing yet…</span>}
          </div>
        </div>
      )}
    </div>
  );
}
