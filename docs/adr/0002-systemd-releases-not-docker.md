# 0002 — Plain systemd services with release directories, not Docker

**Status:** Accepted · 2026-10-30

## Context

The first design proposed Docker Compose on the VM for reproducibility and an easy move to a larger server. The
owner asked whether Docker was needed. The VM already runs MyLuxVacation the plain way: Python services under
systemd behind Caddy, deployed into versioned directories with a `current` symlink (`deploy/activate-public.py`
uses the same pattern for the static mock-up). Docker is not installed. The owner wants one way of doing things on
the server and as little to learn and debug as possible.

## Decision

SparkKindly's web app and worker run as systemd services under a dedicated `sparkkindly` user, each with a
`MemoryMax` limit, on loopback ports behind Caddy. Node 24.22.0 is installed privately under `/opt/sparkkindly/node`
so the system Node used elsewhere is untouched. Each deploy lands in `/opt/sparkkindly/releases/<timestamp>-<sha>`;
`current` is a symlink; rollback is moving the symlink back and restarting; the last five releases are kept. GitHub
Actions delivers a standalone-build tarball over SSH through a forced-command key. Staging is a second pair of
services on other ports with its own database.

## Consequences

- **Positive.** Matches the other site's operating model; no container runtime to patch or debug; direct access to
  logs via `journalctl`; smaller memory footprint on a 2-vCPU VM.
- **Negative.** Moving to a bigger VM is a scripted reinstall (`deploy/provision/*.sh`), a copy of the latest release
  and a database restore, rather than pulling images; environment drift between staging and prod is prevented by
  the provisioning scripts being idempotent and committed, not by image identity.
- **Security / Privacy.** The deploy key can only run the receiver script; the service user's `sudo` is limited to
  restarting its own services; releases are owned by the service user and env files by root, readable by the group.
- **Operational impact.** Provisioning scripts must stay idempotent and be re-run after any manual server change so
  they remain the record of truth.
- **Reversibility.** Cheap: the app is a standard Next.js standalone build; containerising it later is packaging,
  not redesign.
- **Open.** Whether to add a second VM for staging if load tests show contention with MyLuxVacation (owner, after
  Project 1's load test).
