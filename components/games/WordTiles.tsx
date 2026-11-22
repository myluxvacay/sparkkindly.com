'use client';
// Build-a-Word letter tiles (wave 1, 21 Nov 2026). Progressive enhancement over the plain
// short_text input, which stays the real control and the no-JavaScript path: this component
// renders that same input (name "r", so the GET submit and the server's check are unchanged)
// and adds tappable letter tiles above it. Tapping a tile appends its letter; a tile is spent
// once its letter has been used as many times as the tiles provide it. The component never
// knows the target word — a wrong letter is just a letter, removed with Delete or Clear, and
// the server gives the verdict. No penalty, no timer, no sound.
import { useState } from 'react';

export default function WordTiles({ letters }: { letters: string[] }) {
  const [value, setValue] = useState('');
  const typed = value.toLowerCase();
  const usedCount = (letter: string) => typed.split('').filter((c) => c === letter.toLowerCase()).length;
  // A tile is spent when every copy of its letter that the tiles provide is already in the word:
  // the tile's rank among same-letter tiles vs how many of that letter have been typed.
  const spent = (letter: string, index: number) => {
    const rank = letters.slice(0, index + 1).filter((l) => l.toLowerCase() === letter.toLowerCase()).length;
    return usedCount(letter) >= rank;
  };
  return (
    <div className="word-tiles">
      <label className="word-answer">
        Your word{' '}
        <input
          type="text"
          name="r"
          required
          maxLength={Math.max(letters.length, 1)}
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby="word-tiles-hint"
        />
      </label>
      <div className="tile-row" role="group" aria-label="Letter tiles">
        {letters.map((letter, i) => (
          <button
            key={i}
            type="button"
            className="tile"
            disabled={spent(letter, i)}
            onClick={() => setValue((v) => (v.length < letters.length ? v + letter.toLowerCase() : v))}
            aria-label={`Letter ${letter.toUpperCase()}`}
          >
            {letter.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="tile-actions">
        <button type="button" className="text-button" onClick={() => setValue((v) => v.slice(0, -1))}>
          Delete a letter
        </button>{' '}
        <button type="button" className="text-button" onClick={() => setValue('')}>
          Clear
        </button>
      </p>
      <p className="word-tiles-hint" id="word-tiles-hint">
        Tap the letter tiles to build the word — or just type it.
      </p>
    </div>
  );
}
