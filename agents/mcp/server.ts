import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient, type AgentClient, type Result } from '../client';
import { defaultSecretsPath, loadSecrets, resolveConfig } from '../secrets';

type Deps = {
  client: AgentClient | null; // null when the environment is not configured
  missing?: string[];
  secretsHint?: string;
  formatDoc: string;
};

const asText = (r: Result) => ({ content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }] });

// Builds the server. Every tool returns the API's answer as JSON text; a refusal (ok:false) is an ordinary result so
// Claude can read the failing check, fix the item and send it again. Nothing is thrown at the caller.
export function buildServer(deps: Deps): McpServer {
  const server = new McpServer({ name: 'sparkkindly', version: '1.0.0' });

  async function run(fn: (c: AgentClient) => Promise<Result>) {
    if (!deps.client) {
      const names = (deps.missing ?? []).join(' and ') || 'the connector settings';
      return asText({ ok: false, status: 0, data: null, error: `SparkKindly is not configured: add ${names} to ${deps.secretsHint ?? 'the secrets file'}.` });
    }
    try {
      return asText(await fn(deps.client));
    } catch {
      return asText({ ok: false, status: 0, data: null, error: 'The request failed unexpectedly.' });
    }
  }

  server.registerTool(
    'sparkkindly_item_format',
    {
      title: 'SparkKindly item format',
      description:
        'Read this first. Returns the exact shapes SparkKindly accepts for an article, quiz, game or video script, the seven game mechanics, and the rules every item must follow (answers beside the body, sources for facts, no status).',
      inputSchema: {},
    },
    async () => ({ content: [{ type: 'text' as const, text: deps.formatDoc }] }),
  );

  server.registerTool(
    'sparkkindly_brief',
    {
      title: 'SparkKindly brief',
      description:
        "Get what a world needs today: its goals, the curated topics with how many items each already has, the last 30 titles to avoid repeating, how many days of content are already scheduled, and which kinds and mechanics the site can render. A world agent gets its own world; the master agent passes a world slug.",
      inputSchema: { world: z.string().regex(/^[a-z0-9-]+$/).optional().describe('World slug, for example play. Only the master agent needs this.') },
    },
    ({ world }) => run((c) => c.brief(world)),
  );

  server.registerTool(
    'sparkkindly_submit_item',
    {
      title: 'Submit an item to SparkKindly',
      description:
        'Create a game, quiz, article or video script. The site checks it and decides its status itself: scheduled for the next free day, waiting for owner approval (Kids content), or draft with the failing check named. Fix a draft and resubmit the same slug to replace it. Call sparkkindly_item_format first if unsure of the shape.',
      inputSchema: { item: z.record(z.string(), z.unknown()).describe('The item, shaped as in sparkkindly_item_format.') },
    },
    ({ item }) => run((c) => c.submit(item)),
  );

  server.registerTool(
    'sparkkindly_item_status',
    {
      title: 'SparkKindly item status',
      description:
        "Check what happened to an item you submitted: its status (draft, in_review, scheduled, published), when it will publish, and the quality report listing each check that passed or failed.",
      inputSchema: { id: z.string().min(1).max(100).describe('The id returned when the item was submitted.') },
    },
    ({ id }) => run((c) => c.status(id)),
  );

  return server;
}

async function main() {
  const flag = process.argv.indexOf('--env');
  const env = process.argv[flag + 1] as 'staging' | 'prod';
  const config = resolveConfig(env, loadSecrets());
  const formatDoc = readFileSync(new URL('../../docs/item-format.md', import.meta.url), 'utf8');
  const server = buildServer({
    client: config.ok ? createClient({ baseUrl: config.baseUrl, agentKey: config.agentKey, basicAuth: config.basicAuth }) : null,
    missing: config.ok ? undefined : config.missing,
    secretsHint: defaultSecretsPath(),
    formatDoc,
  });
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; anything for a human goes to stderr.
  console.error(`sparkkindly MCP server ready (${env}${config.ok ? '' : ', NOT configured: ' + config.missing.join(', ')})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('sparkkindly MCP server failed to start:', (err as Error).message);
    process.exit(1);
  });
}
