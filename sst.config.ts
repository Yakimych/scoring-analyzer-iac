/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "scoring-analyzer",
      home: "cloudflare",
      providers: {
        supabase: "1.4.1",
        vercel: "4.6.0",
        command: "1.2.1",
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

    // Realtime is not on supabase.Project; suspend via Management API (Dashboard → Realtime).
    // Fine-grained tokens need realtime_config_write on SUPABASE_ACCESS_TOKEN.
    new command.local.Command(
      "ScoringAnalyzerDisableRealtime",
      {
        environment: {
          SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN!,
        },
        create: supabaseProject.id.apply(
          (ref) =>
            `curl -sfS -X PATCH "https://api.supabase.com/v1/projects/${ref}/config/realtime" ` +
            '-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" ' +
            '-H "Content-Type: application/json" ' +
            `-d '{"suspend":true}'`,
        ),
      },
      { dependsOn: [supabaseProject] },
    );

    const databaseUrl = $interpolate`postgresql://postgres.${supabaseProject.id}:${dbPassword}@aws-1-${region}.pooler.supabase.com:6543/postgres`;
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
