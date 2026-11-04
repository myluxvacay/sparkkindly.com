# Project 3F: Draft legal and privacy documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draft, for professional privacy review, the documents the spec asks the builder to prepare for accounts: a data inventory, a privacy policy, terms and community guidelines, plus the exact page-copy changes to apply at go-live and a review checklist for the professional. Nothing is published and no page copy changes in this plan.

**Architecture:** Markdown drafts under `docs/legal/`, each marked DRAFT with a status block. Statements of fact are taken from the code, migrations and `docs/OPERATIONS.md`, never invented; every claim names its source file so the professional (and a later builder) can check it.

**Tech Stack:** Markdown only. No application code, no tests beyond a link/frontmatter/consistency check script run by hand.

**Spec:** `docs/superpowers/specs/2026-10-30-sparkkindly-platform-design.md` Project 3 "Privacy work" and section 4a.5; owner decision 30 October 2026: the owner has these reviewed by a privacy or legal professional before Project 3 goes live.

## Global Constraints

- DRAFT status on every file: "Draft for professional review. Not legal advice. Not published." The repo is public: no real names, emails, addresses, secrets or personal data in any draft; use placeholders such as `[owner contact address]`, `[company name and address]`, `[jurisdiction]`.
- Facts only from the repo: what is stored, why, for how long, who can see it. Where the code and the spec differ, say so in an "Open questions for the professional" section instead of choosing silently.
- Plain English, short sentences, a reading level suitable for 13 and over; a separate short "for parents and guardians" section.
- Accurate about what exists: no circles, comments, contributing or sponsorship yet (Projects 4 to 8). Describe them only as "planned, not yet available" where needed, and never promise features.
- Children's data statements must match spec 4a.5 exactly (what is held and never held, who can see it, deletion, retention, age-out, shared devices, teens 13 to 15 and 16 to 17).
- Existing trust pages (`app/(trust)/privacy`, `about`, `terms`) are NOT edited here. The "page copy changes" file lists the replacement text and the existing e2e assertions that will need updating (`tests/e2e/trust-pages.spec.ts`).
- Commits have no AI trailers.

## Review Focus

- Every storage claim is true of the code: tables, columns, retention numbers (48 hours unverified, 7 and 30 days consent, 24 months inactivity plus 30 days, sessions 30 days idle and 90 days maximum, backups ageing out within 30 days) match `docs/OPERATIONS.md` and the migrations.
- No document says anything the product does not do (for example "answers are not saved" must be replaced by what is true once accounts exist).
- Child and teen sections are consistent with `.claude/rules/data-isolation.md` and spec 4a.5.

---

### Task 1: Data inventory

**Files:** Create `docs/legal/data-inventory.md`.

- [ ] **Step 1:** Build the table from migrations 007 to 012 and the "Personal data held" sections of `docs/OPERATIONS.md`: for every table and personal column, what it holds, why, who can see it, retention and deletion path, source file. Include non-database locations (in-memory rate limiter maps, MailerSend recipient records, server logs: state what the repo shows, for example that the Caddy configs set no access log) and what is never collected (spec 4a.5 "never held").
- [ ] **Step 2:** Add "Open questions for the professional" (for example parent email retention, per-child guardian confirmation timestamp, DOB self-declaration, MailerSend as processor, hosting jurisdiction).
- [ ] **Step 3:** Check by script: every table created in `db/migrations/*.sql` that touches accounts appears in the inventory. Run `grep -c` style checks and record the result in the commit message body. Commit `docs: draft data inventory`.

### Task 2: Privacy policy, terms, community guidelines

**Files:** Create `docs/legal/privacy-policy.md`, `docs/legal/terms.md`, `docs/legal/community-guidelines.md`.

- [ ] **Step 1:** Privacy policy: who we are (placeholders), what we collect and why, children's and teens' data (spec 4a.5), parental consent flow, cookies (the one sign-in cookie, nothing else, no analytics), sharing (MailerSend as email processor, hosting provider), retention, rights and how to use them (settings export and deletion), security summary, changes, contact. Cite sources in an HTML comment per section.
- [ ] **Step 2:** Terms: minimum age 13 and parental consent until 16 (owner decision), accounts and sign-in links, acceptable use, content and AI disclosure (editorial policy), no guarantees, termination and deletion, governing law placeholder. Community guidelines: written now for the planned comments and circles, marked "applies when these features launch".
- [ ] **Step 3:** Run a consistency check by hand and record it: numbers in the drafts equal the code constants (`UNVERIFIED_MAX_HOURS`, consent sweep days, inactivity 730/30, session TTLs). Commit `docs: draft privacy policy, terms and community guidelines`.

### Task 3: Go-live page-copy plan and professional checklist

**Files:** Create `docs/legal/go-live-copy-changes.md`, `docs/legal/professional-review-checklist.md`; modify `docs/OPERATIONS.md` (one pointer to `docs/legal/` in the pre-go-live gate) and the roadmap tracker (3.10 status).

- [ ] **Step 1:** `go-live-copy-changes.md`: for each existing trust page that mentions accounts or answers (`privacy`, `about`, `terms`, `accessibility` if relevant, the quiz note in `components/item/PlayPanel.tsx`), the current sentence, the replacement sentence, and the e2e assertion in `tests/e2e/trust-pages.spec.ts` that must change with it. Not applied.
- [ ] **Step 2:** `professional-review-checklist.md`: the decisions that need the professional (COPPA/GDPR-K/UK Age Appropriate Design Code applicability, verifiable parental consent adequacy of the email-plus-confirm flow, DOB self-declaration, legitimate interest vs consent for inactivity retention, processor agreements, DPIA need, data protection officer/representative, cookie rules, children's content moderation duties), each with the relevant code/doc pointers and the options the builder sees.
- [ ] **Step 3:** Update the OPERATIONS pre-go-live gate and tracker. Run the link check (every relative link in the new files resolves). Commit `docs: go-live copy plan and professional review checklist`.
