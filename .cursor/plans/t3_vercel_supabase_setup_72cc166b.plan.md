---
name: T3 Vercel Supabase Setup
overview: Scaffold a T3 Stack app (Next.js + tRPC + Drizzle + Tailwind) in an `app/` subfolder, configure it to use the existing Supabase Postgres via Drizzle ORM, and extend `sst.config.ts` to manage a Vercel project with the proper environment variables using the Pulumi Vercel provider.
todos:
  - id: scaffold-t3
    content: Scaffold T3 app in `app/` subfolder using create-t3-app with Drizzle, Postgres, tRPC, Tailwind, App Router
    status: pending
  - id: configure-drizzle-supabase
    content: "Modify `app/src/server/db/index.ts` and `app/drizzle.config.ts` to use Supabase Postgres pooler with `prepare: false`"
    status: pending
  - id: update-sst-config
    content: Add Vercel provider to sst.config.ts, create vercel.Project and vercel.ProjectEnvironmentVariables with DATABASE_URL
    status: pending
  - id: update-github-workflow
    content: Add VERCEL_API_TOKEN to the GitHub Actions workflow env block
    status: pending
  - id: verify-env-setup
    content: Document required env vars (VERCEL_API_TOKEN) and verify .env / .gitignore setup
    status: pending
isProject: false
---

# T3 Stack with Drizzle, Supabase Postgres, and Vercel Deployment

## Architecture

```mermaid
flowchart LR
    subgraph sstConfig [sst.config.ts]
        SupabaseProject["supabase.Project"]
        VercelProject["vercel.Project"]
        VercelEnvVars["vercel.ProjectEnvironmentVariables"]
    end
    subgraph appDir [app/ - T3 Stack]
        NextJS["Next.js App Router"]
        tRPC["tRPC"]
        Drizzle["Drizzle ORM"]
    end
    SupabaseProject -->|"project.id + password => DATABASE_URL"| VercelEnvVars
    VercelEnvVars --> VercelProject
    VercelProject -->|"git integration"| GitHub["GitHub Repo"]
    GitHub -->|"auto-deploy on push"| Vercel["Vercel Platform"]
    Drizzle -->|"DATABASE_URL (pooler)"| SupabaseDB["Supabase Postgres"]
```

## 1. Scaffold the T3 App

Run `create-t3-app` inside a new `app/` directory with these options:

- **Next.js** (App Router)
- **tRPC**
- **Drizzle** with **PostgreSQL**
- **Tailwind CSS**
- No auth (can be added later)

```bash
pnpm create t3-app@latest app --CI --tailwind --trpc --drizzle --dbProvider postgres --appRouter --noGit
```

## 2. Configure Drizzle for Supabase Postgres

Modify `app/src/server/db/index.ts` to use `postgres` with `prepare: false` (required for Supabase's transaction pooler):

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
export const db = drizzle(client, { schema });
```

Update `app/drizzle.config.ts` to use `DATABASE_URL` with SSL:

```typescript
import { type Config } from "drizzle-kit";

export default {
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  tablesFilter: ["scoring-analyzer_*"],
} satisfies Config;
```

## 3. Add Vercel Provider to SST

Update [sst.config.ts](sst.config.ts) to:

- Add the `vercel` Pulumi provider
- Construct `DATABASE_URL` from the Supabase project ref, password, and region using `$interpolate`
- Create a `vercel.Project` resource with GitHub repo integration (pointing to the `app/` root directory)
- Create `vercel.ProjectEnvironmentVariables` to inject `DATABASE_URL`

The Supabase transaction pooler URL follows the pattern:

```
postgres://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

Updated `sst.config.ts` (key parts):

```typescript
providers: {
  supabase: "1.4.1",
  vercel: "3.0.2",  // add Vercel provider
},
```

In the `run()` function:

```typescript
const project = new supabase.Project("ScoringAnalyzer", {
  /* existing */
});

const databaseUrl = $interpolate`postgres://postgres.${project.id}:${process.env.SUPABASE_DB_PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;

const vercelProject = new vercel.Project("ScoringAnalyzerWeb", {
  name: "scoring-analyzer",
  framework: "nextjs",
  rootDirectory: "app",
  gitRepository: {
    type: "github",
    repo: "yakimych/scoring-analyzer-iac", // adjust to actual repo
  },
});

new vercel.ProjectEnvironmentVariables("ScoringAnalyzerEnvVars", {
  projectId: vercelProject.id,
  variables: [
    {
      key: "DATABASE_URL",
      value: databaseUrl,
      targets: ["production", "preview"],
      sensitive: true,
    },
  ],
});
```

## 4. Environment Variables and Secrets

New environment variables / GitHub secrets needed:

- `VERCEL_API_TOKEN` -- Vercel API token for the Pulumi Vercel provider
- `VERCEL_TEAM_ID` -- (optional) if deploying under a Vercel team

Add to `.env`:

```
VERCEL_API_TOKEN=your-vercel-api-token
```

Update [.github/workflows/deploy-infra.yml](.github/workflows/deploy-infra.yml) to include `VERCEL_API_TOKEN` in the `env` block.

## 5. Update `.gitignore`

Add standard Next.js ignores (`.next/`, `out/`, etc.) -- most will come from the T3 scaffolding's own `.gitignore` but ensure the root `.gitignore` doesn't conflict.

## Key Decisions

- **Supabase connection via Transaction Pooler (port 6543)**: Best for serverless environments like Vercel. Requires `prepare: false` in the postgres client.
- **Vercel auto-deploys via Git integration**: SST creates and configures the Vercel project; actual builds happen on Vercel when code is pushed to GitHub.
- `**rootDirectory: "app"`: Tells Vercel to build from the `app/` subfolder of the repo.
