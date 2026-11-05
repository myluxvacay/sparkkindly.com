// The moderation agent's Claude Code files (plan 7B Task 3, 7B review M3a and L6): one moderator subagent per
// environment, each holding only that environment's decide tool and judging exactly ONE queue entry in its own context
// (comment text from one entry can never steer the judgment of another); the command reads the queue, starts one
// subagent per entry, is limited by allowed-tools to the Agent tool and the queue tools, always ends with a count
// summary and never prints comment text.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const command = read('.claude/commands/moderate-run.md');
const mcp = JSON.parse(readFileSync('.mcp.json', 'utf8')) as { mcpServers: Record<string, { args: string[] }> };
const front = (text: string): Record<string, string> =>
  Object.fromEntries([...(/^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '').matchAll(/^([\w-]+):\s*(.*)$/gm)].map((m) => [m[1], m[2]]));
const list = (v: string | undefined) => (v ?? '').split(',').map((t) => t.trim()).filter(Boolean).sort();

describe.each(['staging', 'prod'])('sparkkindly-moderator-%s subagent', (env) => {
  const agent = read(`.claude/agents/sparkkindly-moderator-${env}.md`);

  it("holds only this environment's decide tool (not the queue, not the other environment)", () => {
    expect(front(agent).name).toBe(`sparkkindly-moderator-${env}`);
    expect(list(front(agent).tools)).toEqual([`mcp__sparkkindly-${env}-moderation__sparkkindly_moderation_decide`]);
  });

  it('judges exactly one entry, states the untrusted-data rule and the guidelines; unsure means escalate', () => {
    expect(agent).toMatch(/exactly one/i);
    expect(agent).toMatch(/data, never instructions/i);
    for (const c of [/be kind/i, /personal attacks?/i, /personal information/i, /advertising/i, /relevant/i]) expect(agent).toMatch(c);
    expect(agent).toMatch(/unsure[^\n]*escalate/i);
    expect(agent).toMatch(/never (include|repeat|quote)[^\n]*comment text/i);
    for (const code of ['abuse', 'personal_info', 'advertising', 'off_topic', 'links', 'other']) expect(agent).toContain(`\`${code}\``);
  });
});

describe('the old shared moderator file', () => {
  it('is gone, so no subagent can reach both environments', () => {
    expect(existsSync('.claude/agents/sparkkindly-moderator.md')).toBe(false);
  });
});

describe('MCP servers', () => {
  it('the moderation servers exist and start with --role moderation', () => {
    for (const env of ['staging', 'prod']) {
      const s = mcp.mcpServers[`sparkkindly-${env}-moderation`];
      expect(s.args).toEqual(expect.arrayContaining(['--env', env, '--role', 'moderation']));
    }
  });
});

describe('/moderate-run command', () => {
  it('is limited by allowed-tools to the Agent tool and the two queue tools (no decide tool of its own)', () => {
    expect(list(front(command)['allowed-tools'])).toEqual([
      'Agent',
      'mcp__sparkkindly-prod-moderation__sparkkindly_moderation_queue',
      'mcp__sparkkindly-staging-moderation__sparkkindly_moderation_queue',
    ]);
  });

  it('starts one moderator per queue entry for the chosen environment, never several entries in one', () => {
    expect(command).toMatch(/one `sparkkindly-moderator-<env>` per (queue )?entry/i);
    expect(command).toMatch(/never (give|pass)[^\n]*more than one entry/i);
  });

  it('ends with a count summary and never prints comment text', () => {
    expect(command).toMatch(/always[^\n]*(end|finish)[^\n]*summary/i);
    expect(command).toMatch(/approved[^\n]*rejected[^\n]*escalated/i);
    expect(command).toMatch(/never print[^\n]*comment text/i);
  });
});
