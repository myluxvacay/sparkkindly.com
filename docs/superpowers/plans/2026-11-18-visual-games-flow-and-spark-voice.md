# Visual games in the question flow + Spark's recorded voice (18 Nov 2026)

Owner direction (chat, 18 Nov 2026): wire the five owner-recorded Spark voice lines into the site;
build 300–400 visual games across six types (observation, memory, spot-the-difference, what-changed,
counting, sequence recall) plus the existing three kinds, and load ALL of them inside the regular
next-question flow — no separate picture-game silo. Push staging → prod authorized.

## Design

- **Content pipeline, like quizzes.** Games live in `content/games/*.json`, validated by a new
  `gameSchema` (lib/schemas.ts), registered in `docs/editorial-approval.json` (kind `game`), loaded by
  `lib/content.ts`, checked by `content:validate`, and imported to the database by the existing deploy
  content-publish (`importLegacy` learns games → items of kind `game`). `scheduledDate` is the
  publish date: a solid share dated ≤ today plays immediately, the rest join the daily runway.
- **Provable answers.** Scenes are parametric data (`lib/games/scene.ts`): a template, fixtures
  (clock time, sign text) and placed elements (art key, name, colour, position). Pure derivations —
  count, scene diff, fact value, sequence position — are recomputed by the schema's proof checks, so a
  game whose stored answer disagrees with its scene cannot validate, let alone deploy.
- **Mechanics stay closed.** Scene games reuse `multiple_choice` / `number` / `odd_one_out`; the scene
  payload rides in the play body as `visual`. Memory games are two-step: scene first, then a
  `?stage=answer` hop hides it (works without JavaScript, like clue_reveal's extra-clue link).
- **Flow integration.** PlayPanel builds keep-playing for quizzes AND games from one merged pool
  (listPublic kind quiz + game); the seen-tracking Kids carve-out is unchanged. `/games/` becomes an
  index of game items linking into the flow; the siloed VisualGames player is retired and its rounds
  are converted to content items.
- **Voice.** `lib/games/spark-voice.ts` is the single map: greeting (assistant tap-to-play),
  praise (correct answers, games + quiz island), completion (finished game / all-done state),
  encouragement (wrong answers), goodbye (assistant dismissal tap). All playback honours
  `sk-games-sound` and only ever starts from a tap or the player's own answer submission — never
  autoplay. Owner MP3s land in `public/brand/` under descriptive names.

## Steps

1. `lib/games/scene.ts` (types, catalogue, derivations) + unit tests.
2. `components/games/SceneArt.tsx` + `SceneView.tsx` (parametric SVG scenes).
3. Schema, content loading, validate-content, approval registry kind, import.
4. `readPlay` visual support; PlayForm scene rendering + memory two-step; PlayPanel pool merge.
5. Voice: files, spark-voice map, SparkAssistant, VisualGames slots, PlayEnhancer quiz voice.
6. Generator script → ~340 new games + 7 legacy conversions; registry entries after review.
7. `/games/` index rework; test updates (pins moved, not weakened).
8. Independent reviewer pass over the collection; regenerate/drop rejects; flip approvals.
9. Gates (content:validate, lint, typecheck, unit, targeted e2e), staging merge + CI + spot check,
   cherry-pick to main, prod verify.

## Progress (18 Nov 2026, evening)

- Engine, schema, import, flow integration, voice wiring, /games/ index: DONE, committed fe6b1d6 on
  feat/spark-voice-visual-games-flow. Silo (VisualGames.tsx, lib/games/visual-games.ts) deleted.
- Collection generated: 360 games (observation 58, memory 58, spot-difference 56, what-changed 54,
  counting 56, sequence 54, flags 13, odd-one-out 6, pick-the-right-one 5; easy 129 / medium 121 /
  hard 110; 32 kids). Dating: first 40% dated 2026-11-08..18, rest 2/day runway from 2026-11-19.
- Targeted unit suites pass (scene, visual-games, games-content, spark-assistant, keep-playing);
  content:validate passes in preview mode. Release-mode validation waits on approvals by design.
- Independent reviewer pass RUNNING (separate agent, own verification logic) -> review-verdicts.json.
- Next: scripts/approve-visual-games.ts (registry + flips; rejects deleted), release-mode
  content:validate, targeted e2e (tests/e2e/visual-games-flow.spec.ts), merge to staging, verify CI,
  then main, verify, spot-check prod.

## Completion (19 Nov 2026, ~00:45 UTC)

- Review: 356/360 approved by the independent reviewer; 4 ambiguous colour-fact games dropped;
  plural typos fixed; schema + generator now refuse ambiguous colour questions.
- Dating rebalanced per type after the first pass left counting/sequence/what-changed with no
  launch-day games: 154/356 playable at launch, rest 2/day.
- Staging: merge 2b502f9 — Deploy success (content publish imported 356 games after a packaging
  fix: release tarball now ships content/games; first attempt's app release was healthy but the
  import needed a workflow_dispatch re-run), Verify success.
- Prod: merge 9f91336 (registry unioned with main's parallel lineage, zero hash collisions;
  merge-resurrected silo files re-deleted) — Deploy success ("Healthy: prod 9f91336", imported
  356 games), Verify success. Spot-checked live: /play/odd-fruit-car/ serves as a GAME item with
  games in its discovery rail.
