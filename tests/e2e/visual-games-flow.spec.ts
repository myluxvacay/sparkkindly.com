import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// Visual games in the regular question flow (owner direction, 18 Nov 2026): picture games are
// library items now — they render in the same play panel as quizzes, their answers are checked by
// the server, and keep-playing deals whatever comes next. These specs play real games from the
// seeded library end to end.
type GameFile = {
  id: string; brand: string; gameType: string; scheduledDate: string; reviewStatus: string;
  prompt?: string;
  correctOptionId?: string; numberAnswer?: { value: number };
  options?: { id: string; text: string }[];
};
const today = new Date().toISOString().slice(0, 10);
const library: GameFile[] = fs
  .readdirSync('content/games')
  .map((f) => JSON.parse(fs.readFileSync(`content/games/${f}`, 'utf8')) as GameFile)
  .filter((g) => g.reviewStatus === 'approved' && g.scheduledDate <= today && g.brand !== 'kids');
const firstOf = (type: string) => library.find((g) => g.gameType === type)!;
const correctText = (g: GameFile) => g.options!.find((o) => o.id === g.correctOptionId)!.text;

test('a starter picture round plays in the flow and hands over to keep-playing', async ({ page }) => {
  await page.goto('/play/odd-fruit-car/#play-panel');
  await expect(page.locator('.options-art .option svg').first()).toBeVisible();
  await page.locator('label.option', { hasText: 'Car' }).first().click();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toContainText(/Correct/);
  // The flow continues: keep-playing offers the next questions from the merged pool.
  await expect(page.locator('.keep-playing')).toBeVisible();
});

test('an observation game renders its scene and checks the answer on the server', async ({ page }) => {
  const g = firstOf('observation');
  await page.goto(`/${g.brand}/${g.id}/#play-panel`);
  await expect(page.locator('svg.scene-view')).toBeVisible();
  await page.locator('label.option', { hasText: correctText(g) }).first().click();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toContainText(/Correct/);
});

test('a memory game shows the scene first, then hides it for the answer', async ({ page }) => {
  const g = firstOf('memory');
  await page.goto(`/${g.brand}/${g.id}/#play-panel`);
  await expect(page.locator('svg.scene-view')).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  // The look phase must not leak the question (owner design review, 18 Nov 2026): the prompt used
  // to head the scene, telling the player exactly what to count or watch for.
  await expect(page.locator('.quiz-panel')).not.toContainText(g.prompt!);
  await expect(page.locator('.article-summary')).not.toContainText(g.prompt!);
  await page.getByRole('link', { name: /looked carefully/ }).click();
  await expect(page.locator('svg.scene-view')).toHaveCount(0);
  await expect(page.getByText('The picture is hidden now')).toBeVisible();
  await page.locator('label.option', { hasText: correctText(g) }).first().click();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toContainText(/Correct/);
});

test('a sequence game shows its items one at a time, then asks', async ({ page }) => {
  const g = firstOf('sequence');
  await page.goto(`/${g.brand}/${g.id}/#play-panel`);
  // Show phase: exactly one item on stage, no question, no options, no strip of everything.
  await expect(page.locator('.seq-stage')).toBeVisible();
  await expect(page.locator('.seq-tile')).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.locator('.quiz-panel')).not.toContainText(g.prompt!);
  // Advance through the show steps until the ask step offers itself.
  for (let i = 0; i < 5; i++) {
    const ask = page.getByRole('link', { name: /remembered the order/ });
    if ((await ask.count()) > 0) { await ask.click(); break; }
    await page.getByRole('link', { name: /Next/ }).click();
    await expect(page.locator('.seq-stage')).toBeVisible();
  }
  await expect(page.locator('.seq-stage')).toHaveCount(0);
  await page.locator('label.option', { hasText: correctText(g) }).first().click();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toContainText(/Correct/);
});

test('a what-changed game shows the before picture alone, then the after picture with the question', async ({ page }) => {
  const g = firstOf('what-changed');
  await page.goto(`/${g.brand}/${g.id}/#play-panel`);
  await expect(page.locator('svg.scene-view')).toHaveCount(1);
  await expect(page.getByText('Before', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByRole('link', { name: /show the after picture/ }).click();
  await expect(page.locator('svg.scene-view')).toHaveCount(1);
  await expect(page.getByText('After', { exact: true })).toBeVisible();
  await page.locator('label.option', { hasText: correctText(g) }).first().click();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toContainText(/Correct/);
});

test('a counting game takes an exact number', async ({ page }) => {
  const g = firstOf('counting');
  await page.goto(`/${g.brand}/${g.id}/#play-panel`);
  await expect(page.locator('svg.scene-view')).toBeVisible();
  await page.locator('input[type="number"]').fill(String(g.numberAnswer!.value));
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toContainText(/Correct/);
});

test('a spot-the-difference game shows both pictures', async ({ page }) => {
  const g = firstOf('spot-difference');
  await page.goto(`/${g.brand}/${g.id}/#play-panel`);
  await expect(page.locator('svg.scene-view')).toHaveCount(2);
  await page.locator('label.option', { hasText: correctText(g) }).first().click();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByRole('status')).toContainText(/Correct/);
});

test('the /games/ page is a doorway into the flow, not a separate section', async ({ page }) => {
  await page.goto('/games/');
  await expect(page.getByRole('heading', { name: 'Spot the Difference', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Memory Pictures', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Spark's voice/ })).toBeVisible();
  await page.getByRole('link', { name: /Play one now/ }).first().click();
  await expect(page.locator('.quiz-panel')).toBeVisible();
});
