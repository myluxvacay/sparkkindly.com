import Link from 'next/link';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import type { PublicItem } from '@/lib/items/repo';
import { playResult, type PlayResult as CheckedResult } from '@/lib/play/answer';
import { buildModel, poolQuizzes, rotateCandidates, DIFFICULTY_ORDER } from '@/lib/play/keep-playing';
import { readPlay, type PlayView } from '@/lib/public/body';
import { listPublic, listQuizzes } from '@/lib/public/reads';
import { currentViewer } from '@/lib/accounts/scope-next';
import { recordableRequest, recordPlay, type AnswerNote } from '@/lib/accounts/record-play';
import { listAnsweredIds } from '@/lib/accounts/responses';
import { clueCount, hasResponse, toParams, type SearchParams } from '@/lib/public/play-params';
import PlayForm from './PlayForm';
import PlayResult, { type PlayReview } from './PlayResult';
import PlayEnhancer from './PlayEnhancer';
import KeepPlaying from './KeepPlaying';
import SharePrompt from './SharePrompt';
import DifficultyMeter from './DifficultyMeter';

// One playable item: the answer form until a response arrives, then the server's verdict. Shared by the item page and
// /quiz/, so both behave the same. A signed-in context allowed to save answers gets its first answer recorded, only for
// our own form's same-origin submit (lib/accounts/record-play.ts); the note says "saved" only when it was. A visitor
// who cannot save sees exactly the page as before.
export default async function PlayPanel({
  item,
  searchParams,
  trackSeen = true,
}: {
  item: PublicItem;
  searchParams: SearchParams;
  /**
   * Whether the keep-playing seen list may be kept on the visitor's device for this surface. The
   * daily-question surfaces (/quiz/ and the home hero) pass false, and Kids-audience items are always
   * excluded below: those journeys store nothing in the browser (child-safety rule, pinned by e2e).
   */
  trackSeen?: boolean;
}) {
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
  const another = item.kind === 'quiz' ? '/quiz/archive/' : item.kind === 'game' ? '/games/' : `/${item.world}/`;
  const track = trackSeen && item.audience !== 'kids';
  const playable = item.kind === 'quiz' || item.kind === 'game';

  // "Keep playing" (owner request, 17 Nov 2026): after a quiz answer, offer an easier / same-level /
  // harder next quiz from the same scope-filtered pool the archive lists, so the player stays in the
  // flow. Candidates are rotated (seeded by this quiz) per level; the island re-picks against the
  // merged seen-set (this device's memory ∪ the signed-in player's saved answers) at tap time. Built
  // only for a checked quiz answer — never for the bare question.
  // Visual games joined the same flow on 18 Nov 2026 (owner direction): the pool is quizzes AND
  // games from the same scope-filtered reads, so a keep-playing hop can land on a picture game and a
  // picture game hands back to a quiz — one stream, no separate picture-game section.
  let keepPlaying: ReactNode = null;
  if (result?.status === 'ok' && playable && play.difficulty) {
    const db = getDb();
    const items: PublicItem[] = [];
    for (let page = 0; page < 6; page++) {
      const rows = await listQuizzes(db, viewer.scope, { limit: 50, offset: page * 50 });
      items.push(...rows);
      if (rows.length < 50) break;
    }
    for (let page = 0; page < 4; page++) {
      const rows = await listPublic(db, viewer.scope, { kind: 'game', limit: 50, offset: page * 50 });
      items.push(...rows);
      if (rows.length < 50) break;
    }
    const pools = poolQuizzes(
      items.map((q) => ({ id: q.id, world: q.world, slug: q.slug, difficulty: readPlay(q.body).difficulty })),
      item.id,
    );
    for (const level of DIFFICULTY_ORDER) {
      pools[level] = rotateCandidates(pools[level], item.id);
    }
    // A signed-in player's seen-set includes their saved answers (lib/accounts/responses): only the
    // ids among these candidates are needed, and a failed read degrades to the device-only set —
    // it never changes what the visitor sees beyond the deal.
    let accountSeen: string[] = [];
    if (viewer.owner) {
      try {
        const candidateIds = DIFFICULTY_ORDER.flatMap((level) => pools[level].map((cand) => cand.id));
        accountSeen = await listAnsweredIds(db, viewer.owner, viewer.scope, candidateIds);
      } catch (err) {
        console.error('keep-playing history read failed:', (err as Error)?.name);
      }
    }
    const model = buildModel(item.id, play.difficulty, pools, {
      accountSeen,
      signedIn: Boolean(viewer.owner),
      trackSeen: track,
    });
    if (model.options.easier || model.options.same || model.options.harder) {
      keepPlaying = <KeepPlaying model={model} correct={result.correct} />;
    }
  }

  return (
    <PlayEnhancer>
      <div
        className="quiz-panel"
        id="play-panel"
        data-kp-current={track && playable ? item.id : undefined}
        data-kp-level={track && playable ? play.difficulty : undefined}
      >
        <DifficultyMeter level={play.difficulty} />
        {result && result.status !== 'not_found' && (
          <PlayResult
            result={result}
            again={action}
            another={another}
            invalidHint={invalidHint}
            review={result.status === 'ok' ? reviewFor(play, result, params) : undefined}
            keepPlaying={keepPlaying ?? undefined}
          />
        )}
        {(!result || result.status === 'invalid') && (
          <PlayForm
            action={action}
            play={play}
            clues={clueCount(params, play.clues.length)}
            stage={params.get('stage') === 'answer' ? 'answer' : 'look'}
            step={Number.parseInt(params.get('step') ?? '0', 10) || 0}
          />
        )}
        <Note note={note} />
        {result?.status === 'ok' && <SharePrompt itemId={item.id} />}
      </div>
    </PlayEnhancer>
  );
}

// The kept quiz context for the result panel (user feedback, 17 Nov 2026): the question and the
// player's own answer stay on screen with the verdict, the correct option marked alongside theirs
// for the closed-choice mechanics; the other mechanics get a one-line "your answer" (for free text,
// the words are echoed from this request's own parameters — they are never stored, see
// lib/play/answer.ts — and handed back only to the person who typed them).
function reviewFor(play: PlayView, result: Extract<CheckedResult, { status: 'ok' }>, params: URLSearchParams): PlayReview {
  const mark = (list: { id: string; text: string }[], chosen: unknown, answer: unknown) =>
    list.map((o) => ({ id: o.id, text: o.text, yours: chosen === o.id, correct: answer === o.id }));
  switch (play.mechanic) {
    case 'multiple_choice':
      return {
        prompt: play.prompt,
        passage: play.passage,
        passageTitle: play.passageTitle,
        options: mark(play.options, result.choice, result.answerChoice),
      };
    case 'odd_one_out':
      return { prompt: play.prompt, options: mark(play.items, result.choice, result.answerChoice) };
    case 'true_false': {
      const asId = (v: unknown) => (v === true ? 'true' : v === false ? 'false' : null);
      return {
        prompt: play.prompt,
        options: mark(
          [
            { id: 'true', text: 'True' },
            { id: 'false', text: 'False' },
          ],
          asId(result.choice),
          asId(result.answerChoice),
        ),
      };
    }
    case 'number':
      return { prompt: play.prompt, yourAnswer: typeof result.choice === 'number' ? String(result.choice) : undefined };
    case 'put_in_order': {
      const text = new Map(play.items.map((i) => [i.id, i.text]));
      const order = Array.isArray(result.choice)
        ? result.choice.map((id) => text.get(String(id)) ?? String(id)).join(', ')
        : undefined;
      return { prompt: play.prompt, yourAnswer: order };
    }
    default:
      return { prompt: play.prompt, yourAnswer: params.get('r') ?? undefined };
  }
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
