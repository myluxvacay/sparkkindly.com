# Content Push API

**Status:** Live on staging · 2026-11-20 · Decision record: [ADR 0006](adr/0006-content-push-api.md)

The Content Push API lets an external agent put finished content — an article, its companion quizzes,
a hero image, and optionally a video — into the SparkKindly library **without touching the codebase**.
A submission lands as a draft in the same `items` store the git pipeline imports into, passes the same
quality gates the daily pipeline runs, and is reviewed and published by state changes, never by a
deployment (the promotions precedent, ADR 0005). Publishing an API item does not run `content:validate`
and cannot break the git deploy gate: that gate validates the content files in the repo, and API items
live only in the database.

## Authentication

Every call carries the agent's own key in the `X-Agent-Key` header (the `Authorization` header belongs
to the site's own auth):

```
X-Agent-Key: skagt_<8 hex>_<48 hex>
```

Keys are issued per agent by the owner (production: `/admin/agents/`), stored only as a SHA-256 hash,
and revoked by disabling the agent — a disabled key stops working immediately. Each key has one role,
mirroring the existing publishing agents:

| Role | Can | Cannot |
|---|---|---|
| `content` (submitter) | Submit packages; upload/replace the hero image and the video on **its own** items (while they are draft/in_review); read its own items, the queue, and other push items in its world | Review, publish, write another agent's items |
| `reviewer` | Read the queue and any push item; approve or reject | Submit, publish |
| `promoter` | Read; publish an approved item (the publish step also flips its video public) | Submit, review |

A master `content` key (no world scope) may submit for any world and manage any push item's media.
Rate limit: 60 requests/minute per key. Bodies are capped per endpoint (JSON 200 KB, image 12 MB,
video 256 MB).

## Workflow

```
submit ──► draft ──(gates pass)──► in_review ──approve──► approved ──publish──► published
              │                        │                                        (stored: scheduled ──► published)
              └──(a gate fails)──► draft, with the failed gates named in qualityReport
                                   └──reject (reason required)──► rejected
```

- The API's `approved` is the store's `scheduled`: approval assigns the item its publication slot
  (articles: the next free daily slot in their world; quizzes: a server-assigned date, below), and the
  publish step flips it public immediately. An approved item the promoter never publishes still goes
  live at its slot through the site's normal publish-due job — approval is the real gate. **The one
  exception is an item with a video:** it is approved *without* a slot, so the publish-due job can
  never take it; it goes public only through the publish endpoint, after its video flip (below).
- Statuses returned by the API: `draft`, `in_review`, `approved`, `published`, `rejected`. The status
  response also carries the store's own status as `itemStatus`.
- Every transition is written to the audit log with the acting key's agent name (`content_push.submit`,
  `content_push.image`, `content_push.review_approve`, `content_push.review_reject`,
  `content_push.publish`, and the `content_push.video_*` events below).

## Endpoints

### `POST /api/agent/content` — submit a package (role: content)

One article and/or up to 20 companion quizzes, in the repo's library shapes (the same JSON the content
files use), plus an optional video declaration. Returns `201` with one record per item:

```json
{
  "items": [
    { "id": "9f0…", "kind": "article", "slug": "why-bees-matter", "status": "in_review",
      "fingerprint": "b3…", "scheduledDate": null, "publishAt": null, "replayed": false,
      "qualityReport": { "gates": [ { "gate": "duplicate", "ok": true }, "…" ] } },
    { "id": "41a…", "kind": "quiz", "slug": "why-bees-matter-quiz-1", "status": "in_review", "…" }
  ],
  "video": { "state": "pending_upload", "watchUrl": null }
}
```

**Idempotency.** Each item's `contentFingerprint` (the same fingerprint the editorial-approval registry
uses) is its idempotency key. Resubmitting identical content returns `200` with the stored records and
`replayed: true` — never a duplicate. Resubmitting your own draft slug with changed content replaces
the draft (while it is still a draft); a slug owned by anyone else, or already past draft, is a `409
slug_taken`.

**Server-owned fields are stripped, never trusted:** `reviewStatus`, `reviewer`, `reviewedAt`,
`publishedAt`, and a quiz's `scheduledDate`. Quiz dates are assigned by the server at approval: the day
after the latest date held by any scheduled or published quiz in the whole library, at the 06:00 UTC
slot — globally unique by construction, so two agents can never collide.

**Validation (at least as strict as `content:validate`).** Hard failures return `422 invalid_package`
with per-field issues and store nothing:

- The full article/quiz schemas (a Kids *activity* must use `contentType: "activity"`).
- **Sources are required on articles and quizzes alike** — at least one, each an https URL off this
  site. (The file pipeline allows a quiz without sources; the API does not.)
- **Kids items** (`brand: "kids"`) must carry all five substantive fields: `ageGuidance`, `materials`,
  `supervision`, `safetyNotes`, `screenFreeExtension`.

**Quality gates** run after validation. A failed gate does not reject the package: the item is stored
as a `draft` with the failures named in `qualityReport.gates`, for the reviewer to judge:

- `duplicate` — title near-duplicate (word-set similarity ≥ 0.8) of an item in the same world from the
  last 90 days, or of a git library title;
- `blocked` — a blocked word or topic anywhere in the item (a blocked *topic* also marks the item
  excluded);
- `sources` — a source that does not answer https (checked with a DNS-pinned probe);
- `readability` — Kids prose above US grade 6 (Flesch-Kincaid).

An item passing every gate advances to `in_review` on its own.

### `POST /api/agent/content/:id/image` — hero image (role: content, owner or master)

Raw image bytes as the body (`image/png`, `image/jpeg` or `image/webp`, ≤ 12 MB). The server verifies
the bytes really decode as an image, then writes the standard variant set the `Picture` component
expects — the image as WebP plus 480/960/1600-wide WebP and AVIF variants — into the shared push-media
directory, and points the item at it. Optional query parameters: `alt` (defaults to the item title),
`credit` (defaults to `AI-generated image · SparkKindly`), `rights` (defaults to `generated`).
Response: the stored image record. Media is part of what the reviewer approves: the hero (and the
video) can change only while the item is `draft` or `in_review`; after approval they are frozen, so
what was reviewed is what publishes. Files are served at `/api/push-media/<file>` only while the
owning item is published — the route checks the item's status, so a draft's or a rejected item's hero
is never public just because its file exists.

### `POST /api/agent/content/:id/video` — attach a video (role: content, owner or master)

Two shapes:

- JSON `{ "sourceUrl": "https://…" }` — the server fetches the file itself. The URL must be https, pass
  the same SSRF screening as content sources (DNS-pinned: the address checked is the address
  connected), answer `200` directly (no redirects — host the file at its final URL), and be an MP4
  (`video/mp4` or `application/octet-stream`), ≤ 256 MB. Calling again with `{}` re-processes a video
  whose upload failed.
- A raw `video/mp4` body — direct upload of the file, ≤ 256 MB.

Either way the server then uploads to YouTube (below) and the response carries the video record.

### `GET /api/agent/content/:id` — status (any push role)

The item record, plus its `video` record when it has one:

```json
{ "id": "9f0…", "kind": "article", "slug": "why-bees-matter", "status": "approved",
  "itemStatus": "scheduled", "fingerprint": "b3…", "publishAt": "2026-11-24T06:00:00.000Z",
  "scheduledDate": null, "qualityReport": { "gates": ["…"], "push": { "review": { "by": "…", "at": "…" } } },
  "video": { "state": "private", "youtubeId": "…", "watchUrl": "https://www.youtube.com/watch?v=…",
             "privacyStatus": "private", "brand": "sparkkindly", "madeForKids": true, "error": null } }
```

### `GET /api/agent/content?status=in_review&limit=50` — the queue (any push role)

Push-submitted items only, newest first. A world-scoped submitter sees only its own world's items;
reviewer, promoter and master keys see all.

### `POST /api/agent/content/:id/review` — review (role: reviewer)

```json
{ "decision": "approve" }
{ "decision": "reject", "reason": "The second section repeats the first." }
```

Rejection requires a reason; it is stored on the item and written to the audit log. Approval requires
the same evidence the item pipeline asks of any reviewer (`lib/agents/verdict.ts`), by the item's risk
tier — and tiers are assigned exactly as the pipeline assigns them (`riskTierFor`): the Kids brand is
the Kids tier, and every other push item is **Sourced**, because the API requires sources on everything.
A Sourced approval must carry `sourcesChecked`: the URLs of the sources the reviewer actually opened
(at least one). Kids items need no evidence beyond the review itself. Approval assigns the slot/date
described above (a video item excepted, as described there).

### `POST /api/agent/content/:id/publish` — publish (role: promoter)

Publishes an `approved` item now. If the item has a video, the video gate runs first (below): a video
still private is flipped public as part of this call, and the item is published only once the video is
public (or has no video). Production promotion stays owner-gated in practice: promoter keys exist only
where the owner issues them.

## Video

A package's article may declare one video:

```json
"video": {
  "title": "Bees at Work",
  "description": "A short look at how bees help flowers.",
  "brand": "sparkkindly",
  "tags": ["bees", "nature"],
  "madeForKids": true,
  "sourceUrl": "https://files.example.org/bees-at-work.mp4"
}
```

`brand` is `sparkkindly` or `mylux`. `sourceUrl` is optional — declare the metadata first and attach
the file later with the video endpoint. The video's own states: `pending_upload`, `private`, `public`,
`auth_expired`, `failed` (with `error` saying what happened), plus a transient `uploading` while one
processor holds the row — exactly one processor ever works on a video, and the moment an upload lands
its YouTube id is recorded on its own, so a crash can never turn into a duplicate upload. Once a video
is on YouTube its source cannot be replaced, and media changes of any kind stop at approval (above).

**The owner's approval rule governs videos exactly like articles:** the upload happens with
`privacyStatus: private` at submission time — whatever the environment's default privacy says — and
the flip to `public` happens only inside the publish step. Both transitions are audit-logged
(`content_push.video_uploaded`, `content_push.video_privacy`). The YouTube watch URL is stored on the
content record (`video.watchUrl` in every status response) from the moment the upload lands.

**Expired YouTube authorization.** The project's Google app is in Testing mode, so its OAuth consents
expire roughly every 7 days (the current cycle ends around 2026-11-22). When an upload or a privacy
flip meets an expired or revoked consent, the video enters the `auth_expired` state with the error
**"YouTube authorization expired — owner re-approval needed"**, and a publish that needs the flip is
refused with `409 youtube_auth_expired` and the same message. Nothing fails silently and nothing is
retried blindly: after the owner re-approves the consent, re-process the video
(`POST /api/agent/content/:id/video` with `{}`) and publish again. An upload whose outcome is genuinely
unknown (the publishing call may have reached YouTube) is terminal `failed` with that explanation —
check the channel by hand; the API never re-uploads it on its own, and pointing the item at a fresh
`sourceUrl` is refused for the same reason.

**One connected channel.** The site's YouTube integration holds a single connected channel (today the
SparkKindly channel). `brand` is recorded on the video record as the package's intent; until a second
channel connection exists, a `mylux` video uploads to the connected channel like any other. Plan the
second connection before pushing MyLux videos.

**Out of scope for v1:** Facebook/Instagram mirroring of API-published videos. The existing video job
mirrors its own videos; API videos can join that flow later. Note it here so nobody assumes a pushed
video reaches Facebook or Instagram on its own.

## Errors

Errors are `{ "error": "<code>", "message": "<what to do about it>" }` (validation adds `issues`).

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `invalid_json`, `body_too_large`, `unsupported_media_type` | Malformed or oversized body; wrong content type for a media upload |
| 401 | `unauthorized` | Missing, unknown or disabled key |
| 403 | `forbidden`, `not_owner` | Wrong role for the endpoint, or another agent's item |
| 404 | `not_found` | No such push item (or not yours to see) |
| 409 | `invalid_state` | The item is not in a state that allows this call |
| 409 | `slug_taken` | The slug exists and is not your replaceable draft |
| 409 | `youtube_auth_expired` | Publish blocked: the video's YouTube consent needs owner re-approval |
| 409 | `video_pending` | Publish blocked: the video has not finished uploading |
| 409 | `video_upload_failed` | Publish blocked: the video upload failed (see its `error`) |
| 422 | `invalid_package` | Schema/validation failure; `issues` names the fields |
| 422 | `review_incomplete` | Approval lacks the tier's evidence (sources checked / answer solved), or a rejection lacks its reason |
| 422 | `image_rejected`, `video_rejected` | The media bytes are not what they claim, or the video fetch failed its checks |
| 429 | `rate_limited` | Over 60 requests/minute for this key |
| 502 | `video_fetch_failed`, `video_privacy_failed` | The video download or the YouTube privacy flip failed upstream |

## Sample client

`agents/push_client.py` (Python, standard library only) walks the whole flow: submit a package, upload
a hero, check status, and — with reviewer/promoter keys — review and publish.

```bash
SPARKKINDLY_BASE=https://staging.sparkkindly.com \
SPARKKINDLY_KEY=skagt_… \
python3 agents/push_client.py package.json hero.png
```
