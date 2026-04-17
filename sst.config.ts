/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "scoring-analyzer",
      home: "cloudflare",
      providers: {
        supabase: "1.4.1",
        vercel: "4.6.0",
        grafana: "2.25.1",
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
      ],
    });

    // --- Grafana Cloud: Supabase metrics monitoring ---
    // Requires GRAFANA_CLOUD_ACCESS_POLICY_TOKEN env var with scopes:
    //   stacks:read, stacks:write, stacks:delete,
    //   stack-service-accounts:write,
    //   integration-management:read, integration-management:write,
    //   stack-dashboards:read, stack-dashboards:write,
    //   rules:read, rules:write
    // Requires SUPABASE_SERVICE_ROLE_KEY env var for metrics endpoint auth

    const grafanaStack = new grafana.cloud.Stack("ScoringAnalyzerGrafana", {
      name: "scoring-analyzer",
      slug: "scoring-analyzer",
      regionSlug: "eu",
      description: "Grafana Cloud stack for Scoring Analyzer Supabase metrics",
    });

    const grafanaServiceAccount = new grafana.cloud.StackServiceAccount(
      "GrafanaServiceAccount",
      {
        stackSlug: grafanaStack.slug,
        name: "sst-managed",
        role: "Admin",
      },
    );

    const grafanaServiceAccountToken =
      new grafana.cloud.StackServiceAccountToken("GrafanaServiceAccountToken", {
        stackSlug: grafanaStack.slug,
        name: "sst-managed-token",
        serviceAccountId: grafanaServiceAccount.id,
      });

    // Stack-scoped provider for managing dashboards/folders inside the stack
    const grafanaStackProvider = new grafana.Provider("GrafanaStackProvider", {
      auth: grafanaServiceAccountToken.key,
      url: grafanaStack.url.apply((url) => url as string),
    });

    // Install the Supabase integration (pre-built dashboards + alert rules)
    const supabaseIntegration = new grafana.cloud.Integration(
      "SupabaseIntegration",
      { slug: "supabase" },
    );

    // Connections API provider for managing metrics scrape jobs
    const connectionsProvider = new grafana.Provider(
      "GrafanaConnectionsProvider",
      {
        connectionsApiUrl: grafanaStack.connectionsApiUrl,
        connectionsApiAccessToken:
          process.env.GRAFANA_CLOUD_ACCESS_POLICY_TOKEN!,
      },
    );

    // Scrape Supabase metrics endpoint every 60s
    new grafana.connections.MetricsEndpointScrapeJob(
      "SupabaseMetricsScrapeJob",
      {
        stackId: grafanaStack.id,
        name: "supabase-scoring-analyzer",
        enabled: true,
        authenticationMethod: "basic",
        authenticationBasicUsername: "service_role",
        authenticationBasicPassword: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        url: $interpolate`https://${supabaseProject.id}.supabase.co/customer/v1/privileged/metrics`,
        scrapeIntervalSeconds: 60,
      },
      { provider: connectionsProvider },
    );

    return {
      projectId: supabaseProject.id,
      vercelProjectId: vercelProject.id,
      grafanaStackUrl: grafanaStack.url,
      grafanaDashboardFolder: supabaseIntegration.dashboardFolder,
    };
  },
});
