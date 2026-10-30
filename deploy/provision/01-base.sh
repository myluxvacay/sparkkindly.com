#!/usr/bin/env bash
# Base provisioning for the SparkKindly VM: OS updates, swap, the sparkkindly service user, a private Node 24.
# Run as root on the VM. Idempotent: running it again changes nothing.
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

echo "== Service user and directories"
id sparkkindly >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/sparkkindly --shell /bin/bash sparkkindly
install -d -o sparkkindly -g sparkkindly /opt/sparkkindly/releases /opt/sparkkindly/bin /opt/sparkkindly-staging /opt/sparkkindly-staging/releases
install -d -o root -g sparkkindly -m 750 /opt/sparkkindly/shared

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
