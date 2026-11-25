// Update docs/editorial-approval.json after the age-band backfill.
//
// For every content item (article / quiz / game) whose PARSED fingerprint no longer
// matches its registry entry's approvedHash — i.e. every item whose file changed —
// this sets entry.priorHash := the entry's previous approvedHash and
// entry.approvedHash := contentFingerprint(parsed item), using the lib/schemas.ts
// parsers and lib/editorial-approval.ts contentFingerprint exactly as
// scripts/validate-content.ts does via lib/content (readFolder + schema parse).
//
// Content items with NO registry entry are reported, never invented.
// The registry file's existing formatting (indent, key order, trailing newline)
// is preserved.
//
// Usage:
//   npx tsx scripts/update-registry-age-bands.ts           # update, then verify
//   npx tsx scripts/update-registry-age-bands.ts --verify  # verify only
import fs from 'node:fs';
import path from 'node:path';
import { readFolder } from '../lib/repository';
import { articleSchema, quizSchema, gameSchema } from '../lib/schemas';
import { contentFingerprint } from '../lib/editorial-approval';

const VERIFY_ONLY = process.argv.includes('--verify');
const REGISTRY_PATH = path.join(process.cwd(), 'docs', 'editorial-approval.json');

type Kind = 'article' | 'quiz' | 'game';
type Item = { kind: Kind; id: string; reviewStatus: string; fingerprint: string };

const items: Item[] = [
  ...readFolder('articles').map((a) => { const p = articleSchema.parse(a); return { kind: 'article' as Kind, id: p.id, reviewStatus: p.reviewStatus, fingerprint: contentFingerprint(p) }; }),
  ...readFolder('quizzes').map((q) => { const p = quizSchema.parse(q); return { kind: 'quiz' as Kind, id: p.id, reviewStatus: p.reviewStatus, fingerprint: contentFingerprint(p) }; }),
  ...readFolder('games').map((g) => { const p = gameSchema.parse(g); return { kind: 'game' as Kind, id: p.id, reviewStatus: p.reviewStatus, fingerprint: contentFingerprint(p) }; }),
];

const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
const registry = JSON.parse(raw) as {
  entries: { kind: Kind; id: string; priorHash: string; approvedHash: string; fields: Record<string, unknown> }[];
  [k: string]: unknown;
};
const byKey = new Map(registry.entries.map((e) => [`${e.kind}:${e.id}`, e]));

const missing: Item[] = items.filter((i) => !byKey.has(`${i.kind}:${i.id}`));

if (!VERIFY_ONLY) {
  let updated = 0;
  let alreadyCurrent = 0;
  // Surgical text edit: swap only the priorHash/approvedHash VALUES in place, in file
  // order, so the rest of the file (indent, \uXXXX escapes, fields) is byte-identical.
  // A JSON round-trip would unescape unicode escapes across every `fields` block.
  const entryPattern = /("kind":\s*"(?:article|quiz|game)",\s*"id":\s*")([^"]+)(",\s*"priorHash":\s*")[0-9a-f]{64}(",\s*"approvedHash":\s*")[0-9a-f]{64}(")/g;
  const seen = new Set<string>();
  const nextText = raw.replace(entryPattern, (match, pre: string, id: string, mid1: string, mid2: string, post: string) => {
    // The pattern does not capture kind; recover it from the match prefix.
    const kind = match.match(/"kind":\s*"(\w+)"/)?.[1] as Kind;
    const key = `${kind}:${id}`;
    seen.add(key);
    const item = items.find((i) => i.kind === kind && i.id === id);
    const entry = byKey.get(key);
    if (!item || !entry) return match;
    if (entry.approvedHash === item.fingerprint) {
      alreadyCurrent += 1;
      return match;
    }
    updated += 1;
    const out = `${pre}${id}${mid1}${entry.approvedHash}${mid2}${item.fingerprint}${post}`;
    entry.priorHash = entry.approvedHash;
    entry.approvedHash = item.fingerprint;
    return out;
  });
  const notLocated = items.filter((i) => byKey.has(`${i.kind}:${i.id}`) && !seen.has(`${i.kind}:${i.id}`));
  if (notLocated.length) throw new Error(`Registry entries not located in file text: ${notLocated.map((i) => i.id).join(', ')}`);
  if (updated) fs.writeFileSync(REGISTRY_PATH, nextText);
  console.log(`Registry update: ${updated} entr(ies) re-hashed, ${alreadyCurrent} already current.`);
}

// Verify: for every approved item, registry approvedHash === contentFingerprint(parsed).
let failures = 0;
for (const item of items) {
  if (item.reviewStatus !== 'approved') continue;
  const entry = byKey.get(`${item.kind}:${item.id}`);
  if (!entry) continue; // counted in `missing`
  if (entry.approvedHash !== item.fingerprint) {
    failures += 1;
    if (failures <= 20) console.log(`  MISMATCH [${item.kind}] ${item.id}: registry ${entry.approvedHash.slice(0, 12)}… != content ${item.fingerprint.slice(0, 12)}…`);
  }
}
console.log(`Verify: ${items.filter((i) => i.reviewStatus === 'approved').length} approved items checked, ${failures} hash mismatch(es).`);
console.log(`Content items with NO registry entry: ${missing.length}`);
for (const m of missing) console.log(`  MISSING [${m.kind}] ${m.id} (reviewStatus=${m.reviewStatus})`);
if (failures || missing.some((m) => m.reviewStatus === 'approved')) process.exitCode = 1;
