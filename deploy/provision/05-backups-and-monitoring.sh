#!/usr/bin/env bash
# Install nightly encrypted backups, the monthly restore test and the hourly disk check on the VM.
# - generates the age key pair if absent (the private key stays in /root/.config/sparkkindly/age.key; the owner copies
#   it into their password manager from their own terminal; this script prints only the PUBLIC key)
# - writes /opt/sparkkindly/shared/backup.env (mode 600): Backblaze key, age public key, heartbeat URLs, database list
# - installs scripts to /opt/sparkkindly/bin, the systemd units, and enables the three timers
# Secrets are read from the environment, or prompted for with hidden input; they are never echoed or passed as arguments.
# Run as root on the VM from the directory that contains deploy/. Idempotent: existing values are kept unless re-supplied.
# Verified by: OPERATIONS.md ("Backups", "Restore", "Monitoring and alerts") by-hand runs.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
DEPLOY=$(cd "$HERE/.." && pwd)
ENV_FILE=/opt/sparkkindly/shared/backup.env
KEY_DIR=/root/.config/sparkkindly
KEY=$KEY_DIR/age.key

[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }
command -v age > /dev/null && command -v rclone > /dev/null || { echo "age and rclone must be installed (01-base.sh)" >&2; exit 1; }

install -d -m 700 /var/backups/sparkkindly "$KEY_DIR"
if [ ! -f "$KEY" ]; then
  age-keygen -o "$KEY" 2> /dev/null
  chmod 600 "$KEY"
  NEW_KEY=1
fi
RECIPIENT=$(age-keygen -y "$KEY")

ask() { # ask NAME "prompt": use the environment value, else the stored one, else prompt (hidden)
  local name=$1 prompt=$2 current=""
  [ -f "$ENV_FILE" ] && current=$(sed -n "s/^$name=//p" "$ENV_FILE" | head -n 1)
  if [ -n "${!name:-}" ]; then printf '%s' "${!name}"; return; fi
  if [ -n "$current" ]; then printf '%s' "$current"; return; fi
  [ -t 0 ] || { echo "$name not set and no terminal to ask on" >&2; exit 1; }
  local v; read -rsp "$prompt: " v < /dev/tty; echo >&2; printf '%s' "$v"
}

B2_ACCOUNT=$(ask B2_ACCOUNT "Backblaze keyID")
B2_KEY=$(ask B2_KEY "Backblaze applicationKey")
HB_BACKUP=$(ask HEARTBEAT_BACKUP_URL "Heartbeat URL for backup")
HB_RESTORE=$(ask HEARTBEAT_RESTORE_URL "Heartbeat URL for restore test")
HB_DISK=$(ask HEARTBEAT_DISK_URL "Heartbeat URL for disk")

umask 077
cat > "$ENV_FILE.new" <<ENV
# Written by 05-backups-and-monitoring.sh. Mode 600, root only. Never commit.
B2_BUCKET=sparkkindly-backups
RCLONE_CONFIG_B2_TYPE=b2
RCLONE_CONFIG_B2_ACCOUNT=$B2_ACCOUNT
RCLONE_CONFIG_B2_KEY=$B2_KEY
RCLONE_B2_NO_CHECK_BUCKET=true
AGE_RECIPIENT=$RECIPIENT
# Databases to back up. Add sparkkindly here at the production cut-over, after its schema exists.
BACKUP_DATABASES=${BACKUP_DATABASES:-sparkkindly_staging}
HEARTBEAT_BACKUP_URL=$HB_BACKUP
HEARTBEAT_RESTORE_URL=$HB_RESTORE
HEARTBEAT_DISK_URL=$HB_DISK
ENV
chmod 600 "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"

install -d -m 755 /opt/sparkkindly/bin
for s in backup restore restore-test check-disk; do install -m 755 "$DEPLOY/bin/$s.sh" /opt/sparkkindly/bin/; done
for u in backup restore-test disk; do
  install -m 644 "$DEPLOY/systemd/sparkkindly-$u.service" "$DEPLOY/systemd/sparkkindly-$u.timer" /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable --now sparkkindly-backup.timer sparkkindly-restore-test.timer sparkkindly-disk.timer

echo "Public key: $RECIPIENT"
if [ "${NEW_KEY:-0}" = 1 ]; then
  echo "A NEW private key was created at $KEY."
  echo "Copy it into your password manager NOW from this terminal (cat $KEY), then clear your screen."
  echo "Without it, backups cannot be restored if this server is lost."
fi
systemctl list-timers 'sparkkindly-*' --no-pager
