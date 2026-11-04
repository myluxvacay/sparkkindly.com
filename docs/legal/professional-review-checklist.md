# Professional privacy review checklist (draft)

> **Status: Draft for professional review. Not legal advice. Not published.**
> Prepared 4 November 2026 by the builder for the owner to hand to the privacy or legal professional (spec Project 3,
> owner decision 30 October 2026; tracker 3.11). Each item names where the facts are and the options the builder sees.
> The builder has not chosen between options; that is for the professional and the owner. Findings go back into the
> design spec (dated owner decision) and the drafts.

What to read first: [data inventory](data-inventory.md), [privacy policy draft](privacy-policy.md),
[terms draft](terms.md), [community guidelines draft](community-guidelines.md),
[go-live copy changes](go-live-copy-changes.md), and spec section 4a.5
([spec](../superpowers/specs/2026-10-30-sparkkindly-platform-design.md)).

Settings that can change by policy without a rebuild: minimum age 13, consent age 16, adult age 18
(`lib/accounts/policy.ts`, `POLICY`), and the per-age-group permissions in the same file.

## 1. Which laws apply

- **Question:** do COPPA (US), UK GDPR with the Age Appropriate Design Code, EU GDPR (including Article 8 consent ages)
  or other children's privacy or online safety laws apply, given the audience (13 to 25 first, all ages later) and
  [jurisdiction]?
- **Facts:** spec 4a.1 and 4a.5; data inventory sections 1 and 4; no country detection exists.
- **Options:** (a) one strict rule everywhere (current design: consent for all 13 to 15); (b) per-country consent ages,
  which needs country detection the design avoids; (c) raise the minimum age.

## 2. Parental consent method for 13 to 15

- **Question:** is "parent's email plus one-click confirm on a POST page" adequate consent where it is required?
- **Facts:** OPERATIONS "Parental consent (Project 3B)"; `lib/accounts/consent.ts`, `consent-email.ts`,
  `consent-sweep.ts`; the parent email lists what is held and links to the privacy page.
- **Options:** (a) keep email-plus-confirm; (b) add a stronger method (for example a small card check or ID check
  through a provider), which adds a processor and cost; (c) restrict 13 to 15 further until a stronger method exists.

## 3. Guardian confirmation for child profiles

- **Question:** is one tick per account ("I am this child's parent or guardian", `accounts.guardian_confirmed_at`,
  stamped at the first profile) enough, or is a per-child record needed?
- **Facts:** OPERATIONS "Child profiles (Project 3C)"; `db/migrations/009_child_profiles.sql`.
- **Options:** (a) keep per account; (b) per-child confirmation timestamp (a small schema change); (c) a stronger
  verification of the adult.

## 4. Date-of-birth self-declaration

- **Question:** is a self-declared date of birth acceptable, and is a neutral age screen or a retry block needed?
- **Facts:** spec 4a.5 "Age declaration"; `lib/accounts/signup.ts` (under 13 refused before anything is stored, neutral
  code in the URL); tracker 3.2 (age screen and retry block deferred to this review). There is no owner tool to close a
  member account; it would be done in the database.
- **Options:** (a) keep as is; (b) add a neutral age screen and a same-browser retry block (the retry block needs some
  browser storage, which the privacy design avoids today); (c) add an owner tool to close an account reported as under 13.

## 5. Lawful basis, including inactivity retention

- **Question:** what is the lawful basis for each purpose: the account itself, the consent record, saved answers and
  interests, and keeping an account for 24 months of inactivity before the notice?
- **Facts:** data inventory section 1; `lib/accounts/inactivity.ts` (730 days, notice, deletion 30 days later).
- **Options:** (a) contract for the account, legitimate interest for retention; (b) consent for optional features;
  (c) a shorter inactivity period.

## 6. Processors and transfers

- **Question:** which providers are processors needing agreements, and are there international transfers?
- **Facts:** data inventory section 2 (MailerSend, Backblaze B2, Better Stack, hosting provider); server location
  `[jurisdiction]` is not recorded in the repository.
- **Options:** (a) sign each provider's standard data processing agreement; (b) choose providers in a particular region.

## 7. DPIA

- **Question:** is a data protection impact assessment required (children's data, a service likely to be used by
  children)?
- **Facts:** spec 4a.5; data inventory.
- **Options:** (a) the professional prepares one; (b) the builder drafts one from the inventory for the professional to
  review.

## 8. Data protection officer or representative

- **Question:** does the owner need a data protection officer, or an EU or UK representative, given the location of
  [company name and address] and the audience?
- **Facts:** none in the repository.
- **Options:** as advised.

## 9. Cookies and storage on Kids pages

- **Question:** is the single strictly necessary sign-in cookie acceptable without a banner, including when it is sent
  on Kids pages while an adult is signed in?
- **Facts:** `lib/accounts/web.ts` (`__Host-sk_account`, HttpOnly, Secure, SameSite=Lax, 30 days); OPERATIONS
  "Session cookie"; the e2e privacy test (no third-party requests, no storage identifiers on Kids pages).
- **Options:** (a) no banner, explained in the policy; (b) scope the cookie away from Kids pages (would sign out a
  family on Kids pages); (c) a notice on first sign-in.

## 10. Children's content and moderation duties

- **Question:** what moderation and reporting duties apply now (no user content exists) and when comments, circles and
  contributions launch?
- **Facts:** spec 4a.4 (editorial policy, Kids items need owner approval), 4a.6 (urgent reports hidden on receipt, owner
  within 24 hours); [community guidelines draft](community-guidelines.md).
- **Options:** (a) review now for current content only; (b) review again before Project 4.

## 11. Points the builder found where code and documents differ

From the "Open questions for the professional" sections of the drafts, each needing a decision:

- whether the server's Caddy configuration writes access logs (repo blocks set none; OPERATIONS assumes it does);
- backup ageing: "within 30 days" versus the 30-day hide plus 1-day delete rule;
- session length: 90-day server maximum versus the 30-day cookie;
- 13 to 15 emails: "essential only by default" (spec) versus no marketing email at all (code);
- the parent consent email mentions friend circles, which do not exist yet;
- `accounts.last_seen_at` is refreshed while a child profile is active (inactivity rule only);
- `events.profile_id` exists but is unused and not covered by deletion;
- no retention period for problem reports and failed-job rows;
- no admin tool to suspend or delete a member account, although the terms draft says we may;
- Google sign-in is in the spec but not built.

## After the review

1. Record the professional's decisions in the design spec with the date (owner decision).
2. Update the drafts and the [data inventory](data-inventory.md).
3. Apply the [go-live copy changes](go-live-copy-changes.md) and their e2e assertions.
4. Only then may `ACCOUNTS_ENABLED` be set in production ([OPERATIONS](../OPERATIONS.md), "Accounts (Project 3A)").
