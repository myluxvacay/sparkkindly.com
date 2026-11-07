# SparkKindly data inventory (draft)

> **Status: Draft for professional review. Not legal advice. Not published.**
> Prepared 4 November 2026 by the builder from the repository only (migrations, code and `docs/OPERATIONS.md`).
> Every row names its source so it can be checked. Accounts are built but switched off in production
> (`ACCOUNTS_ENABLED` is not set there); this inventory describes what the code stores once they are switched on.
> Placeholders: `[company name and address]`, `[owner contact address]`, `[jurisdiction]`.

Related drafts: [privacy policy](privacy-policy.md), [terms](terms.md),
[community guidelines](community-guidelines.md), [professional review checklist](professional-review-checklist.md).
Requirements: design spec section 4a.5 and Project 3
([spec](../superpowers/specs/2026-10-30-sparkkindly-platform-design.md)); runbook:
[OPERATIONS](../OPERATIONS.md), sections "Accounts (Project 3A)" to "Settings, export, deletion and inactivity (Project 3E)".

## Who is who

- **Account holder:** a person aged 13 or over with their own account. Age groups come from the date of birth
  (`lib/accounts/policy.ts`, `POLICY = { minAge: 13, consentAge: 16, adultAge: 18 }`): 13 to 15, 16 to 17, 18 and over.
- **Child profile:** a child under 13. Never an account; only a profile inside an 18+ adult's account.
- **Parent or guardian of a 13 to 15 account holder:** gives or withdraws consent by email; has no account.
- **Anonymous visitor:** reads and plays without an account. Nothing about them is stored by the application
  except an optional problem report.
- **Site operators:** the owner (and an optional second approver) who use `/admin/`.

## 1. Database tables that hold personal data

All account tables live in the one PostgreSQL database per environment. "Account deletion" means
`lib/accounts/delete.ts`: it deletes the address's sign-in links, then the `accounts` row, which cascades every
other account table. It is used by self-service deletion, parental withdrawal, the consent sweep and the
inactivity sweep. A deleted account can survive in an encrypted backup for up to 30 days (section 3).

### `accounts` (one row per account holder)

| Column | What it holds | Why | Who can see it | Retention and deletion | Source |
| --- | --- | --- | --- | --- | --- |
| `id` | random identifier | links the account's rows | not shown to anyone; appears inside unsubscribe links | account deletion | `007_accounts.sql`, `lib/accounts/unsubscribe.ts` |
| `email` | the holder's email address | sign-in links, essential emails | the holder (export); the site operators can query the database | account deletion | `007_accounts.sql` |
| `date_of_birth` | self-declared date of birth | sets the age group and what the account may do; the age group is derived, never stored | the holder (export) | account deletion | `007_accounts.sql`, `lib/accounts/policy.ts` |
| `time_zone` | browser-reported time zone, editable; UTC if unknown | "today" means the holder's day | the holder (settings, export) | until changed, or account deletion | `007_accounts.sql`, OPERATIONS 3D/3E |
| `consent_state` | `none`, `pending` or `confirmed` | parental consent for 13 to 15 | the holder (export) | account deletion; a pending account becomes `none` when the holder is no longer 13 to 15 | `007_accounts.sql`, `lib/accounts/consent-sweep.ts` |
| `parent_email` | the parent or guardian's email (13 to 15 only) | consent record and withdrawal | the holder sees it masked (export) | cleared when the holder is no longer 13 to 15; account deletion | `007_accounts.sql`, `lib/accounts/consent-sweep.ts`, `lib/accounts/export.ts` |
| `consent_at`, `consent_reminded_at` | when the parent confirmed; when the 7-day reminder went | consent record; one reminder only | the holder (export) | account deletion (`consent_at` is kept after the parent email is cleared at 16) | `008_parental_consent.sql` |
| `verified_at`, `created_at` | when the holder first used a sign-in link; when the row was made | an unverified sign-up is deleted after 48 hours | the holder (`verified_at` in export) | account deletion | `007_accounts.sql`, `lib/accounts/retention.ts` |
| `guardian_confirmed_at` | when the adult ticked "I am this child's parent or guardian" (stamped once, at the first child profile) | record of the guardian confirmation | the holder (export) | account deletion | `009_child_profiles.sql`, OPERATIONS 3C |
| `pin_hash`, `pin_failures`, `pin_lock_count`, `pin_locked_until` | a salted scrypt hash of the 4-digit PIN and lockout counters; never the PIN | stops a child leaving their profile on a shared device | nobody (not exported, never logged) | account deletion; a PIN reset clears the counters | `009_child_profiles.sql`, `lib/accounts/pin.ts` |
| `notify_daily_set`, `notify_weekly_circle`, `notify_invites` | email preferences, all off by default | optional emails: circle invite emails are sent now (4B), so with `notify_invites` off by default only addresses without an account and accounts that opted in get them; the set-ready, re-score and weekly circle emails follow them (4D) | the holder (settings, export) | until changed, or account deletion | `011_settings.sql` |
| `inactivity_notice_at` | when the 24-month idle notice was sent | inactivity deletion | the holder (export) | cleared on sign-in; account deletion | `011_settings.sql`, `lib/accounts/inactivity.ts` |
| `last_sign_in_at`, `last_seen_at` | last email-link sign-in; when a session was last used, kept to the hour | inactivity deletion never removes an active account | the holder (export) | account deletion | `012_last_sign_in.sql`, `lib/accounts/sessions.ts` |

### Other account tables

| Table | What it holds | Why | Who can see it | Retention and deletion | Source |
| --- | --- | --- | --- | --- | --- |
| `account_login_tokens` | an email address, a sha256 hash of the sign-in token, expiry and use time | passwordless sign-in | nobody (not exported) | link valid 15 minutes, single use; expired tokens deleted daily, used tokens after 24 hours; deleted with the account (by address) | `007_accounts.sql`, `lib/accounts/sessions.ts`, `lib/accounts/retention.ts`, `lib/accounts/delete.ts` |
| `account_sessions` | session token hash, account id, created, expiry, last used, active child profile id (`active_profile_id`) | keeps a person signed in; records which profile is active on a shared device | nobody (not exported) | 30 days idle, never past 90 days on the server; the browser cookie lasts 30 days from sign-in; expired sessions deleted daily; cascades with the account | `007_accounts.sql`, `009_child_profiles.sql`, `lib/accounts/sessions.ts`, `lib/accounts/web.ts` |
| `account_consent_tokens` | account id, the parent email it was sent to, sha256 token hash, purpose (`confirm` or `withdraw`), expiry and use time | the parent's confirm and withdraw links | nobody (not exported) | confirm link works 30 days; withdraw link has no expiry until cleared when the holder is no longer 13 to 15, on withdrawal, or with the account | `008_parental_consent.sql`, `lib/accounts/consent.ts`, `lib/accounts/consent-sweep.ts` |
| `child_profiles` | display name (1 to 30 characters), age band (`6-9` or `10-12`), owning account id, created time | lets a child under 13 take part inside the adult's account | the adult account holder (pages and export); nobody else today | the adult deletes it at any time (instant, sessions on it end); closed the same way when the child turns 13; cascades with the account | `009_child_profiles.sql`, `lib/accounts/children.ts` |
| `profile_interests` | account id, profile id (empty for the holder, else one child profile), a topic id or a world id; at most 30 per profile | the personal dashboard | the holder, and the child while their profile is active (export covers both) | until changed; cascades with the profile or the account | `010_interests_responses.sql`, `lib/accounts/interests.ts` |
| `item_responses` | account id, profile id, item id, whether the first answer was correct, when, and for a closed question the response given (`choice`: an option id, true or false, a number or an order of ids; 016) | the dashboard and progress counts; circle scores (derived on read, 4C); re-marking after a corrected answer key | the holder, and the child while their profile is active (export covers both) | first answer only; cascades with the profile, the account or the item | `010_interests_responses.sql`, `lib/accounts/record-play.ts` |
| `circles` | name, kind (friends, family, community), optional community description, owner account id, time zone, open or closed, closed and hidden times, a random 10-character slug | a private group that plays together (Project 4) | its current members (name and kind); the owner (owner controls); not in any account's export as a row, since it is shared by its members | open while it has an owner; when the owner's account is deleted it passes to the longest-standing other adult member or is closed; a closed circle is deleted 30 days after closing (worker job `circles-purge`), except that a closed circle with an unhandled report is kept until the site owner marks the report handled | `014_circles.sql`, `lib/circles/`, OPERATIONS "Circles (Project 4A)" |
| `circle_members` | circle id, account id, child profile id (family circles only), the name chosen for the circle (1 to 30 characters), role, joined and left times, when the owner removed the member (`removed_at`, 015), an opaque random key the owner's forms use instead of ids (`member_key`, 015) | who is in a circle and how they are shown | the circle's current members see each other's circle names and roles, never an email; the holder (export, for their own and their children's memberships) | a left member keeps `left_at` ("former member"); cascades with the account, the child profile and the circle | `014_circles.sql`, `lib/circles/`, `lib/accounts/export.ts` |
| `circle_invites` | circle id, the creating account id, kind (`link` or `email`), sha256 hash of the token, for an email invite the invited address, created, expiry (email only), revoked and used times, the account that used it, an open count | inviting people into a circle (Project 4B) | the creator and the circle owner see active invites on the circle page (the owner without other members' typed addresses); the creator's export lists the invites they made, never the address | a link works until revoked; an email invite is single use and expires after 14 days; every invite stops when its circle closes or is hidden, and is revoked when its creator leaves or is removed; in a circle holding a child profile only the owner's invites work; **the invited address is nulled when the invite is used and by the daily purge once it is revoked or expired**; spent invites are deleted 14 days later unless a referral needs them; cascades with the creating account and the circle; pending invites to an address are deleted with that address's account | `015_circle_invites.sql`, `lib/circles/invites.ts`, OPERATIONS "Circle invites and communities (Project 4B)" |
| `circle_interests` | circle id, topic and world ids chosen by the owner | drawing the circle's daily set (Project 4C) | the circle's current members; not in any export (circle data, nothing about one person) | until changed; cascades with the circle, topic or world | `016_circle_sets.sql`, `lib/circles/interests.ts` |
| `circle_daily_sets` | circle id, day, position, item id, bonus flag | the fixed daily set of a circle | the circle's current members (re-filtered to `kids` and `all` while a child profile is in the circle); not in any export | cascades with the circle or the item (a closed circle goes after 30 days, or once its last unhandled report is marked handled) | `016_circle_sets.sql`, `lib/circles/daily-set.ts` |
| `circle_child_days` | circle id and a date; nothing about a person | keeping the days a child profile was in a circle child-safe after it leaves (4C review) | nobody on a page; not in any export (circle data) | cascades with the circle | `020_circle_child_days.sql`, `lib/circles/daily-set.ts` |
| `circle_notices` | circle id, item id, kind (`rescored`), time | telling a circle that an item in a recent set was re-marked | the circle's current account members (the time only); not in any export | cascades with the circle or the item | `016_circle_sets.sql`, `lib/circles/rescore.ts` |
| `circle_mail_log` | circle id, kind (`daily`, `weekly`, `rescore`), period (local day, Monday or notice id), when it was claimed; no address, no account | sending each circle email period exactly once (4D) | nobody on a page; not in any export (circle data) | cascades with the circle | `018_circle_mail.sql`, `lib/jobs/circle-mail.ts` |
| `circle_reports` | circle id, the reporting account id, reason (`name`, `behaviour`, `safety`, `other`), an optional note of up to 300 characters, created and handled times; never a member's contact details | moderation: the site owner reviews reports and may hide the circle (4D) | the site owner in `/admin/circles/` (counts and notes, no names or addresses); the reporter's export lists their own reports | kept while the circle exists; the reporter id is nulled when that account is deleted; cascades with the circle | `019_circle_reports.sql`, `lib/circles/reports.ts`, OPERATIONS "Circle email, reports and hiding (Project 4D)" |
| `invite_address_log` | an HMAC-SHA256 of an invited address (keyed with `UNSUBSCRIBE_SECRET`), the time an invite email went to it; never the address | the site-wide cap of 3 invite emails per address per 7 days (4B security review) | nobody on a page; not in any export (no account link) | deleted after 8 days by the daily invites purge | `017_invite_address_guard.sql`, `lib/circles/invite-guard.ts` |
| `invite_suppressions` | the same keyed hash of an address that chose "never email me invites again", and when | never sending that address an invite email again | nobody on a page; not in any export (no account link) | kept until the person asks otherwise (no self-service undo) | `017_invite_address_guard.sql`, `lib/circles/invite-guard.ts` |
| `account_trust` | account id, comment trust level (0 or 1), approved and rejected counts, banned flag, dismissed (false) report count and whether the account's reports are muted (7B), the display name chosen at the first comment (1 to 30 characters), when the community guidelines were accepted, updated time | comment trust levels and the name shown beside comments (Project 7A) | the display name: anyone reading the account's published comments; the rest: the holder (export) and the site owner in `/admin/comments/` (looked up by comment, no email) | until changed; cascades with the account | `021_comments.sql`, `lib/comments/trust.ts`, OPERATIONS "Comments (Project 7A)" |
| `comment_reports` | the reported comment, the reporter's account id (set null when that account is deleted; the report and its weight are kept), reason, optional note (up to 300 characters), urgent flag, the weight it carried (0, 0.5 or 1), created time, when it was handled and whether it was dismissed | member reports on comments (Project 7B); hide a comment at a threshold, urgent ones alert the owner (counts only) | the moderation agent (reason, note and urgent flag, never who reported); the site owner (counts and urgent reports in `/admin/comments/`); the reporter's own reports in their export | cascades with the comment; the reporter link goes when the reporter's account is deleted | `022_comment_moderation.sql`, `lib/comments/reports.ts`, OPERATIONS "Comment moderation (Project 7B)" |
| `comment_appeals` | the comment, the author's account id, optional note (up to 300 characters), filed time, outcome (`overturn` or `uphold`) and decision time | an author's appeal against the removal of their own comment (Project 7B) | the site owner in `/admin/comments/` (with the comment and the agent's reason, never the email); the author's own appeals in their export | one per comment; cascades with the comment and with the account | `022_comment_moderation.sql`, `lib/comments/appeals.ts`, OPERATIONS "Comment moderation (Project 7B)" |
| `comments` | item id, author account id, parent comment id (one level of replies), body (plain text, up to 1000 characters), status (`held`, `published`, `hidden`, `rejected`, `deleted`), a moderation reason (written by the moderation agent or the owner in 7B and emailed to the author; kept with the comment), moderation workflow times (escalated, sampled, sample reviewed) and who decided (`agent:<name>` or the administrator's address), created and updated times | public comments on items outside Kids (Project 7A); never written by a child profile | published comments: anyone, with the display name and relative time only; held ones: the author; all of the holder's own: the export (without the moderation reason) | the author deletes at any time (body emptied, row kept for its replies' place); cascades with the account, taking replies under its comments with it, and with the item | `021_comments.sql`, `lib/comments/repo.ts`, OPERATIONS "Comments (Project 7A)" |
| `contributor_profiles` | account id, a random 10-character page id, display name (1 to 30 characters), optional bio (up to 140), an optional proposed link and whether the owner approved it, when the contributor terms were accepted, created and updated times | the contributor role and the public contributor page (Project 8) | the public sees the display name, bio and (adults only, once approved) the link on the contributor page and in bylines; the holder's export | until the role holder deletes their account (cascades) | `023_contributors.sql` |
| `contributions` | account id, the item it became, state, kind, world, the contributor's own text (title, summary, sections or question and options, sources, topics), revision count, gate and reviewer reasons, the owner's notes, declaration and submission times, when the publication email was claimed | the contributor programme (Project 8) | the holder (pages and export); the site owner, the AI reviewer (text only, never the account) | cascades with the account; account deletion first archives the published items (no byline remains) and deletes never-published ones | `023_contributors.sql` |
| `referrals` | invite id, the new account id, when it joined | which invites bring new members (growth measurement) | nobody on a page; the new account's export (`joinedThroughInviteAt`) | one row per account; cascades with the account and with the invite | `015_circle_invites.sql`, `lib/circles/invites.ts` |

Not stored in `item_responses`: free text a player typed (short-text and clue answers keep no `choice`), page views,
device details. Circle scores are not stored anywhere: they are computed from these rows on each view, so deleting an
account or a child profile removes its points everywhere. A consent-pending
13 to 15 account may save interests, but its answers are not stored (OPERATIONS 3D; `lib/accounts/policy.ts`).

### Tables outside accounts that hold or could hold personal data

| Table | What it holds | Who can see it | Retention | Source |
| --- | --- | --- | --- | --- |
| `problem_reports` | item, reason, up to 1000 characters of optional free text, status, time. Nothing about the sender | site operators | no automatic deletion in the code | `004_problem_reports.sql` |
| `events` | the site's own server-side counts. Has a `profile_id` column, but today the only writer records `item_published` with no profile id | site operators | no automatic deletion in the code; **not** covered by account deletion | `001_core.sql`, `lib/jobs/publish-due.ts` |
| `admin_users`, `admin_login_tokens`, `admin_sessions`, `audit_log` | operator email addresses, sealed authenticator secrets, token hashes, admin actions | site operators | admin sessions at most 12 hours; others until removed | `005_admin.sql`, `001_core.sql`, OPERATIONS 1C |
| `failed_jobs`, `job_runs` | job names, counts and error names. The account jobs write counts only, never an address | site operators | no automatic deletion in the code | `001_core.sql`, `005_admin.sql`, `lib/accounts/inactivity.ts` |

`sponsors` and `sponsorships` (Project 6, behind `SPONSORSHIP_ENABLED`) hold sponsor names, links, categories,
dates, link text and one click count per sponsorship. No personal data: a click stores no identifier, address, cookie
or log row, and the sponsor line and redirect set no cookie and make no third-party request. Items, topics, worlds,
answers and agent tables hold content, not personal data. The Save world (7 November 2026) adds a world row
and topics only; it collects nothing new.

`social_platforms`, `distributions` and `social_visits` (Project 5A, behind `SOCIAL_ENABLED`) hold platform settings,
the posts made about published items (caption, hashtags, our own link and image URL, the platform's post id and URL,
reach, likes and comment counts, errors as an HTTP status and code) and one visit count per day, platform and item for
visits that arrive with a `utm_source` naming a platform. No personal data: no visitor identifier, cookie, address or
log row; captions never name or describe a person, and the share image carries only the item title, world and logo.
The Meta page token and ids live only in the root-owned env file on the VM and are read by the worker at call time;
they are never stored in the database. The worker sends Meta the caption and our public image and item URLs only.

`video_jobs` (Project 5B, behind `SOCIAL_ENABLED`) holds, per video script and platform, the promotion agent's brief
(narration, shots, on-screen text, captions, hashtags; no personal data), the uploaded file's server-generated name,
SHA-256, size and validation result, the caption file's name, checksum and first 20 cue texts, the owner's approval (checksum and time) and a free-text
"made by" note of up to 100 characters and a licence note (written by the owner; they may name the maker). The files
themselves live in the media folder `SOCIAL_MEDIA_DIR` (default `/opt/sparkkindly/shared/media/social/`, `quarantine/`
and `approved/`, owned by the service user, mode 0700), never in the database or the repository and never served by the
site; quarantine files are deleted after 7 days and cancelled jobs' files after 30. Videos must not show people who
have not agreed to appear. TikTok and YouTube tokens live only in the token file `SOCIAL_TOKEN_FILE` (default
`/opt/sparkkindly/shared/social-tokens/tokens.json` in a 0700 directory of the service user; staging has its own) and the root-owned env file; they are not in the database,
the export or any log. The worker sends TikTok and Google the approved video, its captions and caption file only.

## 2. Outside the database

| Where | What | Retention | Source |
| --- | --- | --- | --- |
| Session cookie `__Host-sk_account` | the session token (HttpOnly, Secure, SameSite=Lax), sent on every page including Kids pages | `Max-Age` 30 days from sign-in; cleared on sign-out and deletion | `lib/accounts/web.ts`, OPERATIONS 3A |
| In-memory rate limiters | email addresses, IP addresses or network prefixes, counts | gone when the process restarts; windows of one hour | `lib/accounts/limits.ts`, OPERATIONS 3A |
| MailerSend (email provider) | recipient address and the content of each email sent: sign-in links, the parent's consent email and reminder, the inactivity notice | set by MailerSend, not by SparkKindly (open question) | OPERATIONS 3A and 3B |
| Application logs (systemd journal on the server) | error names only, and one hourly "email budget reached" line; addresses, IPs, PINs and parent emails are never logged | the server's journal settings (not set in this repository) | `lib/accounts/*.ts` (`console.error(... err.name)`), `lib/accounts/limits.ts` |
| Web server (Caddy) | connection details (IP address, request address) while serving each request. The SparkKindly site blocks in `deploy/sparkkindly-public.caddy`, `deploy/caddy/sparkkindly-public-app.caddy` and `deploy/caddy/sparkkindly-staging.caddy` contain no `log` directive. The server's main Caddyfile is not in this repository | see open question 1 | `deploy/` |
| Encrypted database backups (Backblaze B2) | the full database, encrypted with `age` before upload | B2 lifecycle rule: hidden after 30 days, deleted 1 day after hiding; local copies on the server kept 2 days; never restored selectively | OPERATIONS "Backups, restore and monitoring" |
| Uptime monitoring (Better Stack) | pings the health endpoint and receives job heartbeats; no visitor data | n/a | OPERATIONS "Backups, restore and monitoring" |
| Hosting provider | the server that runs everything above; the live privacy page names Hostinger | n/a | `app/(trust)/privacy/page.tsx` |

## 3. Deletion paths

| Path | What it removes | Source |
| --- | --- | --- |
| Self-service deletion (`/account/settings/delete/`, typed email, adult context) | all seven account tables in one transaction | OPERATIONS 3E, `lib/accounts/delete.ts` |
| Child profile deletion (`/account/children/`) | the profile, its interests and answers; sessions on it end | OPERATIONS 3C |
| Parental withdrawal (link in the parent's email, POST on the page) | the whole account | OPERATIONS 3B |
| Consent sweep (daily) | a 13 to 15 account still pending 30 days after the holder verified; reminder at 7 days | `lib/accounts/consent-sweep.ts` |
| Unverified purge (daily) | accounts never verified within 48 hours; expired tokens; used tokens after 24 hours; expired sessions | `lib/accounts/retention.ts` |
| Inactivity sweep (daily) | after 730 days idle a notice; 30 days later the account if still idle; at most 50 notices and 20 deletions a run | `lib/accounts/inactivity.ts` |
| Backups | age out as above (up to 31 days counting the hide-then-delete rule) | OPERATIONS "Backups, restore and monitoring" |

Pending circle invites to the deleted account's address are deleted by exact address only. An invite sent to another
spelling of the same mailbox (a `+tag`, Gmail dots) stays until it expires (14 days at most) and the daily invite purge
nulls its address (Project 4 final review 8).

The export (`/account/settings/export/`) returns everything above that belongs to the account except the PIN hash
and counters, tokens, sessions and internal ids; the parent address is masked (`lib/accounts/export.ts`).

## 4. What is never collected

From spec 4a.5 and the code:

- **About a child:** email, date of birth, surname, photo, location, free text written by the child (children cannot
  comment), device identifiers beyond the adult's session. A display name that looks like an email address, is all
  digits or has control characters is refused (`lib/accounts/children.ts`).
- **About anyone:** passwords (sign-in is by emailed link only), the answer text itself, page views or browsing
  history, analytics or advertising identifiers, third-party cookies, local-storage identifiers, location.
- **From a sign-up under 13:** nothing is stored; the sign-up is refused before any row is written and the page
  address carries a neutral code, not the age (`lib/accounts/signup.ts`, `lib/accounts/web.ts`). The in-memory
  rate limiter still counts the request.

## 5. Planned, not yet available

Circles and scores (Project 4), comments and communities (Project 4 onward) and contributions (Project 8) are built
behind their flags and listed above. Sponsorship (Project 6) and social distribution (Projects 5A and 5B) are built behind their flags and store no personal data
(above). Their rows are in the tables above; a new table gets a row here before it launches.

After a contributor deletes their account, their archived contributed items keep the contributor's own text (title,
summary, body, sources) in `items` and `item_revisions`, with no byline and no account link (`created_by` and the revisions'
`changed_by` are `contributor`); this is covered by the licence granted in the contributor terms (`/contributors/terms/`).

## Owner decisions pending

- **Report notes outlive the reporter** (7B review L8). When a reporter deletes their account, their comment reports stay
  with the reporter set to null, including any note they wrote (up to 300 characters), so past hide decisions stay
  explainable. The owner may instead choose to delete a reporter's notes (or whole reports) with the account; that is a
  one-line change in `lib/accounts/delete.ts` and should be decided before comments go live.
- `comments.moderation_code` (the closed reason code) and `comments.escalation_note` (the agent's owner-only note) are
  kept with the comment and deleted with it; neither is exported (the code's sentence reached the author by email).

## Open questions for the professional

1. **Web server access logs.** OPERATIONS says the sign-in token "appears in Caddy access logs", but the SparkKindly
   site blocks in `deploy/` set no `log` directive, and the server's main Caddyfile is not in this repository. Confirm on
   the server whether access logs are written, for how long, and whether they need to be stated (they would hold IP
   addresses, the sign-in token and the parent's consent token in the URL).
2. **Parent email retention.** The parent address is kept while the holder is 13 to 15 and cleared after that, while
   `consent_at` stays. On any account deletion the whole consent record goes too. Is that the right balance between
   minimisation and keeping evidence of consent?
3. **Per-child guardian confirmation.** `guardian_confirmed_at` is stamped once, at the first child profile, not per
   child. Spec 4a.5 says the adult "confirms at creation". Is one confirmation per account enough?
4. **Self-declared date of birth.** There is no neutral age screen and nothing stops a refused under-13 from retrying
   with a different date (deferred to this review, tracker 3.2). No tool exists for the owner to close an account
   found to belong to someone under 13 other than deleting it in the database.
5. **Processors.** MailerSend (email), Backblaze (encrypted backups), Better Stack (monitoring, no personal data) and
   the hosting provider: which need processor agreements, and where each stores data.
6. **Hosting jurisdiction and transfers.** Where the server and backups are located is not recorded in this repository:
   `[jurisdiction]`.
7. **Backup ageing.** The spec and OPERATIONS say "within 30 days"; the B2 rule hides at 30 days and deletes 1 day later.
   Choose the wording for the policy (for example "about 31 days").
8. **Session length.** The server allows 30 days idle up to 90 days, but the cookie expires 30 days after sign-in, so a
   sign-in lasts at most 30 days in practice. The policy should state one number.
9. **`events.profile_id`.** Not used today, and not covered by account deletion. If a later project writes it,
   deletion and export must cover it first.
10. **Account-level activity time while a child plays.** `accounts.last_seen_at` is refreshed (to the hour) by any use
    of the session, including while a child profile is active. It exists only for the inactivity rule. Confirm this is
    compatible with "no browsing or behavioural tracking of child profiles" (spec 4a.5).
11. **Problem reports.** No retention period is set in the code for problem reports or failed-job rows.
12. **Google sign-in.** The spec lists Google sign-in; it is not built. If added, its data must be added here.
