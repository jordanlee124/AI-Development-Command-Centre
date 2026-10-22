import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import { getActivity } from "@/server/services/dashboard-service";
import { load } from "@/server/services/load";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

export default async function ActivityPage() {
  const result = await load(getActivity);

  return (
    <>
      <PageHeader
        title="Activity"
        description="What happened across your projects, newest first."
      />
      {!result.ok ? (
        <DataUnavailable error={result.error} />
      ) : result.data.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="The timeline fills from real events (task changes, commits, agent sessions) as those phases land."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {[...Map.groupBy(result.data, (event) => formatDate(event.occurredAt))].map(
            ([day, events]) => (
              <Card key={day}>
                <CardHeader>
                  <CardTitle className="text-sm">
                    <h2>{day}</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="flex flex-col gap-3 border-l pl-4">
                    {events.map((event) => (
                      <li key={event.id} className="relative text-sm">
                        <span
                          aria-hidden
                          className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-primary"
                        />
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium">{event.title}</span>
                          <time
                            dateTime={event.occurredAt.toISOString()}
                            title={formatDateTime(event.occurredAt)}
                            className="shrink-0 text-xs text-muted-foreground"
                          >
                            {timeFormat.format(event.occurredAt)}
                          </time>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[event.project?.name, event.description].filter(Boolean).join(" · ")}
                        </div>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ),
          )}
        </div>
      )}
    </>
  );
}
