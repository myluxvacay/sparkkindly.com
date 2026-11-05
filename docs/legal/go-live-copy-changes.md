# Go-live page-copy changes for accounts (draft)

> **Status: Draft for professional review. Not legal advice. Not published.**
> Prepared 4 November 2026 by the builder. **Not applied.** These are the changes to make to the live pages, together
> with the e2e assertions that must change with them, once the professional review (tracker 3.11) has approved the
> [privacy policy](privacy-policy.md) and [terms](terms.md) drafts and before `ACCOUNTS_ENABLED` is set in production
> ([OPERATIONS](../OPERATIONS.md), "Settings, export, deletion and inactivity (Project 3E)", "Before production").
> Replacement wording must follow whatever the professional changes in those drafts.

Pages checked: `app/(trust)/privacy/page.tsx`, `about/page.tsx`, `terms/page.tsx`, `accessibility/page.tsx`,
`contact/page.tsx`, `editorial-policy/page.tsx` and the quiz note in `components/item/PlayPanel.tsx`. Assertions are in
`tests/e2e/trust-pages.spec.ts`.

## Privacy (`app/(trust)/privacy/page.tsx`)

The simplest safe change is to replace the page's sections with the approved privacy policy, keeping the existing
"Hosting and technical logs", "Other websites" and "What this notice is not" points that remain true. Sentence by
sentence:

| Where | Current | Replacement |
| --- | --- | --- |
| Title and metadata | "Curiosity without a profile." | "Your data, kept small." (or the approved policy's title) |
| "What we collect today", first paragraph | "SparkKindly has no accounts, sign-in, comments, uploads, analytics, advertising, tracking cookies, local-storage identifiers, fingerprinting or location features. …" | "You can read and play without an account. SparkKindly has no comments, uploads, analytics, advertising, tracking cookies, local-storage identifiers, fingerprinting or location features. Your browser makes no requests to other companies' servers while you read or play: fonts, images and scripts all come from SparkKindly itself." Then the approved "What we collect if you make an account" table. |
| "Your answers" | "… Our application does not save it, and nothing links it to you. …" | "If you are not signed in, our application does not save your answer, and nothing links it to you. If you are signed in, we save whether your first answer to each item was right and when, and for a question with set options (a choice, true or false, a number, an order) which one you gave, so the answer can be re-marked if we correct a mistake. We never save anything you type in your own words. In a circle, the other members see your circle name and your points, never your answers. Like any web request, the address can appear in the web server's ordinary technical logs; see the next section." |
| "Kids and shared devices" | "… The Kids pages follow the same rules as the rest of the site: no accounts, no stored answers, no tracking and no outside requests. …" | The approved "Children under 13" section, plus: "The Kids pages make no outside requests and set no cookies of their own. If an adult is signed in, their sign-in cookie is sent on Kids pages too." |
| "Accounts are not available yet" | whole section | Replace with the approved "Teens aged 13 to 15", "Teens aged 16 and 17", "Cookies", "Who we share data with", "How long we keep things" and "Your rights and how to use them" sections. |
| "Hosting and technical logs" | "We have not yet independently reviewed how long the host and server keep logs …" | Update after the professional and the owner confirm whether access logs are written (data inventory, open question 1). |
| "What this notice is not" | "A review of child privacy … has not yet happened, and the owner has asked for it." | "This notice was reviewed by a privacy professional on [date of review]." |
| `updated` | "1 November 2026" | the publication date |

## About (`app/(trust)/about/page.tsx`)

| Where | Current | Replacement |
| --- | --- | --- |
| "What the site is today", first paragraph | "Today SparkKindly is a reading and playing site. There are no accounts, comments, scores or public rankings, and nothing to register for. You can answer a quiz or puzzle and see the explanation straight away. SparkKindly does not save your answer; the privacy guide explains what the web server can still see." | "You can read and play without an account, answer a quiz or puzzle and see the explanation straight away. If you are not signed in, SparkKindly does not save your answer. With an optional account you can pick interests and see your own page of matching items; we then save whether your first answer was right. There are no comments or public rankings. The privacy guide explains what we keep and what the web server can still see." |
| same section, second paragraph | "We plan to add optional accounts for teenagers and adults later. … None of that exists yet, and this page will change before it does." | "Accounts are for people 13 and over. 13 to 15 year olds need a parent or guardian to agree by email. Children under 13 can take part through a child profile in a parent's account." |
| "No pressure to keep up" | "… and we do not track what you do." | Keep. Still true: saved answers are the account holder's own progress, not tracking. Confirm with the professional. |
| `updated` | "1 November 2026" | the publication date |

## Terms (`app/(trust)/terms/page.tsx`)

| Where | Current | Replacement |
| --- | --- | --- |
| "No accounts, comments or submissions yet" | "These terms cover what exists today. Before accounts, comments or contributions are offered, these terms and our privacy notice will be extended and published first." | Replace with the approved terms sections "Who can have an account", "Your account and sign-in links", "Acceptable use" and "Ending your account", plus: "Comments and contributions are not available yet. Before they are offered, these terms will be extended and published first." |
| page comment | "Governing law, liability limits and a company name are owner/legal decisions and are deliberately absent" | Remove once the professional has supplied them. |
| `updated` | "1 November 2026" | the publication date |

## Quiz note (`components/item/PlayPanel.tsx`)

No change needed. The default note ("SparkKindly does not save your answer") is shown only to a visitor who cannot save
answers, where it stays true; signed-in contexts already get the "saved", "unsaved" and "before" notes.

## Accessibility, Contact, Editorial policy

No change needed. None of them mentions accounts or saved answers. The Accessibility page's statement that quizzes work
without a mouse and without JavaScript stays true for signed-in play.

## E2E assertions that must change (`tests/e2e/trust-pages.spec.ts`)

| Test | Assertion today | Change |
| --- | --- | --- |
| "no trust page offers a feature that does not exist yet" | forbids `/sign up/i`, `/create an account/i`, `/log ?in/i`, `/sign ?in/i` on all trust pages | Remove those four from the list for privacy, about and terms (the new copy names sign-in and accounts). Keep `/join (a\|the) (circle\|community)/i` and `/leave a comment/i` until Project 4. |
| "the privacy page states what is true …" | `toMatch(/no accounts/i)` | Replace with `/without an account/i`. |
| same | `toMatch(/does not save it/i)` | Replace with `/does not save your answer/i` and add `/first answer/i`. |
| same | `toMatch(/under 13 cannot have an account/)` | Replace with `/under 13 cannot have (their own )?an account/i` to match the approved wording. Keep `/13 to 15/` and `/Report a problem/`. |
| same (new) | none | Add assertions for the cookie name `__Host-sk_account`, "48 hours", "30 days" (consent and backups) and "24 months" so the retention statements cannot drift from the code silently. |
| "no page claims an answer is wholly unrecorded …" | About: `toContainText('SparkKindly does not save your answer')` | Keep if the About replacement keeps that phrase (it does above); otherwise update. The quiz-note and privacy-log assertions stay unchanged. |
| "trust pages make no third-party request and store nothing in the browser" | `context.cookies()` is empty | Unchanged: the test visits signed out. Consider a signed-in variant that expects exactly one cookie, `__Host-sk_account`. |

## Circles (Project 4A)

Before `CIRCLES_ENABLED` is set in production, the privacy page (and the approved policy) must add that members of a
circle see each other's circle names, roles and, from 4C, scores, including a child profile's display name once its
adult adds it to a family circle; that the email is never shown to other members; and that a closed circle is deleted
30 days after closing ([data inventory](data-inventory.md), `circles` and `circle_members`).

It must also say (Project 4B) that an email invite stores the invited address only until the invite is used, revoked or
expires (14 days), that the invite email names the inviter by their name in the circle, and that a `referrals` row
records which invite brought a new account ([data inventory](data-inventory.md), `circle_invites` and `referrals`).
The trust-page test's `/join (a|the) (circle|community)/i` guard stays until that copy goes live.

## Other places that point at the privacy page

- The parent consent email links to the privacy page (`lib/accounts/consent-email.ts`, `privacyUrl`). It must not be
  sent from production before the new privacy page is live: today that page says there are no accounts.
