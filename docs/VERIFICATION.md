# Public-release verification — 19 October 2026

The site owner explicitly approved publication of all 24 current records in chat.
That decision and revision fingerprints are recorded in editorial-approval.json;
independent media-rights, hosting-privacy and child-privacy reviews remain open.

Latest local checks under Node 24.22.0 LTS:

- Content and exact-revision approval validation: passed (10 entries, 14 quizzes).
- ESLint and TypeScript: passed.
- Vitest: **17 tests passed**, including real validator processes accepting the
  approved revision and rejecting otherwise valid edited article/quiz revisions.
- Public static build: passed; **8 Chromium E2E tests passed** with indexable
  metadata, approved-content sitemap, canonical links and Article/Breadcrumb JSON-LD.
- Explicit private preview build: passed; **8 Chromium E2E tests passed** with
  noindex, robots exclusion and empty sitemap. Both modes are included in CI.
- No serious/critical axe findings in the tested pages/states; 320px reflow,
  mobile keyboard/Escape, no-JS dated answers and Kids network/storage checks passed.
- Initial Git staging secret scan: 167 selected files, no credential-URI, GitHub
  token, private-key or excluded-runtime-file findings. .env.local is ignored.
- Peer security review and deployment-helper review: no concrete actionable findings.
  The test reviewer identified two coverage gaps; both were fixed before the push.
- DNS at preparation time: apex A 2.57.91.91, no AAAA, www CNAME sparkkindly.com,
  no CAA. Public Caddy activation/DNS cutover have not yet occurred.

The prepared activation helper was reviewed and its CLI syntax checked locally;
actual full-config validation must run on the VPS before reload. GitHub CI status
will be verified after push; this file does not pre-assert remote CI success.

The earlier implementation record below is historical and reflects the draft
state before the owner's publication decision.

---

# Verification record — 17 October 2026

This is a local implementation record, not a launch-readiness or WCAG conformance
claim. No production URL exists and CI has not run remotely.

## Passed locally

- Clean `npm ci` under Node **24.22.0 LTS**.
- `npm run content:validate`: **10 articles, 14 quizzes** validated.
- `npm run lint`: passed without warnings/errors.
- `npm run typecheck`: passed.
- `npm test -- --run`: **12 tests passed**, three test files.
- `npm run build`: successful Next.js static export, including five brand pages,
  ten detail pages, fourteen dated quiz pages, daily quiz/archive, five trust
  pages, custom 404, robots and sitemap. No runtime database or server needed.
- MongoDB seed: **24 inserted**; repeat seed: **0 inserted**. Existing managed
  documents were preserved. Validated snapshot contains ten articles/fourteen
  quizzes. Only `sparkkindly_local.sparkkindly` was used.
- Release validator: intentionally fails for launch approval evidence and real human editorial approvals.
  The originally missing brand files were subsequently supplied and integrated. This is expected.
- Production dependency audit: **0 vulnerabilities** (`npm audit --omit=dev`).

## Browser checks

`npm run test:e2e`: **8 tests passed** against the final static export.

The Chromium Playwright suite covers:

1. Home → Discover → article, refresh, custom 404 and browser error monitoring.
2. Correct answer, reasoning, retry, UTC rollover, archive, dated direct refresh.
3. Mobile disclosure with keyboard, Escape, returned focus, 320 CSS px reflow on
   home, Kids landing, Kids activity and daily quiz.
4. axe WCAG 2/2.1/2.2 A/AA on home, Kids, Discover article and submitted incorrect
   quiz state: **no serious or critical violations**.
5. Navigation through Kids and shared quiz: **zero third-party requests, cookies,
   localStorage or sessionStorage entries** observed in the tested flow.
6. JavaScript disabled: Kids activity readable and dated quiz answer/analysis
   available through native HTML details.
7. Canonical metadata, noindex, structured BreadcrumbList JSON-LD, empty draft
   sitemap, robots exclusion and full-page screenshot evidence.
8. Direct HTTP requests for all 37 user-facing canonical destinations; unknown
   nested URL returns actual 404 status and custom content.

Screenshots: `docs/screenshots/home-390.png` and `home-1440.png`. Photography and
fonts are local; responsive WebP/AVIF image variants are generated before build.
The screenshots use a frozen 17 October 2026 UTC clock to make evidence repeatable;
the actual website selects the real current UTC date on the client.

## Test coverage details

Unit coverage checks invalid fields/brands/slugs, missing Kids safety metadata,
incomplete approval records, duplicate quiz IDs and dates, repeated options,
invalid correct answer references, missing reasoning, impossible calendar dates,
leap day, UTC/local boundary, exact midnight, tab visibility update, exhausted and
not-yet-started schedules, correct/incorrect/retry state, and a real validator
process failing on a malformed content file before export.

## Remaining limits

- A human has not completed VoiceOver/NVDA testing, manual 200% browser zoom,
  every color/focus/control combination, content comprehension or age/safety
  review. Keyboard and 320px checks above are automated browser evidence, not a
  claim that a human performed these manual checks.
- axe cannot establish full WCAG 2.2 AA conformance. No conformance claim is made.
- No field Core Web Vitals or formal lab Lighthouse scores have been collected;
  LCP ≤2.5s, CLS ≤0.1 and INP ≤200ms remain targets rather than measured claims.
- Final asset provenance/rights records, editorial identities,
  verified adult contact and host-specific privacy/legal review remain unresolved.
- No finished video exists; therefore no video/caption playback was tested.
- The full dependency audit reports **5 high advisories in development lint tooling**,
  tracing to braces through micromatch/fast-glob and Next’s ESLint plugin. The
  registry currently offers no patched braces release. The available compression
  fix was applied through an override; no forced downgrade of Next tooling was
  made. Recheck before release. Those lint tools do not ship in the static export.
- CI workflow is supplied and reproduces the local gates, but remote CI success is
  not asserted. Static host deep-link behavior, HTTPS, caching, log retention and
  post-upload health cannot be verified before a host is selected and approved.
