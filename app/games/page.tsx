import Link from 'next/link';
import ItemCard from '@/components/item/ItemCard';
import SparkSoundToggle from '@/components/games/SparkSoundToggle';
import { getDb } from '@/lib/db';
import { readPlay } from '@/lib/public/body';
import { listPublic } from '@/lib/public/reads';
import { listWorlds } from '@/lib/public/worlds';
import { currentScope } from '@/lib/accounts/scope-next';
import { metadata as seo } from '@/lib/seo';

export const metadata = seo(
  'Picture games',
  'Picture games with Spark — observation, memory, spot the difference, counting and more — played inside the daily question flow. No timer, no scores to share.',
  '/games/',
);
export const dynamic = 'force-dynamic';

// The picture games live in the question flow now (owner direction, 18 Nov 2026): every game is a
// library item like any quiz, dealt by keep-playing between quizzes, so this page is the doorway —
// one card per game type, each leading into the stream — not a separate game section.
const TYPE_CARDS: { type: string; name: string; blurb: string }[] = [
  { type: 'observation', name: 'Look Closely', blurb: 'A busy scene stays in front of you — then a question about one small detail.' },
  { type: 'memory', name: 'Memory Pictures', blurb: 'Study the scene, hide it, and answer from what you remember.' },
  { type: 'spot-difference', name: 'Spot the Difference', blurb: 'Two pictures, three quiet changes. Can you name them all?' },
  { type: 'what-changed', name: 'What Changed?', blurb: 'Before and after — one thing is different. What is it?' },
  { type: 'counting', name: 'Counting Challenges', blurb: 'Busy scenes with one exact answer. Count carefully!' },
  { type: 'sequence', name: 'Sequence Recall', blurb: 'Spark shows things in order — what came second?' },
  { type: 'odd-one-out', name: 'Odd One Out', blurb: 'Four pictures — one does not belong.' },
  { type: 'pick-the-right-one', name: 'Pick the Right One', blurb: 'Read the clue, pick the matching picture.' },
  { type: 'flags-and-places', name: 'Flags & Places', blurb: 'Flags and famous places — which country?' },
  { type: 'drag-match', name: 'Drag & Drop Match', blurb: 'Drag each piece to its match — cones onto dot circles, animals to their homes, letters to their sounds.' },
  { type: 'fact-or-fiction', name: 'Fact or Make-Believe?', blurb: 'Read the statement, look at the picture, and decide: is it a fact, or make-believe?' },
  { type: 'pattern', name: 'Pattern Planet', blurb: 'A pattern with one piece missing. Which piece completes it?' },
  { type: 'emotion-detectives', name: 'Emotion Detectives', blurb: 'Read the little story, spot the clues, and name how the character feels.' },
  { type: 'build-a-word', name: 'Build-a-Word', blurb: 'See the picture, tap the letter tiles, and spell the word.' },
];

export default async function GamesPage() {
  const db = getDb();
  const scope = await currentScope();
  const all: Awaited<ReturnType<typeof listPublic>> = [];
  for (let page = 0; page < 8; page++) {
    const rows = await listPublic(db, scope, { kind: 'game', limit: 50, offset: page * 50 });
    all.push(...rows);
    if (rows.length < 50) break;
  }
  const worlds = new Map((await listWorlds(db)).map((w) => [w.slug, w]));
  const byType = new Map<string, typeof all>();
  for (const item of all) {
    const type = readPlay(item.body).visual?.gameType ?? 'other';
    byType.set(type, [...(byType.get(type) ?? []), item]);
  }
  const first = all[0];

  return (
    <div className="container section">
      <p className="eyebrow">PLAY · PICTURE GAMES</p>
      <h1>Look closely.<br />Play with Spark.</h1>
      <p>
        Picture games are part of the daily question flow now: answer one and Spark deals the next —
        a quiz, a picture game, another quiz — all in one stream. Pick a kind of game to jump in, and
        keep playing from there. No timer, no pressure, and a kind explanation either way.
      </p>
      <p>
        <SparkSoundToggle />
      </p>
      {first && (
        <p>
          <Link className="button" href={`/${first.world}/${first.slug}/#play-panel`}>
            Start playing <span aria-hidden="true">→</span>
          </Link>
        </p>
      )}
      <div className="games-index-grid">
        {TYPE_CARDS.map((card) => {
          const items = byType.get(card.type) ?? [];
          const entry = items[0];
          return (
            <article className="game-type-card" key={card.type}>
              <h3>{card.name}</h3>
              <p>{card.blurb}</p>
              {entry ? (
                <p>
                  <Link href={`/${entry.world}/${entry.slug}/#play-panel`}>Play one now →</Link>{' '}
                  <span className="muted">({items.length} in the flow)</span>
                </p>
              ) : (
                <p className="muted">Arriving in the flow very soon.</p>
              )}
            </article>
          );
        })}
      </div>
      {all.length > 0 && (
        <>
          <h2 style={{ marginTop: 48 }}>Newest in the flow</h2>
          <div className="content-grid two-col">
            {all.slice(0, 8).map((item) => (
              <ItemCard item={item} world={worlds.get(item.world)} key={item.id} headingLevel={3} variant="strip" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
