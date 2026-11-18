import Link from 'next/link';
import { toSceneSpec, type PlayView } from '@/lib/public/body';
import GameArt from '@/components/games/GameArt';
import SceneView from '@/components/games/SceneView';
import SceneArt from '@/components/games/SceneArt';

type Props = { action: string; play: PlayView; clues: number; stage?: 'look' | 'answer' };

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

// The picture half of a visual game (18 Nov 2026): hero artwork, one scene, a before/after scene
// pair, or the sequence strip. Everything renders from the same scene data the content gate derived
// the answer from. Sequence tiles are numbered so "what came second?" can be answered from the strip;
// the strip's accessible name reads the order out loud, the screen-reader equivalent of seeing it.
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
      {v.sequence.length > 0 && (
        <div
          className="seq-strip"
          role="img"
          aria-label={`In order: ${v.sequence.map((s, i) => `${i + 1}. ${s.label}`).join(', ')}`}
        >
          {v.sequence.map((s, i) => (
            <span className="seq-tile" key={i} aria-hidden="true">
              <svg viewBox="0 0 120 120" className="seq-art">
                <SceneArt art={s.art} color={s.color} />
              </svg>
              <span className="seq-num">{i + 1}</span>
            </span>
          ))}
        </div>
      )}
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

export default function PlayForm({ action, play, clues, stage = 'look' }: Props) {
  const more = play.mechanic === 'clue_reveal' && clues < play.clues.length;
  // Memory games are two-step (18 Nov 2026): first the scene alone with a ready button, then — after
  // the ?stage=answer hop — the question with the picture gone. Plain links and forms, so the game
  // works without JavaScript exactly like clue_reveal's extra-clue hop.
  if (play.visual?.gameType === 'memory' && stage !== 'answer') {
    return (
      <div className="memory-look">
        <p className="memory-prompt">{play.prompt}</p>
        <Visual play={play} />
        <p>Look carefully and remember what you see. When you are ready, hide the picture and answer from memory.</p>
        <p>
          <Link className="button" href={`${action}?stage=answer#play-panel`}>
            I’ve looked carefully — ask me! <span aria-hidden="true">→</span>
          </Link>
        </p>
      </div>
    );
  }
  return (
    <form className="quiz-form" method="get" action={`${action}#result`}>
      <fieldset>
        <legend>{play.prompt}</legend>
        {play.visual?.gameType === 'memory' ? (
          <p className="memory-note">The picture is hidden now — answer from what you remember. 🧠</p>
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
