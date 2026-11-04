# SparkKindly terms of use (draft)

> **Status: Draft for professional review. Not legal advice. Not published.**
> Prepared 4 November 2026 by the builder. It extends the live terms page (`app/(trust)/terms/page.tsx`) for accounts.
> Until it is reviewed and published, the live page stays as it is. Sources are in HTML comments.
> See also the [privacy policy draft](privacy-policy.md), [community guidelines draft](community-guidelines.md) and
> [data inventory](data-inventory.md).

## About these terms

These terms are an agreement between you and [company name and address] ("SparkKindly", "we"). By using the site you
agree to them. If you have an account, they apply to your account too. Questions: [owner contact address].

## Using the site

You may read, play and share links to SparkKindly for your own personal, non-commercial use. Please do not try to
disrupt the site, overload it, get around its limits, or copy it in bulk.
<!-- Source: live terms page, "Using the site". -->

## Who can have an account

- **You must be 13 or over** to have an account. Reading and playing need no account at any age.
- **If you are 13 to 15,** a parent or guardian must agree by email. Until they do, your account can only save
  interests. If they do not agree within 30 days of you opening your first sign-in link, the account is deleted. They
  can withdraw their agreement at any time, which deletes your account.
- **If you are 13 to 17,** you cannot create child profiles.
- **Children under 13** take part only as a child profile inside a parent or guardian's account. Only an account
  holder aged 18 or over who is the child's parent or guardian may create one.
- **Tell the truth about your date of birth.** If we find an account belongs to someone under 13, we close it and
  delete its data.
<!-- Sources: spec 4a.1 (owner decision 30 Oct 2026: 13 and over, consent for 13-15), 4a.5; lib/accounts/policy.ts
(POLICY minAge 13, consentAge 16, adultAge 18); lib/accounts/consent-sweep.ts. -->

## Your account and sign-in links

- We sign you in with a link sent to your email. It works once, for 15 minutes. There is no password.
- Keep access to your email safe: anyone who can open your email can sign in as you.
- Do not share your account. If you add child profiles, keep your 4-digit PIN to yourself so a child cannot get back
  into your account or settings.
- You are responsible for what happens under your account, including on a shared device.
<!-- Sources: lib/accounts/sessions.ts (LINK_TTL 15 min); OPERATIONS 3A, 3C. -->

## Acceptable use

Do not use SparkKindly to:

- break the law, or help someone else break it;
- harass, bully, threaten or impersonate anyone;
- collect other people's personal data, or put a child's personal details anywhere on the site;
- send automated traffic, scrape the site, or try to get around rate limits, sign-in or the PIN;
- try to reach areas or data that are not yours, or test our security without permission;
- sign up with someone else's email address.

When comments, circles and contributions launch (planned, not yet available), the
[community guidelines](community-guidelines.md) will also apply.

## Our content, AI and accuracy

- Much of SparkKindly is written with the help of AI and checked by software before it is published. An item can be
  published without a person reading it first. Anything for the Kids world waits for the site owner's approval.
- Articles, quizzes, games and ideas are for learning, enjoyment and reflection. They are not medical, legal,
  financial or professional advice. Even after our checks, content can contain mistakes. If you find one, use
  "Report a problem" on the item.
- The text, images, name, logo and badge on SparkKindly belong to SparkKindly or are used with permission. You may
  share links and short quotes for personal use. Sources we link to belong to their own authors.
<!-- Sources: live editorial policy page (app/(trust)/editorial-policy/page.tsx); live terms page. -->

## Kids

Kids activities are for children aged 6 to 9 with a responsible adult. That adult is responsible for supervision, for
following the safety notes on each activity and for what a child shares.
<!-- Source: live terms page, "Kids". -->

## No guarantees

We provide the site as it is. We do not promise it will always be available, error-free or that any feature will stay
the same. To the extent the law allows, [liability wording for the professional].
<!-- Note: liability limits are an owner/legal decision (live terms page comment; docs/CUTOVER.md). -->

## Ending your account

- **You** can delete your account at any time from Settings. It removes your account, your child profiles and
  everything in them at once. Deleted data can remain in encrypted backups for about 30 days and is never restored for
  one account.
- **Unused accounts** are deleted: after 24 months without use we email you, and 30 days later, if you still have not
  used the account, we delete it.
- **We** may suspend or delete an account that breaks these terms, or that belongs to someone under 13.
<!-- Sources: OPERATIONS 3E; lib/accounts/inactivity.ts (IDLE_DAYS 730, GRACE_DAYS 30); OPERATIONS backups. No admin
tool to suspend accounts exists yet (see open questions). -->

## Changes to these terms

We may update these terms. The date at the top shows the latest change. If a change matters for account holders, we
will tell them before it applies.

## Governing law

These terms are governed by the law of [jurisdiction]. [Courts and dispute wording for the professional.]

## For parents and guardians

- Children under 13 cannot have accounts. You can add child profiles to your own account if you are 18 or over and
  their parent or guardian.
- For a 13 to 15 year old, your email confirmation is what lets the account continue. You can withdraw it at any time
  with the delete link in our email.
- You are responsible for supervising Kids activities and for what your child does under your account.

## Open questions for the professional

1. **Suspension.** The terms say we may suspend or delete an account that breaks them. Today there is no admin tool to
   suspend or delete a member account; it would be done directly in the database. Keep the promise, or soften it until
   a tool exists?
2. **Liability and governing law.** Placeholders only; owner and professional decide.
3. **Promise to notify before changes.** Proposed, not decided by the owner.
4. **Can a 13 to 15 year old agree to terms** at all, or should the parent's confirmation also cover acceptance of the
   terms? The consent email (`lib/accounts/consent-email.ts`) does not mention the terms today.
5. **Teen restrictions.** The 13 to 15 restrictions are the builder's proposal in spec 4a.5 ("[my call]"); the owner or
   the professional may loosen or tighten them.
