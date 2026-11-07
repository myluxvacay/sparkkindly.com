// @vitest-environment node
// The Save world (plan 2026-11-07 Task 1): a sixth world after Grow and before Kids, added by migration so existing
// databases get it, with copy that matches lib/config.ts.
import { describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../db/migrate.mjs';
import { fromPglite, newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { brands } from '@/lib/config';
import { brandSchema } from '@/lib/schemas';
import { listWorlds } from '@/lib/public/worlds';
import { RESERVED_WORLD_SLUGS } from '@/lib/public/scope';

const MIGRATION = '033_save_world.sql';
const ORDER = ['play', 'discover', 'together', 'grow', 'save', 'kids'];

describe('Save world definition', () => {
  it('config lists six worlds with Save after Grow and Kids last', () => {
    expect(Object.keys(brands)).toEqual(ORDER);
    expect(brands.save.promise).toBe('Spend smart. Keep more.');
  });

  it('the brand schema accepts save and the slug is not reserved', () => {
    expect(brandSchema.parse('save')).toBe('save');
    expect(RESERVED_WORLD_SLUGS).not.toContain('save');
  });

  it('a fresh migrated and seeded database lists the six worlds in order, Save on auto', async () => {
    const db = await newTestDb();
    await seedReference(db);
    expect((await listWorlds(db)).map((w) => w.slug)).toEqual(ORDER);
    const row = (await db.query<Record<string, unknown>>("SELECT * FROM worlds WHERE slug = 'save'")).rows[0];
    const b = brands.save;
    expect(row).toMatchObject({ name: b.name, promise: b.promise, description: b.description, icon: b.icon, color: b.color });
    expect(row).toMatchObject({ enabled: true, approval_mode: 'auto', comments_enabled: true });
    await db.close();
  });

  it('applies on top of a database that already has the five launch worlds and keeps Kids last', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'save-world-'));
    const pg = new PGlite();
    try {
      for (const f of readdirSync('db/migrations').filter((f) => f.endsWith('.sql') && f < MIGRATION)) {
        cpSync(path.join('db/migrations', f), path.join(dir, f));
      }
      const db = fromPglite(pg);
      await migrate(db, dir);
      for (const [i, slug] of ['play', 'discover', 'together', 'grow', 'kids'].entries()) {
        await db.query("INSERT INTO worlds (slug, name, sort, approval_mode) VALUES ($1, $1, $2, CASE WHEN $1 = 'kids' THEN 'review' ELSE 'auto' END)", [slug, i]);
      }
      cpSync(path.join('db/migrations', MIGRATION), path.join(dir, MIGRATION));
      expect((await migrate(db, dir)).applied).toEqual([MIGRATION]);
      expect((await listWorlds(db)).map((w) => w.slug)).toEqual(ORDER);
      const topics = await db.query<{ slug: string }>("SELECT t.slug FROM topics t JOIN topics p ON p.id = t.parent_id WHERE p.slug = 'money-habits' ORDER BY t.slug");
      expect(topics.rows.map((r) => r.slug)).toEqual(expect.arrayContaining(['budgeting', 'money-basics', 'student-money', 'understanding-offers']));
    } finally {
      await pg.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves an owner-moved Kids position alone', async () => {
    const db = await newTestDb();
    // newTestDb already ran 033; a re-run of its statements must not move a Kids row the owner placed elsewhere.
    await db.query("INSERT INTO worlds (slug, name, sort, approval_mode) VALUES ('kids', 'Kids', 9, 'review')");
    const sql = (await import('node:fs')).readFileSync(path.join('db/migrations', MIGRATION), 'utf8');
    await db.exec(sql);
    expect((await db.query<{ sort: number }>("SELECT sort FROM worlds WHERE slug = 'kids'")).rows[0].sort).toBe(9);
    expect((await db.query("SELECT 1 FROM worlds WHERE slug = 'save'")).rows).toHaveLength(1);
    await db.close();
  });
});
