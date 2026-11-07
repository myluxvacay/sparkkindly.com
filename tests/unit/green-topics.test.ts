// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { newTestDb } from '../helpers/test-db';
import { parseGoals } from '../../lib/agents/goals';

const GREEN = ['climate', 'recycling', 'reducing-waste', 'energy-saving'];
const goals = (world: string) => parseGoals(readFileSync(`agents/worlds/${world}.md`, 'utf8'));

describe('Green topics (no new world)', () => {
  it('the migrations create the four topics under a Green parent', async () => {
    const db = await newTestDb();
    const r = await db.query<{ slug: string; parent: string | null }>(
      `SELECT t.slug, p.slug AS parent FROM topics t LEFT JOIN topics p ON p.id = t.parent_id WHERE t.slug = ANY($1) ORDER BY t.slug`,
      [GREEN],
    );
    expect(r.rows).toEqual(GREEN.slice().sort().map((slug) => ({ slug, parent: 'green' })));
    const parent = await db.query<{ slug: string; parent_id: number | null }>("SELECT slug, parent_id FROM topics WHERE slug = 'green'");
    expect(parent.rows).toEqual([{ slug: 'green', parent_id: null }]);
    await db.close();
  });

  it('Discover and Grow may draft Green topics; no world file is added', () => {
    for (const w of ['discover', 'grow']) expect(goals(w).topics).toEqual(expect.arrayContaining(GREEN));
  });

  it('the guidance keeps Green factual: sourced claims, no politics, no guilt', () => {
    expect(goals('discover').body).toMatch(/climate/i);
    expect(goals('grow').body).toMatch(/one small step/i);
  });
});
