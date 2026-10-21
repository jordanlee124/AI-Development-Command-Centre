import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { checkHealth } from "@/server/services/health-service";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const health = await checkHealth();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <Card>
        <CardHeader>
          <CardTitle>System status</CardTitle>
          <CardDescription>Checked {new Date(health.timestamp).toLocaleString()}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {health.checks.map((check) => (
              <li key={check.name} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="capitalize">{check.name}</span>
                <Badge variant={check.status === "up" ? "secondary" : "destructive"}>
                  {check.status}
                </Badge>
                {check.error && <span className="w-full text-muted-foreground">{check.error}</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>No data yet</CardTitle>
          <CardDescription>
            Projects, sessions and usage appear here as later phases connect real sources. See
            ROADMAP.md.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
