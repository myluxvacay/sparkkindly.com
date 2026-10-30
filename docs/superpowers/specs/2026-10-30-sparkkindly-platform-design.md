# SparkKindly Platform: Vision, Design and Roadmap

**Date:** 30 October 2026
**Status:** Final draft for owner approval, revised through the review
conversation of 30 October 2026 and an independent review the same day
(whose points are incorporated in section 4a and throughout). Nothing in
here is built yet.
**Reader:** the site owner, and whoever builds this (a person or an agent).

Items marked **[owner decision]** still need the owner's answer. Items marked
**[my call]** are choices the author made; the owner can overturn any of them.

---

## 1. What we are building and why

SparkKindly is a site for all ages. It brings people a little daily curiosity
and kindness through five "worlds":

| World | Who it is for | What it offers |
| --- | --- | --- |
| Play | everyone | puzzles, games and challenges with explained answers |
| Discover | everyone | general knowledge, science, the world |
| Together | couples, families, friends | relationships and connection |
| Grow | everyone | motivation and personal growth |
| Kids | children about 6–9, with an adult | learning and discovery for children |

New worlds (for example Travel) will be added over time.

**The problem today.** The live site at https://sparkkindly.com is a mock-up
built to show the look and feel. It has 10 hand-written articles and 14 quiz
questions, every page is pre-built, and publishing anything means editing
files, rebuilding and uploading to the server by hand. It cannot grow.

**What the owner wants instead.** A real platform that:

1. **Fills itself.** A team of AI agents produces new content for every world
   every day: games, articles, quizzes, and later video scripts. The owner does
   not write, publish or deploy anything by hand.
2. **Knows its visitors.** A visitor picks topics they care about (say,
   physics) and gets a personal dashboard of matching items from every world.
3. **Brings people together.** Anyone can create a circle (a family, a group of
   friends, a community), invite people, pick the circle's interests, and
   compete daily on the games and quizzes. Scores are kept per circle. Invites
   are how the site grows.
4. **Promotes itself.** A daily selection of new items is posted to Facebook,
   Instagram, TikTok and YouTube, pointing people back to the site.
5. **Runs itself.** Deploys, backups, checks and alerts all happen
   automatically. The owner's only daily touch is reading a short summary and,
   optionally, approving items in a queue.

Together these are the point: a site that grows its content and its audience
without the owner's daily labour.

## 2. What we keep, what we replace

**Keep (the brand kit):** the SparkKindly name, logo and badge, the colour
palette (gold, sage, coral), the Inter and Playfair Display typefaces, the five
world icons (✳ ◎ ⌘ ↗ ☀) and their colours, and the imagery in `public/brand/`
and `public/images/`. The 10 articles and 14 quizzes are imported into the new
database as starter content.

**Replace:** everything else. The pre-built static site, the MongoDB content
workflow, the JSON content files, the deploy scripts and the trust pages are
all superseded by this design. The current "no accounts, no scores" promise on
the About page goes away with the mock-up and is replaced by an honest
description of the new platform.

## 3. Goals, non-goals, anti-goals

**Goals**

- Fresh content in every world every day, produced by agents, with quality
  checks before anything goes live.
- Reading and playing never require an account. Anyone can open any item,
  answer it and read the explained answer. An account is only for saving
  interests, joining circles, commenting and contributing.
- Worlds and topics are data in the database, not code. Adding Travel means
  adding one row and one agent goals file, with no code change.
- Personal dashboards driven by topic interests.
- Circles with invites, daily competitions and running scores.
- Social media distribution for published items.
- Respectful, moderated comments on items, so visitors can talk to each other.
- Fully automated operations: deploy on push, nightly backups, uptime and error
  alerts, a daily digest to the owner.
- Mobile-first, fast and accessible.

**Non-goals (for now)**

- Native mobile apps.
- Conventional advertising (banner or display ad units, ad networks, tracking
  pixels), payments or subscriptions. Disclosed sponsorship and affiliate
  links are permitted under the Project 6 rules; they are not advertising in
  this sense.
- Real-time chat or open forums. (Comments on items are in scope; see Project
  7. A private circle discussion board can reuse the comment machinery later.)
- Open publishing. Visitors may contribute articles and quiz questions
  through the contributor programme (Project 8), but nothing a person
  submits is published until it has passed the same checks as agent content
  and the owner has approved it. Contributed games and puzzles come later.
- Replacing MyLuxVacation's hosting or anything else that shares the VM.

**Anti-goals (these would make the project a failure even if it "works")**

- Anything that needs the owner to act every day for the site to keep going.
- Collecting personal data from children, or letting a child create an account.
- Publishing factual content that nobody and nothing has checked.
- Breaking the other site on the shared VM.
- Deploys that cannot be rolled back in one step.

## 4. Constraints

- **Hosting:** the owner's existing Hostinger VPS (`2.25.121.2`), which already
  runs Caddy, MongoDB and the MyLuxVacation site. Anything we need may be
  installed on it. Measured on 30 October 2026 (see Project 0): ample
  headroom for launch.
- **Agents run on the owner's machine** as scheduled Claude Code tasks, under
  the owner's Claude subscription. No separate AI API account is wanted. The
  agents talk to the site over the public internet through an authenticated
  endpoint.
- **No paid AI API for the site itself.** The site is a conventional web app;
  all AI work happens in the agents on the owner's machine.
- **Child privacy.** The Kids world exists, so the platform must be designed so
  that children never hand over personal data. The current launch record lists
  child privacy, media rights, hosting privacy and a contact channel as
  unreviewed; these stay on the owner's list.
- **Social platforms** each require developer-app approval before automated
  posting works. These approvals take weeks and should be started early.
- **Existing repository:** https://github.com/myluxvacay/sparkkindly.com. The
  new platform replaces its contents.

## 4a. Product and business foundations

The technical design below builds a platform. This section says who it is for
first, how we will know it is working, what it may cost, and how content,
children and day-to-day operation are kept safe. These were added after an
independent review on 30 October 2026 pointed out that the roadmap assumed
them without stating them.

### 4a.1 First audience and the one experience

SparkKindly is for all ages in the long run. A first release still needs one
group to design for and one experience to become known for, or nothing can be
measured and every feature competes for attention.

**First audience (owner decision, 30 October 2026): teenagers and young
adults**, roughly 13 to 25. Families with younger children and the Kids
world stay in the design and follow once the first audience is working.

**The one experience [my proposal]: the friends' daily challenge.** A short
set of games and discoveries each day, answered in a few minutes, with a
private scoreboard among a circle of friends. Discover and Play carry it;
Grow (motivation, direction) and Together (friendships and relationships)
give it depth that a plain quiz app lacks.

What this audience changes elsewhere in the design:

- **Social channels.** Instagram and TikTok come first in Project 5; Facebook
  and YouTube follow. Short video (Project 5B) matters more for this audience
  than for any other, which makes "who makes the videos" a nearer decision.
- **Voice.** Goals files for Discover, Play, Grow and Together are written for
  16-to-25-year-olds first: direct, not preachy, no talking down. The
  reviewer agent checks for this.
- **Circles.** Friend circles are the primary type; invite links shared in
  group chats are the main growth path, so the invite link must work well
  when pasted into WhatsApp, Instagram DMs and iMessage (good preview image
  and title).
- **Pilot.** Pilot A invites 20 to 30 people aged 16 to 25 the owner can
  reach; Pilot B is one friends' group chat.

**Account age (owner decision, 30 October 2026): 13 and over, with
parental consent for 13-to-15-year-olds.** Reading and playing need no
account at any age. The consent flow and the stricter defaults for younger
teens are set out in 4a.5 and Project 3. In short: a 13-to-15-year-old
signs up with a parent's email; until the parent confirms by email, the
account can save interests but cannot join circles, comment or contribute;
the parent can withdraw consent at any time, which closes the account and
deletes its data. **[my call]** One rule everywhere rather than a different
consent age per country (the law sets 13 in the US and UK but up to 16 in
parts of the EU); requiring consent for all 13-to-15-year-olds is the
stricter choice and avoids country detection. Whether email confirmation is
strong enough as a consent method, and what the UK and EU age-appropriate
design rules require of a service with 13-year-old members, are questions
for the professional review before Project 3 goes live. The design keeps the
minimum age and the consent age as settings so either can change by policy.

The journey the builders aim for, end to end:

1. **Discovery.** A 19-year-old sees a friend's share of today's puzzle on
   Instagram, or a link in a group chat.
2. **First activity.** They open the item, answer it without signing up, and
   read the explained answer. Under a minute.
3. **Reason to return.** They pick two or three interests (space, music,
   psychology) and see that tomorrow's items will match; or they are invited
   into a friends' circle.
4. **Invitation.** They create a circle and paste the link into the group
   chat.
5. **Shared experience.** The circle answers the daily set; the scoreboard
   and a Sunday summary keep it going without streak pressure.

What makes it distinct from a quiz app, a learning site or a social network:
it is daily and small, it mixes knowledge with motivation and relationships,
competition stays private among friends, and there are no public rankings,
streaks or ads.

### 4a.2 Pilot gate and how we will know it works

The platform rests on an assumption: people want short daily cross-world
content and will play it together in circles. That is plausible and
unproven. The review proposed validating before building anything. The
owner has already decided to replace the mock-up, and Projects 0 to 2 are
needed for any version of the site, so the gate goes where the expensive,
assumption-heavy work begins: **before Project 4 (circles)**.

**Pilot A: daily content and dashboards** (after Project 3, 3 weeks). The
owner invites 20 to 30 people aged 16 to 25 they can reach. Measured against
the thresholds below.

**Pilot B: circles without code** (runs alongside Pilot A, 2 weeks). The
owner sets up one friends' group chat, posts the link to the day's items each
day, and tallies scores by hand. This tests whether people want daily group
play before any circle code exists. If fewer than half the group answers on
at least four days a week, Project 4 is redesigned or deferred.

**Thresholds [my proposal; owner sets the final numbers]:**

| Metric | Definition | Window | Threshold to proceed | Decision it informs |
| --- | --- | --- | --- | --- |
| Activation | share of new visitors who complete one activity | per visit | 40% | is the first activity rewarding? |
| Return | share of activated visitors who come back within 7 days | 7 days | 30% | is there a reason to return? |
| Interest uptake | share of sign-ups who pick at least one interest | sign-up | 60% | do dashboards matter? |
| Circle value (Pilot B) | share of the group answering on 4+ days a week | weekly | 50% | build Project 4 as designed? |
| Invite funnel (Project 4 onward) | invites sent → opened → accepted → first activity | 14 days | 25% accepted | is the growth loop real? |
| Quality | items corrected or unpublished per 100 published | monthly | under 2 | is the editorial system working? |
| Operating effort | owner hours per week, logged | weekly | under 2 hours | does it run itself? |

The decision owner is the site owner. After the pilots, the choice is expand
as planned, change the design, or stop, recorded in this document.

### 4a.3 Business model and budget

**Objective. [owner decision]** Is the first year about impact and audience,
covering costs, or profit? **[my proposal]** Audience growth with costs
covered by sponsorship where it fits naturally; no profit target in year one.

**Sponsorship rules** (extends Project 6):

- Sponsors never see content before publication and cannot request changes.
  Sponsorship attaches to a topic, world or already-published item after the
  fact. The owner finds and approves sponsors; there is no sales team.
- Excluded categories: gambling, alcohol, tobacco and vaping, weapons, adult
  content, payday lending, cryptocurrency and get-rich schemes, supplements
  and weight-loss products, political and religious organisations, and
  anything marketed to children.
- Disclosure in plain words, next to the link, not in a footer: "SparkKindly
  earns a commission if you buy through this link" or "This topic is
  supported by X. X had no say in what we publish." The one-line "Supported
  by" label alone is not enough.

**Cost scenarios** (monthly, rough, to be replaced with real figures as
accounts are set up):

| Item | Low (launch) | Base (a few thousand members) | High (tens of thousands) |
| --- | --- | --- | --- |
| VM | existing | existing or one size up (~$20–40) | dedicated VM (~$50–100) |
| Domain and DNS | ~$1.50 | ~$1.50 | ~$1.50 |
| MailerSend | free tier | ~$30 | ~$90 |
| Backblaze B2 | free tier | free tier | ~$5 |
| Uptime and error monitoring | free tiers | free tiers | ~$30 |
| Claude plan for agents | Pro $20 | Max $100 | Max $200 |
| Human content review | owner's time | owner's time | part-time reviewer |
| Moderation | agent plus owner's time | agent plus owner's time | agent plus part-time |
| Privacy and legal review | one-off before Project 3 (owner to obtain a quote) | annual check | annual check |
| Video production | owner or family | freelancer per video | freelancer retainer |

**[owner decision]** a monthly budget ceiling and the rule for approving
anything above it. Any item in this document that would add a recurring cost
is flagged before it is built. Triggers for change: email volume approaching
the plan limit, Claude limits missed on 3 of 7 days (see Project 2), VM memory
or CPU above 70% for a week, owner hours above the 2-hour target for a month.

### 4a.4 Editorial quality and safety policy

A second AI pass and mechanical checks reduce errors; they do not prove a
claim is true. This policy sets what may be published, with what evidence,
and what happens when something is wrong. **Quality, not the daily quota, is
the release rule.** If a world cannot produce a trustworthy new item today,
it publishes fewer items or resurfaces an evergreen one, and the digest says
so. The system never pads.

**Risk tiers** (every item carries one; the server enforces the rules):

| Tier | What it covers | Rule |
| --- | --- | --- |
| Excluded | medical or health advice, legal advice, personal financial advice, safety-critical instructions, politics and religion as controversy, sexual content, violence, self-harm, anything about real private individuals | never produced; blocked-topic list on the server rejects it; goals files forbid it |
| Sourced | factual claims: Discover articles, quizzes and games with factual answers, history, science, geography, "did you know" content | every factual claim and every answer carries at least one source (a URL to a reputable reference); the reviewer agent opens each source and confirms it supports the claim; the server rejects Sourced items without sources; sources are stored with the item and shown on the page |
| Computable | puzzles and games whose answer can be verified by working it out (number puzzles, logic, word games with a defined rule) | the reviewer agent solves it independently and must reach the same answer |
| Reflective | Grow prompts, Together ideas, kindness activities: opinion and activity content with no factual claims | reviewer checks tone, safety and originality only |
| Kids | anything in the Kids world or rated `kids` | all of the above as applicable, plus owner approval before publication, always |

**Originality.** The brief gives each agent the last 30 titles and topic
counts; the server rejects near-duplicates; the reviewer rejects items that
only rephrase existing ones. An item must teach, ask or suggest something the
site does not already have. This also keeps SparkKindly clear of search
engines' scaled-content spam policies, which penalise volume without value.

**Human audit.** The weekly digest includes five randomly chosen published
items for the owner to spot-check (about 15 minutes). If the owner flags two
or more in one week, that world switches to review mode automatically until
the owner resets it. Flagged items are unpublished and the reviewer's report
for them is kept for improving the goals files.

**Correction and recall.** Every item page has a "Report a problem" link that
needs no account (rate-limited). Reports go to the owner's queue with the
item's quality report attached. Unpublishing an item also cancels any
scheduled social posts for it and marks posted ones for manual removal.
Corrected items show an "Updated on" note. Corrections to a quiz answer
re-score affected answers and notify affected circles.

**Age suitability.** The owner approves Kids items. **[owner decision]** a
named backup person who can approve Kids items when the owner is away, or
acceptance that the Kids world pauses (its buffer drains and it shows
evergreen items) until the owner returns.

### 4a.5 Child data, consent and access

The earlier draft said "no personal data from children" while also storing
display names, age bands, interests, answers and scores for child profiles.
That was a contradiction. The honest statement is: **SparkKindly holds the
minimum about a child, entered and controlled by their adult, visible only
inside the family, and never any contact detail or identifier that reaches
outside the site.** A qualified reviewer decides which laws apply to this
design (the FTC's COPPA guidance treats identifiers and linked data as
personal information, not just names and emails; GDPR has similar breadth).

| Question | Answer in this design |
| --- | --- |
| Who is a "child" here | anyone under 13: no account, only a child profile under an adult. Teens aged 13 to 17 hold their own accounts under the teen rules below |
| What is held about a child | display name (adult chooses; guidance says first name or nickname only), age band (6–9 or 10–12), interests, answers to items with correctness and time, circle memberships and scores |
| What is never held | email, date of birth, surname, photo, location, free text written by the child (children cannot comment), device identifiers beyond the adult's session |
| Who enters it | the adult creates the profile and sets name and band; the child may pick interests and answer items while the adult's session is switched to their profile |
| Who can see it | the adult account holder; members of circles the child belongs to see display name and scores only; nobody else; never public, never indexed, never in social posts |
| Consent and authorisation | the adult account holder creates and controls the profile and confirms at creation that they are the child's parent or guardian; whether this satisfies verifiable parental consent in a given jurisdiction is for the professional reviewer to confirm, and the design must be adjustable if it does not |
| Access and deletion | the adult can view and export everything held about a child profile and delete the profile instantly; deletion removes all rows; backups age out within 30 days |
| Retention | while the adult account is active; an account inactive for 24 months gets a notice and is deleted 30 days later with all its profiles |
| Events and analytics | child profile events are limited to answers and scores; no browsing or behavioural tracking of child profiles |
| Age-out | when the adult marks a child as 13 or over, the profile is closed; the teen may create their own account (with parental consent until 16); history is not transferred (simpler and avoids linking a minor's record to a new identity) |
| Shared devices | profiles are switched inside the adult's session; switching back to the adult profile, or into settings, requires the adult's 4-digit PIN set at first child-profile creation; a child profile cannot reach settings, invites or the admin area |
| Teens aged 13 to 15 (owner decision: accounts allowed with parental consent) | sign up with their own email and a parent or guardian's email; the account starts in a "consent pending" state in which it can only do what an anonymous visitor can, plus save interests; the parent receives an email that explains exactly what is collected and links to the privacy notice, and confirms with one click; consent is recorded with a timestamp; the parent's email is kept only for the consent record and withdrawal; a reminder goes after 7 days and an unconfirmed account is deleted after 30; the parent can withdraw consent at any time from a link in that email, which closes the account and deletes its data. Once confirmed: may join and create friend circles and invite; **may not** post public comments, join public communities, contribute, or create child profiles; never shown sponsorship; only essential emails by default; no profile page. **[my call]** these restrictions; the owner or the professional reviewer may loosen or tighten them |
| Teens aged 16 and 17 | may hold accounts without parental consent, comment, join and create circles, join communities, contribute and invite; may not create child profiles (that requires being 18 or over and confirming parent or guardian status); never shown sponsorship |
| Age declaration | self-declared date of birth at sign-up, as is standard; an account that is found to belong to someone under 13 is closed and its data deleted |
| Anonymous visitors | all public pages are family-safe by policy; Kids-world items never carry comments or sponsorship for any viewer; comments on other worlds are publicly readable and moderated; sponsorship appears only on items rated `adults`; there is no age gate |

### 4a.6 Operating model

"Runs itself" means: no human step is needed for the site to keep serving
good content, and the human work that remains is bounded, scheduled and
covered.

| Responsibility | Who | Response target | If missed |
| --- | --- | --- | --- |
| Kids approval queue | owner (backup: owner decision) | within 48 hours | Kids buffer drains; Kids pages show evergreen items; digest and alert say so |
| Escalated comments | owner | within 48 hours | comments on the affected item stay hidden until ruled on |
| Urgent safety report (a comment or item that could harm someone) | owner, by immediate email | within 24 hours | the reported content is hidden automatically on receipt of an urgent report |
| Problem reports on items | owner, from the digest | within 7 days | nothing breaks; the item stays live unless unpublished |
| Privacy requests (access, deletion) | self-service in settings; owner for anything else | 30 days | legal exposure; the digest counts open requests |
| Uptime or error alert | owner (and the builder during active projects) | same day | site may be down; MyLuxVacation is unaffected |
| Sponsor approval | owner | none | nothing is shown |
| Contributor submissions | owner, from the approval queue | within 7 days | submissions wait; the contributor is told the expected time |
| Parental consent emails and withdrawals | automatic; owner for anything unusual | immediate (automatic) | an unconfirmed teen account stays limited and is deleted after 30 days |
| Video jobs | the maker named in Project 5B | none | jobs queue; Part A continues |
| Weekly spot-check | owner | weekly | the digest repeats the request; after two missed weeks all worlds switch to review mode |

What pauses safely: Kids publication, comments (switch to hold-everything if
the moderation agent has not run in 48 hours), video posting, new content in
any world (the buffer, then evergreen items). What must not pause: serving
the site, backups, alerts.

If the content agents have not run for more than 3 days, the digest and an
alert say so, and the site keeps serving existing and evergreen content; this
is a degraded state, not an outage.

Target: **under 2 hours of owner time a week**, measured during the pilots
and shown in every digest.

The Claude subscription is a dependency to verify, not assume. Pro and Max
plans have session and weekly limits shared between Claude and Claude Code.
Project 2 measures real usage in its first week before the full schedule is
switched on. Fallbacks in order: reduce items per run; upgrade to Max; and,
only as an owner decision, a pay-as-you-go API key with a hard monthly cap.
The builder also confirms that scheduled headless use under a subscription is
within Anthropic's current terms before Project 2 goes live.

## 5. The shape of the system

```
 Owner's Windows machine                        Hostinger VM
 ┌───────────────────────────────┐              ┌─────────────────────────────────┐
 │ Windows Task Scheduler        │              │ Caddy (already there)           │
 │   └─ claude -p "/daily-run"   │              │   ├─ sparkkindly.com ──► web app│
 │        └─ Master agent        │   HTTPS      │   └─ myluxvacation (untouched)  │
 │            ├─ Play agent      │ ───────────► │ Web app (Next.js, Node)         │
 │            ├─ Discover agent  │  publish API │   ├─ public site + dashboards   │
 │            ├─ Together agent  │              │   ├─ /admin (owner only)        │
 │            ├─ Grow agent      │              │   └─ /api/agent/* (key-protected)│
 │            ├─ Kids agent      │              │ PostgreSQL                      │
 │            ├─ Promotion agent │              │ Worker (scheduled jobs: publish │
 │            └─ Reviewer agent  │              │   due items, scores, digests,   │
 │                               │              │   social posting, backups)      │
 └───────────────────────────────┘              └─────────────────────────────────┘
                                                      │
                                                      ▼
                                      Facebook · Instagram · TikTok · YouTube
```

**Two halves, one contract.** The site (right) is a normal web application
that stores and serves content and knows nothing about AI. The agents (left)
produce content and hand it to the site through one authenticated API. The
contract between them is a published item format and an API key per agent.
Either side can be rebuilt without touching the other.

**Worlds are rows, not code.** The site reads its list of worlds from the
database. The master agent reads the same list from the API. A new world is a
database row plus a goals file for its agent.

**The site never waits on the agents.** Agents work ahead and schedule items
for future days. The site publishes whatever is due. If the owner's machine is
off for a day, visitors see no gap.

## 6. The projects

The work is nine projects, numbered 0 to 8, in dependency order. Each one is
usable on its own when finished. Sizes are rough relative estimates, not
commitments.

### Project 0: Foundations (size: M)

Purpose: a VM, a database, a deployment pipeline and safety nets that
everything else stands on.

What gets built:

- **VM assessment** (done read-only on 30 October 2026):
  - Ubuntu 24.04.4 LTS, 2 vCPUs (AMD EPYC), 7.8 GB memory of which about
    0.9 GB is in use, 96 GB disk with 90 GB free, no swap, up 13 days,
    load near zero.
  - Running: Caddy 2.11.4 (ports 80/443), MongoDB 8.0 (loopback only), two
    MyLuxVacation Python apps (production on port 8001, beta on 8002, both
    loopback, running as their own user under `/opt`), fail2ban, ufw (only
    22, 80 and 443 open), Hostinger's Monarx security agent. The SparkKindly
    mock-up is served from `/var/www/sparkkindly` via Caddy snippets.
  - Not installed: PostgreSQL. Node 22 is installed system-wide; Project 0
    installs Node 24 (the version the project pins) alongside it.
  - 43 packages have pending updates.
  - **Verdict (an estimate until the Project 1 load test):** enough for
    Projects 0–4 at launch scale. The new app, worker and PostgreSQL together
    should use under 1.5 GB, leaving ample headroom.
    Project 0 adds a 2 GB swap file (no swap today is a crash risk under a
    memory spike), applies updates, and sets a memory limit on each new
    service. Upgrade the VM when memory or CPU stay above 70% for a week; the
    move is a scripted install, a copy of the latest release and a database
    restore. MyLuxVacation is not touched; the Caddyfile is edited only by
    adding one import line, as the existing SparkKindly snippets already do.
- **No Docker** (owner decision, 30 October 2026). SparkKindly runs the same
  way MyLuxVacation already does on this VM: plain services managed by
  systemd behind Caddy. One way of doing things on the server, nothing new
  to learn or debug.
- **PostgreSQL 16** installed from Ubuntu's own packages, listening on
  loopback only, with a dedicated database and user for SparkKindly. MongoDB
  is left running for anything else that uses it; SparkKindly stops using it.
  **[my call]** PostgreSQL over MongoDB, because the data (users, circles,
  members, answers, scores) is relational and leaderboards are plain SQL;
  flexible content bodies go in JSON columns.
- **Services.** The web app and the worker run as two systemd services under
  a dedicated `sparkkindly` user, each with a `MemoryMax` limit so a runaway
  process cannot starve MyLuxVacation. Caddy stays as the front door and gets
  one new site block for sparkkindly.com that proxies to the app's loopback
  port.
- **Releases and rollback.** Each deploy lands in
  `/opt/sparkkindly/releases/<timestamp>`; a `current` symlink points at the
  live one and the services restart. Rollback is moving the symlink back and
  restarting, the same pattern the existing `deploy/activate-public.py` uses.
  The last five releases are kept. Database changes use expand-then-contract
  migrations so a rolled-back app still works against the newer schema.
- **CI/CD.** GitHub Actions: on every push to `main`, run checks, build the
  app, copy the build to the VM over SSH into a new release directory, run
  migrations, switch the symlink, restart, run a health check, and switch
  back automatically if the check fails. Secrets live in GitHub Actions
  secrets and an environment file on the VM readable only by the
  `sparkkindly` user, never in the repository.
- **Backups.** Nightly PostgreSQL dump, encrypted, copied off the VM, with a
  30-day retention and a documented, tested restore. Destination: **Backblaze
  B2** (owner decision, 30 October 2026). The first 10 GB are free, which
  covers years of nightly database dumps at this size, it is built for exactly
  this, and the standard `rclone` tool copies to it from the VM. **[owner
  action]** create a Backblaze account and an application key for the builder
  when Project 0 starts.
- **Monitoring and alerts.** External uptime check on the public site, error
  tracking in the app, disk and backup-age alerts. Alerts go to the owner by
  email and, if wanted, phone push. **[my call]** use free tiers of hosted tools
  (e.g. UptimeRobot or Better Stack for uptime, Sentry for errors) rather than
  self-hosting monitoring on the same VM that is being monitored.
- **Transactional email** (sign-in links, invites, digests) through
  **MailerSend** (owner decision, 30 October 2026), sending from
  `hello@sparkkindly.com` as both sender and reply-to (owner decision, 30
  October 2026), so replies from visitors reach a real inbox; this also closes
  the outstanding contact-channel item from the launch record. SPF, DKIM and DMARC records are set up as part
  of this so mail is delivered.
- **Staging site** at a private address on the same VM (for example
  `staging.sparkkindly.com`, password-protected by Caddy), deployed from a
  `staging` branch as a second pair of systemd services on different loopback
  ports with its own database. New features and agent output are tried there
  first. Agents have a separate key for staging.

Done when: a push to `main` deploys to the VM in under 10 minutes with no human
step, a backup exists off the VM and has been restored once successfully, and
an intentional outage triggers an alert.

### Project 1: Platform core (size: L)

Purpose: the real site, backed by the database, with the publishing API the
agents will use.

What gets built:

- **Web app:** Next.js running as a live Node server (not a static export), so
  pages can be personal and content appears the moment it is published.
  **[my call]** Keep Next.js and React because the brand styling and components
  carry over and the team already knows them.
- **Database schema** (the heart of the platform):
  - `worlds`: slug, name, promise, description, icon, colour, display order,
    enabled flag, default agent goals.
  - `topics`: a flat list of tags (physics, cooking, kindness, …) with a parent
    topic for grouping. Items and users both reference topics.
  - `items`: one row per piece of content. Fields: world, kind (`article`,
    `game`, `quiz`, `video_script`, more later), title, slug, summary, body (a
    JSON document whose shape depends on kind), topics (many-to-many),
    `audience` (`kids`, `all` or `adults`; independent of world, so a child
    profile never sees couples content from Together. **[my call]** `adults`
    means "aimed at adults", not "adult-only": every item on SparkKindly is
    family-safe, publicly visible and indexable, and the rating only steers
    dashboards and daily sets; there is no age gate for anonymous visitors),
    `locale` (`en` for now), `evergreen` flag (may be resurfaced on dashboards
    after its day),
    `status` (`draft` → `in_review` → `scheduled` → `published`, or `rejected`,
    `archived`), `publish_at`, `created_by` (which agent or person),
    `risk_tier` (see 4a.4), `sources` (list of URLs with the claim each
    supports; required for the Sourced tier), and a `quality_report` JSON
    with the results of every check it passed.
  - `item_revisions`: every edit to an item keeps the previous version, who
    changed it and why. Only the 10 most recent revisions are kept per item
    (owner decision, 30 October 2026).
  - `events`: server-side counts of what visitors do (page view, item
    answered, invite sent, …) with no personal identifiers beyond the profile
    id for signed-in users. This is the site's own analytics; no third-party
    trackers.
  - `item_answers`: the correct answer(s) for playable items (games and
    quizzes), kept server-side so they are never sent to the browser before the
    player answers.
  - `agents`: name, world, hashed API key, enabled flag, last run, run log.
  - `audit_log`: who changed what and when, for everything in the admin area.
- **Public site:** home, one page per world, one page per item, a topic page,
  full-text search (PostgreSQL's built-in search; no separate search service).
  Fully rendered for crawlers with proper metadata, sitemap and structured
  data. URL scheme is fixed here and never changes: `/<world>/<slug>/`,
  `/topics/<slug>/`, `/me/`, `/circles/<slug>/` for English, and
  `/<lang>/<world>/<slug>/` (and so on) for every other language, with
  `hreflang` links between translations. English stays unprefixed so
  today's URLs survive. Every item page carries a "Report a problem" link
  (see 4a.4).
- **Images for items.** Agent-produced items get a branded template image
  generated by the site: title on the world colour with the world icon. This
  costs nothing and raises no rights question. Each image records its origin
  (`template`, `stock`, `generated`, `owner-supplied`) and licence in the
  database, so free stock photos (Pexels or Unsplash API) or paid AI
  generation (about 1–4 cents per image) can be switched on per world later
  without rework. Claude itself cannot produce images; it can only write
  prompts or choose from candidates. Templates confirmed as the starting point
  (owner decision, 30 October 2026); the owner wants to keep cost low for now.
  The owner's ChatGPT subscription can make one-off brand assets by hand (a
  new world's banner, for example), but it does not provide automated image
  generation; that is billed separately per image, so it is not part of the
  daily pipeline.
- **Rate limits** on the agent API, sign-up, sign-in links and invites, so a
  bug or a bot cannot flood the site or the owner's inbox.
- **Playable items** can be answered in the browser without an account (for
  Project 1 the result is shown but not stored). Correct answers are checked on
  the server.
- **What a "game" is.** **[my call, pending owner]** At launch, games are
  answer-based: the player reads a prompt and gives an answer the server can
  check. The launch set of mechanics is multiple choice, true/false, short
  text answer (with accepted variants), number or estimate (with tolerance),
  odd-one-out, put-in-order, and clue-by-clue reveal (the "one word, five
  clues" shape from the mock-up). One generic renderer handles all of these,
  so agents can mix them freely. Interactive puzzles that need their own
  screen (crossword, word ladder, memory grid, sliding puzzle) are a separate
  kind, `puzzle`, added one mechanic at a time in later work; each is code.
  The `brief` tells agents exactly which kinds and mechanics the site can
  render, and the server rejects anything else. Agents may *propose* a new
  mechanic in their run log; they cannot publish one.
- **Publish API** at `/api/agent/*`, protected by a per-agent API key sent in a
  header:
  - `GET /api/agent/brief` returns what the agent needs to plan: the world's
    goals, topics with recent counts (so it can fill gaps), the last 30 titles
    (so it avoids repeats) and how many days of scheduled items already exist.
  - `POST /api/agent/items` submits an item with a client-chosen idempotency
    key. The server validates the shape, rejects duplicates, runs its own
    checks and returns the stored item's status.
  - `GET /api/agent/items/:id` lets the agent see what happened to it.
- **Quality gates on the server** (run on every submission, regardless of who
  sends it): schema validation per kind; duplicate detection by slug and by
  title similarity against the last 90 days; a blocked-words list and a
  blocked-topics list (the Excluded tier in 4a.4); at least one source for
  Sourced-tier items, each URL fetched once to confirm it resolves; a
  reading-level check for Kids items; required fields such as an explained
  answer for every game and quiz. Failures are recorded in `quality_report`
  and the item is held as `draft` with reasons.
- **Approval policy** (owner decision, 30 October 2026). Items that pass all
  checks are `scheduled` automatically. Kids items always stop at `in_review`
  until the owner approves them; nothing for children goes out unreviewed.
  The owner can flip any other world between "auto" and "review" in the admin
  area.
- **Admin area** at `/admin`, owner only: approval queue with one-click approve
  or reject, item list with edit and unpublish, problem reports, worlds and
  topics management, agents and their keys (create, rotate, revoke), run
  history, and a daily digest page. **[my call]** Project 1 delivers the
  minimum sign-in the admin area needs: an email-link sign-in for an
  allow-list of owner addresses plus a second factor (an authenticator-app
  code), since this account can unpublish everything. Project 3 reuses the
  same email-link mechanism for visitors; the admin does not wait for
  Project 3.
- **Topics are owner-managed.** **[my call]** The topic list is a curated
  taxonomy edited in `/admin`. Agents tag items from the existing list and may
  propose new topics, which appear in the approval queue; they cannot create
  topics directly. This keeps dashboards and circle interests from fragmenting
  into hundreds of near-duplicate tags.
- **Cut-over.** **[my call]** The current mock-up stays live until Project 1
  passes its done-when checks on staging; then Caddy is pointed at the new app
  in one change, with the old static export kept for a one-step rollback.
  Before cut-over: inventory every current URL (the five world pages, ten
  item pages, `/quiz/`, `/quiz/<id>/`, `/quiz/archive/`, the trust pages,
  sitemap and robots) and either preserve or redirect each one, with the
  item URLs unchanged; record the licence of every imported image (the
  owner-supplied brand assets and the Unsplash photos) in the image-origin
  field; compare the staged site against the live one page by page; and run
  a load test on staging that doubles the expected launch traffic while
  MyLuxVacation's memory and response times are watched, since the VM
  verdict in Project 0 is an estimate until tested.
- **Daily digest.** Each morning the worker sends the owner one email: what was
  published yesterday, what is waiting for approval, what failed and why, days
  of buffer left per world, and any alerts.
- **Starter content.** Import the existing 10 articles and 14 quizzes.
- **Trust pages** rewritten for the new platform: About, Privacy, Terms,
  Accessibility, Contact, Editorial policy (which now explains that content is
  AI-assisted and how it is checked).

Done when: the owner can create an item in the admin area and see it on the
live site; a test script can publish an item through the API and watch it move
from `draft` to `published`; a Kids item stops in the queue; the digest email
arrives.

### Project 2: The agent team (size: M)

Purpose: content for every world every day, with no one writing it.

What gets built:

- **Where it lives:** an `agents/` folder in the same repository. **[my call]**
  One repository, so the agents and the item format they produce stay in step.
- **How it runs:** Windows Task Scheduler on the owner's machine runs
  `claude -p` once a day with the `/daily-run` command. **[my call]** This is
  the simplest way to run Claude Code on a schedule without an API account.
  The machine must be on and signed in at run time; the content buffer below
  covers days it is not.
- **Master agent** (`/daily-run`): reads the world list and each world's buffer
  from `GET /api/agent/brief`, decides which worlds need work today, runs one
  world agent per world (in parallel where possible), runs the reviewer on
  their output, submits approved items, retries transient failures, and writes
  a run log. It never writes content itself.
- **World agents:** one goals file per world at `agents/worlds/<slug>.md`
  describing the audience, voice, kinds of items to produce, how many per day,
  topics to favour, and what never to produce. The agent's job is to read its
  brief, pick topics with gaps, draft items in the item format, self-check, and
  hand them to the master. All world agents share one generic runner; only the
  goals file differs.
- **Reviewer agent:** a second, independent Claude pass over every drafted item
  for factual accuracy, tone, age-appropriateness, originality, and whether
  the explained answer is actually correct for games and quizzes. For
  Sourced-tier items it opens every cited source and confirms it supports the
  claim; for Computable items it solves the puzzle independently and must
  reach the same answer (see 4a.4). It returns pass or fail with reasons.
  Fails go back to the world agent once, then are dropped and reported.
- **Quality over quota.** A world agent that cannot produce an item passing
  its own check and the reviewer's submits fewer items that day. The master
  never lowers the bar to hit a count; the digest reports the shortfall and
  the site resurfaces evergreen items in the gap.
- **First-week measurement.** Before the full schedule is switched on, the
  agents run for one week on a reduced schedule while real usage against the
  Pro plan's limits is measured and the subscription terms for scheduled use
  are confirmed (see 4a.6).
- **Buffer rule:** every world keeps at least 3 days of scheduled items ahead.
  **[my call]** 3 days; the owner can change it per world in the admin area.
- **Usage budget.** The daily run is measured (items produced, time taken,
  Claude usage) and logged to the API. Each world has a maximum number of
  items per run so one world cannot consume the whole subscription's limit.
  If the subscription's rate limit is hit, the master stops cleanly and the
  digest says so; the buffer covers the gap.
- **Run shape and the Claude plan.** The agents start on the owner's **Pro**
  plan (owner decision, 30 October 2026), which the owner can raise to Max 5x
  or 20x if needed. On Pro, one run cannot be expected to cover five worlds
  plus review and promotion, so the schedule starts as **several small runs
  spread across the day** (for example two worlds per run, three runs a day,
  plus a short run for promotion and moderation). The master takes a list of
  worlds to work on, and Task Scheduler holds several entries. The reviewer
  always reviews every item; it never samples. If the plan cannot sustain
  that, the per-world item counts come down, not the review. The run log
  records how often the plan's limit is hit; the digest recommends an
  upgrade when any world has missed its buffer target on 3 of the last 7
  days. That is the signal to move to Max, not a guess made now.
- **Adding a world:** add a row in `/admin`, create `agents/worlds/<slug>.md`,
  create an agent key. Nothing else.
- **Video scripts** are produced as a kind of item from the start, so Project 5
  has material; they are not shown on the site until there is a video.

Done when: the scheduled task has run unattended for seven consecutive days,
each world has had at least one new item per day, Kids items appeared in the
queue, and a "Travel" world was added as a test with no code change.

### Project 3: Accounts and personal dashboards (size: M)

Purpose: visitors say what they care about and the site shows them that.

What gets built:

- **Accounts for people 13 and over** (owner decision, 30 October 2026).
  Passwordless sign-in by email link, plus Google sign-in. **[my call]** No
  passwords to leak or reset. A date-of-birth check at sign-up sets the
  account's age group. Under 13: no account (see child profiles). 13 to 15:
  the parental-consent flow in 4a.5, and the younger-teen restrictions,
  until the account holder turns 16. 16 and 17: full members except for
  creating child profiles and seeing sponsorship. 18 and over: everything.
  The minimum age, the consent age and the per-age-group permissions are
  settings, not scattered logic, so the professional review can change them
  by policy, not by rebuild.
- **Child profiles.** Anyone under 13 takes part only as a child profile
  inside an adult's account: display name and age band only (6–9 or 10–12),
  no email, no surname, no date of birth. The age band decides what the
  profile sees: Kids-world items are written for 6–9; every band also sees
  items rated `all`; no band sees `adults`. Children never sign up and never
  provide any contact detail or identifier; what is held about a child
  profile, who can see it, and how it is deleted are set out in 4a.5.
  Creating a child profile requires an account holder aged 18 or over who
  confirms they are the child's parent or guardian, and sets a 4-digit PIN
  that guards switching back to the adult profile and into settings on a
  shared device. Marking a child as 13 or over closes the profile; the teen
  may open their own account. **[my call, pending owner]** This is the model
  that keeps the Kids world viable without collecting children's data.
- **Interests.** A profile picks topics and worlds. The dashboard at `/me`
  shows today's and recent items matching those interests across all worlds,
  what the profile has answered, and streak-free progress (no pressure
  mechanics; that is a brand choice from the mock-up worth keeping).
- **Stored answers.** Answers to playable items are saved per profile, with
  correctness and time. This is the raw material for Project 4.
- **Notification preferences** are part of the profile from the start (daily
  set ready, weekly circle summary, invites), even though only sign-in and
  invite emails are sent in this project. Sending the rest comes with Project
  4. Every email has a one-click unsubscribe.
- **Time zone** is stored per account (detected from the browser, editable), so
  "today" means the user's day, not the server's.
- **Privacy work.** Privacy policy and terms updated for accounts; data export
  and account deletion from the settings page; cookie approach (sign-in cookie
  only, no tracking). The builder drafts the privacy policy, terms, community
  guidelines and a data inventory (what is stored, why, for how long, who can
  see it); the owner has them reviewed by a privacy or legal professional
  before this project goes live (owner decision, 30 October 2026).

Done when: an adult can sign up, pick interests, see a personal dashboard,
create a child profile, and delete their account and all its data; a
14-year-old can sign up, is held at "consent pending" until the parent's
confirmation arrives, and is then able to join a friend circle but not to
comment; the parent's withdrawal link closes the account and removes its
data.

### Project 4: Circles, competitions and invites (size: L)

Purpose: people bring their people, and compete together every day.

What gets built:

- **Circles.** A signed-in account holder creates a circle with a name and a
  type (friends, family, community). Friend circles are the primary type for
  the first audience. Child profiles can be added to a family circle by their
  adult. Circles have an owner and members.
- **Circle rules** (decided here so they are not invented during
  implementation; all **[my call]**): the owner can remove a member,
  transfer ownership to another adult member, or close the circle; a closed
  circle's scores are kept for 30 days then deleted. Invite links can be
  revoked and regenerated at any time; email invites are single-use and
  expire after 14 days; shareable links stay valid until revoked. A family
  circle may include any adult the owner invites; every member of a circle
  sees the display names and scores of every other member, including child
  profiles, which is the point of a circle, so the circle owner is told this
  before adding a child. When a member leaves, their past contributions stay
  in the circle's historical tallies as "former member"; when an account is
  deleted, its individual answer rows are removed and circle totals are
  recomputed. One answer per item per profile; no changes after submitting.
  Ties share a rank. If a corrected quiz answer changes results, affected
  answers are re-scored and the circle is notified. If a circle's chosen
  topics have too few suitable items on a given day, the set is filled from
  its chosen worlds, then from any world, with those items labelled "bonus".
  There are no prizes, so cheating has little reward; the private
  scoreboard and the "former member" rule are the only safeguards.
- **Invites.** Shareable invite link and email invites. Invite links carry a
  referral so growth can be measured, and render a good preview image and
  title when pasted into WhatsApp, Instagram DMs, iMessage and similar.
  Public communities are listed and joinable; families and friend circles
  are invite-only.
- **Circle interests.** The circle picks worlds and topics. Each day the circle
  gets a "daily set" of playable items drawn from the day's published items that
  match its interests. A circle's "day" follows the circle's time zone (set by
  its owner, defaulting to the owner's own), so members in different countries
  compete on the same set.
- **Child-safe sets.** If a circle contains any child profile, its daily set
  only includes items with audience `kids` or `all`.
- **Member notifications.** Daily "your set is ready" and a weekly circle
  summary by email, according to each member's preferences from Project 3.
- **Competitions.** Members answer the daily set. **[my call]** Scoring is
  correctness only: 10 points for a correct answer, nothing for speed. The
  earlier draft had a bonus for answering within the first hour of the set
  appearing; the review pointed out that this rewards being awake at the
  right time, not solving quickly, and a time-spent bonus would penalise
  slower readers and assistive-technology users, so speed scoring is out at
  launch. Daily, weekly, monthly and all-time tallies per circle; per-member
  and whole-circle totals; the owner can tune point values in `/admin`.
- **Leaderboards** are visible only inside the circle. No site-wide public
  leaderboard of individuals. **[my call]** This keeps children's activity
  private to their family and avoids pressure mechanics.
- **Growth loop.** After answering, members are prompted to invite someone or
  share the day's game (a share image with the SparkKindly brand and no
  personal data). A `referrals` table tracks which invites brought new members.
- **Moderation.** Circle names and community descriptions pass the blocked-words
  check; the owner can hide a circle from `/admin`; members can leave and
  report.

Done when: a family of four with two child profiles can play the daily set,
see their circle's scores, and a friend joins through an invite link.

### Project 5: Social media distribution (size: L, in two parts)

Purpose: every published item is promoted where people already are, pointing
back to the site.

**Part A: text and image posts (Instagram first, then Facebook).** Instagram
leads because it is where the first audience is; Facebook follows at low
cost since both use the same Meta tooling.

- **A daily selection, not every item.** **[my call]** Several worlds producing
  several items a day would mean tens of posts per platform per day, which the
  platforms cap (Instagram allows about 25 API posts per account per day) and
  audiences read as spam. Each platform gets a daily cap in `/admin` (starting
  points: Facebook 3, Instagram 2, TikTok 1, YouTube 1). The worker picks
  that day's items by rule: rotate through worlds so each gets a turn, prefer
  playable items (they invite participation), prefer items whose topics are
  currently popular on the site, never pick Kids items for social. Items not
  picked are recorded as `skipped` with the reason, so nothing is silently
  lost and the owner can hand-pick in `/admin`.
- A **promotion agent** in the daily run writes, for each selected item, a
  platform-appropriate post: caption, hashtags, and a branded share image
  generated from a template (title, world colour, logo).
- The **worker on the VM** posts them through the Meta Graph API using stored
  page tokens, at a configurable time per platform, and records the post URL
  and later basic metrics (reach, clicks) in a `distributions` table.
- UTM links on everything so the site can see what each platform sends back.

**Part B: short video (TikTok, YouTube Shorts; YouTube long-form later).**

- The world agents already produce `video_script` items. **[owner direction,
  30 October 2026]** The owner prefers that videos be made by a person or a
  tool working from the agent's material and then attached, rather than a
  paid AI video service. Part B is therefore a **video jobs queue**:
  - The promotion agent turns each selected script into a complete video
    brief: narration script, shot list, on-screen text, caption and hashtags
    per platform, and the branded assets (logo, colours, template frames).
  - The brief appears as a job in `/admin` and, optionally, in a shared
    folder or a Canva design. Whoever makes the video (the owner, a family
    member, a hired editor, or a tool such as Canva, which has a connector
    this environment can use once authorised) produces it and uploads the file
    to the job.
  - The worker then posts it to TikTok and YouTube automatically, exactly as
    Part A posts text, and records the result.
  - No connector available here produces finished videos automatically; if
    that changes, it slots into the same queue as another "maker".
  **[owner decision, before Part B]** who the maker is.
- Posting via the TikTok Content Posting API and the YouTube Data API, with the
  same `distributions` tracking.

Prerequisites the owner must start early, because each takes weeks. SparkKindly
accounts already exist on all four platforms (owner, 30 October 2026) and the
owner will share access when needed. Still to do: a Meta Business account, a
Facebook Page, an Instagram professional account linked to it, and a Meta
developer app with review for posting permissions; a TikTok developer app with
Content Posting approval (posts stay private until approved); a Google Cloud
project with the YouTube Data API and, if more than about 6 uploads a day are
wanted, a quota increase.

Done when: the day's selected items are on Instagram and Facebook by the
configured time with working links back, items not selected show as skipped
with a reason in `/admin`, and (Part B) once a finished video file is
attached to a job, it is posted to TikTok and YouTube with no further human
step. The making of the video itself is human or tool work by design.

### Project 6: Light sponsorship (size: S, any time after Project 1)

Purpose: a quiet way for a sponsor or affiliate to support a piece of content,
without turning SparkKindly into an ad-filled site.

The owner's example: a Grow article about personal finance has a sponsor, shown
as a small "Supported by …" line, and nothing more.

Rules (design constraints, not options):

- **One line, one place.** At most one sponsor line per page, in a fixed
  position (under the title or at the end of the piece), in the site's own
  typography and colours. No banners, pop-ups, interstitials, auto-playing
  media or sidebar ad units.
- **No third-party ad scripts.** Sponsorship is a row in our database rendered
  by our own code. This keeps the no-trackers privacy promise intact.
- **Clearly labelled, in plain words, next to the link.** "SparkKindly earns
  a commission if you buy through this link" or "This topic is supported by
  X. X had no say in what we publish." A bare "Supported by" or "Affiliate
  link" label is not enough; a disclosure page explains the whole
  arrangement; affiliate links carry `rel="sponsored"`.
- **Only on content aimed at adults.** A sponsor line appears only on items
  rated `adults`, never on `kids` or `all` items, never to a child profile or
  to an account holder under 18, and never in a circle that contains a child
  profile. This also covers anonymous visitors: a child browsing without an
  account cannot meet sponsorship on any page meant for them.
- **Independence and exclusions.** Sponsors never see content before it is
  published and cannot ask for changes; the excluded categories and the
  approval rule are in 4a.3.
- **Relevance required.** A sponsorship attaches to a topic, a world or a
  specific item; it does not follow users around.

Data model (created in Project 1 so item pages have the slot from the start):
`sponsors` (name, link, logo, disclosure text, active dates) and
`sponsorships` (sponsor, target item/topic/world, start and end, label text,
click count).

Admin: create sponsors, attach sponsorships, see clicks. No self-serve sponsor
portal; the owner manages this.

Done when: the owner attaches a sponsor to a Grow topic in `/admin` and the
line appears on matching adult-audience items, with clicks counted, and does
not appear to a child profile.

### Project 7: Comments and moderation (size: M, after Project 3)

Purpose: let visitors respond to items and to each other, respectfully and
with their privacy intact, without creating a moderation job for the owner.

What gets built:

- **Who can comment.** Signed-in account holders aged 16 and over (the
  13-to-15 rules in 4a.5 exclude public comments for younger teens). Child
  profiles never post comments and never see them:
  on any page viewed by a child profile the comment section is absent.
  Anonymous visitors can read published comments on non-Kids items but not
  post; Kids items never carry comments for anyone.
- **Where.** Any published item can have comments; the owner can turn comments
  off per world or per item in `/admin`. **[my call]** Comments are on by
  default for Play, Discover, Together and Grow, and off by default for Kids
  (adults may still want to discuss Kids items; the owner can turn it on).
- **Shape.** Plain text, length-limited, one level of replies, display name
  and relative time only. No avatars, no profile links, no likes or vote
  counts (no pressure mechanics). Authors can edit within 15 minutes and
  delete at any time; deleting an account removes its comments.
- **Trust levels, not a queue for everything.** **[my call]** Every new
  account starts at trust level 0: its comments are held until the moderation
  agent approves them. After five approved comments with no rejections the
  account moves to level 1: comments publish immediately once the server's own
  checks pass. A rejection drops the account back a level; the owner can set a
  level by hand or ban an account. Links are not allowed below level 1 and
  are shown as plain text above it.
- **Server checks on every comment** (mechanical, instant): blocked-word list,
  length, rate limit per account, duplicate detection, link policy by trust
  level.
- **Reporting.** Any signed-in account holder can report a comment with a
  reason. Two reports from different accounts hide the comment until the
  moderation agent reviews it; reports are weighted by the reporter's trust
  level so a group of brand-new accounts cannot hide comments at will, and
  repeated false reports lower the reporter's trust. An **urgent** report
  option (someone may be in danger, or a child is identifiable) hides the
  comment immediately and emails the owner at once (see 4a.6).
- **Appeals.** A rejection email includes a reply-to-appeal path; appeals go
  to the owner's queue with the moderation agent's reasoning attached, and
  the author is told the outcome. Response targets are in 4a.6.
- **Trust levels are an experiment**, not proof that a member is safe: the
  five-approval threshold is a starting value, the owner can change it or
  drop a member's level at any time, and the agent still reviews a random
  sample of level-1 comments after publication.
- **Moderation agent.** A new agent in the daily run (and in the short
  mid-day run) fetches held and reported comments through the agent API,
  judges them against the community guidelines page, and approves, rejects
  with a private reason to the author, or escalates to the owner when unsure.
  Escalations and a count of actions appear in the digest. The owner never has
  to read a comment unless the agent escalates it.
- **Community guidelines** page written in plain language: be kind, no
  personal attacks, no personal information about yourself or others, no
  advertising, keep it relevant. Shown at first comment and linked from every
  comment form.
- **Data model.** `comments` (item, profile, parent, body, status
  `held`/`published`/`hidden`/`rejected`/`deleted`, moderation report),
  `comment_reports` (comment, reporter, reason), `profile_trust` (level,
  approved count, rejected count, banned flag). Terms of use updated to cover
  user comments and their removal.

Done when: a new account's first comment is held and then published by the
moderation agent with no owner action; a level-1 account's comment appears
instantly; two reports hide a comment; a child profile sees no comments
anywhere; the owner receives only escalations.

### Project 8: Contributors (size: M, after Project 3)

Purpose: let people who want to write for SparkKindly submit articles and
quiz questions, publish the good ones with credit, and keep the same quality
bar as agent content. Contributors who are proud of their piece share it,
which is another growth path.

What gets built:

- **Who can contribute.** Account holders aged 16 and over (13-to-15 rules
  in 4a.5 exclude contributing). A contributor turns the role on in their
  settings, accepts the contributor terms, and provides a display name and
  an optional one-line bio. **[my call]** No separate application step; the
  review of their first submissions is the application.
- **What can be submitted.** Articles and answer-based quiz questions, in
  any world except Kids at first (Kids content stays agent-plus-owner until
  the programme has earned trust). Games and puzzles come later, when the
  puzzle kinds exist.
- **How a submission works.** A simple editor in `/me/contribute`: title,
  world, topics from the curated list, body, sources for every factual claim
  (required for the Sourced tier, exactly as for agents), a declaration that
  the work is the contributor's own and does not include anything they lack
  the rights to, and the licence grant below. Up to three submissions may be
  pending at once.
- **The same pipeline as agent content.** A contributed item is an `item`
  like any other, with `created_by` pointing at the person. It passes the
  server's gates (schema, duplicates, blocked topics and words, sources
  resolve), then the reviewer agent (facts and sources, tone, originality,
  and a best-effort plagiarism check that searches the web for distinctive
  sentences; this is not a guarantee), then **owner approval, always**, for
  contributed items. The owner can request changes with notes; the
  contributor revises and resubmits; rejections carry a reason.
- **Credit.** A published piece shows "By <display name>" and links to a
  contributor page listing their published items, bio and, if they supplied
  one and the owner approved it, a single external link. Contributors get an
  email when a piece is published, with a share link. Items keep their
  byline when promoted on social media.
- **Rights.** The contributor keeps copyright and grants SparkKindly a
  non-exclusive, perpetual licence to publish, edit for clarity, translate
  and promote the piece with attribution; they can ask for a piece to be
  unpublished at any time, and it is, within the problem-report response
  time. Sponsorship may appear on contributed items under the Project 6
  rules; the contributor terms say so plainly. **[owner decision]** whether
  contributors are ever paid; the design assumes credit only.
- **Trust and abuse.** Contributor trust levels mirror comment trust:
  repeated rejections for plagiarism or rights problems remove the role;
  the owner can remove it at any time. Rate limits on submissions.
- **Minors.** Contributors aged 16 and 17 appear under display name only,
  with no bio link.

Done when: a contributor submits an article with sources, the reviewer flags
a missing source, the contributor fixes it, the owner approves from the same
queue used for Kids items, the piece appears with a byline and on the
contributor's page, and the contributor receives the publication email.

## 7. Cross-cutting concerns

**Content quality and safety.** Three layers, in order: the world agent's own
self-check against its goals file; the independent reviewer agent; the server's
mechanical gates. Every published item keeps its quality report, so a complaint
can be traced to what was checked. Kids content additionally waits for the
owner. Any item can be unpublished from `/admin` in one click, and the
unpublish is instant because pages are served live.

**Privacy and law.** Accounts from age 13, with parental consent and tighter
defaults until 16 (4a.5). Children under 13 exist only as profiles under an
adult, with the minimal data set out in 4a.5. No analytics trackers; the
site measures itself with its own server-side counts. A data-protection and
child-privacy review by a qualified person is an owner responsibility before
Project 3 goes live; this document does not replace it.

**Operations.** The end state is: push code → it deploys; agents run → content
appears; the night passes → a backup exists; something breaks → the owner gets
an alert; every morning → one digest email. Every scheduled job (publishing due
items, scoring, digests, backups, social posting) runs in the worker on the VM,
not on the owner's machine. The owner's machine only hosts the content agents.
Who does the remaining human work, and how fast, is in 4a.6.

**Technical acceptance criteria** that every project is held to:

- *Recovery.* Acceptable data loss is 24 hours (nightly backup) at launch;
  acceptable outage is 4 hours. A restore into a scratch database runs
  automatically every month and compares row counts; a failed restore is an
  alert. Hourly incremental backups become a trigger item once circles hold
  real scores.
- *Job reliability.* Every scheduled job is safe to run twice (idempotent),
  retries three times with increasing delay, and lands in a `failed_jobs`
  table that raises an alert. Publishing, email and social posting all go
  through this.
- *Security.* One key per agent, rotated every 90 days from `/admin` and
  revocable instantly; admin sign-in needs an email link and an
  authenticator code; every admin action is in the audit log; secrets live
  outside the repository; a written incident procedure covers revoking keys,
  rotating secrets, restoring from backup and telling affected members.
- *Release safety.* Staging runs the migration and the rollback together on
  every deploy; a file rollback without a schema rollback is never relied on
  (expand-then-contract migrations make the older release work against the
  newer schema).
- *Accessibility and performance.* Target: WCAG 2.2 AA, checked by automated
  tests in CI and by keyboard and screen-reader runs on each project's main
  flows, on a mid-range Android phone and an iPhone. Core Web Vitals in the
  "good" range on a throttled mobile connection for the home, world, item
  and dashboard pages.

**What the owner still does.** Read the digest. Approve Kids items (a
standing decision; changing it would be a separate, recorded decision). Spot-
check five items a week. Rule on the rare comment or appeal the moderation
agent escalates. Act on alerts. Occasionally add a world or edit a goals file.
Under two hours a week in total, measured.

**Measuring success.** The pilot metrics in 4a.2 (activation, return,
interest uptake, circle value, invite funnel, quality, operating effort) are
the measures that matter, each with its window and the decision it informs.
The operational counters (items per world per day, buffer days, items held
and why, social posts and the visits they bring) support them. All shown in
`/admin`.

**Cost.** The owner wants to keep cost low for now. VM (existing; may need an
upgrade), domain, MailerSend (free tier covers roughly 3,000 emails a month,
enough until circles grow), monitoring (free tiers), item images (free
templates), social posting (free APIs), video generation (free if self-built,
otherwise a monthly fee). The Claude subscription the owner already has covers
the agents. No per-request AI cost in the site. Any item that would add a
recurring cost is flagged as an owner decision before it is built.

## 7a. Planned now, built later

These are designed into the data model and structure from the start because
adding them afterwards would mean reworking existing data. None of them is
built in full until the project that needs it.

| Planned now | Built in | Why now |
| --- | --- | --- |
| `audience` on every item | Project 1 | child profiles must never see adult content; retrofitting ratings to thousands of items is unreliable |
| `locale` on items and a URL scheme that allows other languages (English only at launch; more languages are planned, not speculative) | Project 1 | a second language later would otherwise mean a URL migration |
| Item revisions (last 10 kept) | Project 1 | lost history cannot be recovered |
| Sponsorship slots in the data model (see Project 6) | Project 1 schema, Project 6 UI | a sponsor line has to be designed into the item page, not bolted on |
| Server-side events table | Project 1 | metrics need history from day one |
| Notification preferences on profiles | Project 3, sent from Project 4 | avoids a consent problem when sending starts |
| Time zone per account and per circle | Projects 3 and 4 | "today" must mean the same thing for everyone in a circle |
| Staging site | Project 0 | agent output and new features need a safe place to be tried |
| Rate limits | Project 1 | abuse protection is far harder to add once real users exist |
| Image origin recorded per item | Project 1 | media rights is an open review item |
| Usage budget per agent run | Project 2 | the subscription has limits; discovering them in production is worse |

**Monetisation stance (owner decision, 30 October 2026):** light sponsorship
and affiliate links are allowed, but they must be subdued and never overwhelm
the content. See Project 6 for the rules this implies.

## 8. Decisions I made (please check these)

1. PostgreSQL replaces MongoDB for SparkKindly.
2. Next.js stays, but as a live server, not a static export.
3. (Now an owner decision: no Docker.) Plain systemd services on the existing
   VM, matching how MyLuxVacation runs; Caddy stays as the front door;
   releases in timestamped directories with a `current` symlink.
4. GitHub Actions deploys on push to `main`, with automatic rollback.
5. Agents live in the same repository under `agents/`.
6. Agents run via Windows Task Scheduler calling `claude -p`.
7. Items that pass all checks publish automatically; Kids items wait for
   approval; the owner can switch any world between auto and review.
8. Every world keeps a 3-day buffer of scheduled content.
9. Account holders sign in without passwords (email link or Google);
   children under 13 are profiles under an adult, never account holders.
10. Leaderboards are visible only inside a circle; no public individual
    rankings.
11. Scoring: 10 points per correct answer plus up to 5 for speed.
12. Monitoring uses hosted free tiers rather than self-hosted tools.
13. Video scripts are produced from day one so Project 5 has a backlog.
14. Every item carries an audience rating independent of its world.
15. (Now an owner decision.) Item images are branded templates generated by
    the site; stock or AI-generated images can be enabled per world later.
16. A password-protected staging site on the same VM, deployed from a
    `staging` branch.
17. Full-text search uses PostgreSQL, not a separate search service.
18. Sponsorship is one labelled line per page, rendered by our own code, never
    shown to children, attached to topics, worlds or items rather than to
    people.
19. `audience: adults` is a relevance label, not an age gate; all content is
    public and indexable.
20. Launch games are answer-based mechanics on one generic renderer;
    screen-based puzzles are a later kind, added one at a time.
21. Topics are an owner-curated list; agents tag from it and propose
    additions through the queue.
22. Admin sign-in reuses the visitor email-link flow with an owner allow-list.
23. The mock-up stays live until the new site passes its checks on staging;
    cut-over is one Caddy change with the old export kept for rollback.
24. Social posting is a capped daily selection per platform, never every item.
25. Agents start as several small runs a day on the Pro plan; the digest
    recommends an upgrade when buffers are missed, rather than guessing now.
26. Comments: adults only, never visible to child profiles, trust levels
    (held until five approvals, then instant), two reports hide, moderation
    agent decides, owner sees only escalations.
27. Comments on by default for Play, Discover, Together and Grow; off by
    default for Kids.
28. (Now an owner decision.) `hello@sparkkindly.com` as the single sending
    and reply-to address.
29. (Now an owner decision.) Backblaze B2 for off-VM backups.
30. Child profile age bands are 6–9 and 10–12; the band decides what the
    profile sees; a profile closes at 13.
31. Videos go through a jobs queue: agent writes the brief, a person or tool
    makes the video, the worker posts it.
32. The validation gate sits before Project 4 (two pilots after Project 3),
    not before Project 0, because the owner has decided to replace the
    mock-up and Projects 0 to 2 are needed for any version.
33. Quality over quota: a world publishes fewer items rather than a weak one.
34. Content risk tiers (Excluded, Sourced, Computable, Reflective, Kids) with
    sources required and verified for factual content.
35. Weekly five-item spot-check by the owner; two flags in a week switch
    that world to review mode.
36. Child data model as in 4a.5; 16 and 17-year-olds are full members who
    cannot create child profiles and are never shown sponsorship; creating a
    child profile requires 18+; 13-to-15-year-olds (owner decision: allowed
    with parental consent) cannot post public comments, join public
    communities or contribute until 16.
37. Admin sign-in is delivered in Project 1 (email link plus authenticator
    code), not deferred to Project 3.
38. Speed bonus removed; scoring is correctness only at launch.
39. Sponsorship appears only on `adults`-rated items, with plain-language
    disclosure next to the link.
40. Non-English URLs are prefixed with the language code; English stays
    unprefixed.
41. Recovery targets: 24 hours of acceptable data loss and 4 hours of
    acceptable outage at launch, with a monthly automated restore test.
42. Instagram before Facebook in Project 5A, because of the first audience.
43. Minimum age, consent age and per-age-group permissions are settings so
    they can change by policy.
44. Parental consent for 13-to-15-year-olds is one rule everywhere (not per
    country), by email confirmation from a parent, with a 30-day deletion of
    unconfirmed accounts and a withdrawal link; adequacy to be confirmed by
    the professional review.
45. Contributors (Project 8): 16 and over, articles and quiz questions
    first, same pipeline as agents plus owner approval always, credit by
    display name, non-exclusive licence with the contributor keeping
    copyright, best-effort plagiarism check, no payment assumed.
46. Reading and playing never require an account; this is a stated goal.

## 9. Decisions only the owner can make

In order of how soon they are needed:

1. **Monthly budget ceiling.** The objective is agreed (audience growth,
   costs covered where sponsorship fits, no profit target in year one). No
   ceiling figure has been given. **[my proposal]** the base scenario in
   4a.3, about $150 a month, as the ceiling; anything above needs the
   owner's explicit yes before it is built.
2. **Name the backup approver** for Kids items and contributor submissions.
   The owner has agreed there should be one; the name is needed before
   Project 2 goes live.
3. **The first new world** beyond the five, to prove that adding a world needs
   no code change. Travel was mentioned earlier. Needed only when Project 2 is
   near its end; the owner names the world and says roughly what it covers.
4. **Who makes the videos** in Project 5B; nearer than before, because short
   video matters to the first audience.
5. **Social platform access** when Project 5 starts; accounts exist.
6. **Who reviews the privacy documents** before Project 3 goes live; the owner
   has agreed to arrange this and the builder will supply the drafts. The
   review now also covers the parental-consent method and the age-appropriate
   design rules for 13-to-15-year-old members.
7. **Whether contributors are ever paid** (Project 8); the design assumes
   credit only.

Owner actions needed at the start of Project 0: a Backblaze account and
application key; a MailerSend account with the sparkkindly.com domain
verified; access to the DNS records for sparkkindly.com (for the email and
staging records).

Decided by the owner on 30 October 2026: SSH access granted and working; no
Docker, plain systemd services like MyLuxVacation; PostgreSQL; auto-publish
except Kids, which are always reviewed; 16 and over for accounts, under 16
only as child profiles with age bands; MailerSend sending from
`hello@sparkkindly.com`; Backblaze B2 for backups; privacy documents drafted
by the builder and reviewed by a professional the owner arranges; social
accounts exist on all four platforms; videos made by a person or tool from
the agent's brief and attached through a jobs queue; revisions capped at 10;
multiple languages planned with English first; light sponsorship allowed
under the Project 6 rules; branded template images for items; agents on the
Pro plan with upgrade when measured need appears; answer-based games at
launch with puzzle mechanics added over time; moderated comments planned as
Project 7; first audience is teenagers and young adults; accounts from 13
with parental consent until 16; reading and playing never need an account;
first-year objective is audience growth with costs covered where sponsorship
fits; pilot thresholds as proposed; a backup approver will be named; a
contributor programme as Project 8.

## 10. Risks and how the design handles them

| Risk | Handling |
| --- | --- |
| Owner's machine is off, so agents do not run | 3-day buffer per world; digest shows buffer days; alert when any world drops below 1 day |
| Agents produce wrong facts or an inappropriate item | Reviewer agent, server gates, Kids queue, one-click unpublish, quality report per item |
| Agents produce repetitive content | Brief includes recent titles and topic counts; server rejects near-duplicates |
| Shared VM is too small | Measured on 30 October: ample headroom. A move to a bigger VM is a scripted install, a copy of the latest release and a database restore |
| Deploy breaks the site | Health check and automatic rollback to the previous release directory |
| Data loss | Nightly off-VM encrypted backups with a tested restore |
| Child-privacy breach | No child accounts, no child personal data, circle-only visibility, independent review before launch |
| Social platform approvals delay Project 5 | Start applications during Project 0; Project 5 is last and independent |
| Claude Code scheduled run fails silently | Master agent posts a heartbeat to the API; worker alerts if no heartbeat in 36 hours |
| Pro plan limits throttle the agents | Several small runs a day; per-world caps; digest recommends an upgrade when buffers are missed on 3 of 7 days |
| Abusive or spammy comments | Account holders only, trust-weighted reports, server checks, two-report hiding, urgent-report path, moderation agent, owner can ban; children never see comments |
| The core assumption (daily cross-world content played in circles) is wrong | Pilot gate before Project 4 with thresholds and a recorded expand/change/stop decision; Pilot B tests circles with no code |
| Agents publish a confidently wrong fact | Risk tiers; sources required and opened by the reviewer; Excluded topics never produced; weekly human spot-check; report link and recall process |
| Scheduled subscription use is outside Anthropic's terms or limits | Verified in Project 2's first week before full schedule; fallbacks: fewer items, Max plan, then an owner decision on a capped API key |
| Child data turns out to need stronger consent in some jurisdiction | Data model in 4a.5 is minimal and adjustable; professional review before Project 3 launch; minimum age is a single setting |
| Owner unavailable for Kids approvals or urgent reports | Named backup (owner decision) or safe pause; urgent reports hide content automatically on receipt |
| Email-based parental consent is judged insufficient somewhere | Consent method is a replaceable step; stricter verification can be added for affected countries; professional review before Project 3 launch |
| A contributor submits plagiarised or rights-infringing work | Declaration and licence at submission; reviewer's best-effort plagiarism search; owner approval always; unpublish on request; contributor role removed on repeat offences |
| Teen members are contacted by strangers | 13-to-15-year-olds cannot comment publicly or join public communities; no profile pages or direct messages exist for anyone; circles are invite-only except communities, which younger teens cannot join |

## 10a. Development methodology

All work on this design follows the repository's development policy, `AGENTS.md`, adopted on 30 October 2026 from
the owner's other projects so that every project is built the same way: task tiers that set verification and review
depth (Read-only, Trivial, Standard, High-risk), always-on rules in `.claude/rules/` (security, data isolation and
child safety, AI governance, database, media storage, accessibility, testing, documentation, git, maintainability,
Definition of Done), specialist reviewer roles in `.claude/agents/` used only when a tier calls for them, workflow
skills in `.claude/skills/`, and templates in `.claude/templates/`. Material architecture decisions are recorded in
`docs/adr/`. Precedence: the owner's explicit instructions, then `AGENTS.md`, then the rules, then the skills.

## 11. What is left to the builder

Choice of ORM and migration tool; exact table columns beyond those named; the
JSON body shape for each item kind (to be documented in `docs/item-format.md`
as part of Project 1); component structure and styling approach, provided the
brand kit is used; the precise reading-level and similarity thresholds; the
layout of `/admin`; the format of the goals files; test strategy per project
(unit, integration and end-to-end are all expected); and the exact uptime,
error and email providers within the free-tier guidance above.

## 12. Order of work and what each unlocks

```
Project 0  Foundations ────► Project 1  Platform core ────► Project 2  Agents
                                      │                           │
                                      ├──► Project 3  Accounts ──► pilots ──┼──► Project 4  Circles
                                      │           │                         │
                                      │           ├─────────────────────────┴──► Project 7  Comments
                                      │           │
                                      │           └──────────────────────────────► Project 8  Contributors
                                      │
                                      ├──► Project 5  Social (A after 1, B after 2)
                                      │
                                      └──► Project 6  Sponsorship
```

Project 0 and 1 are the base. After them, Projects 2, 3, 5A and 6 can proceed
in any order or in parallel. Project 4 needs 3 **and the pilot gate in 4a.2**.
Project 5B needs 2. Project 7 needs 3 (accounts) and 2 (the agent run that
hosts the moderation agent). Project 8 needs 3 and the reviewer agent from 2.

The recommended order is 0, 1, 2, 3, **pilots**, 4, 7, 8, 5, 6, because a
site with daily fresh content (after 2) is already worth signing up for, the
pilots decide whether circles are built as designed, comments and
contributions need people, and promotion and sponsorship are worth most once
there is something to point at. Given the first audience, 5A (Instagram) may
be pulled forward to run alongside the pilots, since it is the discovery
channel the pilots rely on.
