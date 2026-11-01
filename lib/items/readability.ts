// Flesch–Kincaid grade level: 0.39 × (words per sentence) + 11.8 × (syllables per word) − 15.59.
// Used to keep Kids content readable. It is a rough guide, not a verdict: the owner still approves every Kids item.

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  let groups = (w.match(/[aeiouy]+/g) ?? []).length;
  // A trailing silent "e" ("make") is not a syllable, but "-le" after a consonant ("table") is.
  if (groups > 1 && /e$/.test(w) && !/[^aeiouy]le$/.test(w)) groups -= 1;
  return Math.max(1, groups);
}

export function fleschKincaidGrade(text: string): number {
  const words = text.split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}'-]/gu, '')).filter((t) => /\p{L}/u.test(t));
  if (words.length === 0) return 0;
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
}
