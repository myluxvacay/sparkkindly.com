import Link from 'next/link';
import { notFound } from 'next/navigation';
import ContributionList from '@/components/contributors/ContributionList';
import Editor from '@/components/contributors/Editor';
import ProfileForm from '@/components/contributors/ProfileForm';
import SubmitForm from '@/components/contributors/SubmitForm';
import { requireAdult } from '@/lib/accounts/next';
import { contributorsEnabled } from '@/lib/config';
import { EDITABLE_STATES } from '@/lib/contributors/rules';
import { CONTRIBUTE_MESSAGES, loadContributePage } from '@/lib/contributors/web';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ id?: string; new?: string; r?: string }> };

function Result({ code }: { code?: string }) {
  const r = code && Object.hasOwn(CONTRIBUTE_MESSAGES, code) ? CONTRIBUTE_MESSAGES[code] : null;
  if (!r) return null;
  return (
    <div role={r.ok ? 'status' : 'alert'} id="result" tabIndex={-1} className={r.ok ? 'takeaway' : 'grown-ups'}>
      <p>{r.text}</p>
    </div>
  );
}

// The contributor's own page (plan 8): the profile, their pieces with each state and next step, and the editor. Adult
// context only (a child context goes to the "Playing as" page); members who cannot contribute, another member's piece
// and the flag off are 404.
export default async function ContributePage({ searchParams }: Props) {
  if (!contributorsEnabled()) notFound();
  const ctx = await requireAdult();
  const q = await searchParams;
  const page = await loadContributePage(getDb(), ctx, { id: q.id, new: q.new });
  if (page === 'not_found') notFound();
  const editable = page.editing && (EDITABLE_STATES as readonly string[]).includes(page.editing.state);
  const kind = page.editing?.kind ?? page.newKind;
  return (
    <>
      <h1>Write for SparkKindly</h1>
      <Result code={q.r} />
      <p>
        Articles and quiz questions for every world except Kids. Every piece is checked automatically, reviewed and approved by
        the site owner before it is published with your name. Read the <Link href="/contributors/terms/">contributor terms</Link>.
      </p>
      <h2>Your contributor profile</h2>
      <ProfileForm profile={page.profile} adult={page.group === 'adult'} />
      {page.profile && (
        <>
          {kind && (!page.editing || editable) ? (
            <>
              <h2>{page.editing ? 'Edit your piece' : kind === 'quiz' ? 'New quiz question' : 'New article'}</h2>
              <Editor kind={kind} worlds={page.worlds} topics={page.topics} editing={page.editing} />
              {page.editing && (
                <>
                  <h2>Submit for review</h2>
                  <SubmitForm id={page.editing.id} />
                </>
              )}
              <p>
                <Link href="/me/contribute/">Back to your pieces</Link>
              </p>
            </>
          ) : (
            <p className="admin-actions">
              <Link href="/me/contribute/?new=article">Write a new article</Link>
              <Link href="/me/contribute/?new=quiz">Write a new quiz question</Link>
            </p>
          )}
          <h2>Your pieces</h2>
          <ContributionList mine={page.mine} />
        </>
      )}
    </>
  );
}
