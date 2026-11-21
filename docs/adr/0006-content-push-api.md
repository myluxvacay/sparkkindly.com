# 0006 — Content Push API: agent submissions as drafts in the items store

**Status:** Accepted · 2026-11-20

## Context

Content volume is the site's growth lever, and the generation side is agentic: the daily pipeline, the
poster pilot and outside helpers all produce library-shaped articles and quizzes. Until now every one of
them needed the codebase — a branch, the editorial-approval registry, a deploy — which made the repo the
bottleneck and put agent hands on machinery they should never touch. The owner directed an API instead:
agents push complete packages (article, companion quizzes, generated hero image, optionally a video)
through a front door that enforces the same rules as the pipeline, so the push strategy stays consistent
without opening the codebase.

## Decision

A package is submitted to `POST /api/agent/content` in the library shapes the content files already use,
authenticated by the existing agent-key system (`lib/agents/auth.ts`: per-agent keys, SHA-256 at rest,
revocable by disabling) with the roles the pipeline already has — `content` submits, `reviewer`
approves/rejects, `promoter` publishes. Production promoter keys are issued only by the owner.

Submissions land in the same `items` store the git pipeline imports into, mapped field-for-field the way
`importLegacy` maps a content file, so API items and git items render identically and coexist.
`content:validate` and the editorial-approval deploy gate validate repo files only; database-only items
cannot break them, and publishing an API item is a state change, never a deployment (the promotions
precedent, ADR 0005).

The server, not the submitter, owns the trust boundary:

- Validation is at least as strict as `content:validate`, and stricter where the file pipeline is lax:
  sources are required on quizzes as well as articles, and Kids items are refused without all five
  substantive Kids fields.
- Server-owned fields (`reviewStatus`, `publishedAt`, a quiz's `scheduledDate`, …) are stripped from
  submissions. Quiz dates are assigned at approval under a lock — the day after the latest date any
  scheduled or published quiz holds — so they are globally unique by construction.
- The `contentFingerprint` is the idempotency key: an identical resubmission returns the stored record.
- The daily pipeline's quality gates (near-duplicate titles, blocked words/topics, source reachability
  through the DNS-pinned probe, Kids readability) run server-side; a failure stores the item as a draft
  with the failed gates named, rather than rejecting the package — the reviewer judges borderline cases.
- Approval reuses the item workflow (`draft → in_review → scheduled → published`) and its tier evidence
  rules; the Kids approval constraint in the database applies unchanged. Every step is audit-logged
  under the acting agent's name.

Media follows the same split. Hero images are verified by decoding, converted to the standard WebP/AVIF
variant set by the same recipe as `prepare-images`, and stored as files in a shared push-media directory
(`PUSH_MEDIA_DIR`) with only their reference on the item — release directories are immutable, so uploads
cannot live in `public/`. A narrow route serves exactly the file names the server writes.

A package may also declare a **video** (migration 042, `push_videos`). The server fetches the file from
an https URL screened like a content source (DNS-pinned, no redirects, size-capped) or accepts a direct
upload, then uploads it to YouTube through the existing adapter with two changes in behaviour: privacy
and the made-for-kids declaration come from the package, not the environment, and the upload always lands
**private** — the owner's rule that nothing goes public before the publish step applies to videos exactly
as to articles. The publish step flips the video public first (reading its current YouTube state and
writing it back with only the privacy changed) and only then publishes the item; both transitions are
audit-logged. The watch URL lives on the item (`items.video_youtube_id`) and is returned by the status
endpoint.

A video item is approved without a `publish_at`. The publish-due job publishes every scheduled item
whose slot has arrived and knows nothing about videos; leaving the field empty is what guarantees it
can never publish an article ahead of its video — the publish endpoint, which performs the flip first,
is the only road to public for such an item. Media of every kind freezes at approval: what the reviewer
saw is what publishes.

Because the project's Google app is in Testing mode, OAuth consents expire roughly every 7 days. That
failure is a first-class state, not a silent error: the video record enters `auth_expired` with the
message "YouTube authorization expired — owner re-approval needed", and a publish needing the flip is
refused with it until the owner re-approves and the video is re-processed. An upload with a genuinely
unknown outcome is terminal, never blindly retried — the same rule the social pipeline follows.

## Consequences

- Agents need no repo access, no registry edits and no deploys to contribute content; the review and
  approval gates are unchanged in strength, and Kids items keep their human-approval guarantee (a
  reviewer key must approve; the database constraint still requires `approved_by`).
- Two content paths now feed one store. The git path keeps its deploy gate; the API path's gate is the
  reviewer. Slugs are shared territory: an API item may not take a slug that exists anywhere in the
  library except its own replaceable draft.
- The site holds one connected YouTube channel. A package's `brand` is recorded as intent; a `mylux`
  video uploads to the connected channel until a second connection exists. Facebook/Instagram mirroring
  of API videos is out of scope (the video job mirrors its own); it is noted in the API spec as a future
  extension so nobody assumes it happens.
- Push media accumulates in the shared directory outside releases; it is covered by the same backup as
  the other shared media, and item deletion does not yet clean it up (acceptable at v1 volumes; revisit
  if the directory grows teeth).
