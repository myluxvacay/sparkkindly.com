#!/usr/bin/env bash
# Shipped inside every release as content-publish.sh. The release receiver runs it from the new release directory,
# with that environment's env file loaded (so DATABASE_URL is set), AFTER the release has passed its health gate —
# and only when the release carries the PUBLISH_CONTENT marker (the deploy workflow adds it when the push changed
# content/ or public/images/). It imports new library items and refreshes hero images; both steps are idempotent.
# It uses the bundled Node and `pg` only; there is no tsx on the server.
# Usage: content-publish.sh [--allow-production]   (the receiver passes the flag for the production target only)
set -euo pipefail
exec /opt/sparkkindly/node/bin/node content-publish.mjs "$@"
