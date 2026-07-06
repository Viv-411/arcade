import { useState } from "react";
import { Link } from "react-router-dom";
import type { BidBattleMode } from "@shared/bidbattle";
import { useBidBattle } from "../bidbattle/useBidBattle";
import GameEntry from "../components/GameEntry";
import BidBattleLobby from "../bidbattle/BidBattleLobby";
import ScoreBar from "../bidbattle/ScoreBar";
import CategoryScreen from "../bidbattle/CategoryScreen";
import BiddingScreen from "../bidbattle/BiddingScreen";
import DeliveryScreen from "../bidbattle/DeliveryScreen";
import ReviewScreen from "../bidbattle/ReviewScreen";
import WinnerScreen from "../bidbattle/WinnerScreen";
import Toasts from "../components/Toasts";

export default function BidBattlePage() {
  const { state, actions } = useBidBattle();
  const { room } = state;
  const [mode, setMode] = useState<BidBattleMode>("1v1");
  const [targetPoints, setTargetPoints] = useState(3);
  const myTeam = room?.players.find((p) => p.id === state.playerId)?.team ?? null;

  let screen: JSX.Element;
  if (!room) {
    screen = (
      <>
        <GameEntry
          busy={state.busy}
          blurb={
            <>
              A team category auction: bid how many <em>car brands</em> (or dog breeds, or world
              capitals…) your team can name. Raise the stakes — or say{" "}
              <strong>"make them name it"</strong> and watch them sweat.
            </>
          }
          preActions={
            <div className="mode-toggle-row">
              <span className="field-label">Mode:</span>
              <div className="mode-toggle">
                {(["1v1", "2v2"] as const).map((m) => (
                  <button
                    key={m}
                    className={`btn small ${mode === m ? "primary" : ""}`}
                    onClick={() => setMode(m)}
                  >
                    {m === "1v1" ? "⚔️ 1v1" : "👥 2v2"}
                  </button>
                ))}
              </div>
            </div>
          }
          advanced={
            <label className="field">
              <span>Match length</span>
              <select
                value={targetPoints}
                onChange={(e) => setTargetPoints(Number(e.target.value))}
              >
                <option value={1}>First to 1 point</option>
                <option value={2}>First to 2 points</option>
                <option value={3}>First to 3 points</option>
                <option value={5}>First to 5 points</option>
              </select>
            </label>
          }
          onCreate={(name) => actions.createRoom(name, false, { mode, targetPoints })}
          onJoin={actions.joinRoom}
          onQuickPlay={(name) => actions.quickPlay(name, mode)}
        />
        <section className="howto panel">
          <h3>How to play</h3>
          <ol>
            <li>Get a category (quick play draws one; private rooms vote on a ballot).</li>
            <li>
              Teams take turns bidding how many they can name — raise, or say "make them name it"
              to end the auction. Sitting on the clock counts as declining.
            </li>
            <li>The high bidders then have 60 seconds to name that many. Exact repeats don't count.</li>
            <li>
              The other team reviews the list — flag junk, the namers defend or concede, the
              challengers make the final call. Hit your bid and you score; fall short and they do.
            </li>
            <li>First team to 3 points wins. Honor system — play with people you trust! 😄</li>
          </ol>
        </section>
      </>
    );
  } else if (room.state === "lobby") {
    screen = (
      <BidBattleLobby
        room={room}
        playerId={state.playerId}
        onSetMode={actions.setMode}
        onAssignTeam={actions.assignTeam}
        onToggleReady={actions.toggleReady}
        onStart={actions.startGame}
        onLeave={actions.leaveRoom}
      />
    );
  } else if (room.state === "finished") {
    screen = (
      <WinnerScreen
        room={room}
        myTeam={myTeam}
        winner={state.winner}
        onPlayAgain={actions.playAgain}
        onLeave={actions.leaveRoom}
      />
    );
  } else {
    let phase: JSX.Element | null;
    if (room.state === "category") {
      phase = (
        <CategoryScreen
          room={room}
          myVote={state.myVote}
          onSuggest={actions.suggestCategory}
          onVote={actions.voteCategory}
        />
      );
    } else if (room.state === "bidding") {
      phase = (
        <BiddingScreen
          room={room}
          myTeam={myTeam}
          onRaise={actions.raiseBid}
          onChallenge={actions.challengeBid}
        />
      );
    } else if (room.state === "delivery") {
      phase = (
        <DeliveryScreen
          room={room}
          myTeam={myTeam}
          liveItems={state.liveItems}
          onSubmitItem={actions.submitItem}
          onDone={actions.finishDelivery}
        />
      );
    } else {
      phase = (
        <ReviewScreen
          room={room}
          myTeam={myTeam}
          onFlag={actions.flagItem}
          onRespond={actions.respondToFlag}
          onFinalize={actions.finalizeFlag}
        />
      );
    }
    screen = (
      <>
        <ScoreBar room={room} myTeam={myTeam} onLeave={actions.leaveRoom} />
        {phase}
        {state.result && (
          <div className="overlay reveal-overlay">
            <div className="panel reveal-panel">
              <h2>
                {state.result.winnerTeam === myTeam ? "🎉 Point for your team!" : "😤 Point lost!"}
              </h2>
              <p>
                <strong>{state.result.category}</strong>: Team {state.result.deliveringTeam} named{" "}
                {state.result.validCount} of {state.result.target} needed —{" "}
                {state.result.validCount >= state.result.target ? "delivered!" : "fell short."}
              </p>
              <p className="win-rounds">
                Team A {state.result.scores.A} — {state.result.scores.B} Team B
              </p>
              <p className="next-round">Next round coming up…</p>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="page bidbattle">
      <header className="mm-header">
        <Link to="/" className="back-link">
          ← Arcade
        </Link>
        <h1 className="mm-title">💰 Bid Battle</h1>
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
