// Spark's recorded voice (owner-recorded lines, Marie voice — owner direction, 18 Nov 2026).
// This map is the single place that names which clip belongs to which moment:
//
//   greeting      the assistant's tap-to-play hello
//   praise        a correct answer, in the picture games and in the quiz/game play flow
//   completion    finishing a game set, or the keep-playing "every question played" state
//   encouragement a wrong answer
//   goodbye       the assistant's dismissal tap
//
// The site's pinned sound rules live here too: a clip only ever plays from a tap or as the direct
// result of the player's own answer submission — never on load, hover or a round change — and the
// sound on/off toggle (localStorage `sk-games-sound`, default on) governs every clip. Playback
// failures are swallowed: the experience never depends on audio working.

export const SPARK_VOICE = {
  greeting: '/brand/spark-hi-friends.mp3',
  praise: '/brand/spark-great-listening.mp3',
  completion: '/brand/spark-you-did-it.mp3',
  encouragement: '/brand/spark-try-again.mp3',
  goodbye: '/brand/spark-goodbye.mp3',
} as const;
export type SparkVoiceKind = keyof typeof SPARK_VOICE;

export const SPARK_SOUND_KEY = 'sk-games-sound';

export function sparkSoundOn(): boolean {
  try {
    return localStorage.getItem(SPARK_SOUND_KEY) !== 'off';
  } catch {
    return true; // storage unreachable: the default is on
  }
}

const cache = new Map<string, HTMLAudioElement>();

/** Play one of Spark's lines. Call ONLY from a user gesture or an answer submission's direct result. */
export function playSparkVoice(kind: SparkVoiceKind): void {
  if (!sparkSoundOn()) return;
  try {
    const src = SPARK_VOICE[kind];
    let audio = cache.get(src);
    if (!audio) {
      audio = new Audio();
      audio.preload = 'auto';
      audio.src = src;
      audio.load();
      cache.set(src, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
    // Audio unavailable in this browser: everything plays on silently.
  }
}
