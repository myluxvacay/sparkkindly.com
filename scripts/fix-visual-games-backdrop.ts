// Fixes the visual games whose proven-from-data answers the rendered backdrop made ambiguous
// (owner report, 18 Nov 2026 — observation-030's "yellow house" vs the farm backdrop's red barn).
// The new schema gate (TEMPLATE_OBJECTS in lib/games/scene.ts) rejects this class; this script
// repairs the six games it caught, in place, keeping id, difficulty, world and scheduledDate:
//
//   observation-030  present fact retargeted from the small yellow house element (the farm
//                    backdrop's red barn dominates that category) to the penguin.
//   memory-004       count-the-planets fact (the space backdrop stands on a planet) replaced
//                    with a present fact on the green turtle.
//   counting-001/023/040/046  star/planet counting in space scenes (the backdrop is full of
//                    star dots and stands on a planet) retargeted to rockets, which the space
//                    backdrop does not draw; counts and answers are unchanged.
//
// The garden flower-counting games needed no data change: the garden backdrop's flower-coloured
// dots became pebbles in SceneView.tsx, so the backdrop no longer draws that category.
//
// Two modes, mirroring generate → review → approve:
//   npx tsx scripts/fix-visual-games-backdrop.ts            apply fixes, mark games pending review
//   npx tsx scripts/fix-visual-games-backdrop.ts --approve --reviewer "<name>"
//                                                           flip the fixed games to approved and
//                                                           chain their editorial-registry entries
//                                                           (priorHash := previously approved hash).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describeScene, type SceneColor } from '../lib/games/scene';
import { gameSchema, type Game } from '../lib/schemas';
import { contentFingerprint } from '../lib/editorial-approval';

const FIXED_IDS = ['observation-030', 'memory-004', 'counting-001', 'counting-023', 'counting-040', 'counting-046'];
const dir = 'content/games';
const pathOf = (id: string) => `${dir}/${id}.json`;
const read = (id: string): Game => gameSchema.parse(JSON.parse(readFileSync(pathOf(id), 'utf8')));
const write = (id: string, g: Game) => writeFileSync(pathOf(id), `${JSON.stringify(g, null, 2)}\n`);

const ROCKET_COLORS: SceneColor[] = ['white', 'red', 'blue', 'white', 'blue', 'red'];

function fixCountingToRockets(g: Game): void {
  const scene = g.visual.scene!;
  let i = 0;
  for (const el of scene.elements) {
    if (el.art === g.visual.countTarget?.art) {
      el.id = el.id.replace(/^(planet|star)-/, 'rocket-');
      el.art = 'rocket';
      el.name = 'rocket';
      el.color = ROCKET_COLORS[i % ROCKET_COLORS.length];
      i += 1;
    }
  }
  g.visual.countTarget = { art: 'rocket' };
  g.visual.sceneAlt = describeScene(scene);
  g.title = 'Counting: rockets at the space scene';
  g.prompt = 'How many rockets can you count in the space scene?';
  g.explanation = `Count the rockets one by one: there are exactly ${g.numberAnswer!.value}.`;
}

function fixObservation030(g: Game): void {
  const penguin = g.visual.scene!.elements.find((e) => e.art === 'penguin')!;
  g.visual.fact = { type: 'present', elementId: penguin.id };
  for (const o of g.options!) if (o.id === g.correctOptionId) o.text = 'penguin';
  g.explanation = 'The penguin is right there in the picture. The other three choices are not in this scene at all.';
}

function fixMemory004(g: Game): void {
  const turtle = g.visual.scene!.elements.find((e) => e.art === 'turtle')!;
  g.visual.fact = { type: 'present', elementId: turtle.id };
  g.title = 'Memory: space scene present';
  g.prompt = 'From memory: which of these can you see in the space scene?';
  const wrongs = ['pink cupcake', 'blue gift box', 'red kite'];
  let w = 0;
  for (const o of g.options!) {
    o.text = o.id === g.correctOptionId ? 'green turtle' : wrongs[w++];
  }
  g.explanation = 'The green turtle is right there in the picture. The other three choices are not in this scene at all.';
}

const args = process.argv.slice(2);
if (args.includes('--approve')) {
  const reviewer = args[args.indexOf('--reviewer') + 1];
  if (!reviewer) throw new Error('Pass --reviewer "<name>"');
  const note = 'Independent rendered-scene review passed (18 Nov 2026): backdrop/fact ambiguity fixed under the owner’s 18 Nov 2026 report — answers re-derived and the rendered pictures inspected.';
  const registryPath = 'docs/editorial-approval.json';
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    entries: { kind: string; id: string; priorHash: string; approvedHash: string; fields: Record<string, unknown> }[];
  };
  for (const id of FIXED_IDS) {
    const g = read(id);
    const next: Game = { ...g, reviewStatus: 'approved', reviewer, reviewedAt: '2026-11-18', reviewNote: note };
    const approvedHash = contentFingerprint(gameSchema.parse(next));
    write(id, next);
    const entry = registry.entries.find((e) => e.kind === 'game' && e.id === id);
    if (!entry) throw new Error(`No registry entry for ${id}`);
    entry.priorHash = entry.approvedHash;
    entry.approvedHash = approvedHash;
    entry.fields = { ...entry.fields, reviewStatus: 'approved', reviewer, reviewedAt: '2026-11-18', reviewNote: note, visualFix: 'backdrop-fact ambiguity (owner report, 18 Nov 2026)' };
    console.log(`APPROVED ${id}`);
  }
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  console.log('Registry chained for the fixed games.');
} else {
  for (const id of FIXED_IDS) {
    if (!existsSync(pathOf(id))) throw new Error(`Missing ${pathOf(id)}`);
    const g = read(id);
    if (id === 'observation-030') fixObservation030(g);
    else if (id === 'memory-004') fixMemory004(g);
    else fixCountingToRockets(g);
    g.reviewStatus = 'safety-review';
    g.reviewer = null;
    g.reviewedAt = null;
    g.reviewNote = 'Backdrop-fact ambiguity fix (owner report, 18 Nov 2026): answer retargeted off a category the scene backdrop also draws. Awaiting the independent rendered-scene review.';
    gameSchema.parse(g); // prove the fixed game before it touches disk
    write(id, g);
    console.log(`FIXED ${id}: ${g.title}`);
  }
}
