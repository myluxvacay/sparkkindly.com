# Git Rules

Before commit:
- inspect `git status`
- inspect unstaged diff
- inspect staged diff
- identify unrelated/local/generated/secret files
- verify tests/reviews at the task's tier

Never commit:
secrets or API keys
`.env*` files other than `.env.example`
env files from the VM
SSH keys, age keys, `*.pem`, `*.key`
local URLs or credentials in docs
logs and test output (`test-results/`, `playwright-report/`)
builds (`.next/`, `out/`, `release/`, `*.tgz`)
uploaded or generated media
database dumps

Do not add AI co-author trailers; repository policy does not use them.
Do not push, create a branch on the remote or open a pull request without owner authorization.
`main` deploys to production and `staging` deploys to staging on push; a push is a deploy.
