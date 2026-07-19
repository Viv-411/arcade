import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { cwTeamLabel, type CwTeam } from "@shared/codewords";
import { useCodewords } from "../codewords/useCodewords";
import BoardGrid from "../codewords/BoardGrid";
import ClueInput from "../codewords/ClueInput";
import { ClueBar, ClueHistory, WinnerBanner } from "../codewords/CluePanel";
import Toasts from "../components/Toasts";
import Icon from "../components/Icon";

/**
 * The spymaster phone view (board mode): opened by scanning a team's QR code.
 * After the token join, this phone privately shows the full shared key — the
 * same key the other spymaster's phone shows.
 */
export default function CodewordsKeyPage() {
  const [params] = useSearchParams();
  const code = (params.get("room") ?? "").toUpperCase();
  const teamParam = params.get("team");
  const team: CwTeam | null =
    teamParam === "red" ? "red" : teamParam === "blue" ? "blue" : null;
  const token = params.get("token") ?? "";

  const { state, actions } = useCodewords("codewords-key");
  const { room } = state;
  const attemptedRef = useRef(false);

  const linkValid = Boolean(code && team && token);

  // Join via the QR token once connected — after a short grace so a stored
  // session's automatic rejoin (page reload) wins when it can.
  useEffect(() => {
    if (state.status !== "connected" || room || !linkValid || attemptedRef.current) return;
    const t = setTimeout(() => {
      if (attemptedRef.current) return;
      attemptedRef.current = true;
      actions.joinViaToken(code, team!, token);
    }, 800);
    return () => clearTimeout(t);
  }, [state.status, room, linkValid, code, team, token, actions.joinViaToken]);

  const me = room?.players.find((p) => p.id === state.playerId) ?? null;
  const myTeam = me?.team ?? team;
  const finished = room?.state === "finished";
  const myClueTurn =
    room?.state === "playing" &&
    room.phase === "clue" &&
    room.activeTeam !== null &&
    room.activeTeam === myTeam;

  return (
    <div className="page codewords">
      <header className="mm-header">
        <Link to="/" className="back-link">
          ← Arcade
        </Link>
        <h1 className="mm-title">
          {myTeam === "red" ? <Icon name="circle" className="ic-red" /> : myTeam === "blue" ? <Icon name="circle" className="ic-blue" /> : <Icon name="grid-3x3" />}{" "}
          {myTeam ? `${cwTeamLabel(myTeam)} Spymaster` : "Spymaster"}
        </h1>
      </header>

      {!linkValid ? (
        <div className="panel">
          <p>
            This page opens from a shared board's QR code. Ask the board host to show the QR
            codes and scan your team's one.
          </p>
        </div>
      ) : !room ? (
        <div className="panel">
          <div className="spinner" />
          <p>Joining room {code} as the {team ? cwTeamLabel(team) : ""} spymaster…</p>
          <button
            className="btn"
            onClick={() => {
              attemptedRef.current = false;
              actions.joinViaToken(code, team!, token);
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {finished && <WinnerBanner room={room} myTeam={myTeam} />}
          <ClueBar room={room} myTeam={myTeam} />
          {room.state === "lobby" && (
            <p className="panel hint">
              You're in! Keep this phone to yourself — the key appears here when the board
              starts the game.
            </p>
          )}
          {myClueTurn && (
            <ClueInput
              onSubmit={(word, number, reset) => actions.submitClue(word, number, reset)}
            />
          )}
          {myClueTurn && (
            <p className="hint">
              …or just say your clue out loud and have the board log the number.
            </p>
          )}
          {room.state !== "lobby" && (
            <>
              <BoardGrid
                board={room.board}
                cardKey={finished ? room.fullKey : state.cardKey}
              />
              {!finished && (
                <p className="hint">
                  <Icon name="eye-off" /> This is the full secret key — both spymasters see the same one. Don't
                  show the guessers!
                </p>
              )}
            </>
          )}
          <ClueHistory room={room} />
        </>
      )}

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
