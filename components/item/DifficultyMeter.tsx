import type { Difficulty } from '@/lib/public/body';

const FILLED: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };
const LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

// The difficulty indicator for a playable item: three ascending bars, filled up to the level, always with the
// level as visible text so the meaning never rests on the bars or their colour alone. Renders nothing when the
// item carries no difficulty (the public reader drops a missing or malformed value).
export default function DifficultyMeter({ level }: { level?: Difficulty }) {
  if (!level) return null;
  const filled = FILLED[level];
  return (
    <p className="difficulty">
      <span className="difficulty-bars" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= filled ? 'difficulty-bar filled' : 'difficulty-bar'} />
        ))}
      </span>
      <span>Difficulty: {LABEL[level]}</span>
    </p>
  );
}
