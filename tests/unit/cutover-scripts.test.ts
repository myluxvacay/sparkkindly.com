// @vitest-environment node
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Runs the cut-over scripts against a temporary directory with stub commands. Nothing here touches Caddy or a server.
// Set TEST_BASH to a bash that can run them (on Windows, Git Bash); the tests skip if there is none.
const BASH = process.env.TEST_BASH ?? 'bash';
const hasBash = spawnSync(BASH, ['-c', 'command -v curl >/dev/null && echo ok']).stdout?.toString().trim() === 'ok';
const SWITCH = 'deploy/cutover/switch-to-app.sh';
const ROLLBACK = 'deploy/cutover/rollback-to-static.sh';
const slash = (p: string) => p.replace(/\\/g, '/');

let app: http.Server;
let appUrl = '';
beforeAll(async () => {
  app = http.createServer((_, res) => res.end('ok'));
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  appUrl = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
});
afterAll(() => app.close());

const ORIGINAL = '# MyLuxVacation blocks stay untouched\nexample.test {\n}\nimport /snip/sparkkindly-public.caddy\n';

function setup() {
  const dir = slash(fs.mkdtempSync(path.join(os.tmpdir(), 'cutover-')));
  const snip = `${dir}/snip`;
  fs.mkdirSync(snip);
  const caddyfile = `${dir}/Caddyfile`;
  const template = `${dir}/template`;
  const text = ORIGINAL.replace(/\/snip\//g, `${snip}/`);
  fs.writeFileSync(caddyfile, text);
  fs.writeFileSync(template, text);
  return { dir, snip, caddyfile, template, text };
}

// Async on purpose: the stub app server lives in this process, so a blocking spawn would starve it.
function run(script: string, args: string[], t: ReturnType<typeof setup>, env: Record<string, string> = {}) {
  return new Promise<{ status: number; stderr: string }>((resolve) => execFile(BASH, [script, ...args], {
    env: {
      ...process.env, CADDYFILE_TEST: '1', CADDYFILE: t.caddyfile, TEMPLATE: t.template, SNIPPET_DIR: t.snip,
      BACKUP_ROOT: `${t.dir}/backups`, CADDY: 'true', RELOAD: 'true', PUBLIC_CHECK: 'true', APP_URL: appUrl, ...env,
    },
  }, (err, _out, stderr) => resolve({ status: err ? Number((err as { code?: number }).code ?? 1) : 0, stderr })));
}
const OK = ['--confirm-owner-authorized', '--confirm-backup-verified'];

describe.skipIf(!hasBash)('cut-over scripts', () => {
  it('refuse without both confirmations and change nothing', async () => {
    const t = setup();
    expect((await run(SWITCH, [], t)).status).toBe(2);
    expect((await run(SWITCH, ['--confirm-owner-authorized'], t)).status).toBe(2);
    expect(fs.readFileSync(t.caddyfile, 'utf8')).toBe(t.text);
  });

  it('refuse when the two Caddyfiles differ', async () => {
    const t = setup();
    fs.appendFileSync(t.template, '# drift\n');
    const r = await run(SWITCH, OK, t);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/differ/);
  });

  it('refuse when the app is not healthy', async () => {
    const t = setup();
    const r = await run(SWITCH, OK, t, { APP_URL: 'http://127.0.0.1:1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not healthy/);
    expect(fs.readFileSync(t.caddyfile, 'utf8')).toBe(t.text);
  });

  it('a dry run validates and changes nothing', async () => {
    const t = setup();
    const r = await run(SWITCH, [...OK, '--dry-run'], t);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(t.caddyfile, 'utf8')).toBe(t.text);
    expect(fs.existsSync(`${t.snip}/sparkkindly-public-app.caddy`)).toBe(false);
  });

  it('swaps only the import line in both files, then rollback restores them exactly', async () => {
    const t = setup();
    const r = await run(SWITCH, OK, t);
    expect(r.status, r.stderr).toBe(0);
    const after = fs.readFileSync(t.caddyfile, 'utf8');
    expect(after).toBe(t.text.replace('sparkkindly-public.caddy', 'sparkkindly-public-app.caddy'));
    expect(fs.readFileSync(t.template, 'utf8')).toBe(after);
    expect(fs.readFileSync(`${t.snip}/sparkkindly-public-app.caddy`, 'utf8')).toContain('reverse_proxy 127.0.0.1:3100');
    const backup = fs.readdirSync(`${t.dir}/backups`)[0];
    const rb = await run(ROLLBACK, [`${t.dir}/backups/${backup}`], t);
    expect(rb.status, rb.stderr).toBe(0);
    expect(fs.readFileSync(t.caddyfile, 'utf8')).toBe(t.text);
    expect(fs.readFileSync(t.template, 'utf8')).toBe(t.text);
    expect(fs.existsSync(`${t.snip}/sparkkindly-public-app.caddy`)).toBe(false);
  });

  it('restores automatically when the public check fails or the reload fails', async () => {
    for (const env of [{ PUBLIC_CHECK: 'false' }, { RELOAD: 'false' }] as Record<string, string>[]) {
      const t = setup();
      const r = await run(SWITCH, OK, t, env);
      expect(r.status).toBe(1);
      expect(fs.readFileSync(t.caddyfile, 'utf8')).toBe(t.text);
      expect(fs.readFileSync(t.template, 'utf8')).toBe(t.text);
    }
  });

  it('leaves everything unchanged when the candidate fails validation', async () => {
    const t = setup();
    const r = await run(SWITCH, OK, t, { CADDY: 'false' });
    expect(r.status).toBe(1);
    expect(fs.readFileSync(t.caddyfile, 'utf8')).toBe(t.text);
    expect(fs.existsSync(`${t.snip}/sparkkindly-public-app.caddy`)).toBe(false);
  });

  it('rollback refuses a missing backup directory', async () => {
    const t = setup();
    expect((await run(ROLLBACK, [`${t.dir}/nope`], t)).status).toBe(2);
    expect((await run(ROLLBACK, [], t)).status).toBe(2);
  });
});
