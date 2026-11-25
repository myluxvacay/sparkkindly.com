// Today's Spark advance (owner addendum, 24 Nov 2026): a fresh visitor gets today's question
// as today. Once THIS visitor has answered it, a reload or return visit must serve the NEXT
// question instead — band-matched first, not previously answered by this visitor. Signed-in
// answers are recorded server-side (lib/accounts/responses.ts); guests rely on the device seen
// store, which the play island applies client-side from the model built here (PlayEnhancer).
// This module is the server half: the chain, the signed-in viewer's answered ids among it, and
// the first-unanswered pick. No Next.js imports.
import type { Db } from '@/lib/db';
import type { PublicItem } from '@/lib/items/repo';
import type { Scope } from '@/lib/public/scope';
import type { Owner } from '@/lib/accounts/interests';
import { dailyQuizChain } from '@/lib/public/reads';
import { listAnsweredIds } from '@/lib/accounts/responses';
import { readPlay } from '@/lib/public/body';

export type DailyChainEntry = {
  id: string;
  world: string;
  slug: string;
  title: string;
  bands: string[];
  difficulty: string | null;
  audience: string;
};

export type DailyModel = { chain: DailyChainEntry[]; accountSeen: string[] };

export const toDailyModel = (chain: PublicItem[], accountSeen: string[]): DailyModel => ({
  chain: chain.map((q) => ({
    id: q.id,
    world: q.world,
    slug: q.slug,
    title: q.title,
    bands: [...q.ageBands],
    difficulty: readPlay(q.body).difficulty ?? null,
    audience: q.audience,
  })),
  accountSeen,
});

// The daily quiz for this viewer: the newest quiz, unless the viewer is signed in and has
// already answered it (and the ones after it), in which case the first unanswered in the chain.
// A failed history read degrades to today's question — it never breaks the page.
export async function loadDailyQuiz(
  db: Db,
  viewer: { owner: Owner | null; scope: Scope },
): Promise<{ quiz: PublicItem | null; daily?: DailyModel }> {
  const chain = await dailyQuizChain(db, viewer.scope, 40);
  if (!chain.length) return { quiz: null };
  let accountSeen: string[] = [];
  if (viewer.owner) {
    try {
      accountSeen = await listAnsweredIds(db, viewer.owner, viewer.scope, chain.map((q) => q.id));
    } catch (err) {
      console.error('daily-quiz history read failed:', (err as Error)?.name);
    }
  }
  const seen = new Set(accountSeen);
  const quiz = chain.find((q) => !seen.has(q.id)) ?? chain[0];
  return { quiz, daily: toDailyModel(chain, accountSeen) };
}
