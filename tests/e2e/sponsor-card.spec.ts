import { test, expect } from '@playwright/test';
import { addItem, sql } from './helpers/fixtures';

// Sponsor card (8 November 2026): a world's own sponsorship shows as a card on that world's page and at the bottom of its
// adults articles, only in Save, Grow and Discover. Play, Together and Kids show nothing even when a row exists. The
// sponsor link is never followed (example.test); the card's link goes through our own /go/<id>/ redirect.

const stamp = Date.now();
const SPONSOR = `Acme Card ${stamp}`;
const GROW_ART = `e2e-card-grow-${stamp}`;
const PLAY_ART = `e2e-card-play-${stamp}`;
const AFFILIATE = 'SparkKindly earns a commission if you buy through this link.';

test.beforeAll(async () => {
  await addItem({ world: 'grow', slug: GROW_ART, audience: 'adults', title: `Card in Grow ${stamp}` });
  await addItem({ world: 'play', slug: PLAY_ART, audience: 'adults', title: `Card in Play ${stamp}` });
  const sp = await sql(
    `INSERT INTO sponsors (name, link, disclosure, category, confirmed_at) VALUES ($1, 'https://acme.example.test/card', '', 'finance-education', now()) RETURNING id`,
    [SPONSOR],
  );
  for (const world of ['grow', 'play', 'kids']) {
    await sql(
      `INSERT INTO sponsorships (sponsor_id, world_id, label, kind) SELECT $1, id, $3, 'affiliate' FROM worlds WHERE slug = $2`,
      [sp.rows[0].id, world, `Card offer ${world}`],
    );
  }
});
test.afterAll(async () => {
  await sql('DELETE FROM sponsorships WHERE sponsor_id IN (SELECT id FROM sponsors WHERE name = $1)', [SPONSOR]);
  await sql('DELETE FROM sponsors WHERE name = $1', [SPONSOR]);
  await sql('DELETE FROM items WHERE slug = ANY($1)', [[GROW_ART, PLAY_ART]]);
});

test('Grow: a card on the world page and one at the bottom of an adults article, with the disclosure', async ({ page }) => {
  await page.goto('/grow/');
  const card = page.getByRole('complementary', { name: 'Sponsored' });
  await expect(card.getByRole('link', { name: 'Card offer grow' })).toHaveAttribute('href', /^\/go\/\d+\/$/);
  await expect(card).toContainText(AFFILIATE);
  await page.goto(`/grow/${GROW_ART}/`);
  await expect(page.getByRole('complementary', { name: 'Sponsored' })).toContainText(AFFILIATE);
});

test('Play and Kids show no card, even with a sponsorship row', async ({ page }) => {
  for (const url of ['/play/', `/play/${PLAY_ART}/`, '/kids/']) {
    await page.goto(url);
    await expect(page.getByRole('complementary', { name: 'Sponsored' })).toHaveCount(0);
    await expect(page.getByText(AFFILIATE)).toHaveCount(0);
  }
});
