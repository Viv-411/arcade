import type { CategoryOption, TriviaSnapshot } from "@shared/trivia";
import { useSecondsLeft } from "../core/hooks";
import Icon from "../components/Icon";

interface Props {
  room: TriviaSnapshot;
  vote: { options: CategoryOption[]; tally: Record<number, number>; deadline: number } | null;
  myVote: number | null;
  onVote: (categoryId: number) => void;
  onLeave: () => void;
}

export default function VoteScreen({ room, vote, myVote, onVote, onLeave }: Props) {
  const secondsLeft = useSecondsLeft(vote?.deadline ?? null);
  const fetching = room.chosenCategory !== null;

  if (fetching) {
    return (
      <div className="panel vote-screen">
        <h2 className="screen-title">Category chosen!</h2>
        <p className="chosen-category">{room.chosenCategory}</p>
        <div className="spinner" />
        <p className="hint">Loading questions…</p>
      </div>
    );
  }

  return (
    <div className="panel vote-screen">
      <h2 className="screen-title">Vote for a category</h2>
      <p className="hint">
        {secondsLeft !== null ? `${secondsLeft}s left` : "…"} · most votes wins, ties go
        to chance
      </p>
      <div className="vote-options">
        {(vote?.options ?? []).map((o) => {
          const count = vote?.tally[o.id] ?? 0;
          return (
            <button
              key={o.id}
              className={`btn vote-btn ${myVote === o.id ? "selected" : ""}`}
              onClick={() => onVote(o.id)}
            >
              <span className="vote-name">{o.name}</span>
              {count > 0 && <span className="vote-count">{count} <Icon name="checkbox" /></span>}
            </button>
          );
        })}
        {(vote?.options.length ?? 0) === 0 && <div className="spinner" />}
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
      <div className="lobby-buttons">
        <button className="btn small danger" onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  );
}
