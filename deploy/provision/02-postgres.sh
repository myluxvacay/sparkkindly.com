#!/usr/bin/env bash
# PostgreSQL 16 for SparkKindly: loopback only; separate roles, passwords and databases for production and staging;
# and the two env files. Staging credentials cannot open the production database and vice versa.
# Run as root on the VM after 01-base.sh, from the directory that contains deploy/ (scp -r deploy root@vm:/root/).
# Idempotent. Verified by: plan Task 4 steps 3 and 4.
set -euo pipefail

SHARED=/opt/sparkkindly/shared
HERE=$(cd "$(dirname "$0")" && pwd)
ENV_TEMPLATES="$HERE/../env"

[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }
[ -d "$SHARED" ] || { echo "Run 01-base.sh first" >&2; exit 1; }

echo "== Install"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get -y -qq install postgresql
pg_lsclusters | awk '$1==16 && $2=="main" {found=1} END {exit !found}' || { echo "No PostgreSQL 16 main cluster" >&2; exit 1; }
systemctl enable --now postgresql >/dev/null

# target : role : database : OS user that may read the env file
TARGETS="prod:sparkkindly:sparkkindly:sparkkindly staging:sparkkindly_staging:sparkkindly_staging:sparkkindly-staging"
for spec in $TARGETS; do
  IFS=: read -r target role db osuser <<<"$spec"
  passfile="$SHARED/db-$target.pass"

  echo "== $target: password (generated once), role $role, database $db"
  if [ ! -s "$passfile" ]; then
    (umask 077; openssl rand -hex 24 > "$passfile")
  fi
  chown root:root "$passfile"; chmod 600 "$passfile"
  pass=$(cat "$passfile")   # hex only: safe inside SQL and sed

  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v pw="$pass" -v role="$role" -q <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'role', :'pw') \gexec
SQL
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || runuser -u postgres -- createdb -O "$role" "$db"
  # Asserted on every run, not only at creation, so a database that already existed ends up in the same state.
  # Only the owner may connect: no other role (including the other environment's) can open this database.
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q \
    -c "ALTER DATABASE \"$db\" OWNER TO \"$role\"" \
    -c "REVOKE CONNECT ON DATABASE \"$db\" FROM PUBLIC" \
    -c "GRANT CONNECT ON DATABASE \"$db\" TO \"$role\""

  envfile="$SHARED/$target.env"
  if [ ! -f "$envfile" ]; then
    sed "s/__DB_PASSWORD__/$pass/" "$ENV_TEMPLATES/$target.env.example" > "$envfile"
  fi
  chown "root:$osuser" "$envfile"; chmod 640 "$envfile"
done

echo "== Loopback-only check"
if ss -tlnH 'sport = :5432' | awk '{print $4}' | grep -vE '^(127\.0\.0\.1|\[::1\]):5432$' | grep -q .; then
  echo "PostgreSQL is listening beyond loopback" >&2
  exit 1
fi
ss -tlnH 'sport = :5432' | awk '{print $4}'
