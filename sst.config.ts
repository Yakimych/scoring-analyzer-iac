/// <reference path="./.sst/platform/config.d.ts" />

function requiredEnv(key: string) {
  const value = process.env[key];

  if (!value) {
    throw new Error(`${key} is required to deploy the infrastructure.`);
  }

  return value;
}

// Google sign-in for scoring-analyzer-web (Better Auth). In CI the plain values
// are GitHub Actions variables and the credentials are secrets; see
// .github/workflows/deploy-infra.yml.
function authEnvironmentVariables() {
  const variables: { key: string; sensitive: boolean }[] = [
    { key: "BETTER_AUTH_SECRET", sensitive: true },
    { key: "BETTER_AUTH_URL", sensitive: false },
    { key: "GOOGLE_CLIENT_ID", sensitive: false },
    { key: "GOOGLE_CLIENT_SECRET", sensitive: true },
    { key: "SUPERUSER_EMAIL", sensitive: false },
  ];

  // Production only: Google sign-in can't complete on preview URLs, since each
  // would need its own registered redirect URI.
  return variables.map(({ key, sensitive }) => ({
    key,
    value: requiredEnv(key),
    targets: ["production"],
    sensitive,
  }));
}

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
        ...authEnvironmentVariables(),
      ],
    });

    return {
      projectId: supabaseProject.id,
      vercelProjectId: vercelProject.id,
    };
  },
});
