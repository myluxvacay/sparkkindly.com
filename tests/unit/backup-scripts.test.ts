// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Runs the real deploy/bin scripts under bash with stub versions of pg_dump, age, rclone, runuser and curl, so the failure
// paths (the ones that must upload nothing and ping nothing) are proven without a server. Skipped where bash is missing.
const BASH = process.env.TEST_BASH ?? 'bash';
const hasBash = spawnSync(BASH, ['-c', 'echo ok'], { encoding: 'utf8' }).stdout?.trim() === 'ok';
const posix = (p: string) => {
  const q = p.split(path.sep).join('/');
  return /^[A-Za-z]:/.test(q) ? `/${q[0].toLowerCase()}${q.slice(2)}` : q;
};

let dir: string;
const calls = () => (fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8') : '');

function stub(name: string, body: string) {
  fs.writeFileSync(path.join(dir, 'bin', name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

function run(script: string, args: string[] = [], env: Record<string, string> = {}) {
  const r = spawnSync(BASH, [path.resolve('deploy/bin', script), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${posix(path.join(dir, 'bin'))}:${process.env.PATH}`,
      BACKUP_ENV_FILE: posix(path.join(dir, 'backup.env')),
      BACKUP_DIR: posix(path.join(dir, 'out')),
      RESTORE_DIR: posix(path.join(dir, 'restore')),
      AGE_KEY_FILE: posix(path.join(dir, 'age.key')),
      LOG: posix(path.join(dir, 'calls.log')),
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(
    path.join(dir, 'backup.env'),
    'AGE_RECIPIENT=age1test\nB2_BUCKET=bkt\nBACKUP_DATABASES=dbone\nHEARTBEAT_BACKUP_URL=https://hb.example.test/b\nHEARTBEAT_DISK_URL=https://hb.example.test/d\n',
  );
  fs.writeFileSync(path.join(dir, 'age.key'), 'AGE-SECRET-KEY-TEST');
  stub('runuser', 'shift 3; exec "$@"'); // runuser -u postgres -- cmd args
  stub('pg_dump', 'if [ "${PGDUMP_FAIL:-0}" = 1 ]; then echo "pg_dump: error" >&2; exit 1; fi; head -c "${PGDUMP_BYTES:-20000}" /dev/zero; [ "${PGDUMP_DIE_LATE:-0}" = 1 ] && { echo "pg_dump: connection lost" >&2; exit 1; }; exit 0');
  stub('age', 'out=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done; cat > "$out"');
  stub('rclone', 'echo "rclone $*" >> "$LOG"');
  stub('curl', 'echo "curl $*" >> "$LOG"');
  stub('createdb', 'echo "createdb $*" >> "$LOG"');
  stub('pg_restore', 'echo "pg_restore $*" >> "$LOG"; cat > /dev/null');
  stub('dropdb', 'echo "dropdb $*" >> "$LOG"');
  stub('df', 'printf "Use%%\n %s%%\n" "${FAKE_DISK:-7}"');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!hasBash)('backup.sh', () => {
  it('uploads and pings the heartbeat last on success, and never deletes from B2', () => {
    const r = run('backup.sh');
    expect(r.code, r.out).toBe(0);
    const log = calls().trim().split('\n');
    expect(log[0]).toMatch(/^rclone copyto .*dbone-.*\.dump\.age b2:bkt\/db\/dbone-/);
    expect(log[1]).toMatch(/^curl .*https:\/\/hb\.example\.test\/b$/);
    expect(log).toHaveLength(2);
    expect(calls()).not.toMatch(/rclone delete|--b2-hard-delete/);
  });

  it('uploads nothing and pings nothing when pg_dump fails', () => {
    const r = run('backup.sh', [], { PGDUMP_FAIL: '1' });
    expect(r.code).not.toBe(0);
    expect(calls()).toBe('');
    expect(fs.readdirSync(path.join(dir, 'out'))).toEqual([]); // no partial file left behind
  });

  it('does not upload a dump that dies midway, even when it is already larger than the minimum', () => {
    const r = run('backup.sh', [], { PGDUMP_DIE_LATE: '1' });
    expect(r.code).not.toBe(0);
    expect(calls()).toBe('');
    expect(fs.readdirSync(path.join(dir, 'out'))).toEqual([]);
  });

  it('refuses a dump below the minimum size', () => {
    const r = run('backup.sh', [], { PGDUMP_BYTES: '100' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/not uploading/);
    expect(calls()).toBe('');
  });
});

describe.skipIf(!hasBash)('restore.sh', () => {
  it('refuses the live databases without --force and touches nothing', () => {
    for (const db of ['sparkkindly', 'sparkkindly_staging']) {
      const r = run('restore.sh', ['b2:bkt/db/x.dump.age', db]);
      expect(r.code, db).toBe(3);
      expect(r.out).toMatch(/Refusing to overwrite/);
    }
    expect(calls()).toBe('');
  });

  it('gives a scratch database a low-privilege owner, never the production role by default', () => {
    fs.writeFileSync(path.join(dir, 'x.dump.age'), 'x');
    stub('age', 'echo "age $*" >> "$LOG"; echo plaintext-dump');
    const posixFile = posix(path.join(dir, 'x.dump.age'));
    expect(run('restore.sh', [posixFile, 'scratchdb'], { RESTORE_OWNER: 'sparkkindly_staging' }).code).toBe(0);
    expect(calls()).toMatch(/createdb -O sparkkindly_staging scratchdb/);
    expect(calls()).toMatch(/--role=sparkkindly_staging/);
    // The decrypted dump goes to pg_restore on stdin: no file argument, and no plaintext file left in the work directory.
    expect(calls()).toMatch(/pg_restore -d scratchdb --no-owner --role=sparkkindly_staging\s*$/m);
    expect(fs.readdirSync(path.join(dir, 'restore')).filter((f) => f.endsWith('.dump'))).toEqual([]);
    expect(run('restore.sh', [posixFile, 'scratchdb', ''], { RESTORE_OWNER: 'x; drop role y' }).code).toBe(2);
  });

  it('rejects an unsafe database name', () => {
    expect(run('restore.sh', ['/nope', 'x; drop database y']).code).toBe(2);
  });
});

describe.skipIf(!hasBash)('check-disk.sh', () => {
  it('pings below the threshold and stays silent at or above it', () => {
    expect(run('check-disk.sh', [], { FAKE_DISK: '7' }).code).toBe(0);
    expect(calls()).toMatch(/curl .*hb\.example\.test\/d/);
    fs.rmSync(path.join(dir, 'calls.log'));
    const r = run('check-disk.sh', [], { FAKE_DISK: '85' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/at or above threshold/);
    expect(calls()).toBe('');
  });
});
