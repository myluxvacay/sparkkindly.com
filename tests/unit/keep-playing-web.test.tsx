// "Keep playing" result panel (owner request, 17 Nov 2026): the three difficulty choices render as
// plain links (no-JS path), the edge levels disable with a friendly note, Spark presents the choices
// with the reaction artwork, and the archive link is demoted while the block is present. The island's
// session/gesture behaviour is pinned from source, in the house style of the games tests.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ItemCard from '@/components/item/ItemCard';
import KeepPlaying from '@/components/item/KeepPlaying';
import PlayResult from '@/components/item/PlayResult';
import { buildModel, type CandidatePools } from '@/lib/play/keep-playing';
import type { PublicItem } from '@/lib/items/repo';
import type { PlayResult as Result } from '@/lib/play/answer';

const enhancerSrc = readFileSync(`${process.cwd()}/components/item/PlayEnhancer.tsx`, 'utf8');
const panelSrc = readFileSync(`${process.cwd()}/components/item/PlayPanel.tsx`, 'utf8');
const css = readFileSync(`${process.cwd()}/app/globals.css`, 'utf8');

const c = (id: string) => ({ id, href: `/discover/${id}/` });
const pools = (p: Partial<CandidatePools>): CandidatePools => ({ easy: [], medium: [], hard: [], ...p });
const ok: Extract<Result, { status: 'ok' }> = {
  status: 'ok',
  itemId: 'q1',
  correct: true,
  answerText: 'The Moon',
  explanation: 'Because of how sunlight falls on it.',
  choice: 'a',
};

describe('KeepPlaying block', () => {
  it('renders the three choices as plain links to the first candidate of each direction', () => {
    const model = buildModel('me', 'medium', pools({ easy: [c('e1')], medium: [c('m1')], hard: [c('h1')] }));
    const html = renderToStaticMarkup(<KeepPlaying model={model} correct={true} />);
    expect(html).toContain('Play an easier one');
    expect(html).toContain('Play another at this level');
    expect(html).toContain('Play a harder one');
    expect(html).toContain('data-kp-btn="easier"');
    expect(html).toContain('data-kp-btn="same"');
    expect(html).toContain('data-kp-btn="harder"');
    expect(html).toContain('href="/discover/e1/"');
    expect(html).toContain('href="/discover/m1/"');
    expect(html).toContain('href="/discover/h1/"');
    // The model rides in the markup for the island's session-aware re-pick.
    expect(html).toContain('data-kp-model=');
    expect(html).toContain('data-kp-hint');
    // The deliberate reset is always offered under the choices.
    expect(html).toContain('data-kp-fresh');
    expect(html).toContain('Start fresh');
  });

  it('on no-track surfaces (Kids questions, the daily question) there is no Start fresh row at all', () => {
    const model = buildModel('me', 'medium', pools({ medium: [c('m1')] }), { trackSeen: false });
    const html = renderToStaticMarkup(<KeepPlaying model={model} correct={true} />);
    expect(html).not.toContain('data-kp-fresh');
    expect(html).not.toContain('Start fresh');
    // The choices themselves still render — only the device memory is off.
    expect(html).toContain('data-kp-btn="same"');
  });

  it('the panel gates tracking off for Kids-audience items, and the daily surfaces opt out', () => {
    expect(panelSrc).toContain("item.audience !== 'kids'");
    const quizPage = readFileSync(`${process.cwd()}/app/quiz/page.tsx`, 'utf8');
    const homePage = readFileSync(`${process.cwd()}/app/page.tsx`, 'utf8');
    expect(quizPage).toContain('trackSeen={false}');
    expect(homePage).toContain('trackSeen={false}');
    // The island never touches the device store for a no-track model.
    expect(enhancerSrc).toContain('model.trackSeen ? mergeSeenIds');
  });

  it('tells a signed-in player that Start fresh leaves their saved answers alone', () => {
    const model = buildModel('me', 'medium', pools({ medium: [c('m1')] }), { signedIn: true });
    const html = renderToStaticMarkup(<KeepPlaying model={model} correct={true} />);
    expect(html).toContain('your saved answers and scores stay');
    const anon = renderToStaticMarkup(
      <KeepPlaying model={buildModel('me', 'medium', pools({ medium: [c('m1')] }))} correct={true} />,
    );
    expect(anon).not.toContain('your saved answers and scores stay');
  });

  it('presents Spark with the victory artwork after a right answer, encouraging after a wrong one', () => {
    const model = buildModel('me', 'medium', pools({ medium: [c('m1')] }));
    expect(renderToStaticMarkup(<KeepPlaying model={model} correct={true} />)).toContain('/brand/spark-victory.gif');
    const wrong = renderToStaticMarkup(<KeepPlaying model={model} correct={false} />);
    expect(wrong).toContain('/brand/spark-encouraging.gif');
    expect(wrong).toContain('data-kp-still="/brand/spark.webp"');
  });

  it('disables the easier choice at the gentlest level with a friendly note, never a dead link', () => {
    const model = buildModel('me', 'easy', pools({ easy: [c('e1')], medium: [c('m1')] }));
    const html = renderToStaticMarkup(<KeepPlaying model={model} correct={true} />);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('This is the gentlest level');
    expect(html).not.toContain('data-kp-btn="easier"');
    // …and the hardest edge mirrors it.
    const top = renderToStaticMarkup(
      <KeepPlaying model={buildModel('me', 'hard', pools({ medium: [c('m1')], hard: [c('h1')] }))} correct={true} />,
    );
    expect(top).toContain('This is the trickiest level');
    expect(top).not.toContain('data-kp-btn="harder"');
  });

  it('says when a direction had to skip to the nearest populated level', () => {
    const model = buildModel('me', 'hard', pools({ easy: [c('e1')], hard: [c('h1')] }));
    const html = renderToStaticMarkup(<KeepPlaying model={model} correct={true} />);
    expect(html).toContain('Easy — the nearest level with questions');
  });
});

describe('landing focus + flick zone (owner phone report, 17 Nov 2026)', () => {
  const itemPageSrc = readFileSync(`${process.cwd()}/app/[world]/[slug]/page.tsx`, 'utf8');
  const headerSrc = readFileSync(`${process.cwd()}/components/Header.tsx`, 'utf8');
  const card = (kind: PublicItem['kind']): PublicItem => ({
    id: 'x1',
    world: 'play',
    kind,
    slug: 'double-minus',
    title: 'Double minus',
    summary: 'A quick sum.',
    body: {},
    audience: 'all',
    evergreen: false,
    publishedAt: new Date('2026-10-05T00:00:00Z'),
    updatedAt: new Date('2026-10-05T00:00:00Z'),
    sources: [],
    image: null,
    topics: [],
  });

  it('the play panel carries the anchor id every play-intent link targets', () => {
    expect(panelSrc).toContain('id="play-panel"');
    expect(css).toMatch(/\.quiz-panel\{[^}]*scroll-margin-top/);
  });

  it('quiz item pages collapse the blank band under the byline (quiz-item wrapper), articles untouched', () => {
    expect(itemPageSrc).toContain('quiz-page quiz-item');
    expect(css).toMatch(/\.section\.quiz-item\{[^}]*padding-top:0/);
    expect(css).toMatch(/\.quiz-item \.quiz-panel\{[^}]*margin-top:12px/);
  });

  it('the Spark band is the flick zone: marked in the markup, touch-action none in the CSS', () => {
    const model = buildModel('me', 'medium', pools({ medium: [c('m1')] }));
    const html = renderToStaticMarkup(<KeepPlaying model={model} correct={true} />);
    expect(html).toContain('data-kp-flick');
    expect(css).toMatch(/\.kp-flick\{[^}]*touch-action:none/);
    // The hint points at Spark honestly — the zone, not the whole panel.
    expect(html).toContain('flick Spark up for a harder one');
    expect(html).toContain('double-tap Spark for the same level');
  });

  it('the flick zone holds no interactive elements — the buttons stay the only actions', () => {
    const model = buildModel('me', 'medium', pools({ medium: [c('m1')] }));
    const html = renderToStaticMarkup(<KeepPlaying model={model} correct={true} />);
    const zone = html.match(/<div class="kp-head kp-flick"[^>]*>(.*?)<\/div>/)?.[1] ?? '';
    expect(zone).toContain('kp-spark');
    expect(zone).not.toMatch(/<a |<button|<input|<select/);
  });

  it('quiz and game cards land on the panel; article cards keep the plain reading URL', () => {
    // The static test renderer normalizes the href to slug#fragment; the served page keeps the
    // canonical /slug/#play-panel form (pinned by the archive sweep in tests/e2e/quiz-routes.spec.ts).
    // The invariant here: playable cards carry the fragment, article cards never do.
    expect(renderToStaticMarkup(<ItemCard item={card('quiz')} />)).toContain('href="/play/double-minus#play-panel"');
    expect(renderToStaticMarkup(<ItemCard item={card('game')} />)).toContain('href="/play/double-minus#play-panel"');
    const article = renderToStaticMarkup(<ItemCard item={card('article')} />);
    // (Next renders the article href without its trailing slash, as it always has — no fragment.)
    expect(article).toContain('href="/play/double-minus"');
    expect(article).not.toContain('#play-panel');
  });

  it("today's-quiz entries carry the fragment: the header nav lands on the daily panel", () => {
    expect(headerSrc).toContain('href="/quiz/#play-panel"');
  });

  it('the retry link lands on the panel, while the result-card paths keep the bare item URL', () => {
    const html = renderToStaticMarkup(
      <PlayResult result={ok} again="/discover/q1/" another="/quiz/archive/" keepPlaying={<p>KP BLOCK</p>} />,
    );
    expect(html).toContain('href="/discover/q1#play-panel"');
    expect(html).toContain('src="/api/result-card/discover/q1/"');
    expect(html).not.toContain('result-card/discover/q1/#play-panel');
    expect(html).not.toContain('result-card/discover/q1#play-panel');
  });
});

describe('PlayResult with the keep-playing block', () => {
  it('demotes the archive to a quiet "Browse all questions" link and drops the old "Try another" button', () => {
    const html = renderToStaticMarkup(
      <PlayResult result={ok} again="/discover/q1/" another="/quiz/archive/" keepPlaying={<p>KP BLOCK</p>} />,
    );
    expect(html).toContain('KP BLOCK');
    expect(html).toContain('Browse all questions');
    expect(html).not.toContain('Try another');
    expect(html).toContain('Try this one again');
  });

  it('keeps the existing behaviour untouched when no block is passed (non-quiz play)', () => {
    const html = renderToStaticMarkup(<PlayResult result={ok} again="/discover/q1/" another="/discover/" />);
    expect(html).toContain('Try another');
    expect(html).not.toContain('Browse all questions');
  });
});

describe('wiring pins', () => {
  it('the panel builds the model from the same scope-filtered quiz read the archive uses', () => {
    expect(panelSrc).toContain('listQuizzes');
    expect(panelSrc).toContain('buildModel');
    expect(panelSrc).toContain("item.kind === 'quiz'");
  });

  it('the island re-picks on tap against the merged seen-set, and adds the gestures', () => {
    expect(enhancerSrc).toContain('[data-kp-btn]');
    expect(enhancerSrc).toContain('pickCandidate');
    expect(enhancerSrc).toContain('detectFlick');
    expect(enhancerSrc).toContain("addEventListener('touchstart'");
    expect(enhancerSrc).toContain("addEventListener('touchend'");
    // Gestures navigate, they never block scrolling: no touch preventDefault anywhere in the island.
    expect(enhancerSrc).not.toMatch(/touch\w*\(\)\s*\{[^}]*preventDefault/);
    expect(enhancerSrc).not.toContain("addEventListener('touchmove'");
  });

  it('the seen memory is persistent and device-only: localStorage first, session as fallback, account merged in', () => {
    expect(enhancerSrc).toContain('loadSeen');
    expect(enhancerSrc).toContain('markSeen');
    expect(enhancerSrc).toContain('mergeSeenIds');
    expect(enhancerSrc).toContain('window.localStorage');
    expect(enhancerSrc).toContain('window.sessionStorage');
    expect(enhancerSrc).toContain('model.accountSeen');
    // Every presented quiz is marked seen via the panel's data attributes.
    expect(enhancerSrc).toContain('dataset.kpCurrent');
    expect(panelSrc).toContain('data-kp-current');
    // Start fresh clears only the device list (clearSeen on the device backend), never an account call.
    expect(enhancerSrc).toContain('[data-kp-fresh]');
    expect(enhancerSrc).toContain('clearSeen(kpStorage())');
  });

  it('the panel sources the account seen-set from the saved-answer history, not a new table', () => {
    expect(panelSrc).toContain('listAnsweredIds');
    expect(panelSrc).toContain('viewer.owner');
  });

  it('the buttons keep the panel gold/dark pairing under panel-scoped selectors (contrast)', () => {
    expect(css).toMatch(/\.quiz-panel \.kp-btn\{[^}]*background:#f7c948/);
    expect(css).toMatch(/\.quiz-panel \.kp-btn\{[^}]*color:#3a2444/);
    expect(css).toMatch(/\.quiz-panel \.kp-hint\{[^}]*color:#e7d7f2/);
    expect(css).toMatch(/\.quiz-panel \.kp-title\{[^}]*color:#fdf6ec/);
    // The completion states are light cards with dark ink, pinned the same way.
    expect(css).toMatch(/\.quiz-panel \.kp-btn-done\{[^}]*background:#fffdf9/);
    expect(css).toMatch(/\.quiz-panel \.kp-btn-done\{[^}]*color:#302438/);
    expect(css).toMatch(/\.kp-done\{[^}]*background:#fffdf9/);
    expect(css).toMatch(/\.kp-done\{[^}]*color:#302438/);
  });
});
