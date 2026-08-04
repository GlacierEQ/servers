# Smithery GitHub setup — zero repeated key entry

This repository does not store a Smithery API key.

## Credential model

```text
GitHub Actions short-lived OIDC token
        |
        v
unified-credential-mcp
        |
        +-- verifies repository and ref
        +-- uses its broker-only Smithery credential
        +-- triggers upstream-core-sync.yml
        +-- returns a sanitized receipt
```

The only provider key is installed once in the deployment environment for `GlacierEQ/unified-credential-mcp`.

## One-time Smithery connection setup

Run once from an authenticated operator terminal:

```bash
set -euo pipefail
npm install -g smithery@latest
smithery auth login
smithery auth whoami
smithery namespace use glaciereq
smithery mcp add https://github.run.tools --id github --name "GlacierEQ GitHub"
smithery tool list github
```

If Smithery returns `auth_required`, complete the hosted GitHub OAuth step once. Smithery stores and refreshes that GitHub credential thereafter.

## One-time credential broker configuration

Install in the `unified-credential-mcp` Vercel project only:

```text
SMITHERY_API_KEY=<backend Smithery API key>
SMITHERY_NAMESPACE=glaciereq
SMITHERY_GITHUB_CONNECTION_ID=github
GITHUB_OIDC_AUDIENCE=unified-credential-mcp
ALLOWED_GITHUB_REPOSITORIES=GlacierEQ/servers
ALLOWED_GITHUB_REFS=refs/heads/main
```

## This repository's only setting

Add one non-secret Actions variable:

```text
CREDENTIAL_BROKER_URL=https://<unified-credential-mcp-deployment>/api/operations/smithery-github-sync
```

No `SMITHERY_API_KEY`, Smithery service token, GitHub PAT, provider key, or broker bearer secret belongs in this repository.

## Fallback

If the broker is unavailable, the workflow uses the job's short-lived repository-scoped `GITHUB_TOKEN` to dispatch `upstream-core-sync.yml`. No manually copied fallback credential is needed.
