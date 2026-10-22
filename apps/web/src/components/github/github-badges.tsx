import { REVIEW_STATUS_LABELS, type ReviewStatus } from "@/domain/github";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// GitHub states are open-ended strings (ADR-008); unknown ones fall back to a neutral badge.

const SUCCESS = "border-success/40 text-success";
const FAILURE = "border-destructive/40 text-destructive";
const RUNNING = "border-primary/40 text-primary dark:text-ring";
const MUTED = "text-muted-foreground";

const conclusionTone: Record<string, string> = {
  success: SUCCESS,
  failure: FAILURE,
  timed_out: FAILURE,
  startup_failure: FAILURE,
  action_required: "border-warning/40 text-warning",
  cancelled: MUTED,
  skipped: MUTED,
  neutral: MUTED,
  stale: MUTED,
};

/** "timed_out" → "Timed out" */
const humanize = (value: string) => {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function RunStatusBadge({
  status,
  conclusion,
}: {
  status: string;
  conclusion: string | null;
}) {
  const label = status === "completed" ? (conclusion ?? status) : status;
  const tone = status === "completed" ? conclusionTone[label] : RUNNING;
  return (
    <Badge variant="outline" className={cn(tone)}>
      {humanize(label)}
    </Badge>
  );
}

const prTone: Record<string, string> = { open: RUNNING, merged: SUCCESS, closed: MUTED };

export function PullRequestStateBadge({ state, draft }: { state: string; draft: boolean }) {
  return (
    <Badge variant="outline" className={cn(draft && state === "open" ? MUTED : prTone[state])}>
      {draft && state === "open" ? "Draft" : humanize(state)}
    </Badge>
  );
}

const reviewTone: Record<ReviewStatus, string> = {
  approved: SUCCESS,
  changes_requested: FAILURE,
  review_requested: "border-warning/40 text-warning",
  no_reviews: MUTED,
};

/** "—" for a value ADCC doesn't know (ADR-011), announced as such. */
export function NotAvailable() {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden>—</span>
      <span className="sr-only">Not available</span>
    </span>
  );
}

export function ReviewStatusBadge({ status }: { status: string | null }) {
  if (!status || !(status in REVIEW_STATUS_LABELS)) return <NotAvailable />;
  const known = status as ReviewStatus;
  return (
    <Badge variant="outline" className={cn(reviewTone[known])}>
      {REVIEW_STATUS_LABELS[known]}
    </Badge>
  );
}

export function IssueStateBadge({ state }: { state: string }) {
  return (
    <Badge variant="outline" className={cn(state === "open" ? RUNNING : MUTED)}>
      {humanize(state)}
    </Badge>
  );
}

/** Sync health of one repository: never synced, last sync failed, or fine. */
export function SyncStatusBadge({
  lastSyncedAt,
  lastSyncError,
}: {
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
}) {
  if (lastSyncError) {
    return (
      <Badge variant="outline" className={FAILURE}>
        Sync failed
      </Badge>
    );
  }
  if (!lastSyncedAt) {
    return (
      <Badge variant="outline" className={MUTED}>
        Not synced
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={SUCCESS}>
      Synced
    </Badge>
  );
}
