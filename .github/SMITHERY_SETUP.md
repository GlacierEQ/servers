# Smithery GitHub setup

This repository uses Smithery only as a secondary trigger path for `upstream-core-sync.yml`. The direct repository-scoped GitHub trigger remains the fallback.

## One-time local setup

```bash
npm install -g smithery@latest
smithery auth login
smithery namespace use GlacierEQ
smithery mcp add github --id github --name "GlacierEQ GitHub"
smithery tool list github
```

If the connection reports `auth_required`, open the setup URL printed by the CLI, authorize GitHub, then rerun:

```bash
smithery tool list github
```

## GitHub repository settings

Add this Actions secret:

```text
SMITHERY_API_KEY=<backend Smithery API key or scoped service token>
```

Add these Actions variables:

```text
SMITHERY_NAMESPACE=GlacierEQ
SMITHERY_GITHUB_CONNECTION_ID=github
```

The workflow installs the official `smithery@latest` CLI, selects the namespace, lists the exact tools exposed by the managed GitHub connection, chooses a compatible workflow-dispatch action, invokes it, and falls back to `GITHUB_TOKEN` if Smithery is unconfigured or degraded.

Do not commit API keys, service tokens, setup URLs, or provider credentials.
