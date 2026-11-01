// @vitest-environment node
import { execFile, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
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

// The stub app: path to body. Tests change `routes` to model a preview build, an empty database and so on.
let app: http.Server;
let appUrl = '';
const GOOD_ROUTES = {
  '/api/health/': '{"ok":true}',
  '/discover/a-day-in-shadows/': 'article',
  '/robots.txt': 'User-agent: *\nAllow: /\n',
  '/': '<html><body>home</body></html>',
};
let routes: Record<string, string> = { ...GOOD_ROUTES };
beforeAll(async () => {
  app = http.createServer((req, res) => {
    const body = routes[req.url ?? ''];
    res.statusCode = body === undefined ? 404 : 200;
    res.end(body ?? 'nope');
  });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  appUrl = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
});
afterAll(() => app.close());

const ORIGINAL = '# MyLuxVacation blocks stay untouched\nexample.test {\n}\nimport /snip/sparkkindly-public.caddy\n';

function setup(original = ORIGINAL) {
  routes = { ...GOOD_ROUTES };
  const dir = slash(fs.mkdtempSync(path.join(os.tmpdir(), 'cutover-')));
  const snip = `${dir}/snip`;
  fs.mkdirSync(snip);
  const caddyfile = `${dir}/Caddyfile`;
  const template = `${dir}/template`;
  const text = original.replace(/\/snip\//g, `${snip}/`);
  fs.writeFileSync(caddyfile, text);
  fs.writeFileSync(template, text);
  return { dir, snip, caddyfile, template, text };
}
type T = ReturnType<typeof setup>;

// Async on purpose: the stub app server lives in this process, so a blocking spawn would starve it.
function run(script: string, args: string[], t: T, env: Record<string, string> = {}) {
  return new Promise<{ status: number; stderr: string; stdout: string }>((resolve) =>
    execFile(BASH, [script, ...args], {
      env: {
        ...process.env, CADDYFILE_TEST: '1', CADDYFILE: t.caddyfile, TEMPLATE: t.template, SNIPPET_DIR: t.snip,
        BACKUP_ROOT: `${t.dir}/backups`, CADDY: 'true', RELOAD: 'true', PUBLIC_CHECK: 'true', STATIC_CHECK: 'true', MLV_CHECK: 'true',
        APP_URL: appUrl, ...env,
      },
    }, (err, stdout, stderr) => resolve({ status: err ? Number((err as { code?: number }).code ?? 1) : 0, stderr, stdout })),
  );
}
const OK = ['--confirm-owner-authorized', '--confirm-backup-verified'];
const read = (f: string) => fs.readFileSync(f, 'utf8');
const switched = (t: T) => t.text.replace('sparkkindly-public.caddy', 'sparkkindly-public-app.caddy');
const backupDir = (t: T) => `${t.dir}/backups/${fs.readdirSync(`${t.dir}/backups`)[0]}`;

describe.skipIf(!hasBash)('switch-to-app.sh', () => {
  it('refuses without both confirmations and changes nothing', async () => {
    const t = setup();
    expect((await run(SWITCH, [], t)).status).toBe(2);
    expect((await run(SWITCH, ['--confirm-owner-authorized'], t)).status).toBe(2);
    expect(read(t.caddyfile)).toBe(t.text);
  });

  it('refuses when the two Caddyfiles differ', async () => {
    const t = setup();
    fs.appendFileSync(t.template, '# drift\n');
    const r = await run(SWITCH, OK, t);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/differ/);
  });

  it('refuses when the app is not healthy', async () => {
    const t = setup();
    const r = await run(SWITCH, OK, t, { APP_URL: 'http://127.0.0.1:1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not healthy/);
    expect(read(t.caddyfile)).toBe(t.text);
  });

  it('refuses a preview build: robots.txt without Allow, or the preview notice on the home page', async () => {
    let t = setup();
    routes['/robots.txt'] = 'User-agent: *\nDisallow: /\n';
    let r = await run(SWITCH, OK, t);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/robots\.txt/);
    t = setup();
    routes['/'] = '<aside aria-label="Preview status">Development preview · The public website uses a separate production build.</aside>';
    r = await run(SWITCH, OK, t);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/preview/i);
    expect(read(t.caddyfile)).toBe(t.text);
  });

  it('refuses a candidate that would change more than one line', async () => {
    const t = setup(`${ORIGINAL}import /snip/sparkkindly-public.caddy\n`);
    const r = await run(SWITCH, OK, t);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/exactly once/); // the import must be unique, so a multi-line change never reaches the candidate check
    expect(read(t.caddyfile)).toBe(t.text);
  });

  it('refuses a snippet whose checksum does not match the pinned value', async () => {
    const t = setup();
    const copy = `${t.dir}/tampered`;
    fs.cpSync('deploy', copy, { recursive: true });
    fs.appendFileSync(`${copy}/caddy/sparkkindly-public-app.caddy`, '# tampered\n');
    const r = await run(`${copy}/cutover/switch-to-app.sh`, OK, t);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/checksum/);
    expect(read(t.caddyfile)).toBe(t.text);
  });

  it('pins the snippet checksum that is actually in the repository', () => {
    const pin = /SNIPPET_SHA256="([0-9a-f]{64})"/.exec(read('deploy/cutover/switch-to-app.sh'))?.[1];
    const actual = crypto.createHash('sha256').update(fs.readFileSync('deploy/caddy/sparkkindly-public-app.caddy')).digest('hex');
    expect(pin).toBe(actual);
  });

  it('a dry run validates and changes nothing', async () => {
    const t = setup();
    const r = await run(SWITCH, [...OK, '--dry-run'], t);
    expect(r.status, r.stderr).toBe(0);
    expect(read(t.caddyfile)).toBe(t.text);
    expect(fs.existsSync(`${t.snip}/sparkkindly-public-app.caddy`)).toBe(false);
  });

  it('swaps only the import line in both files and keeps a backup and candidate', async () => {
    const t = setup();
    const r = await run(SWITCH, OK, t);
    expect(r.status, r.stderr).toBe(0);
    expect(read(t.caddyfile)).toBe(switched(t));
    expect(read(t.template)).toBe(switched(t));
    expect(read(`${t.snip}/sparkkindly-public-app.caddy`)).toContain('reverse_proxy 127.0.0.1:3100');
    expect(read(`${backupDir(t)}/candidate.Caddyfile`)).toBe(switched(t));
  });

  it('a failed public check restores, verifies the static site and says it rolled back', async () => {
    const t = setup();
    const r = await run(SWITCH, OK, t, { PUBLIC_CHECK: 'false' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/rolled back/);
    expect(read(t.caddyfile)).toBe(t.text);
    expect(read(t.template)).toBe(t.text);
  });

  it('a failed MyLuxVacation check restores the files, and exit 4 says the restore could not be confirmed either', async () => {
    const t = setup();
    const r = await run(SWITCH, OK, t, { MLV_CHECK: 'false' });
    expect(r.status).toBe(4);
    expect(read(t.caddyfile)).toBe(t.text);
  });

  it('a reload failure during the restore is reported loudly with its own exit code, files still restored', async () => {
    const t = setup();
    const r = await run(SWITCH, OK, t, { RELOAD: 'false' });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/RELOAD FAILED/);
    expect(read(t.caddyfile)).toBe(t.text);
    expect(read(t.template)).toBe(t.text);
  });

  it('exit code 4 when the restore reloads but the static site does not answer afterwards', async () => {
    const t = setup();
    const r = await run(SWITCH, OK, t, { PUBLIC_CHECK: 'false', STATIC_CHECK: 'false' });
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/NOT CONFIRMED/);
    expect(r.stderr).not.toMatch(/rolled back\./);
  });

  it('an interrupt after the live write restores both files (trap)', async () => {
    const t = setup();
    // First reload (the switch) signals the script itself; later reloads (the restore) succeed.
    const reload = `${t.dir}/reload.sh`;
    fs.writeFileSync(reload, `n=$(cat "${t.dir}/count" 2>/dev/null || echo 0)\necho $((n+1)) > "${t.dir}/count"\nif [ "$n" = 0 ]; then kill -TERM $PPID; sleep 2; fi\nexit 0\n`);
    const r = await run(SWITCH, OK, t, { RELOAD: `bash ${reload}` });
    expect(r.status).not.toBe(0);
    expect(read(t.caddyfile)).toBe(t.text);
    expect(read(t.template)).toBe(t.text);
  });

  it('leaves everything unchanged when the candidate fails validation', async () => {
    const t = setup();
    const r = await run(SWITCH, OK, t, { CADDY: 'false' });
    expect(r.status).toBe(1);
    expect(read(t.caddyfile)).toBe(t.text);
    expect(fs.existsSync(`${t.snip}/sparkkindly-public-app.caddy`)).toBe(false);
  });
});

describe.skipIf(!hasBash)('rollback-to-static.sh', () => {
  async function switchedSetup() {
    const t = setup();
    expect((await run(SWITCH, OK, t)).status).toBe(0);
    return t;
  }

  it('reverses the single import line in the current files and removes the app snippet', async () => {
    const t = await switchedSetup();
    const r = await run(ROLLBACK, [], t);
    expect(r.status, r.stderr).toBe(0);
    expect(read(t.caddyfile)).toBe(t.text);
    expect(read(t.template)).toBe(t.text);
    expect(fs.existsSync(`${t.snip}/sparkkindly-public-app.caddy`)).toBe(false);
  });

  it('keeps newer edits to the Caddyfile instead of restoring an old snapshot', async () => {
    const t = await switchedSetup();
    const newer = `${read(t.caddyfile)}mlv.example.test {\n}\n`;
    fs.writeFileSync(t.caddyfile, newer);
    fs.writeFileSync(t.template, newer);
    const r = await run(ROLLBACK, [], t);
    expect(r.status, r.stderr).toBe(0);
    expect(read(t.caddyfile)).toBe(`${t.text}mlv.example.test {\n}\n`);
  });

  it('accepts the switch backup directory when it matches the current files', async () => {
    const t = await switchedSetup();
    expect((await run(ROLLBACK, [backupDir(t)], t)).status).toBe(0);
  });

  it('refuses a backup directory that does not match the current files, or is not a cutover snapshot', async () => {
    const t = await switchedSetup();
    const real = backupDir(t);
    const other = `${t.dir}/backups/cutover-other`;
    fs.mkdirSync(other);
    fs.writeFileSync(`${other}/candidate.Caddyfile`, `${read(t.caddyfile)}# different\n`);
    let r = await run(ROLLBACK, [other], t);
    expect(r.status).toBe(2);
    const wrongName = `${t.dir}/backups/20260101-activate-public`;
    fs.mkdirSync(wrongName);
    fs.copyFileSync(`${real}/candidate.Caddyfile`, `${wrongName}/candidate.Caddyfile`);
    r = await run(ROLLBACK, [wrongName], t);
    expect(r.status).toBe(2);
    expect(read(t.caddyfile)).toBe(switched(t));
    expect((await run(ROLLBACK, [`${t.dir}/nope`], t)).status).toBe(2);
  });

  it('refuses when nothing was switched, or when the two files differ', async () => {
    const t = setup();
    expect((await run(ROLLBACK, [], t)).status).toBe(1);
    const s = await switchedSetup();
    fs.appendFileSync(s.template, '# drift\n');
    expect((await run(ROLLBACK, [], s)).status).toBe(1);
  });

  it('reports its own reload failure loudly (exit 3) and leaves the files as they were', async () => {
    const t = await switchedSetup();
    const r = await run(ROLLBACK, [], t, { RELOAD: 'false' });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/RELOAD FAILED/);
    expect(read(t.caddyfile)).toBe(switched(t));
  });

  it('does not say "rolled back" unless the static site and MyLuxVacation both answer (exit 4)', async () => {
    for (const env of [{ STATIC_CHECK: 'false' }, { MLV_CHECK: 'false' }] as Record<string, string>[]) {
      const t = await switchedSetup();
      const r = await run(ROLLBACK, [], t, env);
      expect(r.status).toBe(4);
      expect(r.stdout + r.stderr).not.toMatch(/rolled back\./);
    }
  });
});
