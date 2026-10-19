# Static hosting runbook

The owner uses an existing Hostinger VPS with Caddy and MongoDB. A private
SparkKindly preview is already uploaded. On 19 October 2026 the owner explicitly
authorized the full public launch and approved current content. That supersedes
the initial no-auto-publication instruction. Public DNS cutover is still pending;
this runbook is not evidence that sparkkindly.com is already serving this build.

## Before choosing a host

Review the provider’s current free-tier terms for commercial use, bandwidth,
storage, custom domains and HTTPS; do not assume a permanently free allowance.
Confirm the actual request logging, subprocessors, retention, deletion and access
controls. Record the chosen configuration in the privacy notice and owner launch
review. Child-directed compliance review remains an owner launch dependency.

## Prepare

1. Complete all editorial, media, identity and privacy approvals in README.
2. Pull and review a validated MongoDB snapshot, if MongoDB is the source.
3. Use Node 24.22.0 and `npm ci`.
4. Run validation, lint, typecheck, unit tests, build and E2E.
5. After the actual launch evidence is recorded, run `npm run build:release`.
6. Confirm every exported page has its expected canonical URL; the release
   sitemap contains approved canonical pages only and robots permits indexing.

The default `npm run build` is now an approved public release.
`npm run build:preview` explicitly produces noindex output. Owner-directed release
and the outstanding independent reviews are recorded in launch-approval.json;
those reviews are not described as completed.

## Upload

Upload the **contents of `out/` only**. The host must serve a nested route such as
`/discover/a-day-in-shadows/` from its `index.html`, and use the generated
`404.html` with an HTTP 404 status. Do not configure an SPA fallback to the homepage.
Next static export has no runtime database, Node server, API routes or optimizer.

Set HTTPS and one canonical domain, redirecting aliases to
`https://sparkkindly.com` only after ownership and DNS access are confirmed.
Apply headers at the host, since Next runtime headers are unavailable in export:

- Fingerprinted `/_next/static/*`: `Cache-Control: public, max-age=31536000, immutable`
- HTML, robots and sitemap: revalidate or short TTL to allow corrections.
- Non-fingerprinted editorial images: short TTL or version filenames on change.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- Restrict framing (`frame-ancestors 'none'`) in a host CSP; test any CSP against
  Next’s generated inline scripts before enforcing it. Do not use an untested
  blanket policy that breaks hydration or the no-JS answer alternatives.

Verify direct navigation and refresh on every brand, article, trust and quiz URL,
a genuine unknown URL (404 status + custom page), metadata, assets, keyboard flow,
network/storage privacy and current UTC date. Local test success does not replace
this post-upload verification. Lab measures are proxies; field LCP/CLS/INP are
not available from a local MVP.

## Update and rollback

Save the previous approved export as a versioned private artifact with the content
snapshot and source revision. For updates, edit MongoDB → pull and review snapshot
→ check and rebuild → upload a new version. The schedule works only through its
last committed date; extend it with reviewed questions before it runs out.

To roll back, restore the preceding complete static artifact using the host’s
version rollback or replace all exported files together, purge stale HTML caches,
then repeat direct-route and UTC checks. Database credentials are never part of
an upload. Do not undo live editorial source changes blindly: preserve and review
those separately from rolling back a public build.

## Prepared VPS activation helper

`deploy/activate-public.py` installs a checksummed static export into a new
versioned public release directory, validates the combined Caddy configuration,
switches the current symlink and gracefully reloads Caddy. It adds only an import
to the existing active configuration and MyLuxVacation deployment template.
Backups and rollback restore the preceding config and public target on activation
failure. The helper rejects unsafe archive paths/links and credential-like files.

Run its `--help` locally to inspect usage. It must be run **on the VPS as root**,
with `sparkkindly-public.caddy` next to it and the expected archive SHA-256 supplied.
No DNS, MongoDB, or MyLuxVacation route bodies are changed by the helper. It has
been reviewed locally but must still be validated against the actual VPS config.
The added template import must also be committed to MyLuxVacation’s upstream
repository; a local template edit alone is not permanent configuration management.
