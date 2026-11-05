import { CONTRIBUTOR_LIMITS as L } from '@/lib/contributors/rules';
import type { Mine } from '@/lib/contributors/drafts';

type World = { slug: string; name: string };
type Props = { kind: 'article' | 'quiz'; worlds: World[]; topics?: World[]; editing: Mine | null };
type Content = Mine['content'] | null;

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const LETTERS = 'ABCD';

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <p>
      <label htmlFor={id}>{label}</label>
      {children}
    </p>
  );
}

function ArticleFields({ c }: { c: Content }) {
  return (
    <>
      <p className="muted">
        Write {L.minSections} to {L.maxSections} sections, each with a short heading. Separate paragraphs with a blank line.
        Plain text only, up to {L.body.toLocaleString('en')} characters in all.
      </p>
      {range(L.maxSections).map((i) => (
        <fieldset key={i}>
          <legend>
            Section {i + 1}
            {i < L.minSections ? '' : ' (optional)'}
          </legend>
          <Field id={`s-h-${i}`} label={`Section ${i + 1} heading (up to ${L.heading} characters)`}>
            <input id={`s-h-${i}`} name={`section_heading_${i}`} type="text" maxLength={L.heading} defaultValue={c?.sections[i]?.heading ?? ''} />
          </Field>
          <Field id={`s-t-${i}`} label={`Section ${i + 1} text`}>
            <textarea id={`s-t-${i}`} name={`section_text_${i}`} rows={6} defaultValue={c?.sections[i]?.text ?? ''} />
          </Field>
        </fieldset>
      ))}
      <Field id="c-takeaway" label={`Takeaway: one thing to take away (up to ${L.takeaway} characters)`}>
        <input id="c-takeaway" name="takeaway" type="text" maxLength={L.takeaway} defaultValue={c?.takeaway ?? ''} />
      </Field>
    </>
  );
}

function QuizFields({ c }: { c: Content }) {
  return (
    <>
      <Field id="c-question" label={`Question (up to ${L.question} characters)`}>
        <input id="c-question" name="question" type="text" maxLength={L.question} defaultValue={c?.question ?? ''} />
      </Field>
      <fieldset>
        <legend>Four answer options</legend>
        {range(L.options).map((i) => (
          <Field key={i} id={`c-opt-${i}`} label={`Option ${LETTERS[i]} (up to ${L.option} characters)`}>
            <input id={`c-opt-${i}`} name={`option_${i}`} type="text" maxLength={L.option} defaultValue={c?.options[i] ?? ''} />
          </Field>
        ))}
      </fieldset>
      <Field id="c-correct" label="The correct option">
        <select id="c-correct" name="correct" defaultValue={String(c?.correct ?? 0)}>
          {range(L.options).map((i) => (
            <option key={i} value={i}>
              Option {LETTERS[i]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="c-explanation" label={`Explanation of the answer (20 to ${L.explanation} characters)`}>
        <textarea id="c-explanation" name="explanation" rows={4} maxLength={L.explanation} defaultValue={c?.explanation ?? ''} />
      </Field>
    </>
  );
}

function SourceFields({ c }: { c: Content }) {
  return (
    <>
      <p className="muted">
        Sources: one for every fact you state (required for factual pieces), up to {L.sources}. Each needs a title and an https://
        address.
      </p>
      {range(L.sources).map((i) => (
        <fieldset key={i}>
          <legend>Source {i + 1}</legend>
          <Field id={`src-t-${i}`} label={`Source ${i + 1} title`}>
            <input id={`src-t-${i}`} name={`source_title_${i}`} type="text" maxLength={L.sourceTitle} defaultValue={c?.sources[i]?.title ?? ''} />
          </Field>
          <Field id={`src-u-${i}`} label={`Source ${i + 1} address`}>
            <input id={`src-u-${i}`} name={`source_url_${i}`} type="url" maxLength={500} defaultValue={c?.sources[i]?.url ?? ''} />
          </Field>
        </fieldset>
      ))}
    </>
  );
}

// The editor for one article or quiz question. Plain form, no JavaScript; allowances are given as text.
function TopicFields({ topics, c }: { topics: World[]; c: Content }) {
  if (!topics.length) return null;
  return (
    <fieldset>
      <legend>Topics (optional, up to {L.topics})</legend>
      {topics.map((t) => (
        <p className="admin-radio" key={t.slug}>
          <input id={`t-${t.slug}`} name="topic" type="checkbox" value={t.slug} defaultChecked={c?.topics.includes(t.slug)} />
          <label htmlFor={`t-${t.slug}`}>{t.name}</label>
        </p>
      ))}
    </fieldset>
  );
}

export default function Editor({ kind, worlds, topics = [], editing }: Props) {
  const c = editing?.content ?? null;
  return (
    <form method="post" action="/me/contribute/save/" className="admin-form">
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <input type="hidden" name="kind" value={kind} />
      <Field id="c-world" label="World">
        <select id="c-world" name="world" defaultValue={editing?.world ?? worlds[0]?.slug}>
          {worlds.map((w) => (
            <option key={w.slug} value={w.slug}>
              {w.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="c-title" label={`Title (up to ${L.title} characters)`}>
        <input id="c-title" name="title" type="text" maxLength={L.title} defaultValue={c?.title ?? ''} />
      </Field>
      <Field id="c-summary" label={`Summary (up to ${L.summary} characters)`}>
        <textarea id="c-summary" name="summary" rows={3} maxLength={L.summary} defaultValue={c?.summary ?? ''} />
      </Field>
      {kind === 'article' ? <ArticleFields c={c} /> : <QuizFields c={c} />}
      <TopicFields topics={topics} c={c} />
      <SourceFields c={c} />
      <button type="submit" className="button">
        Save draft
      </button>
    </form>
  );
}
