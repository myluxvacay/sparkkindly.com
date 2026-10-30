#!/usr/bin/env bash
# Base provisioning for the SparkKindly VM: OS updates, swap, two service users, a private Node 24.
# Run as root on the VM. Idempotent: running it again changes nothing.
#
# Layout and ownership (the runtime users may write only their own release directory):
#   /opt/sparkkindly                root:root 755   node/, bin/ (deploy script), home/ (deploy logins), shared/ (root only)
#   /opt/sparkkindly/app            sparkkindly      releases/, current, previous        (production)
#   /opt/sparkkindly-staging        sparkkindly-staging  releases/, current, previous    (staging)
# Verified by: docs/superpowers/plans/2026-10-30-project-0-foundations.md, Task 3 (steps 4 and 5).
set -euo pipefail

NODE_VERSION=24.22.0
NODE_DIR=/opt/sparkkindly/node

[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }

echo "== Packages"
export DEBIAN_FRONTEND=noninteractive
# needrestart in list-only mode: upgrading libraries must not restart Caddy, MongoDB or MyLuxVacation behind our back.
export NEEDRESTART_MODE=l
apt-get update -qq
apt-get -y -qq full-upgrade
apt-get -y -qq install unattended-upgrades age rclone curl xz-utils
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== Swap (2 GB)"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
fi
swapon --show=NAME | grep -qx /swapfile || swapon /swapfile
grep -qE '^/swapfile\s' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/90-sparkkindly.conf
sysctl -q -w vm.swappiness=10

echo "== Service users (separate for production and staging) and directories"
install -d -o root -g root -m 755 /opt/sparkkindly /opt/sparkkindly/bin /opt/sparkkindly/home
# shared/ is traverse-only (711): nobody can list it, and each file inside carries its own mode, so a user can open
# only the env file that names its group. The release receiver needs this to run a migration with its own env.
install -d -o root -g root -m 711 /opt/sparkkindly/shared
for u in sparkkindly sparkkindly-staging; do
  if id "$u" >/dev/null 2>&1; then
    usermod -d "/opt/sparkkindly/home/$u" "$u"   # an existing user must not keep a user-writable home
  else
    useradd --system --no-create-home --home-dir "/opt/sparkkindly/home/$u" --shell /bin/bash "$u"
  fi
  # Root-owned home and .ssh: the service user cannot replace its own forced-command key.
  install -d -o root -g root -m 755 "/opt/sparkkindly/home/$u" "/opt/sparkkindly/home/$u/.ssh"
done
install -d -o sparkkindly -g sparkkindly /opt/sparkkindly/app /opt/sparkkindly/app/releases
install -d -o sparkkindly-staging -g sparkkindly-staging /opt/sparkkindly-staging /opt/sparkkindly-staging/releases

echo "== Node ${NODE_VERSION} (private install, system Node untouched)"
if [ "$("$NODE_DIR/bin/node" --version 2>/dev/null || true)" != "v${NODE_VERSION}" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  base="https://nodejs.org/dist/v${NODE_VERSION}"
  tarball="node-v${NODE_VERSION}-linux-x64.tar.xz"
  curl -fsSL -m 120 -o "$tmp/$tarball" "$base/$tarball"
  curl -fsSL -m 30 -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
  (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xJf "$tmp/$tarball" -C "$NODE_DIR" --strip-components=1
  chown -R root:root "$NODE_DIR"
fi
"$NODE_DIR/bin/node" --version

echo "== Pending restarts"
if [ -f /var/run/reboot-required ]; then
  echo "*** System restart required (kernel or core library update). Schedule it in the owner's window. ***"
else
  echo "No reboot required"
fi
command -v needrestart >/dev/null && needrestart -b -r l 2>/dev/null | grep -E '^NEEDRESTART-(KSTA|SVC)' || true
