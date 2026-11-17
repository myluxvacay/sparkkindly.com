import VisualGames from '@/components/games/VisualGames';
import { metadata as seo } from '@/lib/seo';

export const metadata = seo(
  'Picture games',
  'Three picture games with Spark: Odd One Out, Pick the Right One, and Flags & Places. No timer, no scores to share.',
  '/games/',
);

// Static, self-contained feature (lib/games/visual-games.ts): no database, no audience-scoped content —
// the rounds are written for every age the Play world serves, with a grown-up alongside for younger children.
export default function GamesPage() {
  return (
    <div className="container section">
      <p className="eyebrow">PLAY · PICTURE GAMES</p>
      <h1>Look closely.<br />Pick with Spark.</h1>
      <p>Three little picture games, hosted by Spark. No timer, no pressure — just looking, thinking and a kind explanation either way. Younger players: enjoy these with a grown-up.</p>
      <VisualGames />
    </div>
  );
}
