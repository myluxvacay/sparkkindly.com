# MongoDB editorial storage

This implementation uses the local database shown by the owner:

- URI: `mongodb://localhost:27017/` (development only)
- Database: `sparkkindly_local`
- Collection: `sparkkindly`
- Documents: `kind: "article"` or `kind: "quiz"`, with a stable `id`

Twenty-four documents were inserted during implementation: ten articles and
fourteen quizzes. They are explicitly drafts, without invented reviewer names.
No other database or collection was changed. No visitor response is stored.

## Local workflow

1. Use Node 24.22.0 and `npm ci`.
2. Copy `.env.example` to `.env.local`; set `CONTENT_SOURCE=mongodb`.
3. Start your existing local MongoDB service.
4. `npm run content:pull -- --seed` inserts missing seed documents only. Existing
   documents with a matching `kind` and `id` are preserved, not overwritten.
5. Edit the relevant document in MongoDB Compass; retain all required fields.
6. `npm run content:pull` validates every managed record and atomically replaces
   `content/mongodb.snapshot.json` only when the complete result is valid.
7. Review the snapshot diff and run `npm run build` to update the static site.

`npm run content:pull` reads `.env.local` using Node’s native environment loader.
Already-set environment variables take precedence. `npm run build` consumes the
snapshot; it does not connect to a database. A failed connection or invalid record
fails the pull and leaves the previous snapshot intact. Fix the source and pull
again; an older snapshot is never presented as newly synchronized.

The snapshot is editorial public data only and may be committed after review.
Never put private reviewer notes, credentials or personal data in editorial
fields: all public fields can enter HTML or client bundles. Mongo `_id` and the
routing discriminator `kind` are not needed in the exported content schema.

## Approvals

The draft → source-check → safety-review → approved workflow is deliberate.
Record real `reviewer` and `reviewedAt` values. Approved articles also require real
`publishedAt` and `factualClaimsReviewedAt` dates. Kids safety fields cannot be
removed. Build validation rejects invalid dates, answers, duplicate IDs/dates,
missing media and incomplete approval metadata. A review label is not evidence
that review happened; the owner is responsible for completing and recording it.

## Production boundary

MongoDB is an editorial source, not a live dependency of the public site. Do not
expose the local database to the internet or use a `NEXT_PUBLIC_` database URI.
If hosted MongoDB is later chosen, use authentication, TLS, least-privilege build
credentials and the host’s secret store. That service, pricing, backups and access
policy are separate owner decisions; no cloud MongoDB account was created.

Local JSON under `content/articles` and `content/quizzes` remains the reproducible
seed and fallback. Set `CONTENT_SOURCE=local` to use it explicitly. Do not edit the
snapshot expecting it to persist through another pull: MongoDB is the source of
truth when that mode is selected. There is no public content-editing UI or runtime
CMS connection in this MVP.

## VPS editorial database (configured 19 October 2026)

The VPS database is `sparkkindly`, collection `sparkkindly`. The owner created
`sparkkindly_editor` with readWrite on this database only and imported 24 draft
records through Compass. The Mac's ignored `.env.local` now targets
`mongodb://127.0.0.1:27018/?directConnection=true`, with MONGODB_DB=sparkkindly,
MONGODB_USERNAME=sparkkindly_editor and MONGODB_AUTH_SOURCE=sparkkindly.

Keep this SSH tunnel running on the same computer:

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:27018:127.0.0.1:27017 root@2.25.121.2
```

In another Mac terminal, run `npm run content:pull`. Enter the **SparkKindly editor
password** at the hidden prompt. No password is saved to a file or command history.
An optional MONGODB_PASSWORD environment variable supports a build secret store;
never commit it or prefix it with NEXT_PUBLIC_. The CLI fails if authenticated
access requires a password but no interactive terminal or environment secret is
available. A failed pull preserves the last validated snapshot. No VPS database
synchronization is claimed until the owner runs the command successfully.

Run `npm run build` after a successful pull to use the updated content. The static
site does not query MongoDB at runtime. SSH encrypts remote traffic; MongoDB stays
bound to the VPS loopback interface. Do not open port 27017 to the internet.

The earlier local `sparkkindly_local` seed database is retained and unchanged.

## Owner approval synchronization

The current source entries are owner-approved for the 19 October 2026 public
release. Existing VPS records imported before that decision can be updated with
`npm run content:approve`, followed by `npm run content:pull`. Both use the same
restricted editor user and hidden password prompt. The approval command checks
recorded prior/approved revision fingerprints before touching managed documents.
It conditionally updates only matching records and does not overwrite newer
editorial changes. A connection failure preserves the local approved snapshot.
Independent rights/privacy reviews remain disclosed in the launch record.
