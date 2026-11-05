# Project 4D: Circle notifications, growth prompts and moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Members get the "your set is ready" email and a weekly circle summary according to their preferences; a re-scoring notice is emailed; after answering, a member is offered to share the game or invite someone; members can report a circle, and the site owner can review reports and hide or restore a circle in `/admin`.

**Architecture:** `lib/circles/mail.ts` (selection of who gets what, plus plain-text templates), `lib/jobs/circle-mail.ts` (hourly job through `runJob` with a per-(circle, kind, period) claim table and the shared cap/skew guards), `lib/circles/reports.ts`, admin page `/admin/circles/` and actions in `lib/admin/actions.ts`. Behind `ACCOUNTS_ENABLED` and `CIRCLES_ENABLED`. Depends on 4A, 4B, 4C.

**Tech Stack:** Next.js 16, TypeScript, `pg`/PGlite, Vitest, Playwright + axe, `lib/email.ts`, `lib/jobs/guards.ts`, `lib/accounts/unsubscribe.ts`.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` Project 4 ("Member notifications", "Growth loop", "Moderation") and Project 3 notification preferences.

## Global Constraints

- Emails go to **account holders only** (child profiles have no address). Recipients are current members whose account is `verified_at`, not consent-pending, and has `notify_daily_set` (daily) or `notify_weekly_circle` (weekly) on; a 13-15 confirmed account receives essential-style circle mail only if the preference is on (default per 3E). The re-score notice goes to members with `notify_daily_set` on.
- **No item titles, answers or member names appear in the daily email**: only the circle name, "your set is ready" and the link. The weekly summary shows the recipient's own rank and points (their account and, for an adult, each of their own child profiles by profile name), the circle total, and the number of members; no other member's name. This keeps a circle containing a child safe in any mail client.
- Every email carries the plain unsubscribe line and RFC 8058 headers pointing at the 3E one-click route for the matching preference kind; honour the preference at send time (re-read it in the same query that selects recipients).
- Timing: daily mail after 07:00 and weekly mail Monday after 08:00 in the circle's time zone; exactly once per (circle, kind, period) via `circle_mail_log (circle_id, kind, period, sent_at, PRIMARY KEY (circle_id, kind, period))` claimed with `INSERT ... ON CONFLICT DO NOTHING` before sending. Per-run cap 200 mails and 50 circles, the clock-skew refusal and bounded send timeout from `lib/jobs/guards.ts`; a failed send is logged to `failed_jobs` and not retried within the same period beyond the existing retry policy. Closed or hidden circles and circles with no activity setup (no members besides the owner) send nothing.
- Reports: any current member with `join_circle` can report their circle (reasons: `name`, `behaviour`, `safety`, `other`; note up to 300 characters, blocked-words not applied to notes); 5 reports a day per account; the report holds the circle id, reporter account id (set null on account deletion), reason, note, timestamps, never a member's contact details. A child-profile context cannot report (it tells its adult). Admin sees counts and notes, can hide/restore a circle (`hidden_at`), mark reports handled; all audited. A hidden circle is invisible to members (404 on its pages and out of lists) and its mail stops; nothing is deleted.
- Growth prompts: after a signed-in member's answer on an item that is in today's set for one of their circles, the result area offers "Invite someone to <circle>" (link to the circle invite section) and "Share this game" (the item's public URL as selectable text). The share URL carries no member, circle or account identifier; the existing item template image is the share image. Shown to adult-context members only, never in a child context, never on Kids pages.
- Migration 017 additive with rollback header. No AI trailers; do not push.

## Review Focus

- No email contains a title or name that a mail preview could show for a circle with a child; recipients only ever receive their own circle mail; an opted-out or unverified or pending-consent account gets nothing.
- Re-running the job (crash, double worker) or a time-zone boundary never sends a period twice or skips one permanently.
- A member of circle A cannot report circle B; reports survive the reporter's deletion without the reporter; a hidden circle disappears for members immediately and returns on restore.
- The share prompt never leaks a circle or member identifier into a URL.

---

### Task 1: Circle mail

**Files:** Create `db/migrations/017_circle_mail_reports.sql` (`circle_mail_log`, `circle_reports`), `lib/circles/mail.ts`, `lib/jobs/circle-mail.ts`, `tests/unit/circles-mail.test.ts`, `tests/unit/circle-mail-job.test.ts`; modify `worker/main.ts` (hourly tick), `tests/unit/worker-bundle.test.ts` if needed, `lib/accounts/export.ts` and its tests (exclude `circle_mail_log` with a reason).

**Interfaces (produces):** `dailyMailFor(db, now, cap): Promise<Outgoing[]>` and `weeklyMailFor(db, now, cap)` where `Outgoing = { to: string; subject: string; text: string; headers: Record<string,string>; claim: { circleId; kind; period } }`; `runCircleMail(db, now, send): Promise<{ sent: number; skipped: number }>`; templates `dailyEmail(circleName, url)`, `weeklyEmail(...)`, `rescoreEmail(circleName, url)`.

- [ ] **Step 1: Failing tests:** table-driven recipient rules (verified/unverified, opted out, consent pending, closed/hidden circle, left member, solo owner); daily mail only after 07:00 local for UTC, Auckland and Los Angeles circles and once per period; weekly Monday 08:00 local; claim table makes a rerun and two concurrent runs send once (`Promise.all`); the daily text contains no item title, no member name (assert a circle containing a child with a distinctive name and item title: neither appears); weekly text shows only the recipient's own rank, points and own child profiles; unsubscribe headers and token for the right preference; caps and skew refusal; a send failure leaves the claim retryable within policy (document the ruling in the ledger); re-score notices produce one mail per recipient per notice.
- [ ] **Step 2: Run, watch fail.** **Step 3: Implement.** **Step 4: Run** new files, the worker bundle test and the whole unit suite. **Step 5: Commit** `feat: circle set-ready, weekly summary and re-score emails`.

### Task 2: Reports and admin hide

**Files:** Create `lib/circles/reports.ts`, `app/circles/[slug]/report/route.ts` (+ form on the circle page), `app/admin/circles/page.tsx`, `tests/unit/circles-reports.test.ts`; modify `lib/admin/actions.ts` (`circle.hide`, `circle.restore`, `circle.reports_handled`), `lib/admin/messages.ts`, `components/admin/AdminNav.tsx`, admin e2e, every circle read path to honour `hidden_at` (the 4A/4B/4C reads already exclude hidden circles; add tests proving it for set, scores, invites and community listing).

**Interfaces:** `reportCircle(db, accountId, slug, input: { reason: unknown; note?: unknown }, now): Promise<'reported' | 'invalid' | 'not_member' | 'limit' | 'not_allowed'>`; `listReportedCircles(db)` returning counts, latest note and status (no member emails).

- [ ] **Step 1: Failing tests:** member reports, non-member and left member cannot, child context denied, daily limit, invalid reason, long note rejected; reporter deletion keeps the report with a null reporter; admin actions require an admin session and CSRF and write audit rows; hide makes pages 404 for members, drops the circle from lists/communities/invites/mail, restore reverses it; the admin page shows no emails; axe at 320px on the admin page and the report form.
- [ ] **Step 2: Run, watch fail.** **Step 3: Implement.** **Step 4: Run** new files, admin tests and the whole unit suite; e2e from Git Bash: `SITE_RELEASE=false npx playwright test tests/e2e/circles.spec.ts tests/e2e/admin-auth.spec.ts tests/e2e/admin-actions.spec.ts tests/e2e/site.spec.ts`. **Step 5: Commit** `feat: circle reports and admin hide`.

### Task 3: Share prompts, isolation, docs, tracker

**Files:** Create `lib/circles/share-prompt.ts`, `tests/unit/circles-share-prompt.test.ts`; modify the post-answer result component (`components/item/PlayPanel.tsx` area), `tests/unit/account-isolation.test.ts`, `docs/OPERATIONS.md`, `docs/legal/data-inventory.md` and `docs/legal/go-live-copy-changes.md` (emails sent, reports), the tracker.

**Interfaces:** `sharePromptFor(db, ctx, itemId, now): Promise<{ circles: { name: string; inviteHref: string }[]; shareUrl: string } | null>` (null in a child context, on Kids items, for anonymous visitors, or when the item is in none of the member's circles' sets today).

- [ ] **Step 1: Failing tests:** prompt appears only for an adult-context member for an item in that circle's set today; absent for child context, Kids world items, anonymous; the share URL is the public item URL with no query string; no circle or account id in any URL; isolation rows: account B and non-members get no reports, mail or admin data; child context denied report. **Step 2: Implement** and add an e2e assertion on the result area (axe on the answered state). **Step 3:** docs (`OPERATIONS.md` "Circle email, reports and hiding": jobs, caps, how to stop mail (`CIRCLES_ENABLED`, per-preference), rollback of migration 017; tracker 4.6, 4.7, 4.8, 4.10). **Step 4:** whole unit suite, `rm -rf .next/types; npx tsc --noEmit`, eslint on touched files, `npm run build`, the e2e set above plus `accounts.spec.ts`, `trust-pages.spec.ts`. **Step 5: Commit** `feat: circle share prompts, docs and isolation rows`.
