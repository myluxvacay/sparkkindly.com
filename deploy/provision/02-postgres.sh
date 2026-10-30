#!/usr/bin/env bash
# PostgreSQL 16 for SparkKindly: loopback only, one role, a production and a staging database, and the two env files.
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

echo "== Password (generated once)"
if [ ! -s "$SHARED/db.pass" ]; then
  umask 077
  openssl rand -hex 24 > "$SHARED/db.pass"
fi
chmod 600 "$SHARED/db.pass"
chown root:root "$SHARED/db.pass"
PASS=$(cat "$SHARED/db.pass")   # hex only: safe inside SQL and sed

echo "== Role and databases"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v pw="$PASS" -q <<'SQL'
SELECT format('CREATE ROLE sparkkindly LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sparkkindly') \gexec
SELECT format('ALTER ROLE sparkkindly PASSWORD %L', :'pw') \gexec
SQL
for db in sparkkindly sparkkindly_staging; do
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || runuser -u postgres -- createdb -O sparkkindly "$db"
done

echo "== Environment files (written only if absent)"
for target in prod staging; do
  file="$SHARED/$target.env"
  if [ ! -f "$file" ]; then
    sed "s/__DB_PASSWORD__/$PASS/" "$ENV_TEMPLATES/$target.env.example" > "$file"
  fi
  chown root:sparkkindly "$file"
  chmod 640 "$file"
done

echo "== Loopback-only check"
if ss -tlnH 'sport = :5432' | awk '{print $4}' | grep -vE '^(127\.0\.0\.1|\[::1\]):5432$' | grep -q .; then
  echo "PostgreSQL is listening beyond loopback" >&2
  exit 1
fi
ss -tlnH 'sport = :5432' | awk '{print $4}'
