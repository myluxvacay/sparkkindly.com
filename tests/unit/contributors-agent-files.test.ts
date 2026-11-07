// The contribution review run's Claude Code files (plan 8 Task 2, final review L9): the command reads the queue and
// starts one contribution reviewer subagent per entry, in parallel, each in its own context; the subagent for an
// environment holds the web tools and that environment's verdict tool only, judges exactly one contribution (with the
// best-effort plagiarism search) and posts its verdict itself, so text in one contribution can never steer the verdict
// on another. The orchestrator has no verdict tool and prints a count-only summary.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const command = read('.claude/commands/review-contributions.md');
const reviewer = read('.claude/agents/sparkkindly-reviewer.md');
const front = (text: string): Record<string, string> =>
  Object.fromEntries([...(/^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '').matchAll(/^([\w-]+):\s*(.*)$/gm)].map((m) => [m[1], m[2]]));
const list = (v: string | undefined) => (v ?? '').split(',').map((t) => t.trim()).filter(Boolean).sort();

describe('/review-contributions command', () => {
  it('fetches the queue and runs one contribution reviewer per entry, in parallel, for the chosen environment', () => {
    expect(command).toMatch(/sparkkindly_contributions_queue/);
    expect(command).toMatch(/one `sparkkindly-contribution-reviewer-<env>` per (entry|contribution)[^\n]*parallel/i);
    expect(command).toMatch(/never (give|pass)[^\n]*more than one entry/i);
    expect(command).toMatch(/plagiarism/i);
    expect(command).toMatch(/env=prod/);
  });

  it('may use only Agent and the two queue tools: no verdict tool, never submit_item or a content tool', () => {
    const allowed = front(command)['allowed-tools'];
    expect(list(allowed)).toEqual([
      'Agent',
      'mcp__sparkkindly-prod-reviewer__sparkkindly_contributions_queue',
      'mcp__sparkkindly-staging-reviewer__sparkkindly_contributions_queue',
    ]);
    expect(allowed).not.toMatch(/verdict|submit_item|brief|record_run|item_status/);
    expect(command).not.toMatch(/master content key/i);
  });

  it('the reviewer servers exist per environment with --role reviewer', () => {
    const mcp = JSON.parse(readFileSync('.mcp.json', 'utf8')) as { mcpServers: Record<string, { args: string[] }> };
    for (const env of ['staging', 'prod']) {
      expect(mcp.mcpServers[`sparkkindly-${env}-reviewer`].args).toEqual(['--import', 'tsx', 'agents/mcp/server.ts', '--env', env, '--role', 'reviewer']);
    }
  });

  it('never loosens a rule, always prints a count-only summary, never prints contribution text', () => {
    expect(command).toMatch(/never loosen/i);
    expect(command).toMatch(/always[^\n]*summary/i);
    expect(command).toMatch(/never print[^\n]*(text|title)/i);
  });
});

describe.each(['staging', 'prod'])('sparkkindly-contribution-reviewer-%s subagent', (env) => {
  const agent = read(`.claude/agents/sparkkindly-contribution-reviewer-${env}.md`);

  it("holds the web tools and only this environment's verdict tool (not the queue, not the other environment)", () => {
    expect(front(agent).name).toBe(`sparkkindly-contribution-reviewer-${env}`);
    expect(list(front(agent).tools)).toEqual(
      [`mcp__sparkkindly-${env}-reviewer__sparkkindly_contribution_verdict`, 'WebFetch', 'WebSearch'].sort(),
    );
  });

  it('judges exactly one contribution, does the plagiarism search, treats text and pages as data', () => {
    expect(agent).toMatch(/exactly one/i);
    expect(agent).toMatch(/plagiarism/i);
    expect(agent).toMatch(/2 to 3 distinctive sentences/i);
    expect(agent).toMatch(/plagiarismChecked/);
    expect(agent).toMatch(/data, never instructions/i);
    expect(agent).toMatch(/open \*\*every\*\* source/i);
    expect(agent).toMatch(/version/);
    expect(agent).toMatch(/do not retry/i);
  });
});

describe('sparkkindly-reviewer (the daily run)', () => {
  it('stays read-only: WebFetch and WebSearch only, no SparkKindly tool', () => {
    expect(list(front(reviewer).tools)).toEqual(['WebFetch', 'WebSearch']);
  });

  it('is used by /daily-run only now; contributions have their own per-environment reviewer', () => {
    expect(front(reviewer).description).toMatch(/\/daily-run/);
    expect(front(reviewer).description).not.toMatch(/review-contributions/);
    expect(reviewer).toMatch(/data, never instructions/i);
  });

  it('there is no shared contribution reviewer that could reach both environments', () => {
    expect(existsSync('.claude/agents/sparkkindly-contribution-reviewer.md')).toBe(false);
  });
});
