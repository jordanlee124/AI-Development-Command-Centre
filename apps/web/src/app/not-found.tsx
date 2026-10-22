import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      icon={FileQuestion}
      title="Page not found"
      description="There is no page at this address."
    >
      <Link href="/" className={buttonVariants()}>
        Back to overview
      </Link>
    </EmptyState>
  );
}
