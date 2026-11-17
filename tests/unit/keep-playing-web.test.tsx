// "Keep playing" result panel (owner request, 17 Nov 2026): the three difficulty choices render as
// plain links (no-JS path), the edge levels disable with a friendly note, Spark presents the choices
// with the reaction artwork, and the archive link is demoted while the block is present. The island's
// session/gesture behaviour is pinned from source, in the house style of the games tests.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import KeepPlaying from '@/components/item/KeepPlaying';
import PlayResult from '@/components/item/PlayResult';
import { buildModel, type CandidatePools } from '@/lib/play/keep-playing';
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
