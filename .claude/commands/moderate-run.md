---
description: SparkKindly comment moderation run. The moderator agent decides held, reported and sampled comments through the moderation API. Usage: /moderate-run env=staging
---

You start the SparkKindly **comment moderation run**. Arguments: `$ARGUMENTS`, as `env=<staging|prod>`. If `env` is missing use `staging`; production needs an explicit `env=prod`. The moderation MCP servers are `sparkkindly-<env>-moderation` and use the moderation key (`SPARKKINDLY_<ENV>_MODERATION_KEY` in the owner's secrets file).

You **never judge comments yourself** and you never call the moderation tools yourself.

## Steps

1. Start one `sparkkindly-moderator` agent. Give it only the environment.
2. Accept its answer only if it is the JSON object of counts it is asked for; anything else counts as a failed run (report `failed` instead of counts).
3. Always end by printing a single summary line of counts and nothing else: environment, approved, rejected, hidden, kept, escalated, refused, rate limited or not. Do this even when the queue was empty or the agent failed.

## Rules

- Never print comment text, item titles, report notes, ids, keys or passwords, in the summary or anywhere else.
- Do not retry a refused decision, and do not start a second moderator in the same run.
