# SparkKindly privacy policy (draft)

> **Status: Draft for professional review. Not legal advice. Not published.**
> Prepared 4 November 2026 by the builder for the professional privacy review (spec Project 3, owner decision
> 30 October 2026). It describes the product as built, with accounts switched on. Until it is reviewed and published,
> the live privacy page stays as it is. Every section has an HTML comment naming its sources; the full table is in the
> [data inventory](data-inventory.md). Open points are in [Open questions for the professional](#open-questions-for-the-professional)
> and the [review checklist](professional-review-checklist.md).

## Who we are

SparkKindly is run by [company name and address]. You can reach us at [owner contact address].
<!-- Sources: none in the repo; owner details are deliberately not in this public repository. -->

## The short version

- You can read and play without an account. We do not store anything about you when you do.
- If you make an account, we keep your email, your date of birth, your time zone, the interests you pick and
  whether your first answer to each quiz was right.
- No ads, no analytics trackers, no outside fonts or scripts. One cookie, only to keep you signed in.
- Children under 13 cannot have an account. A parent or guardian can add a child profile with just a first name or
  nickname and an age band.
- 13 to 15 year olds need a parent or guardian to say yes by email.
- You can download everything we hold about you, and delete your account, from your settings page at any time.

## If you do not have an account

You can read, play and answer quizzes without signing up. When you check an answer, the server checks it and shows
the explanation. Nothing about your answer is saved by the app, and nothing links it to you.

If you use "Report a problem", we store which item it is about, the reason you chose, the message you type (up to
1000 characters, optional) and the time. We do not store your name, email or anything else about you. Please do not
type personal details into it.
<!-- Sources: OPERATIONS "Public site (Project 1B)" and "Interests, saved answers and /me (Project 3D)" ("Anonymous play
is unchanged and saves nothing"); db/migrations/004_problem_reports.sql. -->

## What we collect if you make an account

| What | Why |
| --- | --- |
| Your email address | to send your sign-in links and essential emails |
| Your date of birth | to work out your age group and what your account can do. We store the date, not the age group |
| Your time zone (from your browser, and you can change it) | so "today's" items match your day |
| A parent or guardian's email (13 to 15 only) | to ask for and record their consent, and so they can withdraw it |
| The topics and worlds you pick (up to 30) | to build your personal page at `/me` |
| Your first answer to each quiz or puzzle: right or wrong, and when | to show your progress. We do not keep what you answered, only whether it was right |
| Your email choices (all off unless you turn them on) | for future optional emails. None are sent yet |
| When you last signed in or used the site (to the hour) | so we only delete accounts that are really inactive |
| A coded version of your 4-digit PIN (only if you add a child profile) | to stop a child leaving their profile on a shared device. We never store the PIN itself |

We do not use passwords. You sign in with a link we email you. The link works once, for 15 minutes.

We do not collect your location, photos, contacts, browsing history or device details, and we do not build an
advertising profile.
<!-- Sources: db/migrations/007..012; lib/accounts/sessions.ts (LINK_TTL 15 min); lib/accounts/interests.ts
(MAX_INTERESTS 30); OPERATIONS 3A-3E; data-inventory.md section 1. -->

## Children under 13

Children under 13 cannot have their own account. They can take part only as a **child profile** inside a parent or
guardian's account.

- **Who can create one:** an account holder aged 18 or over who confirms they are the child's parent or guardian and
  sets a 4-digit PIN.
- **What we hold about a child:** a display name the adult chooses (we ask for a first name or nickname only), an
  age band (6 to 9 or 10 to 12), the interests picked, and for each quiz answered, whether the first answer was right
  and when.
- **What we never hold about a child:** email, date of birth, surname, photo, location, anything the child writes
  (children cannot comment), or any device identifier beyond the adult's own sign-in.
- **Who can see it:** only the adult account holder. It is never public, never in search engines and never in social
  posts. (Friend circles, where circle members would see a child's display name and scores, are planned, not yet
  available.)
- **What a child profile sees:** items meant for everyone and Kids items, never items aimed at adults.
- **Shared devices:** the adult switches to the child's profile inside their own sign-in. Getting back to the adult's
  profile or to settings needs the adult's PIN. A child profile cannot reach settings or the admin area.
- **No tracking:** for a child profile we keep only interests and answers. We do not track what a child browses.
- **Turning 13:** when the child turns 13, the adult closes the profile, which deletes it. The teen can then make their
  own account (with a parent's consent until 16). Their history is not carried over.
<!-- Sources: spec 4a.5 table; db/migrations/009_child_profiles.sql, 010_interests_responses.sql;
lib/accounts/children.ts (NAME_MAX 30, PROFILE_MAX 10); OPERATIONS 3C, 3D. -->

## Teens aged 13 to 15

You can have an account, but a parent or guardian has to say yes.

1. You sign up with your own email, your date of birth and a parent or guardian's email.
2. You open the sign-in link we send you. Then we email your parent or guardian once. That email says exactly what
   the account holds, links to this policy, and has two links: one to confirm and one to delete the account.
3. Until they confirm, your account can only do what any visitor can, plus save your interests. Your quiz answers are
   not saved yet.
4. If they have not confirmed after 7 days, we send them one reminder. If they still have not confirmed 30 days after
   you opened your first sign-in link, we delete the account and everything in it.
5. Once they confirm, we record the date and time. Your answers start being saved.

Your parent or guardian can withdraw consent at any time with the delete link in their email. That closes your account
and deletes everything in it.

Even with consent, until you turn 16 your account cannot post public comments, join public communities, contribute
content, create child profiles or have a profile page, and you never see sponsorship. (Comments, communities,
contributions and sponsorship are planned, not yet available.) Your account gets only essential emails by default.

We keep your parent's email only as the record of their consent and so they can withdraw it. When you are no longer 13
to 15, we remove their email and their links from your account.
<!-- Sources: spec 4a.5 "Teens aged 13 to 15"; lib/accounts/policy.ts (TEEN_PENDING, TEEN_CONFIRMED); lib/accounts/
consent-email.ts (CONSENT_HOLDS and wording); lib/accounts/consent-sweep.ts (7 and 30 days); lib/accounts/consent.ts
(confirm link 30 days); OPERATIONS 3B. -->

## Teens aged 16 and 17

You can have an account without a parent's consent. You cannot create child profiles (you must be 18 or over) and you
never see sponsorship (planned, not yet available).
<!-- Sources: spec 4a.5 "Teens aged 16 and 17"; lib/accounts/policy.ts (OLDER_TEEN). -->

## Your date of birth

You tell us your date of birth when you sign up. If you are under 13, we do not create an account and store nothing.
If we find an account belongs to someone under 13, we close it and delete its data.
<!-- Sources: spec 4a.5 "Age declaration"; lib/accounts/signup.ts (under_13 refused before insert). -->

## Cookies

We use one cookie, `__Host-sk_account`, only when you are signed in. It keeps you signed in and lasts up to 30 days
after you sign in. It is strictly necessary for the account to work, and it is sent on every page of the site,
including Kids pages, while you are signed in.

We use no other cookies, no analytics, no advertising cookies and no local-storage identifiers. Your browser makes no
requests to other companies while you use the site.
<!-- Sources: lib/accounts/web.ts (ACCOUNT_COOKIE, SESSION_SECONDS 30 days); OPERATIONS 3A "Session cookie";
tests/e2e/trust-pages.spec.ts (no third-party requests, no storage). -->

## Who we share data with

We do not sell your data and we do not share it for advertising. A few services help us run the site:

- **MailerSend** sends our emails (sign-in links, the parent consent email and reminder, the inactivity notice). It
  receives the recipient's email address and the email's content.
- **Our hosting provider** runs the server the site and database live on.
- **Backblaze** stores our encrypted backups. They are encrypted on our server before upload.
- **Better Stack** checks that the site is up. It sees no personal data.

Our server is located in [jurisdiction].
<!-- Sources: OPERATIONS 3A ("MailerSend's recipient records"), "Backups, restore and monitoring"; live privacy page
(hosting). Server and backup location are not recorded in the repo. -->

## How long we keep things

| What | How long |
| --- | --- |
| An account that never opens its first sign-in link | deleted after 48 hours |
| A 13 to 15 account whose parent never confirms | reminder at 7 days, deleted at 30 days |
| An account nobody uses | after 24 months without use we email a notice; if it is still unused 30 days later, we delete it and all its child profiles |
| Sign-in links | work for 15 minutes, once; removed within a day after use or expiry |
| Being signed in | up to 30 days from sign-in |
| Everything else in an active account | until you change it, or delete it or the account |
| Backups | deleted copies can stay in encrypted backups for about 30 days, and are never restored one account at a time |
<!-- Sources: lib/accounts/retention.ts (UNVERIFIED_MAX_HOURS 48, USED_TOKEN_MAX_HOURS 24); consent-sweep.ts (7, 30);
inactivity.ts (IDLE_DAYS 730, GRACE_DAYS 30); sessions.ts (LINK_TTL 15 min, IDLE_TTL 30 d, MAX_TTL 90 d);
web.ts (cookie 30 d); OPERATIONS backups (B2: hide at 30 days, delete 1 day later). See open questions 2 and 3. -->

## Your rights and how to use them

- **See and download your data:** Settings, "Export". You get one file with your account details, your interests and
  answers, and each child profile's interests and answers. Your parent's email is shown partly hidden.
- **Correct it:** change your time zone and email choices in settings. For anything else, contact us.
- **Delete it:** Settings, "Delete account". Type your email to confirm. Everything goes at once, including child
  profiles. Delete a single child profile from the child profiles page.
- **Stop emails:** every optional email will have a one-click unsubscribe link.
- **Anything else** (for example a question about your data, or a complaint): contact us at [owner contact address].
  We answer within 30 days. You may also complain to the data protection authority in [jurisdiction].
<!-- Sources: OPERATIONS 3E (export, deletion, unsubscribe); spec 4a.6 ("Privacy requests ... 30 days"). -->

## How we keep it safe

Sign-in links and session codes are stored only in a scrambled (hashed) form. The PIN is never stored, only a coded
version. The database is not open to the internet; only the site's own software and the site owner use it. Backups are encrypted. We never write email addresses, PINs or
parent emails into our logs.
<!-- Sources: migrations 007, 008, 009 headers; OPERATIONS 3A-3E, backups. Deliberately no further detail. -->

## Features that are planned, not yet available

Friend circles and scores, comments, communities, contributing content and sponsorship do not exist yet. Before any of
them launches, we will update this policy and tell you what changes.

## Changes to this policy

When we change this policy we change the date at the top. If a change affects what we collect, we will tell account
holders by email before it applies.
<!-- Note for reviewer: the email-before-change promise is a proposal; confirm the owner wants it. -->

## For parents and guardians

- **Under 13:** your child cannot have an account. You can add a child profile with a first name or nickname and an
  age band. You see everything held about it, can download it, and can delete it instantly.
- **13 to 15:** your teen signs up with your email. You get one email (and one reminder) explaining what the account
  holds. Nothing changes until you confirm; if you do nothing, the account is deleted after 30 days. Your delete link
  works at any time, even after you confirm, and removes the account and everything in it.
- **Shared devices:** a child profile cannot get back to your account or settings without your PIN. If you forget it,
  sign in again with an emailed link and set a new PIN in settings within 10 minutes.
- **What your child sees:** child profiles see only items for everyone and Kids items. There are no ads, no public
  rankings and no comments for children.
- **Questions:** [owner contact address].
<!-- Sources: spec 4a.5; OPERATIONS 3B, 3C, 3E (PIN reset within 10 minutes, lib/accounts/pin-reset.ts FRESH_MS). -->

## Open questions for the professional

1. **Is email confirmation enough as parental consent** for 13 to 15 year olds and for the guardian tick on child
   profiles (one confirmation per account, `accounts.guardian_confirmed_at`, not per child)?
2. **Backup wording.** The B2 rule hides copies at 30 days and deletes them a day later; the spec says "within 30 days".
3. **Session length.** Server sessions may slide to 90 days, but the cookie ends at 30 days; this draft says 30.
4. **Web server logs.** Whether the server's main Caddy configuration writes access logs (not shown in this repository)
   and, if so, how long they are kept; OPERATIONS assumes it does. They would hold IP addresses and sign-in links.
5. **Promise to email before changes.** Proposed here, not decided by the owner.
6. **Response time for requests.** The 30 days come from the spec's operating model; confirm it matches the law that
   applies in [jurisdiction].
7. **Lawful basis** for each purpose (account, consent record, inactivity check), which this draft does not state.
8. **Consent email lists circles.** The parent email (`lib/accounts/consent-email.ts`) lists "the friend circles they
   join or create (once you confirm)", which is planned, not yet available. Keep, or reword until circles launch?
9. **Optional emails for 13 to 15.** The spec says "only essential emails by default"; the code gives 13 to 15 accounts
   no `marketing_email` capability at all (`lib/accounts/policy.ts`), while the three notification preferences exist for
   every account. Decide which emails count as essential, optional and marketing before any optional email is sent.
10. **Last activity while a child plays.** `accounts.last_seen_at` is refreshed by any use of the session, including
    while a child profile is active, for the inactivity rule only. Confirm this fits "no browsing or behavioural
    tracking of child profiles".
