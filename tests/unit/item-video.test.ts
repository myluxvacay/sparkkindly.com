// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newTestDb } from '../helpers/test-db';
import { seedReference } from '@/db/seed';
import { createItem, type NewItem } from '@/lib/items/repo';
import { runAction } from '@/lib/admin/actions';
import { parseYouTubeId, posterSource, getVideoId } from '@/lib/items/video';

type TestDb = Awaited<ReturnType<typeof newTestDb>>;
let db: TestDb;
let playId: number;
let kidsId: number;
let n = 0;
const ADMIN = { email: 'owner@example.test' };
const NOW = new Date('2026-11-05T12:00:00Z');
const ID = 'dQw4w9WgXcQ';

beforeAll(async () => {
  db = await newTestDb();
  await seedReference(db);
  const w = (await db.query<{ id: number; slug: string }>('SELECT id, slug FROM worlds')).rows;
  playId = w.find((x) => x.slug === 'play')!.id;
  kidsId = w.find((x) => x.slug === 'kids')!.id;
});
afterAll(async () => db.close());

const act = (name: string, f: Record<string, string>) => runAction(db, ADMIN, name, new URLSearchParams(f), NOW);
const make = (over: Partial<NewItem> = {}) =>
  createItem(db, {
    worldId: playId, kind: 'article', slug: `vid-${++n}`, title: 'T', summary: 'S',
    body: { sections: [{ heading: 'H', paragraphs: ['P'] }] }, audience: 'all', createdBy: 'test', riskTier: 'reflective', ...over,
  });

describe('parseYouTubeId', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`https://youtube.com/watch?v=${ID}&t=5s`, ID],
    [`https://youtu.be/${ID}`, ID],
    [`https://www.youtube.com/embed/${ID}`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://m.youtube.com/watch?v=${ID}`, ID],
  ])('accepts %s', (url, id) => expect(parseYouTubeId(url)).toBe(id));

  it.each([
    'https://evil.example/watch?v=' + ID,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    'https://www.youtube.com/watch?v=short',
    `https://www.youtube.com/watch?v=${ID}extra`,
    'javascript:alert(1)',
    '',
  ])('rejects %s', (url) => expect(parseYouTubeId(url)).toBeNull());
});

describe('posterSource', () => {
  it('is a fixed https image host with the validated id and nothing else', () => {
    expect(posterSource(ID)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });
});

describe('item.video action', () => {
  it('stores the id, audits it, and getVideoId reads it back', async () => {
    const item = await make();
    const r = await act('item.video', { id: item.id, url: `https://youtu.be/${ID}`, captions: 'yes', reason: 'owner added' });
    expect(r).toMatchObject({ ok: true });
    expect(await getVideoId(db, item.id)).toBe(ID);
    const a = (await db.query<{ action: string }>("SELECT action FROM audit_log WHERE action = 'item.video'")).rows;
    expect(a.length).toBe(1);
  });

  it('refuses without the captions confirmation', async () => {
    const item = await make();
    expect(await act('item.video', { id: item.id, url: `https://youtu.be/${ID}`, reason: 'x' })).toMatchObject({ ok: false, status: 400 });
    expect(await getVideoId(db, item.id)).toBeNull();
  });

  it('refuses a bad link', async () => {
    const item = await make();
    expect(await act('item.video', { id: item.id, url: 'https://evil.example/x', captions: 'yes', reason: 'x' })).toMatchObject({ ok: false, status: 400 });
  });

  it('never attaches a video to a Kids item or a Kids-world item', async () => {
    const kidsAudience = await make({ audience: 'kids', riskTier: 'kids' });
    const kidsWorld = await make({ worldId: kidsId, audience: 'kids', riskTier: 'kids' });
    for (const item of [kidsAudience, kidsWorld]) {
      expect(await act('item.video', { id: item.id, url: `https://youtu.be/${ID}`, captions: 'yes', reason: 'x' })).toMatchObject({ ok: false, status: 400 });
      expect(await getVideoId(db, item.id)).toBeNull();
    }
  });

  it('removes a video', async () => {
    const item = await make();
    await act('item.video', { id: item.id, url: `https://youtu.be/${ID}`, captions: 'yes', reason: 'x' });
    expect(await act('item.video', { id: item.id, url: '', reason: 'removed' })).toMatchObject({ ok: true });
    expect(await getVideoId(db, item.id)).toBeNull();
  });

  it('rejects a database value that is not a valid id (CHECK constraint)', async () => {
    const item = await make();
    await expect(db.query("UPDATE items SET video_youtube_id = 'x y' WHERE id = $1", [item.id])).rejects.toThrow();
  });
});
