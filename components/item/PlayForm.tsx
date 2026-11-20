import Link from 'next/link';
import { toSceneSpec, type PlayView } from '@/lib/public/body';
import GameArt from '@/components/games/GameArt';
import SceneView from '@/components/games/SceneView';
import SceneArt from '@/components/games/SceneArt';

type Props = { action: string; play: PlayView; clues: number; stage?: 'look' | 'answer'; step?: number };

type Choice = { id: string; text: string; art?: string; alt?: string };

const Choices = ({ name, list }: { name: string; list: Choice[] }) => {
  const withArt = list.some((o) => o.art);
  return (
    <div className={withArt ? 'options options-art' : 'options'}>
      {list.map((o, i) => (
        <label className="option" key={o.id}>
          <input type="radio" name={name} value={o.id} required={i === 0} />
          <span className="option-letter" aria-hidden="true">{o.id.toUpperCase().slice(0, 2)}</span>
          {o.art && <GameArt art={o.art} alt={o.alt ?? o.text} />}
          <span>{o.text}</span>
        </label>
      ))}
    </div>
  );
};

// The picture half of a visual game (18 Nov 2026): hero artwork, one scene, or a before/after
// scene pair (spot-the-difference only — what-changed renders its scenes one phase at a time in
// PlayForm below, and sequence recall never renders its items together). Everything renders from
// the same scene data the content gate derived the answer from.
function Visual({ play }: { play: PlayView }) {
  const v = play.visual;
  if (!v) return null;
  const scene = toSceneSpec(v.scene);
  const sceneAfter = toSceneSpec(v.sceneAfter);
  return (
    <>
      {v.heroArt && (
        <figure className="vg-hero">
          <GameArt art={v.heroArt} alt={v.heroAlt ?? ''} />
          <figcaption className="visually-hidden">{v.heroAlt ?? ''}</figcaption>
        </figure>
      )}
      {scene && sceneAfter ? (
        <div className="scene-pair">
          <figure>
            <SceneView scene={scene} label={v.sceneAlt ?? 'The first picture'} />
            <figcaption>{v.gameType === 'what-changed' ? 'Before' : 'Picture 1'}</figcaption>
          </figure>
          <figure>
            <SceneView scene={sceneAfter} label={v.sceneAfterAlt ?? 'The second picture'} />
            <figcaption>{v.gameType === 'what-changed' ? 'After' : 'Picture 2'}</figcaption>
          </figure>
        </div>
      ) : scene ? (
        <figure className="scene-single">
          <SceneView scene={scene} label={v.sceneAlt ?? 'The picture for this game'} />
        </figure>
      ) : null}
    </>
  );
}

function Order({ items }: { items: { id: string; text: string }[] }) {
  return (
    <div className="options">
      {items.map((o) => (
        <label className="option" key={o.id}>
          <span>{o.text}</span>
          <select name={`pos-${o.id}`} required defaultValue="" aria-label={`Position of ${o.text}`}>
            <option value="" disabled>Position…</option>
            {items.map((_, n) => (
              <option key={n} value={n + 1}>{n + 1}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

// The answer field(s) for one mechanic. Nothing here knows the answer: the form is plain HTML that submits by GET to
// the item's own URL, so it works without JavaScript and the server checks the response.
function Fields({ play, clues }: { play: PlayView; clues: number }) {
  switch (play.mechanic) {
    case 'multiple_choice':
      return <Choices name="r" list={play.options} />;
    case 'odd_one_out':
      return <Choices name="r" list={play.items} />;
    case 'true_false':
      return <Choices name="r" list={[{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }]} />;
    case 'put_in_order':
      return <Order items={play.items} />;
    case 'number':
      return (
        <label>
          Your answer <input type="number" step="any" name="r" required autoComplete="off" />
        </label>
      );
    case 'short_text':
    case 'clue_reveal':
      return (
        <>
          {play.mechanic === 'clue_reveal' && (
            <>
              <ol className="clues">
                {play.clues.slice(0, clues).map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ol>
              <input type="hidden" name="clues" value={clues} />
            </>
          )}
          <label>
            Your answer <input type="text" name="r" required maxLength={200} autoComplete="off" />
          </label>
        </>
      );
    default:
      return <p>This activity can’t be played on this page yet.</p>;
  }
}

export default function PlayForm({ action, play, clues, stage = 'look', step = 0 }: Props) {
  const more = play.mechanic === 'clue_reveal' && clues < play.clues.length;
  const gameType = play.visual?.gameType;
  // Phase discipline (owner design review, 18 Nov 2026): games whose mechanic is remembering must
  // never show the question — or the things to be remembered, all at once — before the ask phase.
  // Memory games are two-step: first the scene alone with a ready button, then — after the
  // ?stage=answer hop — the question with the picture gone. The look phase must not contain the
  // question text anywhere (the prompt used to head it, which told the player exactly what to
  // count). Plain links and forms, so the game works without JavaScript exactly like
  // clue_reveal's extra-clue hop.
  if (gameType === 'memory' && stage !== 'answer') {
    return (
      <div className="memory-look">
        <p className="memory-prompt">Look carefully — remember everything you see.</p>
        <Visual play={play} />
        <p>When you are ready, hide the picture and answer from memory.</p>
        <p>
          <Link className="button" href={`${action}?stage=answer#play-panel`}>
            I’ve looked carefully — ask me! <span aria-hidden="true">→</span>
          </Link>
        </p>
      </div>
    );
  }
  // Sequence recall: Spark shows the items ONE at a time, in order, one ?step= hop each — no
  // strip of everything at once, no number badges, no question — then the items hide and only
  // then do the question and options appear (?stage=answer).
  if (gameType === 'sequence' && stage !== 'answer') {
    const seq = play.visual?.sequence ?? [];
    const idx = Math.min(Math.max(step, 0), Math.max(seq.length - 1, 0));
    const entry = seq[idx];
    const last = idx >= seq.length - 1;
    return (
      <div className="sequence-show">
        <p className="sequence-prompt">Spark is showing you some things, one at a time. Remember the order!</p>
        {entry && (
          <div className="seq-stage" role="img" aria-label={`${entry.label} — thing ${idx + 1} of ${seq.length} to remember`}>
            <svg viewBox="0 0 120 120" className="seq-art seq-art-big" aria-hidden="true">
              <SceneArt art={entry.art} color={entry.color} />
            </svg>
          </div>
        )}
        <div className="seq-progress" aria-hidden="true">
          {seq.map((_, i) => (
            <span key={i} className={i <= idx ? 'seq-dot seq-dot-on' : 'seq-dot'} />
          ))}
        </div>
        <p>
          <Link className="button" href={last ? `${action}?stage=answer#play-panel` : `${action}?step=${idx + 1}#play-panel`}>
            {last ? (
              <>I’ve remembered the order — ask me! <span aria-hidden="true">→</span></>
            ) : (
              <>Next <span aria-hidden="true">→</span></>
            )}
          </Link>
        </p>
      </div>
    );
  }
  // What changed: sequential by design — the before picture alone first, then it is replaced by
  // the after picture with the question. Never both pictures side-by-side (that is spot-the-
  // difference's mechanic, not this one's).
  if (gameType === 'what-changed' && stage !== 'answer') {
    const scene = toSceneSpec(play.visual?.scene);
    return (
      <div className="memory-look">
        <p className="memory-prompt">Look carefully — remember this picture.</p>
        {scene && (
          <figure className="scene-single">
            <SceneView scene={scene} label={play.visual?.sceneAlt ?? 'The before picture'} />
            <figcaption>Before</figcaption>
          </figure>
        )}
        <p>Remember everything in this picture. Next you will see the after picture — one thing will have changed.</p>
        <p>
          <Link className="button" href={`${action}?stage=answer#play-panel`}>
            I’ve remembered it — show the after picture <span aria-hidden="true">→</span>
          </Link>
        </p>
      </div>
    );
  }
  const sceneAfter = toSceneSpec(play.visual?.sceneAfter);
  return (
    <form className="quiz-form" method="get" action={`${action}#result`}>
      {play.passage && (
        <section className="passage" aria-label={play.passageTitle ?? 'Reading passage'}>
          {play.passageTitle && <h3 className="passage-title">{play.passageTitle}</h3>}
          {play.passage.split(/\n\s*\n/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
          <p className="passage-note">Read the passage, then answer — it stays here while you think. 📖</p>
        </section>
      )}
      <fieldset>
        <legend>{play.prompt}</legend>
        {gameType === 'memory' || gameType === 'sequence' ? (
          <p className="memory-note">The picture is hidden now — answer from what you remember. 🧠</p>
        ) : gameType === 'what-changed' && sceneAfter ? (
          <>
            <figure className="scene-single">
              <SceneView scene={sceneAfter} label={play.visual?.sceneAfterAlt ?? 'The after picture'} />
              <figcaption>After</figcaption>
            </figure>
            <p className="memory-note">The before picture is hidden — compare from what you remember.</p>
          </>
        ) : (
          <Visual play={play} />
        )}
        <Fields play={play} clues={clues} />
      </fieldset>
      <button className="button" type="submit">
        Check answer <span aria-hidden="true">→</span>
      </button>
      {more && (
        <p>
          <Link href={`${action}?clues=${clues + 1}`}>Show another clue</Link>
        </p>
      )}
    </form>
  );
}
