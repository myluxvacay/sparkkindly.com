// Fixtures shared by the contributor tests (plan 8): a signed-in member with the contributor role on, drafts and
// submitted contributions. Sources are "checked" by a stub probe, so no test reaches the network.
import type { Db } from '@/lib/db';
import type { Probe } from '@/lib/items/probe';
import { enableContributor } from '@/lib/contributors/profile';
import { saveDraft } from '@/lib/contributors/drafts';
import { submitContribution } from '@/lib/contributors/submit';
import { createContributorLimits } from '@/lib/contributors/rules';
import { person, type Person } from './comments';

export const okProbe: Probe = async () => ({ status: 200, location: null });
export const freshLimits = () => createContributorLimits(() => 0);

let n = 0;

export const articleDraft = (over: Record<string, unknown> = {}) => ({
  kind: 'article',
  world: 'discover',
  title: `Why the sky looks blue number ${n++}`,
  summary: 'A short look at how sunlight scatters in the air above us.',
  sources: [{ title: 'NASA', url: 'https://science.nasa.gov/sky' }],
  sections: [
    { heading: 'Sunlight', text: 'Sunlight holds every colour.\n\nBlue light scatters more than red light does.' },
    { heading: 'Air', text: 'Small molecules in the air scatter short waves of light.' },
  ],
  takeaway: 'Look up and think of tiny molecules.',
  ...over,
});

export async function contributor(db: Db, now: Date, dob = '1990-05-05'): Promise<Person> {
  const p = await person(db, now, dob);
  const r = await enableContributor(db, p.ctx, { displayName: `Writer ${n++}`, terms: 'on' }, now);
  if (r.status !== 'enabled') throw new Error(`enable failed: ${JSON.stringify(r)}`);
  return p;
}

export async function drafted(db: Db, p: Person, now: Date, over: Record<string, unknown> = {}): Promise<string> {
  const r = await saveDraft(db, p.ctx, articleDraft(over), now, { limits: freshLimits() });
  if (r.status !== 'saved') throw new Error(`save failed: ${JSON.stringify(r)}`);
  return r.id;
}

export const DECLARED = { original: 'on', licence: 'on' };

export async function submitted(db: Db, p: Person, now: Date, over: Record<string, unknown> = {}): Promise<string> {
  const id = await drafted(db, p, now, over);
  const r = await submitContribution(db, p.ctx, id, DECLARED, now, { probe: okProbe, limits: freshLimits() });
  if (r.status !== 'agent_review') throw new Error(`submit failed: ${JSON.stringify(r)}`);
  return id;
}

export const stateOf = async (db: Db, id: string) =>
  (await db.query<{ state: string; item_id: string | null }>('SELECT state, item_id FROM contributions WHERE id = $1', [id])).rows[0];

export const itemOf = async (db: Db, itemId: string) =>
  (
    await db.query<{ status: string; audience: string; risk_tier: string; created_by: string; agent_id: number | null; title: string }>(
      'SELECT status, audience, risk_tier, created_by, agent_id, title FROM items WHERE id = $1',
      [itemId],
    )
  ).rows[0];
