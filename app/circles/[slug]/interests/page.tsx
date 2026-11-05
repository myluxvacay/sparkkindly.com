import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { Result, type Messages } from '@/components/circles/Result';
import type { Choice } from '@/lib/accounts/interests';
import { PLAYING_PAGE } from '@/lib/accounts/next';
import { ACCOUNT_COOKIE } from '@/lib/accounts/web';
import { INTEREST_LIMITS } from '@/lib/circles/interests';
import { loadInterestsPage } from '@/lib/circles/play-web';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Circle interests' };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ r?: string }> };

const MESSAGES: Messages = {
  saved: { text: "The circle's interests are saved. They shape the sets from tomorrow.", ok: true },
  invalid: { text: `Please choose up to ${INTEREST_LIMITS.worlds} worlds and ${INTEREST_LIMITS.topics} topics, then save again.`, ok: false },
  'not-owner': { text: 'Only the circle owner can change its interests.', ok: false },
  'read-only': { text: 'This circle is closed and cannot change.', ok: false },
};

function Boxes({ name, choices, picked, disabled }: { name: string; choices: Choice[]; picked: number[]; disabled: boolean }) {
  return choices.map((c) => (
    <label className="admin-radio" key={c.id}>
      <input type="checkbox" name={name} value={c.id} defaultChecked={picked.includes(c.id)} disabled={disabled} /> {c.name}
    </label>
  ));
}

// The worlds and topics the circle's daily set is drawn from. Members see them; only the owner of an open circle saves.
export default async function CircleInterestsPage({ params, searchParams }: Props) {
  const [{ slug }, { r }] = await Promise.all([params, searchParams]);
  const token = (await cookies()).get(ACCOUNT_COOKIE)?.value ?? '';
  const page = await loadInterestsPage(getDb(), token, slug);
  if (page.status === 'sign_in') return redirect('/account/sign-in/');
  if (page.status === 'child') return redirect(PLAYING_PAGE);
  if (page.status !== 'ok') return notFound();
  const { circle, interests, choices } = page;
  const canSave = page.isOwner && page.open;
  return (
    <>
      <h1>Interests: {circle.name}</h1>
      <Result code={r} messages={MESSAGES} />
      <p id="circle-interests-hint">
        Each day the circle gets a set of up to 5 items from these topics and worlds. With nothing chosen, every world counts. When there
        are not enough matching items, the set is filled from the chosen worlds, then from any world, marked &quot;bonus&quot;.
        {!canSave && ' Only the circle owner can change them.'}
      </p>
      <form method="post" action={`/circles/${circle.slug}/interests/save/`} className="prose admin-form">
        <fieldset aria-describedby="circle-interests-hint">
          <legend>Worlds (up to {INTEREST_LIMITS.worlds})</legend>
          <Boxes name="world" choices={choices.worlds} picked={interests.worldIds} disabled={!canSave} />
        </fieldset>
        <fieldset aria-describedby="circle-interests-hint">
          <legend>Topics (up to {INTEREST_LIMITS.topics})</legend>
          {choices.topicGroups.map((g) => (
            <fieldset key={g.name}>
              <legend>{g.name}</legend>
              <Boxes name="topic" choices={g.topics} picked={interests.topicIds} disabled={!canSave} />
            </fieldset>
          ))}
        </fieldset>
        {canSave && (
          <button type="submit" className="button">
            Save the circle&apos;s interests
          </button>
        )}
      </form>
      <p>
        <Link href={`/circles/${circle.slug}/`}>Back to the circle</Link>
      </p>
    </>
  );
}
