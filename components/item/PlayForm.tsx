import Link from 'next/link';
import type { PlayView } from '@/lib/public/body';

type Props = { action: string; play: PlayView; clues: number };

const Choices = ({ name, list }: { name: string; list: { id: string; text: string }[] }) => (
  <div className="options">
    {list.map((o, i) => (
      <label className="option" key={o.id}>
        <input type="radio" name={name} value={o.id} required={i === 0} />
        <span className="option-letter" aria-hidden="true">{o.id.toUpperCase().slice(0, 2)}</span>
        <span>{o.text}</span>
      </label>
    ))}
  </div>
);

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

export default function PlayForm({ action, play, clues }: Props) {
  const more = play.mechanic === 'clue_reveal' && clues < play.clues.length;
  return (
    <form className="quiz-form" method="get" action={action}>
      <fieldset>
        <legend>{play.prompt}</legend>
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
