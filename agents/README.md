# SparkKindly connector for Claude Code

This lets Claude Code create SparkKindly content on demand (a game, a quiz, a post, a video script) by calling the site's
agent API through four tools. It also works from scheduled, unattended Claude Code runs, with no AI API account.

## The four tools

| Tool | What it does |
|---|---|
| `sparkkindly_item_format` | Returns the exact shapes SparkKindly accepts. Read it first. |
| `sparkkindly_brief` | What a world needs today: goals, topics with counts, the last 30 titles, days of buffer, supported kinds and mechanics. |
| `sparkkindly_submit_item` | Submit an item. The site decides its status: scheduled, waiting for owner approval (Kids), or draft with the failing check named. |
| `sparkkindly_item_status` | What happened to an item, including its quality report. |

A refusal is an ordinary answer (`"ok": false` with the reason), so Claude can read it, fix the item and resubmit. To fix
a draft, resubmit the same slug; a draft you submitted is replaced. Content that is scheduled or published cannot be
replaced this way.

## One-time setup

1. Create a key for each environment on the server's database (the key is printed once):
   `npm run agent:create -- <name> --world <slug>` for a world agent, or without `--world` for the master agent.
   Use a `DATABASE_URL` that points at the database the key is for.
2. Put the settings in your secrets file (default `~/sparkkindly-secrets.txt`, outside the repository; override with the
   `SPARKKINDLY_SECRETS_FILE` environment variable):
   ```
   SPARKKINDLY_STAGING_URL=https://staging.sparkkindly.com
   SPARKKINDLY_STAGING_AGENT_KEY=skagt_...
   STAGING_BASIC_AUTH_USER=...
   STAGING_BASIC_AUTH_PASSWORD=...
   SPARKKINDLY_PROD_URL=https://sparkkindly.com
   SPARKKINDLY_PROD_AGENT_KEY=skagt_...
   ```
   Staging is behind a password, so its two `STAGING_BASIC_AUTH_` lines are needed. Production has none.
3. Open Claude Code in this project and accept the project's MCP servers (`.mcp.json`). Run `/mcp` and check that
   `sparkkindly-staging` shows as connected. Restart the session if you just added the file.

The keys never go in `.mcp.json` or the repository. The server reads them from your secrets file each time it starts, so a
scheduled run needs nothing extra.

## Use it

Ask Claude something like "create a Play quiz on number patterns on staging". Claude reads the format, reads the brief
(so it avoids repeating titles and fills thin topics), submits the item, and checks its status. Practise on
`sparkkindly-staging`; only use `sparkkindly-prod` once you trust the output.

## Check it works

- `npx tsx scripts/mcp-smoke.ts --env staging` starts the real server and lists the tools (touches nothing).
- `npx tsx scripts/mcp-smoke.ts --env staging --live` also reads the brief and submits one test quiz.

## Good to know

- Agent keys travel in the `X-Agent-Key` header only. The API URLs end with a slash.
- Limits: 60 requests a minute per agent, 200 KB per item, at most 10 sources per item.
- Kids items, and anything in a world set to review mode, always wait for the owner's approval.
- A corrected item gets a new idempotency key automatically, because the key is derived from the item's content.
