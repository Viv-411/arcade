import type { BidBattleSnapshot, TeamId } from "@shared/bidbattle";

interface Props {
  room: BidBattleSnapshot;
  myTeam: TeamId | null;
  onLeave: () => void;
}

export default function ScoreBar({ room, myTeam, onLeave }: Props) {
  return (
    <div className="round-bar panel score-bar">
      <div className={`team-score team-a ${myTeam === "A" ? "mine" : ""}`}>
        <span className="team-label">Team A{myTeam === "A" ? " (you)" : ""}</span>
        <span className="team-points">{room.scores.A}</span>
      </div>
      <div className="score-mid">
        <span className="round-max">Round {room.round}</span>
        <span className="score-target">first to {room.settings.targetPoints}</span>
      </div>
      <div className={`team-score team-b ${myTeam === "B" ? "mine" : ""}`}>
        <span className="team-label">Team B{myTeam === "B" ? " (you)" : ""}</span>
        <span className="team-points">{room.scores.B}</span>
      </div>
      <button className="btn small danger" onClick={onLeave}>
        Leave
      </button>
    </div>
  );
}
