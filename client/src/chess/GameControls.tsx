import { useState } from "react";
import {
  CHESS_MAX_BASE_MINUTES,
  CHESS_MAX_INCREMENT_SECONDS,
  CHESS_PRESETS,
  formatTimeControl,
  type ChessColorPref,
  type ChessTimeControl,
} from "@shared/chess";
import { BOARD_THEMES, type BoardTheme } from "./theme";
import Icon from "../components/Icon";

/** Time control picker: presets plus a custom base+increment entry. */
export function TimeControlPicker({
  value,
  disabled,
  onChange,
}: {
  value: ChessTimeControl;
  disabled?: boolean;
  onChange: (tc: ChessTimeControl) => void;
}) {
  const matchesPreset = CHESS_PRESETS.some(
    (p) =>
      p.tc.baseMinutes === value.baseMinutes &&
      p.tc.incrementSeconds === value.incrementSeconds,
  );
  const [custom, setCustom] = useState(!matchesPreset);

  return (
    <div className="chess-tc">
      <div className="chess-tc-presets">
        {CHESS_PRESETS.map((p) => {
          const active =
            !custom &&
            p.tc.baseMinutes === value.baseMinutes &&
            p.tc.incrementSeconds === value.incrementSeconds;
          return (
            <button
              key={p.label}
              type="button"
              className={`btn small chess-tc-btn ${active ? "primary" : ""}`}
              disabled={disabled}
              onClick={() => {
                setCustom(false);
                onChange(p.tc);
              }}
            >
              <span className="chess-tc-group">{p.group}</span>
              <span className="chess-tc-label">{p.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`btn small chess-tc-btn ${custom ? "primary" : ""}`}
          disabled={disabled}
          onClick={() => setCustom(true)}
        >
          <span className="chess-tc-group">Custom</span>
          <span className="chess-tc-label">
            <Icon name="settings" />
          </span>
        </button>
      </div>

      {custom && (
        <div className="chess-tc-custom">
          <label className="field">
            <span>Minutes per side (0 = unlimited)</span>
            <input
              type="number"
              min={0}
              max={CHESS_MAX_BASE_MINUTES}
              value={value.baseMinutes}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...value, baseMinutes: clampNum(e.target.value, 0, CHESS_MAX_BASE_MINUTES) })
              }
            />
          </label>
          <label className="field">
            <span>Increment (seconds)</span>
            <input
              type="number"
              min={0}
              max={CHESS_MAX_INCREMENT_SECONDS}
              value={value.incrementSeconds}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...value,
                  incrementSeconds: clampNum(e.target.value, 0, CHESS_MAX_INCREMENT_SECONDS),
                })
              }
            />
          </label>
        </div>
      )}
      <p className="hint">
        Selected: <strong>{formatTimeControl(value)}</strong>
      </p>
    </div>
  );
}

function clampNum(raw: string, min: number, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** White / Black / Random picker. */
export function ColorPicker({
  value,
  disabled,
  label,
  onChange,
}: {
  value: ChessColorPref;
  disabled?: boolean;
  label: string;
  onChange: (c: ChessColorPref) => void;
}) {
  const options: { id: ChessColorPref; text: string }[] = [
    { id: "white", text: "White" },
    { id: "black", text: "Black" },
    { id: "random", text: "Random" },
  ];
  return (
    <div className="field">
      <span>{label}</span>
      <div className="chess-color-row">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`btn small ${value === o.id ? "primary" : ""}`}
            disabled={disabled}
            onClick={() => onChange(o.id)}
          >
            {o.id !== "random" && <span className={`chess-color-dot ${o.id}`} />}
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Board theme + sound toggle — per-viewer preferences, stored locally. */
export function BoardPrefs({
  theme,
  onTheme,
  sound,
  onSound,
}: {
  theme: BoardTheme;
  onTheme: (t: BoardTheme) => void;
  sound: boolean;
  onSound: (on: boolean) => void;
}) {
  return (
    <div className="chess-prefs">
      <div className="chess-theme-row">
        {BOARD_THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chess-theme-swatch ${theme.id === t.id ? "active" : ""}`}
            title={t.name}
            aria-label={`${t.name} board`}
            onClick={() => onTheme(t)}
          >
            <span style={{ background: t.light }} />
            <span style={{ background: t.dark }} />
          </button>
        ))}
      </div>
      <button className="btn small" onClick={() => onSound(!sound)}>
        <Icon name={sound ? "megaphone" : "close"} /> Sound {sound ? "on" : "off"}
      </button>
    </div>
  );
}
