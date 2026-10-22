import Link from "next/link";
import { ListX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "./empty-state";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

interface PageLinks {
  params: Record<string, string | undefined>;
  path: string;
}

function pageHref({ params, path }: PageLinks, target: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  if (target > 1) query.set("page", String(target));
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/** Previous/next links that keep the current filters. Renders nothing for a single page. */
export function Pager({
  page,
  pageCount,
  ...links
}: PageLinks & { page: number; pageCount: number }) {
  if (pageCount <= 1) return null;
  const href = (target: number) => pageHref(links, target);
  return (
    <Pagination aria-label="Pages">
      <PaginationContent>
        {page > 1 && (
          <PaginationItem>
            <PaginationPrevious href={href(page - 1)} />
          </PaginationItem>
        )}
        <PaginationItem className="px-3 text-sm text-muted-foreground tabular-nums">
          Page {page} of {pageCount}
        </PaginationItem>
        {page < pageCount && (
          <PaginationItem>
            <PaginationNext href={href(page + 1)} />
          </PaginationItem>
        )}
      </PaginationContent>
    </Pagination>
  );
}

/** For a ?page= past the end: rows exist, just not on this page. */
export function PastLastPage(links: PageLinks) {
  return (
    <EmptyState
      icon={ListX}
      title="Nothing on this page"
      description="This page is past the end of the list."
    >
      <Link
        href={pageHref(links, 1)}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Go to page 1
      </Link>
    </EmptyState>
  );
}
