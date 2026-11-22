import type { Queryable } from '@/lib/db';
import { mechanics, type Mechanic } from '@/lib/items/format';
import { getAnswer } from '@/lib/items/repo';
import { getPublicItem } from '@/lib/public/reads';
import type { Scope } from '@/lib/public/scope';
import { checkAnswer, describeAnswer, parseGiven } from './check';

export type PlayResult =
  | {
      status: 'ok';
      itemId: string;
      correct: boolean;
      answerText: string;
      explanation: string;
      choice: unknown;
      // The stored answer in the same closed form as `choice` (an option id, a boolean, an order of
      // ids, a number), or null for the free-text mechanics — never the accepted-text list itself.
      // The result panel uses it to mark the correct option in the kept quiz context; it is produced
      // only after a response has been checked, alongside answerText, which already states it in words.
      answerChoice: unknown;
    }
  | { status: 'invalid' }
  | { status: 'not_found' };

// Mechanics whose response is a closed choice (an id, true/false, a number, an order of ids). Only these keep the
// response for re-scoring (plan 4C); free text a player typed (short_text, clue_reveal) is never stored.
const CLOSED: readonly Mechanic[] = ['multiple_choice', 'odd_one_out', 'true_false', 'number', 'put_in_order', 'match_pairs'];

const isMechanic = (x: unknown): x is Mechanic => (mechanics as readonly unknown[]).includes(x);

type Body = {
  mechanic: Mechanic;
  options?: { id: string }[];
  items?: { id: string }[];
  visual?: { match?: { pieces?: { id: string }[]; targets?: { id: string }[] } };
};
const ids = (list: unknown) => (Array.isArray(list) ? list.map((c: { id?: unknown }) => c?.id) : []);

// The response to keep for re-scoring (4C review M1): only a closed form the item itself offers, never text a player
// typed into the id field. parseGiven already returns only booleans, finite numbers and orders of the item's own ids.
function closedChoice(body: Body, given: unknown): unknown {
  if (!CLOSED.includes(body.mechanic)) return null;
  if (body.mechanic === 'multiple_choice') return ids(body.options).includes(given) ? given : null;
  if (body.mechanic === 'odd_one_out') return [...ids(body.items), ...ids(body.options)].includes(given) ? given : null;
  if (body.mechanic === 'match_pairs') {
    const pieces = ids(body.visual?.match?.pieces);
    return Array.isArray(given) && given.every((id) => pieces.includes(id)) ? given : null;
  }
  return given;
}

// The stored answer in closed form, mirroring closedChoice: only the shapes a closed mechanic's key
// legitimately takes, so a malformed key yields null rather than leaking an unexpected value.
function closedAnswer(body: Body, stored: unknown): unknown {
  if (!CLOSED.includes(body.mechanic)) return null;
  switch (body.mechanic) {
    case 'multiple_choice':
    case 'odd_one_out':
      return typeof stored === 'string' ? stored : null;
    case 'true_false':
      return typeof stored === 'boolean' ? stored : null;
    case 'put_in_order':
    case 'match_pairs':
      return Array.isArray(stored) ? stored : null;
    case 'number':
      return typeof stored === 'object' && stored !== null && typeof (stored as { value?: unknown }).value === 'number'
        ? (stored as { value: number }).value
        : null;
    default:
      return null;
  }
}

// Checks one response on the server. The item is loaded through getPublicItem so every visibility and audience rule
// applies; the stored answer is read only here and leaves this function only as describeAnswer text after checking.
// It is never logged.
export async function playResult(db: Queryable, scope: Scope, world: string, slug: string, params: URLSearchParams): Promise<PlayResult> {
  const item = await getPublicItem(db, scope, world, slug);
  if (!item || (item.kind !== 'quiz' && item.kind !== 'game')) return { status: 'not_found' };
  const body = item.body as (Omit<Body, 'mechanic'> & { mechanic?: unknown }) | null;
  if (!body || !isMechanic(body.mechanic)) return { status: 'not_found' };

  const given =
    body.mechanic === 'match_pairs'
      ? parseGiven(
          body.mechanic,
          params,
          (body as Body).visual?.match?.targets?.map((t) => t.id),
          (body as Body).visual?.match?.pieces?.map((p) => p.id),
        )
      : parseGiven(body.mechanic, params, body.items?.map((i) => i.id));
  if (given === null) return { status: 'invalid' };

  // ponytail: the key is read outside the transaction that records the answer, so a changeAnswerKey committed between
  // this read and the insert leaves that one row checked against the old key (its choice is kept, so the next re-score
  // fixes it). Re-check the key FOR SHARE inside the record transaction if corrections ever become routine.
  const answer = await getAnswer(db, item.id);
  if (!answer) return { status: 'not_found' };
  return {
    status: 'ok',
    itemId: item.id,
    correct: checkAnswer(body.mechanic, answer.value, given),
    answerText: describeAnswer(item.body, answer.value),
    explanation: answer.explanation,
    choice: closedChoice(body as Body, given),
    answerChoice: closedAnswer(body as Body, answer.value),
  };
}
