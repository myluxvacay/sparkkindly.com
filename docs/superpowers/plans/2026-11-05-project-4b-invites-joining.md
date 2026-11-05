# Project 4B: Invites, joining and communities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Circle owners and members (with the `invite` capability) invite people by a shareable link or a single-use email invite; a person opens the link (a chat-app preview shows the circle name, no personal data), signs up or in, and joins; public communities are listed and joinable by 16 and over. Referrals are recorded.

**Architecture:** `lib/circles/invites.ts` (create, revoke, regenerate, accept, referral; no Next.js imports) over migration 015; `lib/circles/join.ts` holds the one set of join rules shared by invite acceptance and community joining; pages under `app/circles/join/[token]/`, `app/circles/communities/`. Behind `ACCOUNTS_ENABLED` and `CIRCLES_ENABLED`. Depends on plan 4A (`docs/superpowers/plans/2026-11-05-project-4a-circles-core.md`, built first).

**Tech Stack:** Next.js 16, TypeScript, `pg`/PGlite, `node:crypto`, Vitest, Playwright + axe, existing `lib/email.ts`.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` Project 4 ("Invites", "Circle rules", "Moderation"), section 4a.5, `.claude/rules/{data-isolation,security}.md`.

## Global Constraints

- Tokens: 32 random bytes, base64url, stored only as a sha256 hash (like sign-in links); the raw token exists only in the URL/email.
- **Opening an invite page (GET) never consumes or changes an invite** (chat apps and scanners fetch links); joining is a POST behind a same-origin check from a signed-in adult-context session. An unknown, revoked, expired or used token is one neutral 404 page.
- The invite page shows the circle name, kind and member count only: never member names, emails, scores or the inviter's email. It sends `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and the preview (Open Graph title/description + one branded image route) contains no personal data.
- Link invite: reusable until revoked; regenerate = revoke all active links and mint a new one. Email invite: single use, expires 14 days after creation, revoked when the circle closes. Only a current member with `invite` capability on an open circle may invite; a circle's owner may revoke any invite, a member only their own.
- Join rules (one function, `canJoin`): signed-in; not already a current member; circle open and not hidden; member limit not reached and the account is below its per-account circle limit (4A constants); capability `join_circle` (so a consent-pending 13-15 is refused); a circle that contains a child profile admits **18+ only**; a **community** additionally needs `join_community` (denies 13-15) and a friends/family circle is joinable only through an invite; a child-profile context is refused everywhere. The name typed for the circle ("your name in this circle", 1 to 30 characters, blocked-words checked) is required.
- Email invites: stored invited address kept only until accepted, revoked or 14 days (then nulled by the purge); at most 10 invites sent per account per day, 3 per address per circle, and a per-network limiter; if the address belongs to an account with `notify_invites` off, nothing is sent (the sender still sees "sent"); the mail states who invited them by their in-circle name, the circle name and "ignore this if you do not know them", and carries the one-click unsubscribe from plan 3E. Outbound send has a bounded timeout (as in `lib/email.ts`).
- Referral: when an account is created and first joins through an invite, one `referrals` row records (invite id, new account id, joined_at). It holds no names. Sign-up carries the invite token through as a validated return path only (`/circles/join/<token>/`, never any other URL).
- Community listing `/circles/communities/` is public: name, description and member count of open, non-hidden communities, newest first, paged. No member names.
- Migration 015 additive with rollback header. No AI trailers; do not push.

## Review Focus

- A scanner or crawler fetching an invite URL (any number of times) does not use up an email invite or join anyone.
- A revoked, expired, used or foreign token never reveals whether the circle exists; a token for circle A never joins circle B; a forged `circle` id in the join form is ignored (the token decides).
- A 13-15 account cannot join a community; a 13-17 account cannot join a circle with a child profile; a child context cannot accept; a consent-pending account cannot join.
- Sign-up return path cannot be used as an open redirect.
- Account deletion removes the account's invites, referral rows and any pending invite to its address; export lists the invites the account created (without invitee addresses).

---

### Task 1: Migration, join rules, invites library

**Files:** Create `db/migrations/015_circle_invites.sql`, `lib/circles/join.ts`, `lib/circles/invites.ts`, `tests/unit/circles-join.test.ts`, `tests/unit/circles-invites.test.ts`; modify `lib/accounts/export.ts` and its completeness test, `lib/accounts/delete.ts` only if a row is not covered by cascades.

**Interfaces (produces):**
- Tables: `circle_invites (id uuid PK default gen_random_uuid(), circle_id uuid NOT NULL REFERENCES circles ON DELETE CASCADE, created_by uuid NOT NULL REFERENCES accounts ON DELETE CASCADE, kind text CHECK in ('link','email'), token_hash text NOT NULL UNIQUE, invited_email text, created_at timestamptz DEFAULT now(), expires_at timestamptz, revoked_at timestamptz, used_at timestamptz, used_by uuid REFERENCES accounts ON DELETE SET NULL, opens int NOT NULL DEFAULT 0)`; `referrals (invite_id uuid REFERENCES circle_invites ON DELETE CASCADE, new_account_id uuid PRIMARY KEY REFERENCES accounts ON DELETE CASCADE, joined_at timestamptz DEFAULT now())`.
- `join.ts`: `canJoin(input: { group; consent; circleKind; circleHasChild: boolean; viaInvite: boolean; memberCount; accountCircleCount; alreadyMember; circleOpen; circleHidden }): { ok: true } | { ok: false; reason: 'capability' | 'community_age' | 'has_child_adults_only' | 'invite_only' | 'full' | 'account_limit' | 'already_member' | 'closed' }`; and `joinCircle(db, accountId, circleId, yourName, viaInvite, now)` doing the checks and the insert in one transaction under the circle row lock.
- `invites.ts`: `createLinkInvite(db, accountId, slug, now): Promise<{ status: 'created'; token: string } | { status: 'not_allowed' | 'closed' }>` (replaces the active link: regenerate), `createEmailInvite(db, accountId, slug, email: unknown, now, send): Promise<'sent' | 'invalid' | 'not_allowed' | 'closed' | 'limit' | 'duplicate'>` (`send` injected, as in the consent email), `revokeInvite(db, accountId, slug, inviteId): Promise<boolean>`, `previewInvite(db, token): Promise<{ circleName; kind; memberCount } | null>` (read-only; increments `opens` only through a separate `recordOpen` call from the page, documented as an upper bound because crawlers also open links), `acceptInvite(db, accountId, token, yourName, now): Promise<{ status: 'joined'; slug } | { status: 'invalid' | JoinReason }>` (marks an email invite used, records the referral if the account was created through this invite flow within the last hour and has no prior membership), `joinCommunity(db, accountId, slug, yourName, now)`, `listCommunities(db, page): Promise<{ name; slug; description; memberCount }[]>`, `purgeExpiredInvites(db, now, cap): Promise<number>` (nulls `invited_email` and deletes unusable rows 14 days after expiry) wired into the worker after the circles purge.

- [ ] **Step 1: Failing tests** (PGlite): every join rule above as a table-driven test over age group x consent x circle kind x has-child (including 13-15 community denied, teen into a child circle denied, pending denied, friends circle without invite denied, full and closed and hidden denied, double join denied); link invite reusable by two accounts, regenerate kills the old token, revoke kills it; email invite single use (second accept `invalid`), expiry at 14 days exact boundary, revoked on circle close; token stored hashed (the raw token is not in any column); preview returns only name, kind and member count (assert the JSON keys) and never changes the invite; a non-member or non-`invite` account cannot create or revoke; a member cannot revoke another member's invite but the owner can; limits (10/day per account, 3 per address per circle); recipient with `notify_invites` off gets no mail but the sender gets `sent`; referral row written once for a fresh account and not for an existing member; account deletion removes its invites and referral row; export lists created invites without invitee addresses; purge nulls expired addresses and respects the cap.
- [ ] **Step 2: Run, watch fail.** `npx vitest run tests/unit/circles-join.test.ts tests/unit/circles-invites.test.ts`
- [ ] **Step 3: Implement.** **Step 4: Run** the new files, `account-export`, the worker bundle test and the whole unit suite. **Step 5: Commit** `feat: circle invites, join rules and referrals`.

### Task 2: Pages, routes, preview image, sign-up return path

**Files:** Create `app/circles/join/[token]/page.tsx`, `app/circles/join/[token]/accept/route.ts`, `app/circles/join/[token]/opengraph-image` or a route handler reusing `lib/public/template-image.tsx` styling, `app/circles/communities/page.tsx`, `app/circles/communities/join/route.ts`, `app/circles/[slug]/invite/{link,email,revoke}/route.ts`, `lib/circles/invite-web.ts`, `tests/unit/circles-invite-web.test.ts`, `tests/e2e/circle-invites.spec.ts`; modify the circle page (invite section: current link with copy-friendly text field, regenerate, email form, active email invites with revoke), the sign-up / sign-in flow to carry a validated invite return path (`lib/accounts/web.ts` / signup, keep the change minimal and tested), `playwright.config.ts` if needed.

- [ ] **Step 1: Failing unit tests (web layer):** flags off = 404; GET invite page: valid token shows name, kind, member count and the right Open Graph tags (title contains the circle name, an image URL, no email/member name anywhere), invalid token = 404 with the same body shape as every other invalid case, headers `no-store` and `no-referrer`, and a second GET changes nothing; POST accept: same-origin required, anonymous gets a redirect to sign-up carrying only the validated path, child context 403, rate limited per network; the return-path validator accepts only `/circles/join/<43-char token>/` and rejects `//evil`, `https://evil`, other paths and over-long input; invite create/revoke routes require an adult context and ignore a forged circle id.
- [ ] **Step 2: Run, watch fail.** **Step 3: Implement** (thin routes; plain semantic forms working without JavaScript; the share link shown as selectable text, no clipboard script required).
- [ ] **Step 4: E2E:** owner creates a link invite; a second signed-out visitor opens it (preview page, no member names), signs up through it, joins and sees the circle; the old link fails after regenerate; a 14-year-old confirmed account joins a friends circle through a link but is refused a community; community listing is public and shows no member names; axe at 320px and desktop on the invite page and communities page; privacy and accessibility e2e tests stay green. Run from Git Bash: `SITE_RELEASE=false npx playwright test tests/e2e/accounts.spec.ts tests/e2e/circles.spec.ts tests/e2e/circle-invites.spec.ts tests/e2e/admin-auth.spec.ts tests/e2e/site.spec.ts tests/e2e/trust-pages.spec.ts`.
- [ ] **Step 5: Commit** `feat: invite pages, communities and sign-up return path`.

### Task 3: Isolation matrix, docs, tracker

- [ ] **Step 1:** Extend `tests/unit/account-isolation.test.ts`: tampered token/circle/invite ids denied; 13-15 community denied; child profile context denied on invite and accept; account B cannot revoke account A's invite. **Step 2:** `docs/OPERATIONS.md` "Circle invites and communities" (token handling, limits, the `opens` caveat, purge, rollback of migration 015, how to revoke from the DB in an emergency); `docs/legal/data-inventory.md` rows for `circle_invites`, `referrals`, invitee address retention; tracker 4.2 and 4.9. **Step 3:** whole unit suite, `rm -rf .next/types; npx tsc --noEmit`, eslint on touched files, `npm run build`. **Step 4: Commit** `docs: invites operations and isolation rows`.

### Review fixes (4B security review, 5 November 2026)

Applied as `fix: 4B security review findings`: a site-wide cap of 3 invite emails per address per 7 days and a "never
email me invites again" link for addresses without an account (keyed address hashes, migration 017; no secret, no
invite email); no link-like text in circle names, descriptions or member names; Caddy sets `Referrer-Policy` only when
the app sent none; the sender's account row is locked for the daily cap; leaving revokes the leaver's invites; the
one-time link cookie is cleared on first view and on sign-out; invite mail has its own 60-an-hour budget.
**Ruling:** in a circle that holds a child profile only the owner creates invite links or email invites, and a member's
earlier invite stops working while a child is in the circle; revoke rules are unchanged. See OPERATIONS "Circle invites
and communities (Project 4B)".
