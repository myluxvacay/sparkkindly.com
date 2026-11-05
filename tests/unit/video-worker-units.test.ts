// The video poster's own systemd service and timer (5B review M4): long uploads run outside the one-minute worker tick,
// with a longer start timeout and more memory but the same hardening, one pair per environment; the release ships its
// bundle; provisioning creates each environment's own media and token directories (5B review M1).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import pkg from '../../package.json';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe.each([
  ['', 'sparkkindly', '/opt/sparkkindly/app/current', 'prod.env'],
  ['-staging', 'sparkkindly-staging', '/opt/sparkkindly-staging/current', 'staging.env'],
])('sparkkindly-video-poster%s', (suffix, user, dir, envFile) => {
  const service = read(`deploy/systemd/sparkkindly-video-poster${suffix}.service`);
  const timer = read(`deploy/systemd/sparkkindly-video-poster${suffix}.timer`);

  it('runs the video bundle as the environment user, oneshot, with the long timeout, more memory and the worker hardening', () => {
    for (const line of [
      'Type=oneshot',
      `User=${user}`,
      `Group=${user}`,
      `WorkingDirectory=${dir}`,
      `EnvironmentFile=/opt/sparkkindly/shared/${envFile}`,
      'ExecStart=/opt/sparkkindly/node/bin/node video-worker.mjs',
      'TimeoutStartSec=1800',
      'MemoryMax=512M',
      'NoNewPrivileges=true',
      'PrivateTmp=true',
      'ProtectSystem=full',
    ]) {
      expect(service).toContain(line);
    }
  });

  it('is started every 5 minutes by its timer', () => {
    expect(timer).toContain(`Unit=sparkkindly-video-poster${suffix}.service`);
    expect(timer).toContain('OnUnitActiveSec=5min');
    expect(timer).toContain('WantedBy=timers.target');
  });
});

describe('release and provisioning', () => {
  it('the deploy builds video-worker.mjs beside worker.mjs', () => {
    expect(pkg.scripts['worker:video:build']).toMatch(/^esbuild worker\/video\.ts --bundle .*--outfile=release\/video-worker\.mjs$/);
    expect(read('.github/workflows/deploy.yml')).toContain('npm run worker:video:build');
  });

  it('provisioning creates separate token and media directories, mode 0700, for each service user', () => {
    const base = read('deploy/provision/01-base.sh');
    expect(base).toContain('install -d -o sparkkindly -g sparkkindly -m 0700 /opt/sparkkindly/shared/social-tokens');
    expect(base).toContain('install -d -o sparkkindly-staging -g sparkkindly-staging -m 0700 /opt/sparkkindly/shared/social-tokens-staging');
    expect(base).toMatch(/-o sparkkindly -g sparkkindly -m 0700 \/opt\/sparkkindly\/shared\/media\/social /);
    expect(base).toMatch(/-o sparkkindly-staging -g sparkkindly-staging -m 0700 \/opt\/sparkkindly\/shared\/media\/social-staging /);
    const staging = read('deploy/env/staging.env.example');
    expect(staging).toMatch(/^SOCIAL_TOKEN_FILE=\/opt\/sparkkindly\/shared\/social-tokens-staging\/tokens\.json$/m);
    expect(staging).toMatch(/^SOCIAL_MEDIA_DIR=\/opt\/sparkkindly\/shared\/media\/social-staging$/m);
    const services = read('deploy/provision/03-services.sh');
    expect(services).toContain('sparkkindly-video-poster.timer');
    expect(services).toContain('sparkkindly-video-poster-staging.timer');
  });
});
