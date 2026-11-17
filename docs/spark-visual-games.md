# Spark assistant + visual games — follow-ups (17 Nov 2026)

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
  CSS rule, because a GIF animates itself).

## Follow-ups

1. **Schema integration:** if picture rounds should be agent-authored daily like quizzes, extend the play body
   with a per-option image reference (art key or media reference + licence), teach `content:validate` and the
   reviewer pass to verify image–answer correctness, and add a `visual` mechanic or reuse `odd_one_out` /
   `multiple_choice` with image options. Until then, new rounds are code-reviewed edits to the data file.
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
