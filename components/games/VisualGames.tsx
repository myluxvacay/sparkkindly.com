'use client';
import { useEffect, useRef, useState } from 'react';
import DifficultyMeter from '@/components/item/DifficultyMeter';
import GameArt from './GameArt';
import { visualGameKinds, visualRounds, type VisualGameKind } from '@/lib/games/visual-games';

// Picture games hosted by Spark (owner requests #20/#21, 17 Nov 2026). Play is local to the page: no timer,
// no account, nothing is saved or shared — the same promise the daily quiz makes anonymous visitors.
// Spark presents each round and reacts kindly either way; a wrong pick can be retried, and the explanation
// appears once the round is answered correctly or the player chooses to see it.

// Spark reaction slots (owner direction 17 Nov 2026; slot list in SPARK-ANIMATIONS.md): each slot is a
// named file in public/brand/. When a slot's real GIF arrives, drop the file in under its slot name —
// no logic change needed. Until then the fallbacks below apply (the <img> onError swap handles a missing
// slot file). Reduced-motion visitors get the still Spark in every slot.
export type SparkSlot = 'presenting' | 'victory' | 'encouraging';
export const SPARK_SLOTS: Record<SparkSlot, { animated: string; fallback: string; still: string; voice?: string }> = {
  presenting: { animated: '/brand/spark-waving.gif', fallback: '/brand/spark.webp', still: '/brand/spark.webp' },
  victory: { animated: '/brand/spark-victory.gif', fallback: '/brand/spark-waving.gif', still: '/brand/spark.webp', voice: '/brand/spark-you-did-it.mp3' },
  encouraging: { animated: '/brand/spark-encouraging.gif', fallback: '/brand/spark.webp', still: '/brand/spark.webp', voice: '/brand/spark-you-got-this.mp3' },
};

// Intrinsic sizes of the slot artwork, so the browser reserves the right shape for each file.
const SPARK_DIMS: Record<string, { w: number; h: number }> = {
  '/brand/spark-waving.gif': { w: 313, h: 627 },
  '/brand/spark-victory.gif': { w: 418, h: 627 },
  '/brand/spark-encouraging.gif': { w: 512, h: 527 },
  '/brand/spark.webp': { w: 438, h: 646 },
};

function SparkFigure({ slot, alt, reducedMotion }: { slot: SparkSlot; alt: string; reducedMotion: boolean }) {
  // A failed slot file is remembered per slot (derived state, no reset effect): a new slot tries its
  // own animated file first, a failed one swaps to that slot's fallback.
  const [failedSlot, setFailedSlot] = useState<SparkSlot | null>(null);
  const conf = SPARK_SLOTS[slot];
  const failed = failedSlot === slot;
  const src = reducedMotion ? conf.still : failed ? conf.fallback : conf.animated;
  const dims = SPARK_DIMS[src] ?? SPARK_DIMS['/brand/spark.webp'];
  return (
    <img
      src={src}
      width={dims.w}
      height={dims.h}
      alt={alt}
      onError={() => setFailedSlot(slot)}
    />
  );
}

const SOUND_KEY = 'sk-games-sound';

export default function VisualGames() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        setSoundOn(localStorage.getItem(SOUND_KEY) !== 'off');
      } catch {
        // Keep the defaults (motion allowed by the CSS rule, sound on) if storage/media checks fail.
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const toggleSound = () => {
    setSoundOn((on) => {
      try {
        localStorage.setItem(SOUND_KEY, on ? 'off' : 'on');
      } catch {
        // Private-mode storage failure: the toggle still works for this visit.
      }
      return !on;
    });
  };

  // Spark's reaction voice lines play ONLY here — as the direct result of the player's own click on an
  // answer (a user gesture, never autoplay: nothing plays on load, round change or hover). Both clips are
  // created and preloaded lazily on that first interaction; a rejected play() promise is swallowed.
  const playClip = (src?: string) => {
    if (!src || !soundOn) return;
    try {
      for (const s of [SPARK_SLOTS.victory.voice, SPARK_SLOTS.encouraging.voice]) {
        if (s && !audioRefs.current[s]) {
          const a = new Audio();
          a.preload = 'auto';
          a.src = s;
          a.load();
          audioRefs.current[s] = a;
        }
      }
      const a = audioRefs.current[src];
      a.currentTime = 0;
      void a.play().catch(() => {});
    } catch {
      // Audio unavailable in this browser: the game plays on silently.
    }
  };
  const [kind, setKind] = useState<VisualGameKind>('odd-one-out');
  const rounds = visualRounds.filter((r) => r.kind === kind);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const round = rounds[index];
  const done = solved || showAnswer;

  // Keep focus with the game across round changes: the button that advanced the round unmounts, so focus
  // moves to the panel (the site's accessibility promise for games) instead of being dropped to <body>.
  const panelRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    panelRef.current?.focus();
  }, [index, kind, finished]);

  const choose = (game: VisualGameKind) => {
    setKind(game);
    setIndex(0);
    setPicked(null);
    setSolved(false);
    setShowAnswer(false);
    setScore(0);
    setFinished(false);
  };

  const pick = (id: string) => {
    if (done) return;
    setPicked(id);
    if (id === round.correctId) {
      setSolved(true);
      setScore((s) => s + 1);
      playClip(SPARK_SLOTS.victory.voice);
    } else {
      playClip(SPARK_SLOTS.encouraging.voice);
    }
  };

  const next = () => {
    if (index + 1 >= rounds.length) {
      setFinished(true);
      return;
    }
    setIndex(index + 1);
    setPicked(null);
    setSolved(false);
    setShowAnswer(false);
  };

  return (
    <div className="visual-games">
      <div className="visual-games-tabs" role="group" aria-label="Picture game types">
        {visualGameKinds.map((g) => (
          <button key={g.kind} aria-pressed={kind === g.kind} className={kind === g.kind ? 'vg-tab selected' : 'vg-tab'} onClick={() => choose(g.kind)}>
            <strong>{g.name}</strong>
            <span>{g.blurb}</span>
          </button>
        ))}
      </div>

      <div className="vg-sound-row">
        <button className="vg-sound-toggle" aria-pressed={soundOn} onClick={toggleSound}>
          {soundOn ? "🔊 Spark's voice: on" : "🔇 Spark's voice: off"}
        </button>
      </div>

      {finished ? (
        <div className="quiz-panel vg-panel" ref={panelRef} tabIndex={-1}>
          <div className="vg-spark">
            <SparkFigure slot="presenting" reducedMotion={reducedMotion} alt="Spark, the SparkKindly guide, waving hello" />
            <div>
              <h2>Spark says: lovely playing!</h2>
              <p>You solved {score} of {rounds.length} rounds. Play again, or try another picture game above.</p>
              <button className="button" onClick={() => choose(kind)}>Play this game again</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="quiz-panel vg-panel" key={round.id} ref={panelRef} tabIndex={-1}>
          <DifficultyMeter level={round.difficulty} />
          <div className="vg-spark">
            <SparkFigure slot={solved ? 'victory' : picked ? 'encouraging' : 'presenting'} reducedMotion={reducedMotion} alt="Spark, the SparkKindly guide, presenting the round" />
            <div>
              <p className="vg-round-count">Round {index + 1} of {rounds.length}</p>
              <h2>{round.prompt}</h2>
              <p aria-live="polite" className="vg-spark-says">
                {solved ? round.sparkRight : picked ? round.sparkTryAgain : 'Take your time — there is no timer.'}
              </p>
            </div>
          </div>

          {round.hero && (
            <figure className="vg-hero">
              <GameArt art={round.hero.art} alt={round.hero.alt} />
              <figcaption className="visually-hidden">{round.hero.alt}</figcaption>
            </figure>
          )}

          <div className="vg-options" role="group" aria-label="Picture choices">
            {round.options.map((o) => {
              const state = done && o.id === round.correctId ? ' correct' : picked === o.id ? ' picked' : '';
              return (
                <button key={o.id} className={`vg-option${state}`} onClick={() => pick(o.id)} disabled={done} aria-pressed={picked === o.id}>
                  <GameArt art={o.art} alt={o.alt} />
                  <span>{o.label}</span>
                </button>
              );
            })}
          </div>

          {done ? (
            <div className="vg-result" id="result" aria-live="polite">
              <p><strong>{solved ? 'That is right!' : 'Here is the answer:'}</strong> {round.explanation}</p>
              <button className="button" onClick={next}>{index + 1 >= rounds.length ? 'See your score' : 'Next round'}</button>
            </div>
          ) : (
            picked && (
              <p>
                <button className="underlined vg-give-up" onClick={() => setShowAnswer(true)}>Show me the answer</button>
              </p>
            )
          )}
          <p className="quiz-note">No timer. No scores to share. SparkKindly does not save your answers in these picture games.</p>
        </div>
      )}
    </div>
  );
}
