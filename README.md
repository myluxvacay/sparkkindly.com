# SparkKindly

A mobile-first editorial website with five worlds, ten original entries and a
fourteen-question UTC daily quiz. Built with Next.js App Router, React and
TypeScript; statically exported to `out/` with no runtime database dependency.

The site owner approved the current content for public publication on **19 October
2026**. Approval is recorded against exact revisions. Independent media-rights,
hosting-privacy and child-privacy reviews remain incomplete and are disclosed in
[the launch decision](docs/launch-approval.json) and public trust pages. No claim
of independent professional review or full WCAG conformance is made.

## Run locally

```bash
cd /Users/cassiusarulkumaran/source/sparkkindly
nvm install
nvm use
npm ci
npm run dev
```

Open http://localhost:3000. For another checkout, replace the first command with
its actual project path. Node is pinned to **24.22.0 LTS** in `.nvmrc` and engines.
Dependencies are pinned with a lockfile: Next.js 16.4.2, React 19.3.1, TypeScript
6.0.3, Zod 4.6.7 and MongoDB driver 7.7.0. CI can build the checked-in content
without MongoDB, authentication or secrets.

## Check and build

```bash
npm run content:validate
npm run lint
npm run typecheck
npm test -- --run
npm run build:release
npx playwright install chromium
npm run test:e2e
```

`npm run build` and `npm run build:release` now produce the approved public build:
indexable metadata, canonical URLs, sitemap entries and truthful Article JSON-LD.
The Together pilot remains a storyboard: no fake video player or VideoObject.
Run `npm run preview` to serve `out/` at http://localhost:4173.

For an explicitly private/noindex export:

```bash
npm run build:preview
SITE_RELEASE=false npm run test:e2e
```

Preview mode disallows crawlers and excludes all pages from the sitemap. It does
not replace HTTP authentication. The VPS's private preview additionally uses a
loopback listener, SSH tunnel and Caddy password protection.

## Editorial content and MongoDB

The VPS uses database **sparkkindly**, collection **sparkkindly**. Documents have
`kind: "article"` or `kind: "quiz"`, and `sparkkindly_editor` has access only to
this database. The earlier local `sparkkindly_local` database is retained.
See [MongoDB instructions](docs/MONGODB.md).

Keep a separate Mac terminal running this tunnel:

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:27018:127.0.0.1:27017 root@2.25.121.2
```

Copy `.env.example` to `.env.local` and configure your local credentials privately.
For the VPS tunnel, use MONGODB_URI `mongodb://127.0.0.1:27018/?directConnection=true`,
MONGODB_DB `sparkkindly`, MONGODB_COLLECTION `sparkkindly`, MONGODB_USERNAME
`sparkkindly_editor`, MONGODB_AUTH_SOURCE `sparkkindly`, CONTENT_SOURCE `mongodb`.
The CLI requests the editor password without echoing or saving it. Never put a
password in a NEXT_PUBLIC_ variable or commit it to Git.

To apply the owner's recorded approval to the existing imported draft revision:

```bash
cd /Users/cassiusarulkumaran/source/sparkkindly
npm run content:approve
npm run content:pull
npm run build:release
```

Approval sync rejects entries edited since the owner's approved snapshot. It is
idempotent for already-approved matching revisions and preserves unrelated data.
Subsequent changes need genuine renewed approval and updated revision records;
don't merely change hashes to bypass validation. Edit → approve the revision →
pull a validated snapshot → build → upload. Browser visitors never connect to
MongoDB, and their quiz choices are not transmitted or persisted.

Without `.env.local`, local JSON is the reproducible content source. Set
CONTENT_SOURCE=mongodb to use `content/mongodb.snapshot.json`, a public-content
snapshot that is safe to review and commit. No remote MDX is executed.

## Quiz schedule

The initial approved schedule is **17–30 October 2026 UTC**. Extend it with newly
reviewed entries before it runs out. The client starts from a neutral loading
state, rechecks visibility and UTC midnight, and never relabels yesterday's quiz
as today. An exhausted schedule says “No new quiz today” and links to a dated
quiz/archive. Dated answers are readable without JavaScript using HTML details.

There are no accounts, timers, streaks, public scores, ads, newsletter forms,
tracking identifiers, visitor analytics or response storage. Kids content is for
ages 6–9 with an adult and uses locally served media/fonts.

## Identity, media and licensing

The supplied heart-and-spark badge, browser icons and panoramic banner are
integrated. Originals/checksums and transformations are in the brand manifest.
Third-party photographic provenance and independent final rights review remain
open; do not describe them as independently cleared.

Inter and Playfair Display are self-hosted, with font-display: swap and OFL license
files. Image variants at 480/960/1600px use local AVIF/WebP. To regenerate:

```bash
node --import tsx scripts/prepare-images.ts
node --import tsx scripts/prepare-brand.ts
```

See [asset records](docs/ASSETS.md) and [LICENSE](LICENSE). Original code and brand
assets are all rights reserved; third-party licenses remain separate. Verified
contact/social configuration defaults to null; no address or handle is invented.

## Deployment and rollback

See [full domain launch preparation](docs/DOMAIN-LAUNCH.md) and
[deployment runbook](docs/DEPLOYMENT.md). The VPS serves MyLuxVacation and SparkKindly
through separate Caddy site blocks/directories. Only static export files go to
the public root; no Node server or database connection is required for visitors.

The existing private preview is already on the VPS. A prepared public artifact or
GitHub push does **not** mean public domain/DNS cutover has occurred. Verify the
actual DNS, Caddy configuration, HTTPS and every nested route after activation.
Preserve the preceding complete artifact for rollback and record Caddy imports
in the MyLuxVacation deployment source so later deployments do not erase them.

CI runs clean install, schema/approval validation, lint, typecheck, unit tests,
public build/E2E and private-preview build/E2E. Automated checks do not establish
full accessibility or legal compliance. See [verification](docs/VERIFICATION.md)
for evidence and remaining independent review limits.
