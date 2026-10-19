# Full public launch — owner-directed, 19 October 2026

The owner explicitly instructed: “No go live with everything. mark draft as
approved.” The coming-soon alternative was declined and its temporary files
removed. The initial no-auto-publication instruction is superseded by this
explicit launch authorization. No claim is made that independent rights, privacy
or professional review has occurred: outstanding items are recorded in
launch-approval.json and reflected in the public trust pages.

## Release content

The 10 articles and 14 quizzes are approved by the site owner, with the actual
approval date and scope. docs/editorial-approval.json stores prior and approved
revision fingerprints. New edits cannot silently inherit this initial approval.
Published articles disclose AI assistance and owner approval; no independent
specialist fact-check is asserted. Science sources and quiz reasoning were
rechecked with AI assistance on 19 October 2026.

The default build is the approved public release. Use `npm run build:preview` to
explicitly request a private noindex export. No preview password is placed into
the public configuration. The existing password-protected loopback preview stays
separate. SITE_RELEASE=false cannot be used to produce an indexable public build.

## Synchronize approval into the VPS database

With the MongoDB SSH tunnel on Mac port 27018 running:

```bash
cd /Users/cassiusarulkumaran/source/sparkkindly
npm run content:approve
npm run content:pull
npm run build:release
```

The first two commands separately request the editor password without saving it.
Approval sync only updates known entries with exactly matching prior revisions;
changed or missing records stop the operation. Repeated approval sync on unchanged
approved records does nothing. MyLuxVacation data and users are not touched.

## Domain/server preparation

The public Caddy snippet is deploy/sparkkindly-public.caddy. It serves
`/var/www/sparkkindly/public/current`, redirects www to the canonical apex using
HTTPS, and serves the actual exported 404. Caddy needs DNS validation for automatic
certificates. This snippet must be imported by both the active Caddyfile and the
tracked MyLuxVacation deployment template, preserving all existing blocks.
The full candidate needs validation on the VPS before reload. No local Caddy
validation or production deployment is claimed until performed.

The last owner-shared DNS state was apex A = 2.57.91.91 and www CNAME =
sparkkindly.com. Before cutover, recheck current A/AAAA/CAA records. After uploading
and validating a versioned release and preparing Caddy, change only the apex A to
2.25.121.2. Keep unrelated email records and the www CNAME. Record the former A
value for rollback; DNS caches can retain a previous value until TTL expiry.

After cutover, verify HTTPS, www redirects, all nested pages and real 404 status,
assets, the date-accurate daily quiz, and that MyLuxVacation and the private preview
still work. Keep a previous public release symlink/config for rollback. Do not
expose MongoDB publicly or restart it as part of deploying static files.

## GitHub and production are separate

The requested GitHub target is https://github.com/myluxvacay/sparkkindly.com.
Uploading code does not itself activate Caddy or change DNS. No deployment token,
MongoDB password, .env.local, bcrypt preview hash, or generated out/ artifact is
committed. The source repository retains its existing all-rights-reserved status;
third-party package/font/photo licenses remain separate.
