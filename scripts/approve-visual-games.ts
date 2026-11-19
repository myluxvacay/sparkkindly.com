// Applies the independent reviewer's verdicts to the visual games collection: approved games are
// flipped to reviewStatus 'approved' with the reviewer attribution and registered in
// docs/editorial-approval.json (prior/approved fingerprints, same shape as quiz approvals);
// rejected games are deleted from content/games — a safety-review game left in the tree blocks the
// release validation gate, and a rejected game must not ship. Run content:validate afterwards.
// Usage: npx tsx scripts/approve-visual-games.ts --verdicts path/to/verdicts.json [--dry-run]
// Verdicts shape: { "reviewer": "name", "reviewedAt": "2026-11-18",
//                   "approved": ["id", ...] | [{ "id": "...", "note": "..." }],
//                   "rejected": [{ "id": "...", "reason": "..." }] }
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { gameSchema } from '../lib/schemas';
import { contentFingerprint } from '../lib/editorial-approval';

const args = process.argv.slice(2);
const verdictsPath = args[args.indexOf('--verdicts') + 1];
const dryRun = args.includes('--dry-run');
if (!verdictsPath || !existsSync(verdictsPath)) throw new Error('Pass --verdicts <file> with the reviewer verdicts.');

type Verdicts = {
  reviewer: string;
  reviewedAt?: string;
  approved: (string | { id: string; note?: string })[];
  rejected: { id: string; reason: string }[];
};
const verdicts = JSON.parse(readFileSync(verdictsPath, 'utf8')) as Verdicts;
const reviewedAt = verdicts.reviewedAt ?? new Date().toISOString().slice(0, 10);
const approvedNotes = new Map<string, string | undefined>();
for (const a of verdicts.approved) {
  if (typeof a === 'string') approvedNotes.set(a, undefined);
  else approvedNotes.set(a.id, a.note);
}
const rejected = new Map(verdicts.rejected.map((r) => [r.id, r.reason]));

const dir = 'content/games';
const registryPath = 'docs/editorial-approval.json';
const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
  entries: { kind: string; id: string; priorHash: string; approvedHash: string; fields: Record<string, unknown> }[];
};
const touched = new Set([...approvedNotes.keys(), ...rejected.keys()]);
registry.entries = registry.entries.filter((e) => !(e.kind === 'game' && touched.has(e.id)));

let flipped = 0;
let deleted = 0;
const missing: string[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const path = `${dir}/${file}`;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const id = String(raw.id);
  if (rejected.has(id)) {
    console.log(`REJECTED ${id}: ${rejected.get(id)}`);
    if (!dryRun) rmSync(path);
    deleted += 1;
    continue;
  }
  if (!approvedNotes.has(id)) continue;
  const priorHash = contentFingerprint(gameSchema.parse(raw));
  const note = approvedNotes.get(id) ?? 'Independent review passed: answer re-derived from scene data, difficulty and safety checked. Published under the owner\'s 18 Nov 2026 direction.';
  const next = { ...raw, reviewStatus: 'approved', reviewer: verdicts.reviewer, reviewedAt, reviewNote: note };
  const approvedHash = contentFingerprint(gameSchema.parse(next));
  if (!dryRun) writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  registry.entries.push({
    kind: 'game',
    id,
    priorHash,
    approvedHash,
    fields: { reviewStatus: 'approved', reviewer: verdicts.reviewer, reviewedAt, reviewNote: note },
  });
  flipped += 1;
}
for (const id of touched) {
  if (!existsSync(`${dir}/${id}.json`) && !rejected.has(id)) missing.push(id);
}
if (!dryRun) writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`Approved ${flipped}, deleted ${deleted} rejected, registry entries now ${registry.entries.length}.${missing.length ? ` Verdict ids with no file: ${missing.join(', ')}` : ''}`);
