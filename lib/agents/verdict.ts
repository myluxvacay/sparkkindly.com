import { z } from 'zod';

// The reviewer agent's answer for one item. A pass has to show its work for the item's risk tier: a Sourced item
// needs the sources the reviewer actually opened, a Computable item the answer the reviewer reached on its own.
const verdictSchema = z.object({
  pass: z.boolean(),
  reasons: z.array(z.string().min(1).max(500)).max(10),
  sourcesChecked: z.array(z.url().startsWith('https://')).max(10),
  solvedAnswer: z.string().max(200).optional(),
});

export type Verdict = z.infer<typeof verdictSchema>;
export type Tier = 'sourced' | 'computable' | 'reflective' | 'kids';

export function parseVerdict(input: unknown, item: { tier: Tier }): Verdict {
  const v = verdictSchema.parse(input);
  if (!v.pass && v.reasons.length === 0) throw new Error('a failing verdict needs at least one reason');
  if (v.pass && item.tier === 'sourced' && v.sourcesChecked.length === 0) throw new Error('a Sourced item cannot pass without a source the reviewer opened');
  if (v.pass && item.tier === 'computable' && !v.solvedAnswer) throw new Error('a Computable item cannot pass without the reviewer\'s own solved answer');
  return v;
}
