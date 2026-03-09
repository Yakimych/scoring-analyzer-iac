/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "scoring-analyzer",
      home: "cloudflare",
      providers: {
        supabase: "1.4.1",
      },
    };
  },
  async run() {
    const project = new supabase.Project("ScoringAnalyzer", {
      organizationId: process.env.SUPABASE_ORG_ID!,
      name: "scoring-analyzer",
      databasePassword: process.env.SUPABASE_DB_PASSWORD!,
      region: "eu-central-1",
    });
    return { projectId: project.id };
  },
});
