# KB-001: A reader says an answer, article or page is wrong or broken

Version 1, 1 November 2026. Related: `tests/e2e/report.spec.ts`, `docs/superpowers/plans/2026-11-01-project-1b-public-site.md` (report a problem).

## Symptom

A reader, parent or teacher tells the owner (by the Report a problem form, or by email once a contact address is published) that a quiz answer is wrong, an article has a mistake, something is unsuitable for children, or a page or the answer form does not work.

## Affected

Anyone reading or playing; most urgent when the item is in the Kids world or the report says "unsafe".

## Likely causes

- The item has a factual or answer error that passed the automatic checks (they are software, not a fact-check).
- A page in the Kids world or a Play item is unsuitable in some way the blocked-word list did not catch.
- Display or form problem: JavaScript blocked, very old browser, or a zoom or screen-size problem.

## Diagnostics

1. Find the report: `SELECT r.created_at, r.reason, r.message, i.world, i.slug FROM problem_reports r JOIN items i ON i.id = r.item_id ORDER BY r.created_at DESC;` on the production database (read-only, from the VM; the admin queue arrives with Project 1C).
2. Open the item page and reproduce. For an answer dispute, read the item's explanation and its sources.
3. For a form problem, try the same page with JavaScript off; the form is meant to work either way.

## Resolution

1. Wrong or unsuitable item: unpublish it (admin once 1C ships; until then the owner asks the engineer to archive it through the documented procedure), then correct it, record the correction note on the item and republish.
2. Display problem: note browser and screen size, fix, and add an e2e test.
3. Reply to the reporter only if they left a way to reach them (the form does not collect one).

## Workaround for the reader

Reload the page; try another browser; for an unsuitable item, leave the page. Reports do not need an account.

## Escalate when

The report says "unsafe" about Kids content (act the same day: unpublish first, investigate after), names a real person, or points to a privacy leak.

## Collect

Item world and slug, time of the report, reason chosen, message text. Do not collect or request a child's personal details.

## Safe logs

`journalctl -u sparkkindly-web -n 200` for server errors. Never paste environment files or keys into a ticket.
