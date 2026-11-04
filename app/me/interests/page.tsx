import type { Metadata } from 'next';
import Link from 'next/link';
import { getInterests, interestChoices, MAX_INTERESTS, type Choice } from '@/lib/accounts/interests';
import { requireContext } from '@/lib/accounts/next';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your interests' };

type Props = { searchParams: Promise<{ r?: string }> };

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  saved: { text: 'Your interests are saved.', ok: true },
  invalid: { text: `Please choose up to ${MAX_INTERESTS} worlds and topics in total, then save again.`, ok: false },
  no: { text: 'This account cannot save interests.', ok: false },
};

function Result({ code }: { code?: string }) {
  const r = code ? RESULTS[code] : undefined;
  if (!r) return null;
  return (
    <div role={r.ok ? 'status' : 'alert'} id="result" tabIndex={-1} className={r.ok ? 'takeaway' : 'grown-ups'}>
      <p>{r.text}</p>
      {r.ok && (
        <p>
          <Link href="/me/">See items that match</Link>
        </p>
      )}
    </div>
  );
}

function Boxes({ name, choices, picked }: { name: 'world' | 'topic'; choices: Choice[]; picked: Set<number> }) {
  return choices.map((c) => (
    <label className="admin-radio" key={c.id}>
      <input type="checkbox" name={name} value={c.id} defaultChecked={picked.has(c.id)} /> {c.name}
    </label>
  ));
}

// Any signed-in context (a child profile too) picks its own interests. The owner is the session's context; the form
// carries only the chosen ids.
export default async function InterestsPage({ searchParams }: Props) {
  const ctx = await requireContext();
  const { r } = await searchParams;
  const db = getDb();
  const owner = { accountId: ctx.account.id, profileId: ctx.profile?.id ?? null };
  const [choices, current] = await Promise.all([interestChoices(db), getInterests(db, owner)]);
  const described = ['interests-hint', r && RESULTS[r] && !RESULTS[r].ok ? 'result' : undefined].filter(Boolean).join(' ');
  return (
    <>
      <h1>Your interests</h1>
      <Result code={r} />
      <p>
        <Link href="/me/">Back to your page</Link>
      </p>
      <form method="post" action="/me/interests/save/" className="prose admin-form">
        <p id="interests-hint">
          Choose the worlds and topics you like, up to {MAX_INTERESTS} in total. Items that match show on your page.
        </p>
        <fieldset aria-describedby={described}>
          <legend>Worlds</legend>
          <Boxes name="world" choices={choices.worlds} picked={new Set(current.worldIds)} />
        </fieldset>
        <fieldset aria-describedby={described}>
          <legend>Topics</legend>
          {choices.topicGroups.map((g) => (
            <fieldset key={g.name}>
              <legend>{g.name}</legend>
              <Boxes name="topic" choices={g.topics} picked={new Set(current.topicIds)} />
            </fieldset>
          ))}
        </fieldset>
        <button type="submit" className="button">
          Save my interests
        </button>
      </form>
    </>
  );
}
