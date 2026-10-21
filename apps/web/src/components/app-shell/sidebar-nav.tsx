"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  ChartColumn,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Route once built; until then the roadmap phase that adds it. */
  target: { href: string } | { phase: number };
}

const navItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, target: { href: "/" } },
  { label: "Projects", icon: FolderKanban, target: { phase: 2 } },
  { label: "GitHub", icon: GitBranch, target: { phase: 3 } },
  { label: "Sessions", icon: MessagesSquare, target: { phase: 4 } },
  { label: "Usage & cost", icon: ChartColumn, target: { phase: 6 } },
  { label: "Activity", icon: Activity, target: { phase: 7 } },
  { label: "Agents", icon: Bot, target: { phase: 8 } },
];

const itemClass = "flex items-center gap-2 rounded-md px-3 py-2 text-sm";

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {navItems.map(({ label, icon: Icon, target }) =>
        "href" in target ? (
          <Link
            key={label}
            href={target.href}
            aria-current={pathname === target.href ? "page" : undefined}
            className={cn(
              itemClass,
              "hover:bg-sidebar-accent",
              pathname === target.href && "bg-sidebar-accent font-medium",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </Link>
        ) : (
          <span key={label} aria-disabled="true" className={cn(itemClass, "text-muted-foreground")}>
            <Icon aria-hidden className="size-4" />
            {label}
            <Badge variant="outline" className="ml-auto">
              Phase {target.phase}
            </Badge>
          </span>
        ),
      )}
    </nav>
  );
}
