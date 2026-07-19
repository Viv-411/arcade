import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { NAME_KEY } from "../core/useRoomCore";
import Icon from "./Icon";

interface Props {
  busy: boolean;
  blurb: ReactNode;
  /** Prominent controls between the name field and the action buttons (e.g. a mode toggle). */
  preActions?: ReactNode;
  /** Optional game-specific room settings controls (state owned by the page). */
  advanced?: ReactNode;
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
  onQuickPlay: (name: string) => void;
}

/** Shared entry screen: name + Create private room / Join with code / Quick Play. */
export default function GameEntry({
  busy,
  blurb,
  preActions,
  advanced,
  onCreate,
  onJoin,
  onQuickPlay,
}: Props) {
  const [params] = useSearchParams();
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [code, setCode] = useState(() => (params.get("room") ?? "").toUpperCase());
  const [showJoin, setShowJoin] = useState(() => Boolean(params.get("room")));
  const [showAdvanced, setShowAdvanced] = useState(false);

  // A ?room= code can arrive while this screen is already mounted (e.g.
  // tapping a friend's lobby invite while sitting on the entry screen) —
  // the initializers above only run once, so track changes too.
  useEffect(() => {
    const fromUrl = (params.get("room") ?? "").toUpperCase();
    if (fromUrl) {
      setCode(fromUrl);
      setShowJoin(true);
    }
  }, [params]);

  const trimmed = name.trim();
  const remember = () => localStorage.setItem(NAME_KEY, trimmed);
  const needName = trimmed.length === 0;

  return (
    <div className="entry panel">
      <p className="entry-blurb">{blurb}</p>

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

      {preActions}

      <div className="entry-buttons">
        <button
          className="btn primary"
          disabled={busy || needName}
          onClick={() => {
            remember();
            onQuickPlay(trimmed);
          }}
        >
          <Icon name="zap" /> Quick Play
        </button>
        <button
          className="btn"
          disabled={busy || needName}
          onClick={() => {
            remember();
            onCreate(trimmed);
          }}
        >
          <Icon name="lock" /> Create private room
        </button>
        <button className="btn" disabled={busy} onClick={() => setShowJoin((s) => !s)}>
          <Icon name="login" /> Join with code
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
            disabled={busy || needName || code.length !== 4}
            onClick={() => {
              remember();
              onJoin(code, trimmed);
            }}
          >
            Join
          </button>
        </div>
      )}

      {advanced && (
        <>
          <button className="link-btn" onClick={() => setShowAdvanced((s) => !s)}>
            {showAdvanced ? "▾" : "▸"} Room settings (for created rooms)
          </button>
          {showAdvanced && <div className="advanced">{advanced}</div>}
        </>
      )}
    </div>
  );
}
