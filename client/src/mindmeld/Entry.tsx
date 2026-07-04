import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { RoomSettings } from "@shared/types";
import { NAME_KEY } from "./useMindMeld";

interface Props {
  busy: boolean;
  onCreate: (name: string, isPublic: boolean, settings?: Partial<RoomSettings>) => void;
  onJoin: (code: string, name: string) => void;
  onQuickPlay: (name: string) => void;
}

export default function Entry({ busy, onCreate, onJoin, onQuickPlay }: Props) {
  const [params] = useSearchParams();
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [code, setCode] = useState(() => (params.get("room") ?? "").toUpperCase());
  const [showJoin, setShowJoin] = useState(() => Boolean(params.get("room")));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [roundTimeSec, setRoundTimeSec] = useState(60);
  const [matchMode, setMatchMode] = useState<"strict" | "loose">("strict");

  const trimmed = name.trim();
  const remember = () => localStorage.setItem(NAME_KEY, trimmed);
  const needName = () => trimmed.length === 0;

  return (
    <div className="entry panel">
      <p className="entry-blurb">
        Sync brains with 2–4 players: everyone secretly submits a word, then keeps
        submitting until you all say the <strong>same</strong> word. Used words are
        dead forever!
      </p>

      <label className="field">
        <span>Your name</span>
        <input
          value={name}
          maxLength={20}
          placeholder="e.g. Kumaresh"
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </label>

      <div className="entry-buttons">
        <button
          className="btn primary"
          disabled={busy || needName()}
          onClick={() => {
            remember();
            onQuickPlay(trimmed);
          }}
        >
          ⚡ Quick Play
        </button>
        <button
          className="btn"
          disabled={busy || needName()}
          onClick={() => {
            remember();
            onCreate(trimmed, false, { roundTimeSec, matchMode });
          }}
        >
          🔒 Create private room
        </button>
        <button className="btn" disabled={busy} onClick={() => setShowJoin((s) => !s)}>
          🔑 Join with code
        </button>
      </div>

      {showJoin && (
        <div className="join-row">
          <input
            className="code-input"
            value={code}
            maxLength={4}
            placeholder="CODE"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
          />
          <button
            className="btn primary"
            disabled={busy || needName() || code.length !== 4}
            onClick={() => {
              remember();
              onJoin(code, trimmed);
            }}
          >
            Join
          </button>
        </div>
      )}

      <button className="link-btn" onClick={() => setShowAdvanced((s) => !s)}>
        {showAdvanced ? "▾" : "▸"} Room settings (for created rooms)
      </button>
      {showAdvanced && (
        <div className="advanced">
          <label className="field">
            <span>Round time</span>
            <select
              value={roundTimeSec}
              onChange={(e) => setRoundTimeSec(Number(e.target.value))}
            >
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
              <option value={90}>90 seconds</option>
              <option value={120}>2 minutes</option>
            </select>
          </label>
          <label className="field">
            <span>Word matching</span>
            <select
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value === "loose" ? "loose" : "strict")}
            >
              <option value="strict">Strict (exact after normalizing)</option>
              <option value="loose">Loose (cats = cat)</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
