'use client';
import { useEffect, useRef, useState } from 'react';
import DifficultyMeter from '@/components/item/DifficultyMeter';
import GameArt from './GameArt';
import { visualGameKinds, visualRounds, type VisualGameKind } from '@/lib/games/visual-games';

// Picture games hosted by Spark (owner requests #20/#21, 17 Nov 2026). Play is local to the page: no timer,
// no account, nothing is saved or shared — the same promise the daily quiz makes anonymous visitors.
// Spark presents each round and reacts kindly either way; a wrong pick can be retried, and the explanation
// appears once the round is answered correctly or the player chooses to see it.
export default function VisualGames() {
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

      {finished ? (
        <div className="quiz-panel vg-panel" ref={panelRef} tabIndex={-1}>
          <div className="vg-spark">
            <img src="/brand/spark-220.webp" width={219} height={323} alt="Spark, the SparkKindly guide, celebrating" />
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
            <img src="/brand/spark-220.webp" width={219} height={323} alt="Spark, the SparkKindly guide, presenting the round" />
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
