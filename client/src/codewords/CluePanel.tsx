import { cwTeamLabel, type CodewordsSnapshot, type CwTeam } from "@shared/codewords";

function teamDot(team: CwTeam): string {
  return team === "red" ? "🔴" : "🔵";
}

/** Score + whose-turn + current-clue banner shown on every surface. */
export function ClueBar({ room, myTeam }: { room: CodewordsSnapshot; myTeam?: CwTeam | null }) {
  const { activeTeam, phase, clue, guessesRemaining, remaining } = room;
  if (!activeTeam) return null;
  const turnLabel =
    phase === "clue"
      ? `${teamDot(activeTeam)} ${cwTeamLabel(activeTeam)} spymaster is thinking of a clue…`
      : clue
        ? `${teamDot(activeTeam)} ${cwTeamLabel(activeTeam)} is guessing — ${
            clue.word ? `“${clue.word.toUpperCase()}”` : "spoken clue"
          } · ${clue.number === "unlimited" ? "∞" : clue.number}`
        : "";
  return (
    <div className="cw-cluebar panel">
      <div className="cw-score">
        <span className="cw-score-chip cw-chip-red">🔴 {remaining.red} left</span>
        <span className="cw-score-chip cw-chip-blue">🔵 {remaining.blue} left</span>
      </div>
      <p className="cw-turn">
        {turnLabel}
        {myTeam && activeTeam === myTeam && <strong> (your team!)</strong>}
      </p>
      {phase === "guess" && (
        <p className="cw-guesses">
          Guesses left this turn: <strong>{guessesRemaining ?? "unlimited"}</strong>
        </p>
      )}
    </div>
  );
}

/** Past clues with the guesses each one produced. */
export function ClueHistory({ room }: { room: CodewordsSnapshot }) {
  if (room.clueHistory.length === 0) return null;
  return (
    <section className="cw-history panel">
      <h3>Clue log</h3>
      {[...room.clueHistory].reverse().map((entry, i) => (
        <div key={room.clueHistory.length - i} className="cw-history-row">
          <span className={`cw-history-clue cw-text-${entry.team}`}>
            {teamDot(entry.team)}{" "}
            {entry.word ? entry.word.toUpperCase() : "(spoken)"} ·{" "}
            {entry.number === "unlimited" ? "∞" : entry.number}
          </span>
          <span className="cw-history-guesses">
            {entry.guesses.length === 0
              ? "no guesses yet"
              : entry.guesses
                  .map(
                    (guess) =>
                      `${guess.word.toUpperCase()} ${
                        guess.identity === "assassin"
                          ? "💀"
                          : guess.identity === "bystander"
                            ? "🚶"
                            : guess.identity === entry.team
                              ? "✅"
                              : "❌"
                      }`,
                  )
                  .join("  ")}
          </span>
        </div>
      ))}
    </section>
  );
}

/** Game-over banner used by all surfaces (the grid shows the full key). */
export function WinnerBanner({
  room,
  myTeam,
  onPlayAgain,
  onLeave,
}: {
  room: CodewordsSnapshot;
  myTeam?: CwTeam | null;
  onPlayAgain?: () => void;
  onLeave?: () => void;
}) {
  if (!room.winner) return null;
  const won = myTeam ? room.winner === myTeam : null;
  return (
    <div className="cw-winner panel">
      <h2 className={won === false ? "lose-title" : "win-title"}>
        {teamDot(room.winner)} Team {cwTeamLabel(room.winner)} wins!
        {won === true && " 🎉"}
      </h2>
      {room.gameOverReason && <p className="cw-reason">{room.gameOverReason}</p>}
      <div className="lobby-buttons">
        {onPlayAgain && (
          <button className="btn primary" onClick={onPlayAgain}>
            🔁 Play again
          </button>
        )}
        {onLeave && (
          <button className="btn danger" onClick={onLeave}>
            Leave
          </button>
        )}
      </div>
    </div>
  );
}
