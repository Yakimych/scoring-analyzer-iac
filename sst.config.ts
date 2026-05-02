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
    const grafanaPrometheusDatasourceUid = "grafanacloud-prom";
    const grafanaExpressionDatasourceUid = "-100";
    const supabaseAlertRunbookUrl =
      "https://supabase.com/docs/guides/troubleshooting/supabase-grafana-memory-charts";
    const githubAlertDispatchRepository =
      process.env.GITHUB_ALERT_DISPATCH_REPOSITORY ??
      "Yakimych/scoring-analyzer-iac";
    const githubAlertDispatchToken =
      process.env.SCORING_ANALYZER_ALERT_DISPATCH_TOKEN ??
      (() => {
        throw new Error(
          "SCORING_ANALYZER_ALERT_DISPATCH_TOKEN is required to let Grafana trigger the Supabase restart GitHub Action.",
        );
      })();

    const compactPromQl = (query: string) => query.replace(/\s+/g, " ").trim();

    const supabaseMetricsSelector = (projectRef: string) =>
      `{supabase_project_ref="${projectRef}", supabase_identifier="${projectRef}"}`;

    const prometheusAlertQueryModel = (refId: string, expr: string) =>
      JSON.stringify({
        datasource: {
          type: "prometheus",
          uid: grafanaPrometheusDatasourceUid,
        },
        editorMode: "code",
        expr,
        instant: true,
        intervalMs: 1000,
        maxDataPoints: 43200,
        refId,
      });

    const thresholdConditionModel = (
      refId: string,
      queryRefId: string,
      threshold: number,
    ) =>
      JSON.stringify({
        conditions: [
          {
            evaluator: {
              params: [threshold],
              type: "gt",
            },
            operator: {
              type: "and",
            },
            query: {
              params: [queryRefId],
            },
            reducer: {
              params: [],
              type: "last",
            },
            type: "query",
          },
        ],
        datasource: {
          type: "__expr__",
          uid: grafanaExpressionDatasourceUid,
        },
        hide: false,
        intervalMs: 1000,
        maxDataPoints: 43200,
        refId,
        type: "classic_conditions",
      });

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

    // Fetch the service_role key from the Supabase Management API
    const serviceRoleKey = supabaseProject.id.apply(async (ref) => {
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${ref}/api-keys`,
        {
          headers: {
            Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
          },
        },
      );
      if (!res.ok) throw new Error(`Failed to fetch API keys: ${res.status}`);
      const keys = (await res.json()) as { name: string; api_key: string }[];
      const sr = keys.find((k) => k.name === "service_role");
      if (!sr) throw new Error("service_role key not found");
      return sr.api_key;
    });

    const grafanaStack = new grafana.cloud.Stack("ScoringAnalyzerGrafana", {
      name: "scoringanalyzer",
      slug: "scoringanalyzer",
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

    // Stack-scoped provider with cloud + connections access
    const grafanaStackProvider = new grafana.Provider("GrafanaStackProvider", {
      cloudAccessPolicyToken: process.env.GRAFANA_CLOUD_ACCESS_POLICY_TOKEN!,
      auth: grafanaServiceAccountToken.key,
      url: grafanaStack.url.apply((url) => url as string),
      connectionsApiUrl: grafanaStack.connectionsApiUrl,
      connectionsApiAccessToken: process.env.GRAFANA_CLOUD_ACCESS_POLICY_TOKEN!,
    });

    // Install the Supabase integration (pre-built dashboards + alert rules)
    const supabaseIntegration = new grafana.cloud.Integration(
      "SupabaseIntegration",
      { slug: "supabase" },
      { provider: grafanaStackProvider },
    );

    const supabaseAlertsFolder = new grafana.oss.Folder(
      "SupabaseAlertsFolder",
      {
        uid: "scoring-analyzer-supabase-alerts",
        title: "Scoring Analyzer Supabase Alerts",
        preventDestroyIfNotEmpty: true,
      },
      { provider: grafanaStackProvider },
    );

    const supabaseRestartContactPoint = new grafana.alerting.ContactPoint(
      "SupabaseRestartGitHubDispatchContactPoint",
      {
        name: "supabase-restart-github-dispatch",
        webhooks: [
          {
            url: `https://api.github.com/repos/${githubAlertDispatchRepository}/dispatches`,
            httpMethod: "POST",
            authorizationScheme: "Bearer",
            authorizationCredentials: githubAlertDispatchToken,
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            disableResolveMessage: true,
            maxAlerts: 1,
            payload: {
              template: `{{ coll.Dict "event_type" "supabase_restart_requested" "client_payload" (coll.Dict "source" "grafana" "status" .Status "project_ref" .Vars.project_ref "alertname" .CommonLabels.alertname "severity" .CommonLabels.severity "symptom" .CommonLabels.symptom "group_key" .GroupKey) | data.ToJSON }}`,
              vars: {
                project_ref: supabaseProject.id,
              },
            },
          },
        ],
      },
      { provider: grafanaStackProvider },
    );

    // Scrape Supabase metrics endpoint every 120s
    const supabaseMetricsScrapeJob =
      new grafana.connections.MetricsEndpointScrapeJob(
        "SupabaseMetricsScrapeJob",
        {
          stackId: grafanaStack.id,
          name: "supabase-scoring-analyzer",
          enabled: true,
          authenticationMethod: "basic",
          authenticationBasicUsername: "service_role",
          authenticationBasicPassword: serviceRoleKey,
          url: $interpolate`https://${supabaseProject.id}.supabase.co/customer/v1/privileged/metrics`,
          scrapeIntervalSeconds: 120,
        },
        { provider: grafanaStackProvider },
      );

    const memoryPressureExpr = supabaseProject.id.apply((projectRef) => {
      const selector = supabaseMetricsSelector(projectRef);

      return compactPromQl(`
        (
          max(
            100 * (
              1 - node_memory_MemAvailable_bytes${selector}
                / node_memory_MemTotal_bytes${selector}
            ) > bool 90
          ) or vector(0)
        )
        +
        (
          max(
            100 * (
              node_memory_SwapTotal_bytes${selector}
                - node_memory_SwapFree_bytes${selector}
            )
              / node_memory_SwapTotal_bytes${selector}
              > bool 5
          ) or vector(0)
        )
        > bool 0
      `);
    });

    const missingMetricsExpr = supabaseProject.id.apply((projectRef) => {
      const selector = supabaseMetricsSelector(projectRef);

      return compactPromQl(`
        (
          (
            max(absent_over_time(node_memory_MemAvailable_bytes${selector}[10m]))
              or vector(0)
          )
          +
          (
            max(absent_over_time(node_memory_MemTotal_bytes${selector}[10m]))
              or vector(0)
          )
          +
          (
            max(absent_over_time(pg_up${selector}[10m]))
              or vector(0)
          )
        ) > bool 0
      `);
    });

    const supabaseHealthAlerts = new grafana.alerting.RuleGroup(
      "SupabaseHealthAlertRules",
      {
        name: "scoring-analyzer-supabase-health",
        folderUid: supabaseAlertsFolder.uid,
        intervalSeconds: 120,
        rules: [
          {
            uid: "supabase-memory-pressure",
            name: "Supabase memory pressure",
            for: "10m",
            condition: "B",
            notificationSettings: {
              contactPoint: supabaseRestartContactPoint.name,
              groupInterval: "10m",
              groupWait: "30s",
              repeatInterval: "10m",
            },
            noDataState: "Alerting",
            execErrState: "Alerting",
            annotations: {
              summary: "Supabase memory pressure is high",
              description: supabaseProject.id.apply(
                (projectRef) =>
                  `Project ${projectRef} has used more than 90% of available memory or more than 5% of swap for at least 10 minutes.`,
              ),
              runbook_url: supabaseAlertRunbookUrl,
            },
            labels: {
              service: "supabase",
              project: supabaseProject.id,
              severity: "critical",
              symptom: "memory-pressure",
            },
            isPaused: false,
            datas: [
              {
                refId: "A",
                queryType: "",
                relativeTimeRange: {
                  from: 600,
                  to: 0,
                },
                datasourceUid: grafanaPrometheusDatasourceUid,
                model: memoryPressureExpr.apply((expr) =>
                  prometheusAlertQueryModel("A", expr),
                ),
              },
              {
                refId: "B",
                queryType: "",
                relativeTimeRange: {
                  from: 0,
                  to: 0,
                },
                datasourceUid: grafanaExpressionDatasourceUid,
                model: thresholdConditionModel("B", "A", 0.5),
              },
            ],
          },
          {
            uid: "supabase-metrics-missing",
            name: "Supabase metrics missing",
            for: "10m",
            condition: "B",
            notificationSettings: {
              contactPoint: supabaseRestartContactPoint.name,
              groupInterval: "10m",
              groupWait: "30s",
              repeatInterval: "10m",
            },
            noDataState: "Alerting",
            execErrState: "Alerting",
            annotations: {
              summary: "Supabase metrics are missing",
              description: supabaseProject.id.apply(
                (projectRef) =>
                  `Grafana has not received core memory/database metrics for project ${projectRef} for at least 10 minutes.`,
              ),
              runbook_url:
                "https://supabase.com/docs/guides/telemetry/metrics/grafana-cloud#5-troubleshooting",
            },
            labels: {
              service: "supabase",
              project: supabaseProject.id,
              severity: "critical",
              symptom: "missing-metrics",
            },
            isPaused: false,
            datas: [
              {
                refId: "A",
                queryType: "",
                relativeTimeRange: {
                  from: 600,
                  to: 0,
                },
                datasourceUid: grafanaPrometheusDatasourceUid,
                model: missingMetricsExpr.apply((expr) =>
                  prometheusAlertQueryModel("A", expr),
                ),
              },
              {
                refId: "B",
                queryType: "",
                relativeTimeRange: {
                  from: 0,
                  to: 0,
                },
                datasourceUid: grafanaExpressionDatasourceUid,
                model: thresholdConditionModel("B", "A", 0.5),
              },
            ],
          },
        ],
      },
      {
        provider: grafanaStackProvider,
        dependsOn: [
          supabaseIntegration,
          supabaseAlertsFolder,
          supabaseRestartContactPoint,
          supabaseMetricsScrapeJob,
        ],
      },
    );

    return {
      projectId: supabaseProject.id,
      vercelProjectId: vercelProject.id,
      grafanaStackUrl: grafanaStack.url,
      grafanaDashboardFolder: supabaseIntegration.dashboardFolder,
      grafanaSupabaseAlertsFolder: supabaseAlertsFolder.url,
      grafanaSupabaseHealthAlertGroup: supabaseHealthAlerts.name,
      grafanaSupabaseRestartContactPoint: supabaseRestartContactPoint.name,
    };
  },
});
