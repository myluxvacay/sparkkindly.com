import {
  DIFFICULTY_LABEL,
  type KeepPlayDirection,
  type KeepPlayModel,
} from '@/lib/play/keep-playing';

// "Keep playing" (owner request, 17 Nov 2026): after a quiz answer, three big choices — easier, same
// level, harder — so a player keeps flipping through questions instead of landing in the archive list.
// Server-rendered as plain links (the first candidate of each direction), so the flow works with no
// JavaScript; the play island (PlayEnhancer) re-picks against the session's played set at tap time and
// adds the flick / double-tap gestures on the result panel.
//
// Spark presents the choices with the reaction artwork from the picture games (the slot files named in
// SPARK-ANIMATIONS.md, mirrored from SPARK_SLOTS in components/games/VisualGames.tsx): the victory GIF
// after a right answer, the encouraging GIF after a wrong one. The island swaps in the still image for
// reduced-motion visitors (data-kp-still), matching the games.
const KP_SPARK = {
  victory: { animated: '/brand/spark-victory.gif', still: '/brand/spark.webp', alt: 'Spark, the SparkKindly guide, celebrating with you', w: 418, h: 627 },
  encouraging: { animated: '/brand/spark-encouraging.gif', still: '/brand/spark.webp', alt: 'Spark, the SparkKindly guide, cheering you on', w: 512, h: 527 },
} as const;

const DIRECTIONS: { key: KeepPlayDirection; label: string; arrow: string; offNote: string }[] = [
  { key: 'easier', label: 'Play an easier one', arrow: '↓', offNote: 'This is the gentlest level' },
  { key: 'same', label: 'Play another at this level', arrow: '→', offNote: 'No more questions to try right now' },
  { key: 'harder', label: 'Play a harder one', arrow: '↑', offNote: 'This is the trickiest level' },
];

export default function KeepPlaying({ model, correct }: { model: KeepPlayModel; correct: boolean }) {
  const spark = correct ? KP_SPARK.victory : KP_SPARK.encouraging;
  return (
    <div className="keep-playing" data-kp data-kp-model={JSON.stringify(model)}>
      <div className="kp-head">
        <img
          className="kp-spark"
          src={spark.animated}
          data-kp-still={spark.still}
          width={spark.w}
          height={spark.h}
          alt={spark.alt}
          loading="lazy"
        />
        <p className="kp-title">
          <strong>Keep playing?</strong> Spark picked your next questions.
        </p>
      </div>
      <div className="kp-buttons">
        {DIRECTIONS.map(({ key, label, arrow, offNote }) => {
          const option = model.options[key];
          if (!option) {
            return (
              <span key={key} className="kp-btn kp-btn-off" aria-disabled="true">
                <span className="kp-btn-label">{label}</span>
                <span className="kp-btn-sub">{offNote}</span>
              </span>
            );
          }
          const sub = option.skipped
            ? `${DIFFICULTY_LABEL[option.level]} — the nearest level with questions`
            : DIFFICULTY_LABEL[option.level];
          return (
            <a key={key} className="kp-btn" href={option.candidates[0].href} data-kp-btn={key}>
              <span className="kp-btn-label">
                {label} <span aria-hidden="true">{arrow}</span>
              </span>
              <span className="kp-btn-sub">{sub}</span>
            </a>
          );
        })}
      </div>
      <p className="kp-hint" data-kp-hint>
        Tip: on a phone or tablet, flick up on this panel for a harder one, flick down for an easier one, or
        double-tap for the same level.
      </p>
      {model.trackSeen && (
        <p className="kp-fresh">
          <button type="button" className="text-button" data-kp-fresh>
            Start fresh
          </button>{' '}
          — forget which questions you’ve seen on this device
          {model.signedIn ? '; your saved answers and scores stay' : ''}.
        </p>
      )}
    </div>
  );
}
