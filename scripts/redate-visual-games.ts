// Rebalances the approved visual games' scheduled dates PER TYPE (the generator's first run dated
// the first 40% of the whole list, leaving counting/sequence/what-changed with nothing playable at
// launch). Content is untouched — only scheduledDate moves — and each changed game gets a fresh
// registry record in the repo's approval shape: priorHash becomes the previously approved hash and
// fields.scheduledDate records the move, so the approval chain stays auditable.
// Usage: npx tsx scripts/redate-visual-games.ts [--dry-run]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gameSchema } from '../lib/schemas';
import { contentFingerprint } from '../lib/editorial-approval';

const dryRun = process.argv.includes('--dry-run');
const TODAY = '2026-11-18';
const dayMs = 86400000;
const todayMs = Date.parse(`${TODAY}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type GameFile = Record<string, unknown> & { id: string; gameType: string; scheduledDate: string };
const dir = 'content/games';
const games: { path: string; game: GameFile }[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    const path = `${dir}/${f}`;
    return { path, game: JSON.parse(readFileSync(path, 'utf8')) as GameFile };
  });

const byType = new Map<string, typeof games>();
for (const entry of games) {
  const list = byType.get(entry.game.gameType) ?? [];
  list.push(entry);
  byType.set(entry.game.gameType, list);
}
const runway: typeof games = [];
const plan = new Map<string, string>();
for (const list of byType.values()) {
  const sorted = [...list].sort((a, b) => a.game.scheduledDate.localeCompare(b.game.scheduledDate) || a.game.id.localeCompare(b.game.id));
  // The handcrafted starter types stay fully live, as they were on 17 Nov; the 40% rule is for the
  // six generated scene types.
  const starterTypes = ['flags-and-places', 'odd-one-out', 'pick-the-right-one'];
  const immediateCount = starterTypes.includes(sorted[0].game.gameType) ? sorted.length : Math.floor(sorted.length * 0.4);
  sorted.forEach((entry, i) => {
    if (i < immediateCount) {
      const back = Math.floor((i / Math.max(1, immediateCount)) * 10);
      plan.set(entry.game.id, iso(todayMs - back * dayMs));
    } else runway.push(entry);
  });
}
runway
  .sort((a, b) => a.game.gameType.localeCompare(b.game.gameType) || a.game.id.localeCompare(b.game.id))
  .forEach((entry, i) => plan.set(entry.game.id, iso(todayMs + (Math.floor(i / 2) + 1) * dayMs)));

const registryPath = 'docs/editorial-approval.json';
const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
  entries: { kind: string; id: string; priorHash: string; approvedHash: string; fields: Record<string, unknown> }[];
};
let changed = 0;
for (const { path, game } of games) {
  const next = plan.get(game.id)!;
  if (next === game.scheduledDate) continue;
  const entry = registry.entries.find((e) => e.kind === 'game' && e.id === game.id);
  if (!entry) throw new Error(`No registry entry for ${game.id}`);
  const updated = { ...game, scheduledDate: next };
  const approvedHash = contentFingerprint(gameSchema.parse(updated));
  if (!dryRun) {
    writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
    entry.priorHash = entry.approvedHash;
    entry.approvedHash = approvedHash;
    entry.fields = { ...entry.fields, scheduledDate: next };
  }
  changed += 1;
}
if (!dryRun) writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
const immediate = games.filter((g) => plan.get(g.game.id)! <= TODAY).length;
console.log(`Redated ${changed} games; ${immediate}/${games.length} now playable by ${TODAY}, spread per type; the rest run 2/day from 2026-11-19.`);
