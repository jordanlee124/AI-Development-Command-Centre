import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { ThemeSettings } from "@/components/settings/theme-settings";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { getGitHubSettings } from "@/server/services/github-service";
import { checkHealth } from "@/server/services/health-service";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const health = await checkHealth();
  const github = getGitHubSettings();
  const integrations = [
    {
      name: "GitHub",
      status: github.configured ? "Token configured" : "Not configured",
      detail: "Read-only repository sync. Status and setup on the GitHub page.",
    },
    {
      name: "Agent Bridge",
      status: "Not installed",
      detail: "Claude Code and Codex sessions, Phase 5–6.",
    },
  ];

  return (
    <>
      <PageHeader title="Settings" description="Appearance and system status for this machine." />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Appearance</h2>
          </CardTitle>
          <CardDescription>Saved in this browser.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeSettings />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>System</h2>
          </CardTitle>
          <CardDescription>Checked {formatDateTime(new Date(health.timestamp))}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3">
            {health.checks.map((check) => (
              <li key={check.name} className="flex flex-col gap-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium capitalize">{check.name}</span>
                  <Badge
                    variant="outline"
                    className={
                      check.status === "up"
                        ? "border-success/40 text-success"
                        : "border-destructive/40 text-destructive"
                    }
                  >
                    {check.status === "up" ? `Up · ${check.latencyMs} ms` : "Down"}
                  </Badge>
                </div>
                {check.error && (
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                    {check.error}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Integrations</h2>
          </CardTitle>
          <CardDescription>Nothing outside this machine is contacted until set up.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {integrations.map((integration) => (
              <li
                key={integration.name}
                className="flex items-center justify-between gap-4 py-3 text-sm first:pt-0 last:pb-0"
              >
                <div>
                  <div className="font-medium">{integration.name}</div>
                  <div className="text-xs text-muted-foreground">{integration.detail}</div>
                </div>
                <Badge variant="outline" className="text-muted-foreground">
                  {integration.status}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
