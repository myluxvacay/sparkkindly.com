// Backfill `ageBands` on EVERY content item (owner decision, 24 Nov 2026).
//
// Age-appropriateness is NOT difficulty: it is topic familiarity, vocabulary / reading
// level and concept abstractness (see lib/age-bands.ts). Canonical bands:
// '3-5', '6-8', '9-12', 'family'. This script derives a band set per item from the
// rules below, writes it into content/articles|quizzes|games/*.json (preserving key
// order and trailing-newline style), and prints a coverage report. It is idempotent:
// an item whose stored bands already equal the derived bands is left untouched.
//
// Derivation rules (applied in order; first match wins unless stated):
//
// ARTICLES
//   a. tags include 'ages-5-8' -> ['3-5','6-8']; 'ages-6-10' -> ['6-8','9-12']
//      (the printables legacy topics, LEGACY_BAND_TOPICS; both present -> union).
//   b. ageGuidance parses via parseAgeRange -> bandsForAgeRange(min, max).
//   c. description parses an age range -> bandsForAgeRange(min, max).
//   d. brand 'kids': country-facts articles (tags include 'countries' or slug starts
//      'meet-') -> ['6-8','9-12']; otherwise a reading-level heuristic over the body
//      paragraphs — avg words/sentence <= 9 -> ['3-5','6-8'], <= 14 -> ['6-8'],
//      else ['6-8','9-12'].
//   e. any other brand -> ['family'].
//
// QUIZZES
//   a. brand together/grow/save -> ['family'].
//   b. brand kids: easy -> ['3-5','6-8'] UNLESS an abstract-term hit -> ['6-8'];
//      medium -> ['6-8']; hard -> ['9-12'] if abstract hit else ['6-8','9-12'].
//   c. brand play/discover: if a passage is present, avg words/sentence of the passage
//      <= 12 -> ['6-8','9-12'] else ['9-12']. Otherwise a vocabulary score over
//      prompt+options+explanation: abstractHits = distinct abstract terms found,
//      avgWordLen = mean word length. abstractHits >= 2 or avgWordLen >= 5.6 ->
//      ['9-12']; abstractHits = 1 or avgWordLen >= 5.0 -> ['6-8','9-12'];
//      else ['6-8'].
//   d. HARD RULE: no quiz whose text contains an abstract science term may include
//      '3-5' (enforced again after derivation, defensively).
//
// GAMES — per-type mapping (every type in GAME_TYPES from lib/games/scene.ts):
//   memory            -> ['3-5','6-8'] regardless of difficulty (owner-cited example)
//   counting          -> numberAnswer.value <= 10 -> ['3-5','6-8'] else ['6-8']
//   build-a-word      -> wordAnswer length <= 4 -> ['3-5','6-8']; 5-6 -> ['6-8'];
//                        >= 7 -> ['6-8','9-12']
//   perception types (odd-one-out, spot-difference, what-changed, drag-match)
//                     -> easy ['3-5','6-8'], medium ['6-8'], hard ['6-8','9-12']
//   all remaining types (observation, sequence, pick-the-right-one, flags-and-places,
//   fact-or-fiction, pattern, emotion-detectives)
//                     -> easy ['6-8'], medium ['6-8','9-12'], hard ['9-12']
//   NOTE: the task brief said games are all brand 'kids'; in the repo only a minority
//   are — the type mapping is applied regardless of brand, because every approved
//   item must carry bands and the mapping is type/difficulty based, not brand based.
//
// Usage: npx tsx scripts/backfill-age-bands.ts [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { bandsForAgeRange, parseAgeRange, LEGACY_BAND_TOPICS, type AgeBand } from '../lib/age-bands';
import { GAME_TYPES, type GameType } from '../lib/games/scene';

const DRY_RUN = process.argv.includes('--dry-run');
const CONTENT_DIR = path.join(process.cwd(), 'content');

// Abstract / advanced-concept terms (lowercase substring match). A hit means the item
// turns on a concept a 3-5-year-old cannot be expected to know, whatever its difficulty.
export const ABSTRACT_TERMS = [
  'mercury', 'element', 'atom', 'molecule', 'gravity', 'orbit', 'evaporation',
  'condensation', 'photosynthesis', 'fraction', 'percentage', 'percent', 'ancient',
  'century', 'empire', 'voltage', 'circuit', 'mineral', 'fossil', 'oxygen', 'hydrogen',
  'carbon dioxide', 'planet', 'solar system', 'electricity', 'magnet',
  'temperature degrees', 'celsius', 'fahrenheit', 'continent', 'equator', 'hemisphere',
  'species', 'habitat', 'predator', 'camouflage', 'metamorphosis', 'larva', 'pupa',
  'erosion', 'glacier', 'volcano', 'earthquake', 'tsunami', 'constellation',
  'telescope', 'microscope', 'bacteria', 'virus', 'vaccine', 'nutrient', 'protein',
  'vitamin', 'skeleton', 'muscle', 'organ', 'brainwave',
];

const wordsOf = (text: string): string[] => text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];

/** Average words per sentence across the given texts (sentences split on . ! ?). */
function avgWordsPerSentence(texts: string[]): number {
  const sentences = texts.join(' ').split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (!sentences.length) return 0;
  const total = sentences.reduce((n, s) => n + wordsOf(s).length, 0);
  return total / sentences.length;
}

const abstractHitsIn = (text: string): string[] => {
  const lower = text.toLowerCase();
  return ABSTRACT_TERMS.filter((t) => lower.includes(t));
};

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

type Derived = { bands: AgeBand[]; rule: string; lowConfidence?: string };

function deriveArticle(a: Raw): Derived {
  const tags = strArr(a.tags);
  // (a) legacy printable age topics
  const legacy = [...new Set(tags.flatMap((t) => LEGACY_BAND_TOPICS[t] ?? []))] as AgeBand[];
  if (legacy.length) {
    const ordered = (['3-5', '6-8', '9-12'] as AgeBand[]).filter((b) => legacy.includes(b));
    return { bands: ordered, rule: 'article-a-legacy-tag' };
  }
  // (b) ageGuidance range
  const guidance = str(a.ageGuidance);
  if (guidance) {
    const r = parseAgeRange(guidance);
    if (r) return { bands: bandsForAgeRange(r.min, r.max), rule: 'article-b-ageGuidance' };
  }
  // (c) description range
  const descRange = parseAgeRange(str(a.description));
  if (descRange) return { bands: bandsForAgeRange(descRange.min, descRange.max), rule: 'article-c-description' };
  // (d) kids: country facts, else reading-level heuristic
  if (a.brand === 'kids') {
    if (tags.includes('countries') || str(a.slug).startsWith('meet-')) {
      return { bands: ['6-8', '9-12'], rule: 'article-d-country-facts' };
    }
    const paragraphs = (Array.isArray(a.body) ? a.body : []).flatMap((b) =>
      b && typeof b === 'object' ? strArr((b as Raw).paragraphs) : [],
    );
    const avg = avgWordsPerSentence(paragraphs.length ? paragraphs : [str(a.description)]);
    const bands: AgeBand[] = avg <= 9 ? ['3-5', '6-8'] : avg <= 14 ? ['6-8'] : ['6-8', '9-12'];
    const near = Math.min(Math.abs(avg - 9), Math.abs(avg - 14));
    const abstract = abstractHitsIn([str(a.title), str(a.description), ...paragraphs].join(' '));
    return {
      bands,
      rule: 'article-d-reading-level',
      lowConfidence:
        bands.includes('3-5') && abstract.length
          ? `heuristic gave 3-5 (avg ${avg.toFixed(1)} w/s) but text contains abstract term(s): ${abstract.slice(0, 3).join(', ')}`
          : near <= 0.75
            ? `avg words/sentence ${avg.toFixed(2)} sits within 0.75 of a threshold (9 / 14)`
            : undefined,
    };
  }
  // (e) any other brand
  return { bands: ['family'], rule: 'article-e-family' };
}

function quizText(q: Raw): string {
  const options = (Array.isArray(q.options) ? q.options : [])
    .map((o) => (o && typeof o === 'object' ? str((o as Raw).text) : ''))
    .join(' ');
  return [str(q.passage), str(q.prompt), options, str(q.explanation)].join(' ');
}

function deriveQuiz(q: Raw): Derived {
  const brand = str(q.brand);
  if (brand === 'together' || brand === 'grow' || brand === 'save') {
    return { bands: ['family'], rule: 'quiz-a-family-brand' };
  }
  const hits = abstractHitsIn(quizText(q));
  if (brand === 'kids') {
    let bands: AgeBand[];
    if (q.difficulty === 'easy') bands = hits.length ? ['6-8'] : ['3-5', '6-8'];
    else if (q.difficulty === 'medium') bands = ['6-8'];
    else bands = hits.length ? ['9-12'] : ['6-8', '9-12']; // hard
    return {
      bands,
      rule: 'quiz-b-kids-difficulty',
      lowConfidence:
        q.difficulty === 'easy' && hits.length
          ? `easy kids quiz demoted from 3-5 by abstract term(s): ${hits.slice(0, 3).join(', ')}`
          : q.difficulty === 'hard' && !hits.length
            ? 'hard kids quiz with no abstract-term hit — band rests on difficulty alone'
            : undefined,
    };
  }
  // brand play / discover
  if (str(q.passage)) {
    const avg = avgWordsPerSentence([str(q.passage)]);
    return {
      bands: avg <= 12 ? ['6-8', '9-12'] : ['9-12'],
      rule: 'quiz-c-passage',
      lowConfidence: Math.abs(avg - 12) <= 0.75 ? `passage avg words/sentence ${avg.toFixed(2)} within 0.75 of the 12 threshold` : undefined,
    };
  }
  const text = quizText(q);
  const words = wordsOf(text);
  const avgWordLen = words.length ? words.reduce((n, w) => n + w.replace(/[^a-z]/g, '').length, 0) / words.length : 0;
  let bands: AgeBand[];
  if (hits.length >= 2 || avgWordLen >= 5.6) bands = ['9-12'];
  else if (hits.length === 1 || avgWordLen >= 5.0) bands = ['6-8', '9-12'];
  else bands = ['6-8'];
  const nearLen = Math.min(Math.abs(avgWordLen - 5.0), Math.abs(avgWordLen - 5.6));
  return {
    bands,
    rule: 'quiz-c-vocabulary',
    lowConfidence:
      hits.length < 2 && nearLen <= 0.3
        ? `avgWordLen ${avgWordLen.toFixed(2)} within 0.3 of a threshold (5.0 / 5.6), abstractHits=${hits.length}`
        : undefined,
  };
}

const PERCEPTION_TYPES: GameType[] = ['odd-one-out', 'spot-difference', 'what-changed', 'drag-match'];

function deriveGame(g: Raw): Derived {
  const type = str(g.gameType) as GameType;
  const difficulty = str(g.difficulty);
  const byDifficulty = (easy: AgeBand[], medium: AgeBand[], hard: AgeBand[]): AgeBand[] =>
    difficulty === 'easy' ? easy : difficulty === 'hard' ? hard : medium;
  switch (type) {
    case 'memory':
      return { bands: ['3-5', '6-8'], rule: 'game-memory' };
    case 'counting': {
      const value = (g.numberAnswer as Raw | undefined)?.value;
      if (typeof value !== 'number') return { bands: ['6-8'], rule: 'game-counting', lowConfidence: 'counting game without numberAnswer.value — fell back to 6-8' };
      return { bands: value <= 10 ? ['3-5', '6-8'] : ['6-8'], rule: 'game-counting', lowConfidence: value >= 9 && value <= 12 ? `count value ${value} sits right at the <=10 boundary` : undefined };
    }
    case 'build-a-word': {
      const word = str(g.wordAnswer);
      if (!word) return { bands: ['6-8'], rule: 'game-build-a-word', lowConfidence: 'build-a-word without wordAnswer — fell back to 6-8' };
      const bands: AgeBand[] = word.length <= 4 ? ['3-5', '6-8'] : word.length <= 6 ? ['6-8'] : ['6-8', '9-12'];
      return { bands, rule: 'game-build-a-word' };
    }
    default: {
      if (PERCEPTION_TYPES.includes(type)) {
        return { bands: byDifficulty(['3-5', '6-8'], ['6-8'], ['6-8', '9-12']), rule: 'game-perception' };
      }
      // All remaining GAME_TYPES: observation, sequence, pick-the-right-one,
      // flags-and-places, fact-or-fiction, pattern, emotion-detectives.
      const hits = abstractHitsIn([str(g.title), str(g.prompt), str(g.explanation)].join(' '));
      return {
        bands: byDifficulty(['6-8'], ['6-8', '9-12'], ['9-12']),
        rule: 'game-remaining',
        lowConfidence:
          difficulty === 'easy' && hits.length >= 2
            ? `generic-rule easy game assigned 6-8 but text contains abstract term(s): ${hits.slice(0, 3).join(', ')}`
            : undefined,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Writing (key-order preserving: ageBands inserted after an anchor key)
// ---------------------------------------------------------------------------

function withAgeBands(item: Raw, bands: AgeBand[], anchors: string[]): Raw {
  const out: Raw = {};
  let inserted = false;
  for (const [key, value] of Object.entries(item)) {
    if (key === 'ageBands') {
      out.ageBands = bands;
      inserted = true;
      continue;
    }
    out[key] = value;
    if (!inserted && anchors.includes(key)) {
      out.ageBands = bands;
      inserted = true;
    }
  }
  if (!inserted) out.ageBands = bands;
  return out;
}

const sameBands = (a: unknown, b: AgeBand[]): boolean =>
  Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const KINDS = [
  { kind: 'article', folder: 'articles', derive: deriveArticle, anchors: ['ageGuidance', 'tags', 'description'] },
  { kind: 'quiz', folder: 'quizzes', derive: deriveQuiz, anchors: ['difficulty'] },
  { kind: 'game', folder: 'games', derive: deriveGame, anchors: ['difficulty'] },
] as const;

const coverage: Record<string, Record<AgeBand, number>> = {};
const ruleCounts: Record<string, number> = {};
const lowConfidence: { kind: string; id: string; bands: AgeBand[]; why: string }[] = [];
let changed = 0;
let unchanged = 0;
let unbandedApproved = 0;

for (const { kind, folder, derive, anchors } of KINDS) {
  coverage[kind] = { '3-5': 0, '6-8': 0, '9-12': 0, family: 0 };
  const dir = path.join(CONTENT_DIR, folder);
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const filePath = path.join(dir, file);
    const raw = fs.readFileSync(filePath, 'utf8');
    const item = JSON.parse(raw) as Raw;
    const { bands, rule, lowConfidence: why } = derive(item);

    // Quiz HARD RULE (d): an abstract-term quiz never carries '3-5'.
    let finalBands = bands;
    if (kind === 'quiz' && finalBands.includes('3-5') && abstractHitsIn(quizText(item)).length) {
      finalBands = finalBands.filter((b) => b !== '3-5');
      if (!finalBands.length) finalBands = ['6-8'];
    }

    ruleCounts[rule] = (ruleCounts[rule] ?? 0) + 1;
    for (const b of finalBands) coverage[kind][b] += 1;
    if (item.reviewStatus === 'approved' && !finalBands.length) unbandedApproved += 1;
    if (why) lowConfidence.push({ kind, id: str(item.id), bands: finalBands, why });

    if (sameBands(item.ageBands, finalBands)) {
      unchanged += 1;
      continue;
    }
    changed += 1;
    if (!DRY_RUN) {
      const next = withAgeBands(item, finalBands, [...anchors]);
      const text = JSON.stringify(next, null, 2) + (raw.endsWith('\n') ? '\n' : '');
      fs.writeFileSync(filePath, text);
    }
  }
}

console.log(`Age-band backfill ${DRY_RUN ? '(dry run) ' : ''}complete: ${changed} file(s) ${DRY_RUN ? 'would change' : 'changed'}, ${unchanged} already correct.`);
console.log(`Approved items left without bands: ${unbandedApproved}`);
console.log('\nCoverage (an item with 2 bands counts in both):');
for (const [kind, counts] of Object.entries(coverage)) {
  console.log(`  ${kind}: ${Object.entries(counts).map(([b, n]) => `${b}=${n}`).join('  ')}`);
}
console.log('\nCounts by derivation rule:');
for (const [rule, n] of Object.entries(ruleCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${rule}: ${n}`);
console.log(`\nLow-confidence items: ${lowConfidence.length} (showing up to 60)`);
for (const lc of lowConfidence.slice(0, 60)) console.log(`  [${lc.kind}] ${lc.id} -> [${lc.bands.join(', ')}] — ${lc.why}`);
console.log(`\nGame types covered by the mapping: ${GAME_TYPES.join(', ')}`);
