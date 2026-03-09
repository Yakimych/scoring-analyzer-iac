# Infrastructure

This directory contains the Infrastructure as Code (IaC) for the ScoringAnalyzer project, using [SST](https://sst.dev/) with the [Supabase provider](https://www.pulumi.com/registry/packages/supabase/).

## What it deploys

- A Supabase Postgres database project (`scoring-analyzer`, free-tier `micro` instance in `eu-central-1`)

Infrastructure state is stored in Cloudflare R2 (free tier).

## Prerequisites

You need accounts on two services:

1. **Supabase** (hosts the database) — https://supabase.com/
2. **Cloudflare** (stores SST state in R2) — https://dash.cloudflare.com/

## Required secrets

Five secrets must be configured in GitHub at **Settings > Secrets and variables > Actions**.

### Cloudflare (SST state storage)

| Secret                          | How to get it                                                                                                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_DEFAULT_ACCOUNT_ID` | Go to [Cloudflare dashboard](https://dash.cloudflare.com/) > **Workers and Pages** > **Overview**. The **Account ID** is shown on the right side of the page.                                                                 |
| `CLOUDFLARE_API_TOKEN`          | Go to https://dash.cloudflare.com/profile/api-tokens > **Create Token**. Use the **Edit Cloudflare Workers** template (or create a custom token with `Account.Workers R2 Storage:Edit` permission). Copy the generated token. |

### Supabase (database provider)

| Secret                  | How to get it                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Go to https://supabase.com/dashboard/account/tokens > **Generate new token**. Give it a name and copy the token value.                                                                 |
| `SUPABASE_ORG_ID`       | Go to https://supabase.com/dashboard > click your organization. The **slug** is visible in the URL (`app.supabase.com/org/<slug>`) and also under **Organization Settings > General**. |
| `SUPABASE_DB_PASSWORD`  | A strong password for the Postgres database (set once when the project is created). Generate one with the command below.                                                               |

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
```

Then run:

```sh
npx sst diff --stage prod   # preview changes
npx sst deploy --stage prod # apply changes
```

## CI/CD workflow

The GitHub Actions workflow (`.github/workflows/deploy-infra.yml`) triggers on pushes to `infra/**` and manual dispatch:

1. **Plan job** — runs `sst diff` on every branch, prints what would change.
2. **Deploy job** — runs `sst deploy` only on `main` and only if the plan detected changes.
