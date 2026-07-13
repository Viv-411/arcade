import { Link } from "react-router-dom";
import { IMPOSTER_CATEGORIES } from "@shared/imposterWords";
import { IMPOSTER_MAX_PLAYERS } from "@shared/imposter";
import { useImposter } from "../imposter/useImposter";
import { useJoinLinkOverride } from "../core/hooks";
import GameEntry from "../components/GameEntry";
import GameLobby from "../components/GameLobby";
import Toasts from "../components/Toasts";
import {
  CluesScreen,
  DecisionScreen,
  FinalScreen,
  RevealScreen,
  StealScreen,
  VoteScreen,
} from "../imposter/OnlinePhases";

export default function ImposterOnlinePage() {
  const { state, actions } = useImposter();
  const { room } = state;
  useJoinLinkOverride(room?.code ?? null, actions.leaveRoom);
  const isHost = room !== null && state.playerId === room.hostId;

  let screen: JSX.Element;
  if (!room) {
    screen = (
      <>
        <GameEntry
          busy={state.busy}
          blurb={
            <>
              Everyone gets the same secret word — except the <strong>imposter</strong>. Take
              turns giving one-word clues, then vote out the faker before they blend in
              (or steal the word).
            </>
          }
          onCreate={(name) => actions.createRoom(name, false)}
          onJoin={actions.joinRoom}
          onQuickPlay={actions.quickPlay}
        />
        <section className="howto panel">
          <h3>How to play</h3>
          <ol>
            <li>3–{IMPOSTER_MAX_PLAYERS} players. Everyone secretly sees the word — imposters don't.</li>
            <li>Take turns giving ONE-word clues that prove you know the word.</li>
            <li>After each round, vote: keep going or accuse someone.</li>
            <li>Vote out all imposters to win — but a caught imposter gets one guess to steal the word!</li>
          </ol>
        </section>
      </>
    );
  } else if (room.state === "lobby") {
    const maxImposters = Math.max(1, room.players.length - 1);
    screen = (
      <GameLobby
        room={room}
        playerId={state.playerId}
        joinPath="/imposter-online"
        gameKey="imposter"
        minPlayers={3}
        maxPlayers={IMPOSTER_MAX_PLAYERS}
        settingsLine={`🕵️ ${room.settings.imposters} imposter${room.settings.imposters === 1 ? "" : "s"} · ${
          room.settings.category ?? "random category"
        } · hints ${room.settings.hints ? "on" : "off"} · ${room.settings.clueInputMode} clues · steal ${
          room.settings.wordSteal ? "on" : "off"
        }`}
        extras={
          isHost ? (
            <div className="imposter-settings">
              <label className="field">
                <span>Imposters</span>
                <select
                  value={Math.min(room.settings.imposters, maxImposters)}
                  onChange={(e) => actions.setSettings({ imposters: Number(e.target.value) })}
                >
                  {Array.from({ length: maxImposters }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Category</span>
                <select
                  value={room.settings.category ?? ""}
                  onChange={(e) =>
                    actions.setSettings({ category: e.target.value || null })
                  }
                >
                  <option value="">🎲 Random</option>
                  {IMPOSTER_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Imposter hints (category)</span>
                <select
                  value={room.settings.hints ? "on" : "off"}
                  onChange={(e) => actions.setSettings({ hints: e.target.value === "on" })}
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <label className="field">
                <span>Word steal</span>
                <select
                  value={room.settings.wordSteal ? "on" : "off"}
                  onChange={(e) => actions.setSettings({ wordSteal: e.target.value === "on" })}
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <label className="field">
                <span>Clues are</span>
                <select
                  value={room.settings.clueInputMode}
                  onChange={(e) =>
                    actions.setSettings({
                      clueInputMode: e.target.value === "spoken" ? "spoken" : "typed",
                    })
                  }
                >
                  <option value="typed">Typed in the app</option>
                  <option value="spoken">Spoken out loud</option>
                </select>
              </label>
              <label className="field">
                <span>Clue rounds before forced vote</span>
                <select
                  value={room.settings.maxClueRounds}
                  onChange={(e) => actions.setSettings({ maxClueRounds: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : undefined
        }
        onToggleReady={actions.toggleReady}
        onStart={actions.startGame}
        onLeave={actions.leaveRoom}
      />
    );
  } else if (room.state === "finished") {
    screen = (
      <FinalScreen
        room={room}
        playerId={state.playerId}
        end={state.end}
        onPlayAgain={actions.playAgain}
        onLeave={actions.leaveRoom}
      />
    );
  } else if (room.state === "reveal") {
    screen = <RevealScreen room={room} myRole={state.myRole} />;
  } else if (room.state === "decision") {
    screen = (
      <DecisionScreen
        room={room}
        playerId={state.playerId}
        myDecision={state.myDecision}
        onDecide={actions.castDecision}
      />
    );
  } else if (room.state === "vote") {
    screen = (
      <VoteScreen room={room} playerId={state.playerId} myVote={state.myVote} onVote={actions.castVote} />
    );
  } else if (room.state === "steal") {
    screen = (
      <StealScreen
        room={room}
        playerId={state.playerId}
        stealPrompt={state.stealPrompt}
        onGuess={actions.guessWord}
      />
    );
  } else {
    screen = (
      <CluesScreen
        room={room}
        playerId={state.playerId}
        myRole={state.myRole}
        onSubmitClue={actions.submitClue}
        onAdvanceTurn={actions.advanceTurn}
      />
    );
  }

  return (
    <div className="page imposter">
      <header className="mm-header">
        <Link to="/imposter" className="back-link">
          ← Imposter
        </Link>
        <h1 className="mm-title">🕵️ Imposter Online</h1>
      </header>
      {screen}
      {state.voteResult && room && room.state !== "finished" && (
        <div className="overlay reveal-overlay">
          <div className="panel reveal-panel">
            <h2>Vote result</h2>
            <ul className="reveal-list">
              {state.voteResult.tally.map((t) => {
                const p = room.players.find((x) => x.id === t.targetId);
                return (
                  <li key={t.targetId}>
                    <span className="history-name">{p?.name ?? "?"}</span>
                    <strong className="reveal-word">
                      {t.votes} vote{t.votes === 1 ? "" : "s"}
                    </strong>
                  </li>
                );
              })}
              {state.voteResult.tally.length === 0 && <li>Nobody voted 😶</li>}
            </ul>
            {state.voteResult.eliminatedId ? (
              <p>
                <strong>
                  {room.players.find((p) => p.id === state.voteResult!.eliminatedId)?.name ?? "?"}
                </strong>{" "}
                was eliminated — they were{" "}
                <strong className={state.voteResult.revealedRole === "imposter" ? "used-warning" : "auth-notice"}>
                  {state.voteResult.revealedRole === "imposter" ? "🕵️ the Imposter!" : "😇 crew…"}
                </strong>
              </p>
            ) : state.voteResult.runoffNext ? (
              <p className="next-round">Tie! Runoff vote coming up…</p>
            ) : (
              <p className="next-round">Still tied — nobody goes home. Back to clues…</p>
            )}
          </div>
        </div>
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
