import Link from 'next/link';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import type { PublicItem } from '@/lib/items/repo';
import { playResult } from '@/lib/play/answer';
import { readPlay } from '@/lib/public/body';
import { currentViewer } from '@/lib/accounts/scope-next';
import { recordableRequest, recordPlay, type AnswerNote } from '@/lib/accounts/record-play';
import { clueCount, hasResponse, toParams, type SearchParams } from '@/lib/public/play-params';
import PlayForm from './PlayForm';
import PlayResult from './PlayResult';

// One playable item: the answer form until a response arrives, then the server's verdict. Shared by the item page and
// /quiz/, so both behave the same. A signed-in context allowed to save answers gets its first answer recorded, only for
// our own form's same-origin submit (lib/accounts/record-play.ts); the note says "saved" only when it was. A visitor
// who cannot save sees exactly the page as before.
export default async function PlayPanel({ item, searchParams }: { item: PublicItem; searchParams: SearchParams }) {
  const action = `/${item.world}/${item.slug}/`;
  const play = readPlay(item.body);
  const params = toParams(searchParams);
  const viewer = await currentViewer();
  const result = hasResponse(params) ? await playResult(getDb(), viewer.scope, item.world, item.slug, params) : null;
  const recordable = Boolean(viewer.owner && result?.status === 'ok' && recordableRequest(await headers()));
  const note = await recordPlay(getDb(), viewer.owner, result, recordable, new Date());
  const invalidHint =
    play.mechanic === 'put_in_order'
      ? `Please give each item a different position from 1 to ${play.items.length}, then check again.`
      : undefined;
  const another = item.kind === 'quiz' ? '/quiz/archive/' : `/${item.world}/`;

  return (
    <div className="quiz-panel">
      {result && result.status !== 'not_found' && <PlayResult result={result} again={action} another={another} invalidHint={invalidHint} />}
      {(!result || result.status === 'invalid') && <PlayForm action={action} play={play} clues={clueCount(params, play.clues.length)} />}
      <Note note={note} />
    </div>
  );
}

const privacy = <Link href="/privacy/">privacy guide</Link>;

function Note({ note }: { note: AnswerNote }) {
  switch (note) {
    case 'saved':
      return <p className="quiz-note">No timer. No scores to share. Your answer is saved to your profile; see the {privacy}.</p>;
    case 'unsaved':
      return (
        <p className="quiz-note">
          No timer. No scores to share. Your answer is not saved this time. Use the answer form on this page to save it to your
          profile; see the {privacy}.
        </p>
      );
    case 'before':
      return (
        <p className="quiz-note">
          No timer. No scores to share. An answer you check with this form is saved to your profile; see the {privacy}.
        </p>
      );
    default:
      return (
        <p className="quiz-note">
          No timer. No scores to share. SparkKindly does not save your answer; see the <Link href="/privacy/">privacy guide</Link>.
        </p>
      );
  }
}
