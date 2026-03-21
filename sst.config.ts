/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "scoring-analyzer",
      home: "cloudflare",
      providers: {
        supabase: "1.4.1",
        vercel: "4.6.0",
      },
    };
  },
  async run() {
    const dbPassword = process.env.SUPABASE_DB_PASSWORD!;
    const region = "eu-central-1";

    const supabaseProject = new supabase.Project("ScoringAnalyzer", {
      organizationId: process.env.SUPABASE_ORG_ID!,
      name: "scoring-analyzer",
      databasePassword: dbPassword,
      region,
    });

    const databaseUrl = $interpolate`postgres://postgres.${supabaseProject.id}:${encodeURIComponent(dbPassword)}@aws-0-${region}.pooler.supabase.com:6543/postgres`;

    const vercelProject = new vercel.Project("ScoringAnalyzerWeb", {
      name: "scoring-analyzer",
      framework: "nextjs",
      gitRepository: {
        type: "github",
        repo: "yakimych/scoring-analyzer-web",
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

    return {
      projectId: supabaseProject.id,
      vercelProjectId: vercelProject.id,
    };
  },
});
