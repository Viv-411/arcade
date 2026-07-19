import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { cwTeamLabel, type CwClueNumber, type CwTeam } from "@shared/codewords";
import { useCodewords } from "../codewords/useCodewords";
import BoardGrid from "../codewords/BoardGrid";
import { ClueBar, ClueHistory, WinnerBanner } from "../codewords/CluePanel";
import Toasts from "../components/Toasts";
import Icon from "../components/Icon";

const TEAMS: CwTeam[] = ["red", "blue"];
const NUMBERS: CwClueNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, "unlimited"];

function keyLink(code: string, team: CwTeam, token: string): string {
  return `${window.location.origin}/codewords/key?room=${code}&team=${team}&token=${token}`;
}

/** Per-team QR pair the spymasters scan; identifies the phone's team only —
 *  both phones receive the same full key. */
function QrPair({
  code,
  tokens,
  small,
}: {
  code: string;
  tokens: Record<CwTeam, string>;
  small?: boolean;
}) {
  const [urls, setUrls] = useState<Record<CwTeam, string | null>>({ red: null, blue: null });
  const [copiedTeam, setCopiedTeam] = useState<CwTeam | null>(null);
  useEffect(() => {
    let alive = true;
    for (const team of TEAMS) {
      void QRCode.toDataURL(keyLink(code, team, tokens[team]), {
        width: 384,
        margin: 1,
        color: { dark: "#0d0d1f", light: "#f2f2ff" },
      }).then(
        (url) => alive && setUrls((u) => ({ ...u, [team]: url })),
        () => alive && setUrls((u) => ({ ...u, [team]: null })),
      );
    }
    return () => {
      alive = false;
    };
  }, [code, tokens]);
  return (
    <div className={`cw-qr-pair ${small ? "cw-qr-small" : ""}`}>
      {TEAMS.map((team) => (
        <div key={team} className={`cw-qr cw-qr-${team}`}>
          <h3>{team === "red" ? <><Icon name="circle" className="ic-red" /> Red spymaster</> : <><Icon name="circle" className="ic-blue" /> Blue spymaster</>}</h3>
          {urls[team] ? (
            <img src={urls[team]!} alt={`${cwTeamLabel(team)} spymaster QR`} />
          ) : (
            <div className="spinner" />
          )}
          <button
            className="link-btn"
            onClick={() => {
              navigator.clipboard.writeText(keyLink(code, team, tokens[team])).then(
                () => {
                  setCopiedTeam(team);
                  setTimeout(() => setCopiedTeam(null), 1500);
                },
                () => setCopiedTeam(null),
              );
            }}
          >
            {copiedTeam === team ? <><Icon name="check" /> Copied!</> : "copy link instead"}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function CodewordsBoardPage() {
  const { state, actions } = useCodewords("codewords-board");
  const { room } = state;
  const [selected, setSelected] = useState<number | null>(null);
  const [manualNumber, setManualNumber] = useState<CwClueNumber>(1);
  const [showQrs, setShowQrs] = useState(false);

  // Any turn/board change invalidates a pending tap-to-confirm selection.
  useEffect(() => setSelected(null), [room?.phase, room?.activeTeam, room?.state]);

  let screen: JSX.Element;
  if (!room) {
    screen = (
      <div className="entry panel">
        <p className="entry-blurb">
          Put this screen where everyone can see it — a laptop or TV. It shows the word grid
          and two QR codes; each spymaster scans their team's code to get the secret key on
          their phone. Everyone else plays out loud and taps guesses right here.
        </p>
        <div className="entry-buttons">
          <button
            className="btn primary"
            disabled={state.busy}
            onClick={() => actions.createRoom("Shared Board", false, { mode: "board" })}
          >
            <Icon name="tv" /> Create a shared board
          </button>
        </div>
        <p className="hint">
          The board never shows the key — only the spymasters' phones hold it.
        </p>
      </div>
    );
  } else if (room.state === "lobby") {
    const phoneStatus = TEAMS.map((team) => {
      const spy = room.players.find((p) => p.team === team && p.role === "spymaster");
      return { team, connected: Boolean(spy?.connected) };
    });
    const ready = phoneStatus.every((s) => s.connected);
    screen = (
      <div className="lobby panel">
        <div className="room-code-box">
          <span className="room-code-label">Shared board</span>
          <span className="room-code">{room.code}</span>
        </div>
        {state.boardTokens ? (
          <QrPair code={room.code} tokens={state.boardTokens} />
        ) : (
          <div className="spinner" />
        )}
        <ul className="player-list">
          {phoneStatus.map((s) => (
            <li key={s.team}>
              <span className={`dot ${s.connected ? "on" : "off"}`} />
              <span className="player-name">
                {s.team === "red" ? <Icon name="circle" className="ic-red" /> : <Icon name="circle" className="ic-blue" />} {cwTeamLabel(s.team)} spymaster phone
              </span>
              <span className={`badge ${s.connected ? "ready-badge" : "waiting-badge"}`}>
                {s.connected ? "Connected" : "Scan the QR"}
              </span>
            </li>
          ))}
        </ul>
        <div className="lobby-buttons">
          <button className="btn primary" disabled={!ready} onClick={actions.startGame}>
            <Icon name="play" /> Start game
          </button>
          <button className="btn danger" onClick={actions.leaveRoom}>
            Close board
          </button>
        </div>
        {!ready && <p className="hint">Waiting for both spymasters to scan their QR code…</p>}
      </div>
    );
  } else {
    const finished = room.state === "finished";
    const guessPhase = room.state === "playing" && room.phase === "guess";
    screen = (
      <>
        {finished && <WinnerBanner room={room} onPlayAgain={actions.playAgain} onLeave={actions.leaveRoom} />}
        <ClueBar room={room} />
        {room.state === "playing" && room.phase === "clue" && (
          <div className="panel cw-manual-clue">
            <p>
              Waiting for the {room.activeTeam ? cwTeamLabel(room.activeTeam) : ""} spymaster —
              they can type the clue on their phone, or say it out loud and log the number
              here:
            </p>
            <div className="cw-clue-row">
              <select
                value={String(manualNumber)}
                onChange={(e) =>
                  setManualNumber(
                    e.target.value === "unlimited" ? "unlimited" : Number(e.target.value),
                  )
                }
              >
                {NUMBERS.map((n) => (
                  <option key={String(n)} value={String(n)}>
                    {n === "unlimited" ? "∞" : n}
                  </option>
                ))}
              </select>
              <button
                className="btn primary"
                onClick={() => actions.submitClue(null, manualNumber)}
              >
                <Icon name="megaphone" /> Clue given
              </button>
            </div>
          </div>
        )}
        <BoardGrid
          board={room.board}
          cardKey={finished ? room.fullKey : null}
          selected={selected}
          big
          interactive={guessPhase}
          onCard={(i) => setSelected((s) => (s === i ? null : i))}
        />
        {guessPhase && (
          <div className="cw-guess-actions">
            {selected !== null && (
              <button
                className="btn primary"
                onClick={() => {
                  actions.revealCard(selected);
                  setSelected(null);
                }}
              >
                <Icon name="pointer" /> Reveal “{room.board[selected]?.word.toUpperCase()}”
              </button>
            )}
            <button
              className="btn"
              disabled={room.guessesMade < 1}
              onClick={actions.passTurn}
            >
              <Icon name="hand" /> Pass turn
            </button>
          </div>
        )}
        {room.needsSpymaster.length > 0 && !finished && (
          <p className="cw-claim panel">
            <Icon name="warning" /> {room.needsSpymaster.map((t) => cwTeamLabel(t)).join(" & ")} spymaster phone
            disconnected — re-scan the QR below to restore it.
          </p>
        )}
        {!finished && (
          <>
            <button className="link-btn" onClick={() => setShowQrs((s) => !s)}>
              {showQrs ? "▾" : "▸"} Spymaster QR codes (re-scan)
            </button>
            {showQrs && state.boardTokens && (
              <QrPair code={room.code} tokens={state.boardTokens} small />
            )}
          </>
        )}
        <ClueHistory room={room} />
        {!finished && (
          <div className="lobby-buttons">
            <button className="btn danger" onClick={actions.leaveRoom}>
              Close board
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="page codewords cw-board-page">
      <header className="mm-header">
        <Link to="/codewords" className="back-link">
          ← Codewords
        </Link>
        <h1 className="mm-title"><Icon name="grid-3x3" /> Codewords — Shared Board</h1>
      </header>
      {screen}
      {state.status === "reconnecting" && (
        <div className="overlay reconnecting">
          <div className="panel">
            <div className="spinner" />
            <p>Reconnecting…</p>
          </div>
        </div>
      )}
      <Toasts toasts={state.toasts} onDismiss={actions.dismissToast} />
    </div>
  );
}
