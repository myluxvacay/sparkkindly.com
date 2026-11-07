# Save world Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or executing-plans). Steps use checkbox syntax.

**Goal:** A sixth world, **Save**: general money-skills guides and quizzes for everyone 13 and over, plus curated offers that may carry an owner-attached affiliate link. Education only, never personal financial advice.

**Owner decision (7 November 2026, recorded in the spec):** the five worlds become six. "Guides plus offers plus affiliate links"; audience everyone 13 and over; education-only wording with a disclaimer on every Save page.

**Architecture:** reuse everything that exists. A world is a `worlds` row plus config copy, the brand enum, a goals file for the content agent and the places that list worlds. Offers are **adults-rated articles** in a Save topic; the affiliate link is the existing sponsorship (kind `affiliate`, `ends_on`) the owner attaches in `/admin/sponsors/`, so the disclosure sentence, excluded categories, date window, click counting and the under-18 and Kids exclusions already apply. No new item kind, no new table.

**Tech Stack:** Next.js 16, TypeScript, zod, PGlite, Vitest, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` (add a dated owner-decision note for the sixth world) and sections on sponsorship (4a.3, 4a.5).

## Global Constraints

- **Audience rulings:** Save guides and quizzes are audience `all` (open to teens and anonymous visitors; never a sponsor line). Offer articles are audience `adults` (never to a child profile; `adults` means "aimed at adults", not an age gate, so a 13-17 account may read the explainer but never sees the sponsor line or affiliate link; the line shows only to anonymous visitors and 18+ per the existing rules). Save is never rated `kids`. Child profiles see no Save item rated `adults`.
- **Education only:** every Save page (world page and every Save item page) carries a plain disclaimer: "General information, not financial advice. Check the details with the provider before you decide." The agent goals forbid recommending a specific investment, loan, credit product, broker, crypto or any "guaranteed" return, personalised advice, get-rich claims and anything on the excluded sponsor categories (gambling, alcohol, tobacco and vaping, weapons, adult content, payday lending, cryptocurrency and get-rich schemes, supplements and weight-loss, political and religious bodies, anything marketed to children).
- **No time-dependent facts in item text:** prices, rates, end dates and "this week" never appear in an item body; the only dated element of an offer is the sponsorship's `ends_on`, so an expired offer simply loses its link.
- Sources: facts need sources the reviewer has opened (existing `sourced` tier); offers also need the provider's own terms page as a source.
- With the world row absent or disabled nothing changes. Migration additive with rollback header. No AI trailers; do not push; do not touch the VM or production.
- Keep `.claude/rules/*` (accessibility WCAG 2.2 AA, maintainability, data-isolation, ai-governance).

## Review Focus

- A child profile, a 13-17 account and an anonymous visitor: offer (`adults`) never reaches the child profile on any route, and never carries the sponsor line or affiliate link for the teen (list, detail, search, topic page, sitemap, daily set, share image, email); guides (`all`) reach everyone and never show a sponsor line.
- The disclaimer is on every Save item page and the world page, not only the world page.
- Every place that lists the five worlds (nav, home grid, footer, sitemap, SEO alt text, trust pages, cut-over inventory, circle sharing, admin, social copy, privacy and about copy) now handles six without a hard-coded count of five.
- The content agent cannot invent offers or links: it drafts guides and "how this offer works" explainers; links come only from the owner's sponsorship.
- Colour contrast of the new world's accent meets AA on its card and label.

---

### Task 1: World definition, data, copy and everywhere worlds are listed

**Files:** Create `db/migrations/<next>_save_world.sql` (insert the `save` world row, enabled, auto approval with all gates, `ON CONFLICT (slug) DO NOTHING`, rollback header), `agents/worlds/save.md`; modify `lib/config.ts` (world copy), `lib/schemas.ts` (brand enum), `lib/seo.tsx` (banner alt), `db/seed/index.ts`, `lib/cutover/inventory.ts`, every other place found by searching for the five slugs and for "five worlds"/"Five worlds" in `app/`, `components/`, `lib/`, `docs/legal/`, `.claude/`, `agents/`, tests; CSS for the new world's colour class (check AA contrast); `docs/OPERATIONS.md`, spec owner-decision note, roadmap tracker.

- [ ] **Step 1: Failing tests:** worlds list/nav returns six with `save` in the agreed position (after Grow, before Kids so Kids stays last); `/save/` renders with the disclaimer; an unknown-world and a reserved-slug check still pass; brand schema accepts `save`; migration applies on top of the existing ones and its row matches config copy; inventory lists `/save/`.
- [ ] **Step 2: Run, watch fail. Step 3: Implement.** World copy: promise "Spend smart. Keep more.", description one sentence on money skills and saving for everyone 13 and over, plus the short card line. `agents/worlds/save.md`: audience `all`, `maxItemsPerRun: 3`, kinds `article,quiz`, topics (e.g. `budgeting`, `saving`, `student-money`, `spending-smart`, `understanding-offers`, `money-basics`), voice and the never-list from Global Constraints. Replace hard-coded "five" wording with six where it is a count of worlds (not the Kids "ages 6-9" text).
- [ ] **Step 4:** run the new tests, the migrate tests, the whole unit suite, `npx tsc --noEmit`. **Step 5: Commit** `feat: Save world definition, data and copy`.

### Task 2: Disclaimer, offers, agent files and verification

**Files:** Create `components/item/MoneyDisclaimer.tsx`; modify the item page and world page (render the disclaimer for world `save`), `.claude/agents/sparkkindly-world-agent.md` (Save rules: guides vs offer explainers, no invented links), `.claude/commands/daily-run.md` only if it lists worlds, `agents/README.md`, `tests/e2e/save.spec.ts`, `docs/legal/{data-inventory,go-live-copy-changes}.md` (new world copy, no new data collected), `docs/OPERATIONS.md` ("Save world": what it is, how to attach an affiliate offer in `/admin/sponsors/`, the ending of an offer by `ends_on`, rollback by disabling the world row).

- [ ] **Step 1: Failing tests (unit + e2e):** disclaimer on `/save/` and on a Save item; absent on other worlds; a Save `all` guide never shows a sponsor line even if a sponsorship targets its topic; a Save `adults` offer shows the affiliate disclosure for an anonymous visitor and nothing for a child session or a 16-year-old; the offer disappears from child-profile list, search, topic page and sitemap; axe at 320px and desktop on `/save/`, a guide and an offer; privacy gate (no third-party requests, no storage identifiers on Kids pages) still green; `account-isolation` rows.
- [ ] **Step 2: Run, watch fail. Step 3: Implement. Step 4:** whole unit suite, `SITE_RELEASE=false npm run build`, then `SITE_RELEASE=false npx playwright test` for the affected specs (public-browse, site, sponsorship, item-page, search, seo, a11y-signoff, save). **Step 5: Commit** `feat: Save world disclaimer, offer rules and agent files`.

**Ruling (review, 7 November 2026):** the first wording said teens never reach an offer. The platform's `adults` rating is not an age gate (see OPERATIONS, Accounts), so the plan now says what the code does: child profiles never receive offers; teens may read an explainer but never see the sponsor line (spec 4a.5). Owner to confirm.
