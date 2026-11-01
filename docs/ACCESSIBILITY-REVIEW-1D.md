# Accessibility Review: public site before cut-over (Project 1D)

Target: WCAG 2.2 AA
Overall: **PASS for the automated and scripted checks listed; screen-reader and real-device passes UNVERIFIED** (see the end). This is not a conformance claim and the public Accessibility page says so.

Code state: branch `worktree-agent-a66fe208337ed3abe` after the 1D commits; run with `SITE_RELEASE=false` against the in-process test database (starter content plus fixtures). Tracker task 1.16.

## Automated evidence

`tests/e2e/a11y-signoff.spec.ts` runs axe (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice; **every** impact, not only serious/critical) over 31 pages and states: home, five worlds, a Kids article, an article, a quiz page before and after answering (right, wrong), put_in_order with duplicate positions, clue_reveal, `/quiz/`, archive, search (empty, results, no results), a topic page, the report form (empty, error, sent), all six trust pages, and the 404 page. Result: 0 violations. The older gate `site.spec.ts` (serious/critical on home, Kids, article, quiz) and `report.spec.ts` still pass.

Caveat: axe finds roughly a third of issues. Everything below is the part it cannot.

## Keyboard / Focus

| Check | How | Result |
|---|---|---|
| Skip link is the first Tab stop, visible, and moves focus into `main` | `a11y-signoff` on `/`, `/about/`, `/search/` | PASS |
| All seven play mechanics answerable by keyboard alone (arrow/Space on radios, typing in text/number, typing in selects, Tab to button, Enter) | `a11y-signoff` | PASS |
| After submitting, focus lands on the result block (`#result`, `tabindex=-1`), with and without JavaScript the URL carries `#result` | `a11y-fixes` | PASS (fixed in 1D) |
| Report form completable by keyboard; confirmation focused | `report`, `a11y-fixes` | PASS |
| Visible focus indicator (outline of at least 2px or shadow) on every stop reached by 60 Tab presses on 7 key pages | `a11y-signoff` | PASS |
| Mobile menu: Enter opens, Tab reaches links, Escape closes and returns focus to the button | `site.spec.ts` (1B) | PASS |
| No keyboard trap | Tab loops above end on the browser chrome | PASS |

## Semantics / Names

- One `h1` per page; heading levels never skip on search, topic, archive, world, home and item pages (`a11y-fixes`). **Fixed:** list cards were `h3` directly under `h1`.
- Breadcrumb now marks the current page with `aria-current="page"` on world, topic, item and all trust pages. **Fixed.**
- The "Pages" navigation landmark is no longer rendered when there is no previous or next link. **Fixed.**
- Native controls only: fieldset/legend for answer groups, labelled inputs and selects, `role=status` for results and `role=alert` for the report error.
- Decorative images use `alt=""`; photographs have descriptions.

## Forms / Errors

- Report form: no reason is pre-selected any more (it defaulted to "wrong", which could send a wrong report unseen); the group is `required`. **Fixed.**
- put_in_order with a repeated position now says "Please give each item a different position from 1 to N" instead of the generic message. **Fixed.**
- Errors and confirmations are in the focused `#result` block.

## Contrast / Reflow

- axe `color-contrast` passes on every page above.
- No horizontal scroll at 320px on any of the 31 pages and states; no loss at 640px wide (a 200% zoom of a 1280px window).
- Links in the breadcrumb, pager and footer navigation are at least 24px tall (WCAG 2.2 target size, 2.5.8). **Fixed** by `min-height: 24px` (additive CSS).
- `prefers-reduced-motion` switches off transitions and smooth scrolling (1B CSS, unchanged).

## Media

No video or audio is published. Template images are decorative. The video block, captions and transcript requirements stay in force for the day a video is added.

## Findings

| # | Finding | Status |
|---|---|---|
| 1 | Result block not focused after answer or report | Fixed, tested |
| 2 | Heading skip h1 to h3 on list pages | Fixed, tested |
| 3 | Breadcrumb lacked `aria-current` | Fixed, tested |
| 4 | Empty "Pages" landmark | Fixed, tested |
| 5 | Report reason pre-selected as "wrong" | Fixed, tested |
| 6 | Vague duplicate-position message | Fixed, tested |
| 7 | Textarea, select and `tabindex=-1` targets had no explicit focus style | Fixed (CSS) |
| 8 | Several labels are 9 to 11px (card meta, footer, breadcrumb). They pass axe and zoom works, but they are small | **Open, low:** a design decision for the owner; not a WCAG A or AA failure |

No remaining serious or critical issue was found by these checks.

## Unverified (owner or later)

- **Screen reader:** no NVDA, JAWS, VoiceOver or TalkBack pass was run (this agent cannot). Script for the owner, 20 minutes: with NVDA and Firefox or Chrome, (1) tab to the skip link and use it, (2) open a quiz, answer by keyboard and confirm the verdict is announced, (3) open Report a problem and send one, confirm the confirmation is announced, (4) read one article by headings (H key) and confirm the outline makes sense. Repeat on iPhone VoiceOver for (2) and (3).
- **Real devices:** mid-range Android and iPhone passes (spec, Accessibility and performance) not run.
- **Windows high-contrast and forced-colors mode:** not run.
- **Outside specialist review:** not done; the public page does not claim it.
- **Core Web Vitals on throttled mobile** (spec): not measured here; belongs with the load test in `docs/CUTOVER.md`.
