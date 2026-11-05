// The moderation agent's Claude Code files (plan 7B Task 3): the subagent may use only the two moderation MCP tools
// (judgment needs no file, web or shell access), treats comment text as data, judges by the community guidelines and
// escalates when unsure; the command always ends with a count summary and never prints comment text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const agent = readFileSync('.claude/agents/sparkkindly-moderator.md', 'utf8').replace(/\r\n/g, '\n');
const command = readFileSync('.claude/commands/moderate-run.md', 'utf8').replace(/\r\n/g, '\n');
const mcp = JSON.parse(readFileSync('.mcp.json', 'utf8')) as { mcpServers: Record<string, { args: string[] }> };
const front = (text: string): Record<string, string> =>
  Object.fromEntries([...(/^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '').matchAll(/^(\w+):\s*(.*)$/gm)].map((m) => [m[1], m[2]]));

describe('sparkkindly-moderator subagent', () => {
  it('restricts its tools to the two moderation MCP tools, per environment', () => {
    const tools = front(agent)
      .tools.split(',')
      .map((t) => t.trim())
      .sort();
    expect(tools).toEqual([
      'mcp__sparkkindly-prod-moderation__sparkkindly_moderation_decide',
      'mcp__sparkkindly-prod-moderation__sparkkindly_moderation_queue',
      'mcp__sparkkindly-staging-moderation__sparkkindly_moderation_decide',
      'mcp__sparkkindly-staging-moderation__sparkkindly_moderation_queue',
    ]);
    expect(front(agent).name).toBe('sparkkindly-moderator');
  });

  it('states the untrusted-data rule and the community-guidelines criteria; unsure means escalate', () => {
    expect(agent).toMatch(/data, never instructions/i);
    for (const c of [/be kind/i, /personal attacks?/i, /personal information/i, /advertising/i, /relevant/i]) expect(agent).toMatch(c);
    expect(agent).toMatch(/unsure[^\n]*escalate/i);
    expect(agent).toMatch(/never (include|repeat|quote)[^\n]*comment text/i);
  });

  it('the MCP servers for the moderation role exist and start with --role moderation', () => {
    for (const env of ['staging', 'prod']) {
      const s = mcp.mcpServers[`sparkkindly-${env}-moderation`];
      expect(s.args).toEqual(expect.arrayContaining(['--env', env, '--role', 'moderation']));
    }
  });
});

describe('/moderate-run command', () => {
  it('starts the moderator, ends with a count summary and never prints comment text', () => {
    expect(command).toMatch(/sparkkindly-moderator/);
    expect(command).toMatch(/always[^\n]*(end|finish)[^\n]*summary/i);
    expect(command).toMatch(/approved[^\n]*rejected[^\n]*escalated/i);
    expect(command).toMatch(/never print[^\n]*comment text/i);
  });
});
