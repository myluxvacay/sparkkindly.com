// Starting lists for the server-side gates. They are a first line of defence, not a complete one: the reviewer agent
// and the owner's approval for Kids content still apply. Extend these as real submissions show what slips through.

export const blockedWords = [
  'fuck', 'fucking', 'shit', 'shitty', 'bullshit', 'bitch', 'bastard', 'asshole', 'cunt', 'dickhead',
];

const wordPattern = new RegExp(`\\b(${blockedWords.join('|')})\\b`, 'i');

export function findBlockedWord(text: string): string | null {
  return text.match(wordPattern)?.[1] ?? null;
}

// The Excluded tier (spec 4a.4): topics SparkKindly never publishes. Phrasing patterns, not a topic classifier.
export const blockedTopics: { category: string; pattern: RegExp }[] = [
  {
    category: 'medical advice',
    pattern: /\byou should (take|use|stop taking|start taking)\b[^.]{0,60}\b(tablets?|pills?|medication|medicine|doses?|mg|antibiotics?|supplements?)\b|\b(cure|treat|diagnos\w*)\b[^.]{0,40}\b(cancer|diabetes|depression|anxiety|infection|disease|fever)\b/i,
  },
  { category: 'legal advice', pattern: /\b(you should sue|this is legal advice|you do not need a lawyer)\b/i },
  {
    category: 'personal financial advice',
    pattern: /\b(guaranteed returns?|buy (this|these) (stock|share|coin)s?|invest (all|your savings))\b/i,
  },
  { category: 'self-harm', pattern: /\b(suicide|self[- ]harm|kill (yourself|myself)|hurt yourself)\b/i },
  { category: 'sexual content', pattern: /\b(porn\w*|explicit sex|sexual(ly)? explicit)\b/i },
  { category: 'violence instructions', pattern: /\b(how to (make|build) a (bomb|weapon)|torture)\b/i },
];

export function findBlockedTopic(text: string): string | null {
  return blockedTopics.find((t) => t.pattern.test(text))?.category ?? null;
}
