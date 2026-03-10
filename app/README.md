# Scoring Analyzer

A [T3 Stack](https://create.t3.gg/) app using Next.js, tRPC, Drizzle ORM, and Tailwind CSS, backed by a Supabase Postgres database.

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v10+

## Local Development

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Copy the example env file and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Set `DATABASE_URL` to your Supabase **transaction pooler** connection string (port 6543). You can find it in the [Supabase dashboard](https://supabase.com/dashboard) under **Connect** > **Transaction Pooler**.

The format is:

```
postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

Replace `[PROJECT-REF]`, `[PASSWORD]`, and `[REGION]` with your actual values. Make sure to URL-encode the password if it contains special characters.

### 3. Push the database schema

This syncs the Drizzle schema to your remote Supabase database:

```bash
pnpm db:push
```

### 4. Start the dev server

```bash
pnpm dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

## Useful Commands

| Command            | Description                              |
| ------------------ | ---------------------------------------- |
| `pnpm dev`         | Start the development server (Turbopack) |
| `pnpm build`       | Build for production                     |
| `pnpm start`       | Start the production server              |
| `pnpm db:push`     | Push schema changes to the database      |
| `pnpm db:generate` | Generate Drizzle migration files         |
| `pnpm db:migrate`  | Run pending migrations                   |
| `pnpm db:studio`   | Open Drizzle Studio (visual DB browser)  |
| `pnpm typecheck`   | Run TypeScript type checking             |

## Deployment

This app is deployed to **Vercel** via SST. The Vercel project and environment variables (including `DATABASE_URL`) are managed in the root `sst.config.ts`. Vercel auto-deploys on pushes to the GitHub repo.

## Tech Stack

- [Next.js](https://nextjs.org) -- React framework (App Router)
- [tRPC](https://trpc.io) -- End-to-end typesafe APIs
- [Drizzle ORM](https://orm.drizzle.team) -- TypeScript ORM for Postgres
- [Tailwind CSS](https://tailwindcss.com) -- Utility-first CSS
- [Supabase](https://supabase.com) -- Managed Postgres database
