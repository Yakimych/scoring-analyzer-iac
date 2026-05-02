# Infrastructure

This directory contains the Infrastructure as Code (IaC) for the ScoringAnalyzer project, using [SST](https://sst.dev/) with the [Supabase provider](https://www.pulumi.com/registry/packages/supabase/).

## What it deploys

- A Supabase Postgres database project (`scoring-analyzer`, free-tier `micro` instance in `eu-central-1`)
- A Grafana Cloud stack with the Supabase integration (pre-built dashboards for 200+ database metrics)
- A metrics scrape job that pulls Supabase Prometheus metrics into Grafana Cloud every 60s

Infrastructure state is stored in Cloudflare R2 (free tier).

### Workaround: service_role key via HTTP

The Supabase `service_role` key (needed for the Grafana metrics scrape job) is currently fetched at deploy time via a raw HTTP call to the Supabase Management API (`GET /v1/projects/{ref}/api-keys`). This is a workaround because the SST-packaged Supabase provider (`@sst-provider/supabase`) is pinned at v1.4.1, which predates the `getApikeys` data source added in upstream v1.5.0.

**When `@sst-provider/supabase` publishes ≥1.5.0**, replace the HTTP workaround with:

```ts
// 1. Bump the provider version in sst.config.ts
providers: { supabase: "1.5.0", ... }

// 2. Replace the fetch() block with:
const supabaseApiKeys = supabase.getApikeysOutput({
  projectRef: supabaseProject.id,
});

// 3. Use supabaseApiKeys.serviceRoleKey instead of serviceRoleKey
authenticationBasicPassword: supabaseApiKeys.serviceRoleKey,
```

## Prerequisites

You need accounts on two services:

1. **Supabase** (hosts the database) — https://supabase.com/
2. **Cloudflare** (stores SST state in R2) — https://dash.cloudflare.com/

## Required secrets

Seven secrets must be configured in GitHub at **Settings > Secrets and variables > Actions**.

### Cloudflare (SST state storage)

| Secret                          | How to get it                                                                                                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_DEFAULT_ACCOUNT_ID` | Go to [Cloudflare dashboard](https://dash.cloudflare.com/) > **Workers and Pages** > **Overview**. The **Account ID** is shown on the right side of the page.                                                                 |
| `CLOUDFLARE_API_TOKEN`          | Go to https://dash.cloudflare.com/profile/api-tokens > **Create Token**. Use the **Edit Cloudflare Workers** template (or create a custom token with `Account.Workers R2 Storage:Edit` permission). Copy the generated token. |

### Supabase (database provider)

| Secret                  | How to get it                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Go to https://supabase.com/dashboard/account/tokens > **Generate new token**. Give it a name and copy the token value. The restart workflow needs project admin write access.         |
| `SUPABASE_ORG_ID`       | Go to https://supabase.com/dashboard > click your organization. The **slug** is visible in the URL (`app.supabase.com/org/<slug>`) and also under **Organization Settings > General**. |
| `SUPABASE_DB_PASSWORD`  | A strong password for the Postgres database (set once when the project is created). Generate one with the command below.                                                               |

### Vercel (app deployment)

| Secret             | How to get it                                                                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERCEL_API_TOKEN` | Go to https://vercel.com/account/tokens > **Create Token**. Give it a descriptive name (e.g. `sst-deploy`), pick a scope (your personal account or team), and set an expiration. Copy the token value immediately — it won't be shown again. |

### Grafana Cloud (metrics monitoring)

| Secret                              | How to get it                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GRAFANA_CLOUD_ACCESS_POLICY_TOKEN` | Go to https://grafana.com/orgs > select your org > **Security > Access Policies** > **Create access policy**. Add scopes: `stacks:read`, `stacks:write`, `stacks:delete`, `stack-service-accounts:write`, `integration-management:read`, `integration-management:write`, `stack-dashboards:read`, `stack-dashboards:write`, `rules:read`, `rules:write`. Then create a token for the policy and copy the value. |

### GitHub alert automation

| Secret                        | How to get it                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCORING_ANALYZER_ALERT_DISPATCH_TOKEN` | Create a GitHub fine-grained personal access token scoped to `Yakimych/scoring-analyzer-iac` with **Contents: Read and write** permission. Grafana uses this token to call GitHub's `repository_dispatch` API when the Supabase health alert fires. A classic PAT needs `repo` scope for private repos. |

Generate a random password:

```sh
openssl rand -base64 32
```

## Local development

To preview changes locally:

```sh
npm install
npx sst install
```

Create a `.env.local` file with the required variables:

```
CLOUDFLARE_DEFAULT_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
SUPABASE_ACCESS_TOKEN=...
SUPABASE_ORG_ID=...
SUPABASE_DB_PASSWORD=...
VERCEL_API_TOKEN=...
GRAFANA_CLOUD_ACCESS_POLICY_TOKEN=...
SCORING_ANALYZER_ALERT_DISPATCH_TOKEN=...
```

## Supabase restart automation

The `Restart Supabase Project` GitHub Actions workflow is triggered by Grafana alert webhooks using the `repository_dispatch` event type `supabase_restart_requested`. It can also be run manually from GitHub Actions.

To prevent repeated project restarts during a noisy incident, the workflow serializes all restart runs and checks for a recent `supabase-restart-marker-rlyhhlwyzeqhoxlralre` artifact before calling the Supabase Management API. If a marker was created in the last 10 minutes, the run exits without calling the restart endpoint.

The project restart is implemented with the documented Supabase Management API project lifecycle endpoints: pause the project, wait until it is inactive, then restore it and wait until it is active again.

Then run:

```sh
npx sst diff --stage prod   # preview changes
npx sst deploy --stage prod # apply changes
```

## CI/CD workflow

The GitHub Actions workflow (`.github/workflows/deploy-infra.yml`) triggers on pushes to `infra/**` and manual dispatch:

1. **Plan job** — runs `sst diff` on every branch, prints what would change.
2. **Deploy job** — runs `sst deploy` only on `main` and only if the plan detected changes.
