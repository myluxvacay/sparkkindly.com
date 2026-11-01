import { getDb } from '@/lib/db';
import type { PublicItem } from '@/lib/items/repo';
import { playResult } from '@/lib/play/answer';
import { readPlay } from '@/lib/public/body';
import { anonymousScope } from '@/lib/public/scope';
import { clueCount, hasResponse, toParams, type SearchParams } from '@/lib/public/play-params';
import PlayForm from './PlayForm';
import PlayResult from './PlayResult';

// One playable item: the answer form until a response arrives, then the server's verdict. Shared by the item page and
// /quiz/, so both behave the same.
export default async function PlayPanel({ item, searchParams }: { item: PublicItem; searchParams: SearchParams }) {
  const action = `/${item.world}/${item.slug}/`;
  const play = readPlay(item.body);
  const params = toParams(searchParams);
  const result = hasResponse(params) ? await playResult(getDb(), anonymousScope(), item.world, item.slug, params) : null;
  const another = item.kind === 'quiz' ? '/quiz/archive/' : `/${item.world}/`;

  return (
    <div className="quiz-panel">
      {result && result.status !== 'not_found' && <PlayResult result={result} again={action} another={another} />}
      {(!result || result.status === 'invalid') && <PlayForm action={action} play={play} clues={clueCount(params, play.clues.length)} />}
      <p className="quiz-note">No timer. No scores to share. Nothing is recorded.</p>
    </div>
  );
}
