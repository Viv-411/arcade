import { useState } from "react";
import type { CwClueNumber } from "@shared/codewords";

interface Props {
  /** Called with the clue word + number; parent handles the socket ack. */
  onSubmit: (word: string, number: CwClueNumber, reset: () => void) => void;
  disabled?: boolean;
}

const NUMBERS: CwClueNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, "unlimited"];

/** Spymaster clue entry: one word + a number (0/∞ = uncapped guesses). */
export default function ClueInput({ onSubmit, disabled }: Props) {
  const [word, setWord] = useState("");
  const [number, setNumber] = useState<CwClueNumber>(1);
  const trimmed = word.trim();
  const submit = () => {
    if (!trimmed) return;
    onSubmit(trimmed, number, () => setWord(""));
  };
  return (
    <div className="cw-clue-input panel">
      <h3>🕵️ Your clue</h3>
      <div className="cw-clue-row">
        <input
          value={word}
          maxLength={24}
          placeholder="one word"
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <select
          value={String(number)}
          onChange={(e) =>
            setNumber(e.target.value === "unlimited" ? "unlimited" : Number(e.target.value))
          }
        >
          {NUMBERS.map((n) => (
            <option key={String(n)} value={String(n)}>
              {n === "unlimited" ? "∞" : n}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={disabled || !trimmed} onClick={submit}>
          Give clue
        </button>
      </div>
      <p className="hint">
        One single word that isn't (part of) a word on the board, plus how many cards it
        points to. Your team gets exactly that many guesses (0 or ∞ = no limit).
      </p>
    </div>
  );
}
