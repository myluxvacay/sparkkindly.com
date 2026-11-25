// Printables (owner direction, 22 Nov 2026): free print-and-do sheets for families and classrooms.
// A printable is a Kids "activity" article in the library (brand 'kids'), tagged with the 'printables'
// topic plus one category topic and one age-band topic below. The topics are seeded reference data
// (db/seed/topics.ts), so the hub, topic pages and search all filter on topics alone — no new tables,
// no new item kind. The dedicated /printables/ section renders the sheet view around the delivered
// sheet itself: the library was delivered as 300 finished, branded one-page PDFs (15 categories × 20,
// ingested by scripts/ingest-printables.ts); each item's hero image is the rendered first page of its
// PDF, and the Download PDF button serves the delivered PDF unchanged.
import type { PublicItem } from './items/repo';
import { bandsFromTopics, type AgeBand as CanonicalAgeBand } from './age-bands';

// The canonical age-band list lives in lib/age-bands.ts only (24 Nov 2026); it is re-exported
// here under a distinct name so the legacy delivered-library bands below are never confused
// with it — there is one canonical list, and the hub filters on it via printableAgeBands.
export { AGE_BANDS as CANONICAL_AGE_BANDS, BAND_LABEL } from './age-bands';
export type { AgeBand as CanonicalAgeBand } from './age-bands';

// An item's canonical age bands, unified from its topics (legacy ages-5-8 / ages-6-10 topics
// included, via lib/age-bands). ['family'] when it carries no child band.
export const printableAgeBands = (item: { topics: string[] }): CanonicalAgeBand[] => bandsFromTopics(item.topics);

export const PRINTABLES_TOPIC = 'printables';

export type PrintableCategory = {
  slug: string; // short key for the category, e.g. 'colouring'
  topic: string; // the category topic slug carried in item tags/topics
  name: string;
  blurb: string;
  glyph: string;
  // One-line guidance shown on the sheet page under the title.
  instruction: string;
};

export const PRINTABLE_CATEGORIES: PrintableCategory[] = [
  { slug: 'colouring', topic: 'printables-colouring', name: 'Coloring Pages', blurb: 'Friendly pictures with bold outlines to color your way.', glyph: '🖍', instruction: 'Color the picture any way you like — there are no wrong colors!' },
  { slug: 'tracing', topic: 'printables-writing-tracing', name: 'Writing & Tracing', blurb: 'Patterns, letters and numbers on gentle dotted guide lines.', glyph: '✎', instruction: 'Trace the dotted lines slowly, then try one on your own.' },
  { slug: 'counting', topic: 'printables-counting-maths', name: 'Counting', blurb: 'Pictures to count carefully, with a box for every answer.', glyph: '🔢', instruction: 'Count carefully, touch each picture as you go, and write the total in the box.' },
  { slug: 'math', topic: 'printables-maths', name: 'Math', blurb: 'Adding and subtracting practice with pictures to help.', glyph: '➕', instruction: 'Work through each problem — use the pictures to help you count.' },
  { slug: 'fold', topic: 'printables-fold-make', name: 'Fold & Make', blurb: 'A simple folded kindness card to make, decorate and give away.', glyph: '✈', instruction: 'Follow the numbered steps in order — press every fold flat.' },
  { slug: 'maze', topic: 'printables-mazes', name: 'Mazes', blurb: 'Find the path from START to FINISH — finger first, pencil second.', glyph: '🧭', instruction: 'Draw the path from START to FINISH — no jumping over walls!' },
  { slug: 'dot-to-dot', topic: 'printables-dot-to-dot', name: 'Dot-to-Dot', blurb: 'Join the numbers in order and a picture appears — then color it.', glyph: '✦', instruction: 'Join the dots in number order, then color the picture you found.' },
  { slug: 'matching', topic: 'printables-matching-sorting', name: 'Matching & Sorting', blurb: 'Draw a line from each picture to the partner it belongs with.', glyph: '🧩', instruction: 'Name each picture, then draw a line to its matching partner.' },
  { slug: 'word-play', topic: 'printables-word-play', name: 'Word Play', blurb: 'Scrambled words to unscramble and first word games.', glyph: '🔤', instruction: 'Say the letters out loud and unscramble each word.' },
  { slug: 'reading-aids', topic: 'printables-reading-aids', name: 'Reading Aids', blurb: 'Clap the syllables, blend the parts, build the word.', glyph: '📚', instruction: 'Clap each word slowly — one clap for every syllable you hear.' },
  { slug: 'crosswords', topic: 'printables-crosswords', name: 'Crosswords', blurb: 'Mini crosswords with kind clues for newer puzzlers.', glyph: '▦', instruction: 'Read each clue and pencil the answer in lightly — across and down must agree.' },
  { slug: 'cut-and-paste', topic: 'printables-cut-paste-crafts', name: 'Cut-and-Paste Crafts', blurb: 'Cut out the pieces on the dashed lines and arrange your own picture.', glyph: '✂', instruction: 'Cut along the dashed lines — a grown-up stays close while scissors are out.' },
  { slug: 'science-labels', topic: 'printables-science-labels', name: 'Label-the-Parts', blurb: 'Diagrams to label from the word bank — name it to know it.', glyph: '🔬', instruction: 'Use the word bank to label every part of the diagram.' },
  { slug: 'kindness', topic: 'printables-kindness-feelings', name: 'Kindness & Feelings', blurb: 'Journal pages about feelings and the kind acts that help.', glyph: '💛', instruction: 'Take it slowly — on a feelings page, honest answers are the whole point.' },
  { slug: 'sequencing', topic: 'printables-story-sequencing', name: 'Story Sequencing Cards', blurb: 'Put the story cards in order — beginning, middle, end — and retell it.', glyph: '📖', instruction: 'Look at every card, number them in story order, and retell the story aloud.' },
  { slug: 'how-things-work', topic: 'printables-how-things-work', name: 'How Things Work', blurb: 'Big friendly posters that explain how everyday things work.', glyph: '💡', instruction: 'Read it together, point to each part as you name it, then explain it back in your own words.' },
];

export type AgeBand = { topic: string; label: string; short: string };

// The delivered library uses two age bands (manifest age_band): 5-8 and 6-10.
export const AGE_BANDS: AgeBand[] = [
  { topic: 'ages-5-8', label: 'Ages 5–8', short: '5–8' },
  { topic: 'ages-6-10', label: 'Ages 6–10', short: '6–10' },
];

const categoryByTopic = new Map(PRINTABLE_CATEGORIES.map((c) => [c.topic, c]));
const ageByTopic = new Map(AGE_BANDS.map((a) => [a.topic, a]));

export const isPrintable = (item: { topics: string[] }): boolean => item.topics.includes(PRINTABLES_TOPIC);

export const printableCategory = (item: { topics: string[] }): PrintableCategory | null =>
  item.topics.map((t) => categoryByTopic.get(t)).find(Boolean) ?? null;

export const printableAgeBand = (item: { topics: string[] }): AgeBand | null =>
  item.topics.map((t) => ageByTopic.get(t)).find(Boolean) ?? null;

export const printablePath = (slug: string): string => `/printables/${slug}/`;

export const printablePdfPath = (slug: string): string => `/printables/${slug}/pdf/`;

export const printableCardPath = (slug: string): string => `/api/printable-card/${slug}/`;

// Skill/topic chips for a printable: its public topics minus the printables machinery itself.
const MACHINERY = new Set([
  PRINTABLES_TOPIC,
  ...PRINTABLE_CATEGORIES.map((c) => c.topic),
  ...AGE_BANDS.map((a) => a.topic),
  'ages-3-5',
  'ages-6-8',
  'ages-9-12',
]);
export const printableSkillTopics = (item: Pick<PublicItem, 'topics'>): string[] =>
  item.topics.filter((t) => !MACHINERY.has(t));
