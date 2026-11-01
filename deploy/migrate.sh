#!/usr/bin/env bash
# Shipped inside every release as migrate.sh. The release receiver runs it from the new release directory, with that
# environment's env file loaded (so DATABASE_URL is set), BEFORE it switches the live symlink. If it fails, the receiver
# keeps the old release serving. It uses the bundled Node and `pg` only; there is no tsx on the server.
set -euo pipefail
exec /opt/sparkkindly/node/bin/node db/migrate.mjs
