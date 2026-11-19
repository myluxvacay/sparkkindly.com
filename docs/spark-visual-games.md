# Spark assistant + visual games — follow-ups (17 Nov 2026)

> **Update, 18 Nov 2026 (owner direction: "do both and push to staging and prod").** The picture games
> left the silo: all rounds — the seven below plus a generated collection of 360 — are library content
> in `content/games/*.json`, imported as `kind: 'game'` items and dealt inside the regular
> keep-playing question flow like any quiz. Six new scene types (observation, memory, spot the
> difference, what changed, counting, sequence recall) render parametric SVG scenes
> (`components/games/SceneArt.tsx` / `SceneView.tsx`) from data in the game file, and the content
> schema (`gameSchema` in `lib/schemas.ts`) re-derives every answer from that data — counts, scene
> diffs, facts and sequence positions — so a wrong key cannot validate. `lib/games/visual-games.ts`
> and `components/games/VisualGames.tsx` are deleted; `/games/` is now an index into the flow.
> Follow-ups 1, 2 and 5 below are therefore DONE (games record through the standard play path and
> play without JavaScript, memory games via a two-step look-then-answer form). The hero rule from
> follow-up 1 is enforced by the schema for every game. Spark's voice is now the owner's own
> recordings (Marie voice): greeting `spark-hi-friends.mp3`, praise `spark-great-listening.mp3`,
> completion `spark-you-did-it.mp3` (owner take replacing the synthesized one), encouragement
> `spark-try-again.mp3`, goodbye `spark-goodbye.mp3` — mapped in `lib/games/spark-voice.ts`, played
> only on tap or as the direct result of the player's own answer submission, behind the same
> `sk-games-sound` toggle. The synthesized `spark-greeting.mp3` / `spark-you-got-this.mp3` are
> retired. The in-flow games no longer show the victory/encouraging GIF reactions (the recorded
> voice carries the reaction in the shared play panel); the GIF slots described below applied to
> the retired silo player. Plan: `docs/superpowers/plans/2026-11-18-visual-games-flow-and-spark-voice.md`.

Built on `feat/spark-and-visual-games` (off `staging`): Spark homepage widget (#20) and picture games at
`/games/` (#21), with Spark hosting the games.

## Decisions taken

- **No schema change.** The DB play body (`lib/public/body.ts`) carries text options only, so picture rounds
  live in a typed in-repo file (`lib/games/visual-games.ts`) with original SVG artwork
  (`components/games/GameArt.tsx`). Games are not recorded to profiles and carry no public scores — the same
  promise the daily quiz makes anonymous visitors.
- **Spark scope.** Fixed guidance + links only; no open-ended AI chat, no third-party requests, no tracking.
  Voice is tap-to-play (`preload="none"`), dismissal remembered in `localStorage`, CSS attention animation
  stilled by the global `prefers-reduced-motion` rule.
- **Assets.** Canonical cape Spark, optimized: `public/brand/spark.webp` (27 KB) and `spark-220.webp` (12 KB),
  plus `spark-greeting.mp3` (140 KB, fetched only on tap). The 3 MB attention-loop MP4 was deliberately NOT
  shipped — CSS animation on the static image is lighter.
- **Animation slots (updated later 17 Nov).** The owner-provided transparent waving GIF
  `public/brand/spark-waving.gif` (313×627, 249 KB) replaced the CSS-animated static figure in the homepage
  widget and the games presenter. `SPARK_SLOTS` in `components/games/VisualGames.tsx` names the reaction
  slots — `presenting` (waving GIF), `victory` (`spark-victory.gif`, fallback waving GIF) and `encouraging`
  (`spark-encouraging.gif`, fallback still Spark) — so a new reaction GIF is a file drop with no logic
  change. Reduced-motion visitors get the still Spark in every slot (matchMedia check, not just the global
  CSS rule, because a GIF animates itself). The real victory/encouraging GIFs arrived the same day, with
  voice lines (`spark-you-did-it.mp3`, `spark-you-got-this.mp3`): a correct pick plays the victory GIF +
  "You did it!", a wrong pick the encouraging GIF + "You got this! Try again!". Sound plays ONLY from the
  player's own answer click (never on load/round change/hover), behind a visible on/off toggle persisted
  in `localStorage` (`sk-games-sound`, default on); clips are created and preloaded lazily on that first
  interaction and `play()` rejections are swallowed.

## Follow-ups

1. **Schema integration:** if picture rounds should be agent-authored daily like quizzes, extend the play body
   with a per-option image reference (art key or media reference + licence), teach `content:validate` and the
   reviewer pass to verify image–answer correctness, and add a `visual` mechanic or reuse `odd_one_out` /
   `multiple_choice` with image options. Until then, new rounds are code-reviewed edits to the data file.
   Carry over the authoring rule from the in-repo rounds (owner report, 17 Nov 2026): an option must never
   repeat the round's hero image — when the hero shows the answer's picture, options are text-only cards
   (omit `art`/`alt`); a data-level test pins this for every round.
2. **Recording/leaderboard:** wiring picture-game results into profile scoring needs the same closed-choice
   recording path as quizzes (`lib/accounts/record-play.ts`) — do it with the schema work, not before.
3. **Spark poses:** the meet-sheet poses (guiding, celebrating, listening) can be cut into separate web assets
   so Spark's in-game reactions change expression, not just text.
4. **Social:** Spark in social posts is a separate, owner-confirmed change to the daily social job (from
   18 Nov 2026) — not part of this branch.
5. **No-JS play:** `VisualGames` is a client component and is inert without JavaScript, unlike the daily
   quiz's server-checked form. If picture games join the recorded quiz system (follow-up 1/2), give them the
   same server-rendered form path.
6. **Flag fidelity:** flag SVGs are recognisable simplifications (star counts, fine arms and the Union Jack's
   counterchange are not exact). If a round ever teaches flag details rather than recognition, redraw that
   flag to spec first.
