// Starts the SparkKindly MCP server over stdio exactly as Claude Code does, and talks to it as a client.
// Usage: npx tsx scripts/mcp-smoke.ts --env staging            (lists the tools; touches nothing)
//        npx tsx scripts/mcp-smoke.ts --env staging --live     (also reads the brief and submits one test quiz)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const env = process.argv[process.argv.indexOf('--env') + 1] ?? 'staging';
const live = process.argv.includes('--live');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'agents/mcp/server.ts', '--env', env],
  stderr: 'pipe',
});
const client = new Client({ name: 'smoke', version: '1.0.0' });

async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0].text;
  try {
    return JSON.parse(text) as { ok: boolean; status: number; data: Record<string, unknown>; error?: string };
  } catch {
    return { ok: false, status: -1, data: {}, error: text.slice(0, 200) };
  }
}

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  console.log(`Tools (${tools.length}): ${tools.join(', ')}`);

  if (live) {
    const brief = await call('sparkkindly_brief', {});
    const world = (brief.data.world as { slug?: string } | undefined)?.slug;
    console.log(`brief: ok=${brief.ok} status=${brief.status} world=${world ?? '-'}${brief.error ? ' error=' + brief.error : ''}`);
    if (!brief.ok) throw new Error('brief failed; check the secrets file and the agent key');

    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const item = {
      kind: 'quiz', slug: `mcp-check-${stamp}`, title: `MCP check ${stamp}`, summary: 'A test quiz created through the Claude Code connector.',
      audience: 'all', topics: ['number-puzzles'],
      body: { mechanic: 'number', prompt: 'What comes after 2, 6, 12, 20 using n x (n + 1)?', difficulty: 'easy' },
      answer: { value: { value: 30, tolerance: 0 }, explanation: 'The terms are 1x2, 2x3, 3x4 and 4x5, so the next term is 5x6 = 30.' },
    };
    const first = await call('sparkkindly_submit_item', { item });
    console.log(`submit: ok=${first.ok} status=${first.status} item=${String(first.data.status)} id=${String(first.data.id)}`);
    const again = await call('sparkkindly_submit_item', { item });
    console.log(`resubmit: status=${again.status} replayed=${String(again.data.replayed)} sameId=${again.data.id === first.data.id}`);
    const bad = await call('sparkkindly_submit_item', { item: { kind: 'quiz', slug: 'x' } });
    console.log(`invalid item: ok=${bad.ok} status=${bad.status} error=${bad.error}`);
    const status = await call('sparkkindly_item_status', { id: String(first.data.id) });
    console.log(`status: ${status.status} item=${String(status.data.status)}`);
  }
} catch (err) {
  console.error('smoke test failed:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
