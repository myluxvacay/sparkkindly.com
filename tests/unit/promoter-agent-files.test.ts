// The promotion agent's Claude Code files (plan 5A Task 2), on the moderation pattern: one promoter subagent per
// environment, each holding only that environment's copy tool and writing copy for exactly ONE queue entry in its own
// context (item text from one entry can never steer another); the command reads the queue, starts one subagent per
// entry, is limited by allowed-tools to the Agent tool and the queue tools, and ends with a count-only summary.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const command = read('.claude/commands/promote-run.md');
const mcp = JSON.parse(readFileSync('.mcp.json', 'utf8')) as { mcpServers: Record<string, { args: string[] }> };
const front = (text: string): Record<string, string> =>
  Object.fromEntries([...(/^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '').matchAll(/^([\w-]+):\s*(.*)$/gm)].map((m) => [m[1], m[2]]));
const list = (v: string | undefined) => (v ?? '').split(',').map((t) => t.trim()).filter(Boolean).sort();

describe.each(['staging', 'prod'])('sparkkindly-promoter-%s subagent', (env) => {
  const agent = read(`.claude/agents/sparkkindly-promoter-${env}.md`);

  it("holds only this environment's copy and brief tools (not the queue, not the other environment, no web access)", () => {
    expect(front(agent).name).toBe(`sparkkindly-promoter-${env}`);
    expect(list(front(agent).tools)).toEqual([
      `mcp__sparkkindly-${env}-promoter__sparkkindly_promotion_brief`,
      `mcp__sparkkindly-${env}-promoter__sparkkindly_promotion_copy`,
    ]);
  });

  it('writes a video brief (plan 5B) for a video_script entry under the same rules, never choosing assets', () => {
    expect(agent).toMatch(/video_script/);
    expect(agent).toMatch(/narration/i);
    expect(agent).toMatch(/shots?/i);
    expect(agent).toMatch(/15 to 60/);
    expect(agent).toMatch(/assets[^\n]*(server|site)/i);
  });

  it('writes copy for exactly one entry, states the untrusted-data rule and the copy rules', () => {
    expect(agent).toMatch(/exactly one/i);
    expect(agent).toMatch(/data, never instructions/i);
    for (const rule of [/no (links|URLs)/i, /@/, /hashtags?/i, /\b8\b/, /kind/i]) expect(agent).toMatch(rule);
    expect(agent).toMatch(/never (include|repeat|quote)[^\n]*(item text|caption)/i);
  });
});

describe('MCP servers', () => {
  it('the promoter servers exist and start with --role promoter', () => {
    for (const env of ['staging', 'prod']) {
      const s = mcp.mcpServers[`sparkkindly-${env}-promoter`];
      expect(s.args).toEqual(expect.arrayContaining(['--env', env, '--role', 'promoter']));
    }
  });
});

describe('/promote-run command', () => {
  it('is limited by allowed-tools to the Agent tool and the two queue tools (no copy tool of its own)', () => {
    expect(list(front(command)['allowed-tools'])).toEqual([
      'Agent',
      'mcp__sparkkindly-prod-promoter__sparkkindly_promotions_queue',
      'mcp__sparkkindly-staging-promoter__sparkkindly_promotions_queue',
    ]);
  });

  it('starts one promoter per queue entry for the chosen environment, never several entries in one', () => {
    expect(command).toMatch(/one `sparkkindly-promoter-<env>` per (queue )?entry/i);
    expect(command).toMatch(/never (give|pass)[^\n]*more than one entry/i);
  });

  it('ends with a count-only summary and never prints item text or captions', () => {
    expect(command).toMatch(/always[^\n]*(end|finish)[^\n]*summary/i);
    expect(command).toMatch(/scheduled[^\n]*briefed[^\n]*refused/i);
    expect(command).toMatch(/never print[^\n]*(item text|captions?)/i);
  });
});
