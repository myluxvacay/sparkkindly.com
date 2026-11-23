'use client';
// Drag & Drop Match board (wave 1, owner direction 21 Nov 2026 — the hedgehog dot-counting
// game from his photo, generalised). Progressive enhancement in the PlayEnhancer pattern: the
// server form's per-target <select> elements (rendered by PlayForm next to this board) remain
// the real controls and the no-JavaScript path. When this board mounts it hides the selects,
// drops their `required` flag (an unmatched board then submits to the server's friendly
// "match every piece" hint instead of a browser bubble on a hidden field), and keeps them
// synced with the board, so the GET submit — and the server's answer check — is unchanged.
//
// Play is drag (HTML5 drag events) OR tap-to-select-then-tap-target, for small screens and
// switch users. Placed pieces can be tapped again to lift them back to the tray. No sound, no
// timers, no scores: the board only arranges the answer the form submits.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import SceneArt from './SceneArt';

export type MatchPieceView = { id: string; text: string; art?: string; alt?: string; value?: number };
export type MatchTargetView = { id: string; text: string; art?: string; alt?: string; dots?: number };

const CONES: { bg: string; fg: string }[] = [
  { bg: '#d43a2f', fg: '#ffffff' },
  { bg: '#3b6fd4', fg: '#ffffff' },
  { bg: '#3f9e4d', fg: '#ffffff' },
  { bg: '#f7d038', fg: '#22252d' },
  { bg: '#7d4fc9', fg: '#ffffff' },
  { bg: '#f28bb4', fg: '#22252d' },
];

// Dot layouts on a 48-unit circle face, dice-style first, for counts 1–10.
const DOT_LAYOUTS: Record<number, [number, number][]> = {
  1: [[24, 24]],
  2: [[15, 15], [33, 33]],
  3: [[14, 14], [24, 24], [34, 34]],
  4: [[15, 15], [33, 15], [15, 33], [33, 33]],
  5: [[14, 14], [34, 14], [24, 24], [14, 34], [34, 34]],
  6: [[15, 13], [33, 13], [15, 24], [33, 24], [15, 35], [33, 35]],
  7: [[15, 13], [33, 13], [15, 24], [24, 24], [33, 24], [15, 35], [33, 35]],
  8: [[15, 13], [24, 13], [33, 13], [15, 24], [33, 24], [15, 35], [24, 35], [33, 35]],
  9: [[13, 13], [24, 13], [35, 13], [13, 24], [24, 24], [35, 24], [13, 35], [24, 35], [35, 35]],
  10: [[13, 11], [24, 11], [35, 11], [13, 21], [24, 21], [35, 21], [13, 31], [24, 31], [35, 31], [24, 41]],
};

// Where the dot circles sit on the hedgehog's back, per target count (percent of board size).
const HEDGEHOG_SLOTS: Record<number, [number, number][]> = {
  3: [[20, 28], [38, 16], [56, 28]],
  4: [[15, 34], [31, 17], [48, 15], [63, 30]],
  5: [[13, 38], [27, 19], [43, 13], [59, 21], [37, 42]],
  6: [[11, 40], [23, 21], [37, 13], [53, 13], [65, 27], [41, 42]],
};

function Cone({ value, index, small }: { value: number; index: number; small?: boolean }) {
  const c = CONES[index % CONES.length];
  return (
    <svg viewBox="0 0 120 120" className={small ? 'cone cone-small' : 'cone'} aria-hidden="true">
      <path d="M60 6 L106 108 Q60 124 14 108 Z" fill={c.bg} stroke="#00000030" strokeWidth="3" />
      <text x="60" y="92" textAnchor="middle" fontSize="46" fontWeight="800" fill={c.fg} fontFamily="inherit">
        {value}
      </text>
    </svg>
  );
}

function DotCircle({ dots }: { dots: number }) {
  const layout = DOT_LAYOUTS[dots] ?? DOT_LAYOUTS[9];
  return (
    <svg viewBox="0 0 48 48" className="dot-circle" aria-hidden="true">
      <circle cx="24" cy="24" r="22.5" fill="#fff8ea" stroke="#7a4a21" strokeWidth="2.6" />
      {layout.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3.3" fill="#22252d" />
      ))}
    </svg>
  );
}

// The hedgehog himself, drawn after the owner's cardboard original: spiky tan back, teal face
// and feet, red nose. Decorative — the interactive circles are HTML buttons laid over his back.
function Hedgehog() {
  return (
    <svg viewBox="0 0 440 250" className="hedgehog-art" aria-hidden="true">
      <ellipse cx="95" cy="212" rx="30" ry="11" fill="#2f9db4" />
      <ellipse cx="255" cy="212" rx="30" ry="11" fill="#2f9db4" />
      <path
        d="M28 172 Q22 122 44 110 L58 76 L84 104 L104 68 L128 100 L152 64 L178 98 L204 66 L228 100 L254 72 L276 106 L300 86 L314 124 Q332 142 328 172 Q302 208 176 208 Q58 208 28 172 Z"
        fill="#c9a06a"
        stroke="#8a5a33"
        strokeWidth="4"
      />
      <ellipse cx="352" cy="150" rx="50" ry="52" fill="#2f9db4" />
      <path d="M388 138 L424 156 L388 172 Z" fill="#2f9db4" />
      <circle cx="426" cy="156" r="11" fill="#d43a2f" />
      <circle cx="342" cy="140" r="10" fill="#ffffff" />
      <circle cx="343" cy="141" r="5" fill="#22252d" />
    </svg>
  );
}

export default function MatchBoard({
  pieces,
  targets,
  variant,
}: {
  pieces: MatchPieceView[];
  targets: MatchTargetView[];
  variant?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [placement, setPlacement] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const dots = variant === 'dots';

  useEffect(() => {
    const area = rootRef.current?.closest('.match-area');
    if (!area) return;
    area.classList.add('is-enhanced');
    area.querySelectorAll('select').forEach((s) => {
      s.required = false;
    });
    setActive(true);
  }, []);

  useEffect(() => {
    const area = rootRef.current?.closest('.match-area');
    if (!area) return;
    for (const t of targets) {
      const sel = area.querySelector<HTMLSelectElement>(`select[name="match-${t.id}"]`);
      if (sel) sel.value = placement[t.id] ?? '';
    }
  }, [placement, targets]);

  const placedOn = (pieceId: string) => targets.find((t) => placement[t.id] === pieceId)?.id;
  const place = (pieceId: string, targetId: string) => {
    setPlacement((prev) => {
      const next = { ...prev };
      for (const t of targets) if (next[t.id] === pieceId) delete next[t.id];
      next[targetId] = pieceId;
      return next;
    });
    setSelected(null);
  };
  const unplace = (targetId: string) => {
    setPlacement((prev) => {
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
  };
  const tapPiece = (pieceId: string) => {
    const on = placedOn(pieceId);
    if (on) {
      unplace(on);
      setSelected(pieceId);
    } else {
      setSelected(selected === pieceId ? null : pieceId);
    }
  };
  const tapTarget = (targetId: string) => {
    if (selected) place(selected, targetId);
    else if (placement[targetId]) unplace(targetId);
  };

  const pieceChip = (p: MatchPieceView, i: number) => {
    const on = placedOn(p.id);
    return (
      <button
        key={p.id}
        type="button"
        className={`match-piece${selected === p.id ? ' is-selected' : ''}${on ? ' is-placed' : ''}`}
        draggable={active && !on}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', p.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={() => tapPiece(p.id)}
        aria-pressed={selected === p.id}
        aria-label={dots ? `Number cone ${p.text}` : `${p.text}${on ? ' (placed — tap to lift it back)' : ''}`}
      >
        {dots ? (
          <Cone value={p.value ?? Number(p.text)} index={i} />
        ) : p.art ? (
          <>
            <svg viewBox="0 0 120 120" className="match-art" aria-hidden="true">
              <SceneArt art={p.art} />
            </svg>
            <span>{p.text}</span>
          </>
        ) : (
          <span className="match-piece-word">{p.text}</span>
        )}
      </button>
    );
  };

  const dropProps = (targetId: string) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      if (id && pieces.some((p) => p.id === id)) place(id, targetId);
    },
  });

  if (dots) {
    const slots = HEDGEHOG_SLOTS[targets.length] ?? HEDGEHOG_SLOTS[5];
    return (
      <div className="match-board match-board-dots" ref={rootRef}>
        <div className="hedgehog-board">
          <Hedgehog />
          {targets.map((t, i) => {
            const piece = pieces.find((p) => p.id === placement[t.id]);
            const pieceIndex = piece ? pieces.indexOf(piece) : 0;
            return (
              <button
                key={t.id}
                type="button"
                className={`dot-target${piece ? ' is-filled' : ''}`}
                style={{ left: `${slots[i][0]}%`, top: `${slots[i][1]}%` }}
                {...dropProps(t.id)}
                onClick={() => tapTarget(t.id)}
                aria-label={`Circle with ${t.dots} dot${t.dots === 1 ? "" : "s"}${piece ? ` — cone ${piece.text} is on it (tap to lift it off)` : ' — empty'}`}
              >
                <DotCircle dots={t.dots ?? 0} />
                {piece && (
                  <span className="dot-target-cone">
                    <Cone value={piece.value ?? Number(piece.text)} index={pieceIndex} small />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="match-tray" role="group" aria-label="Number cones">
          {pieces.map((p, i) => pieceChip(p, i))}
        </div>
        <p className="match-hint">Drag each cone onto the circle with the same number of dots — or tap a cone, then tap its circle.</p>
      </div>
    );
  }

  return (
    <div className="match-board" ref={rootRef}>
      <div className="match-targets">
        {targets.map((t) => {
          const piece = pieces.find((p) => p.id === placement[t.id]);
          return (
            <button
              key={t.id}
              type="button"
              className={`match-target${piece ? ' is-filled' : ''}`}
              {...dropProps(t.id)}
              onClick={() => tapTarget(t.id)}
              aria-label={`${t.text}${piece ? ` — matched with ${piece.text} (tap to lift it back)` : ' — waiting for its match'}`}
            >
              {t.art && (
                <svg viewBox="0 0 120 120" className="match-art" aria-hidden="true">
                  <SceneArt art={t.art} />
                </svg>
              )}
              <span className="match-target-name">{t.text}</span>
              <span className="match-target-slot">{piece ? piece.text : '?'}</span>
            </button>
          );
        })}
      </div>
      <div className="match-tray" role="group" aria-label="Pieces to match">
        {pieces.map((p, i) => pieceChip(p, i))}
      </div>
      <p className="match-hint">Drag each piece onto its match — or tap a piece, then tap where it belongs.</p>
    </div>
  );
}
