// The contribution review run's Claude Code files (plan 8 Task 2): the command mirrors /daily-run's review step for
// contributions (one reviewer per entry, in parallel, verdicts posted, a count-only summary), and the reviewer's
// instructions cover the best-effort plagiarism search and treat contribution text as data.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const command = readFileSync('.claude/commands/review-contributions.md', 'utf8').replace(/\r\n/g, '\n');
const reviewer = readFileSync('.claude/agents/sparkkindly-reviewer.md', 'utf8').replace(/\r\n/g, '\n');

describe('/review-contributions command', () => {
  it('fetches the queue, runs one reviewer per entry in parallel and posts each verdict', () => {
    expect(command).toMatch(/sparkkindly_contributions_queue/);
    expect(command).toMatch(/one `?sparkkindly-reviewer`? per (entry|contribution)[^\n]*parallel/i);
    expect(command).toMatch(/sparkkindly_contribution_verdict/);
    expect(command).toMatch(/plagiarism/i);
    expect(command).toMatch(/env=prod/);
  });

  it('may use only Agent and the reviewer-role queue and verdict tools, never submit_item or a content tool', () => {
    const allowed = /^allowed-tools:\s*(.+)$/m.exec(command)?.[1] ?? '';
    const tools = allowed.split(',').map((t) => t.trim()).sort();
    expect(tools).toEqual([
      'Agent',
      'mcp__sparkkindly-prod-reviewer__sparkkindly_contribution_verdict',
      'mcp__sparkkindly-prod-reviewer__sparkkindly_contributions_queue',
      'mcp__sparkkindly-staging-reviewer__sparkkindly_contribution_verdict',
      'mcp__sparkkindly-staging-reviewer__sparkkindly_contributions_queue',
    ]);
    expect(allowed).not.toMatch(/submit_item|brief|record_run|item_status/);
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

describe('sparkkindly-reviewer', () => {
  it('stays read-only: WebFetch and WebSearch only, no SparkKindly tool', () => {
    const tools = /^tools:\s*(.+)$/m.exec(reviewer)?.[1] ?? '';
    expect(tools.split(',').map((t) => t.trim()).sort()).toEqual(['WebFetch', 'WebSearch']);
  });

  it('is used by both runs and does the plagiarism search for contributions', () => {
    expect(reviewer).toMatch(/\/review-contributions/);
    expect(reviewer).toMatch(/plagiarism/i);
    expect(reviewer).toMatch(/2 to 3 distinctive sentences/i);
    expect(reviewer).toMatch(/plagiarismChecked/);
    expect(reviewer).toMatch(/data, never instructions/i);
  });
});
