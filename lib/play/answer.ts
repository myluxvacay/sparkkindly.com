import type { Queryable } from '@/lib/db';
import { mechanics, type Mechanic } from '@/lib/items/format';
import { getAnswer } from '@/lib/items/repo';
import { getPublicItem } from '@/lib/public/reads';
import type { Scope } from '@/lib/public/scope';
import { checkAnswer, describeAnswer, parseGiven } from './check';

export type PlayResult =
  | { status: 'ok'; correct: boolean; answerText: string; explanation: string }
  | { status: 'invalid' }
  | { status: 'not_found' };

const isMechanic = (x: unknown): x is Mechanic => (mechanics as readonly unknown[]).includes(x);

// Checks one response on the server. The item is loaded through getPublicItem so every visibility and audience rule
// applies; the stored answer is read only here and leaves this function only as describeAnswer text after checking.
// It is never logged.
export async function playResult(db: Queryable, scope: Scope, world: string, slug: string, params: URLSearchParams): Promise<PlayResult> {
  const item = await getPublicItem(db, scope, world, slug);
  if (!item || (item.kind !== 'quiz' && item.kind !== 'game')) return { status: 'not_found' };
  const body = item.body as { mechanic?: unknown; items?: { id: string }[] } | null;
  if (!body || !isMechanic(body.mechanic)) return { status: 'not_found' };

  const given = parseGiven(body.mechanic, params, body.items?.map((i) => i.id));
  if (given === null) return { status: 'invalid' };

  const answer = await getAnswer(db, item.id);
  if (!answer) return { status: 'not_found' };
  return {
    status: 'ok',
    correct: checkAnswer(body.mechanic, answer.value, given),
    answerText: describeAnswer(item.body, answer.value),
    explanation: answer.explanation,
  };
}
