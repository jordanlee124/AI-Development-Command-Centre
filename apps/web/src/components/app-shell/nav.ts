import {
  Activity,
  Bot,
  ChartColumn,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  ListTodo,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const workspaceNav: NavItem[] = [
  { title: "Overview", href: "/", icon: LayoutDashboard },
  { title: "Projects", href: "/projects", icon: FolderKanban },
  { title: "Tasks", href: "/tasks", icon: ListTodo },
];

export const insightNav: NavItem[] = [
  { title: "AI Agents", href: "/agents", icon: Bot },
  { title: "GitHub", href: "/github", icon: GitBranch },
  { title: "Analytics", href: "/analytics", icon: ChartColumn },
  { title: "Activity", href: "/activity", icon: Activity },
];

export const settingsNav: NavItem = { title: "Settings", href: "/settings", icon: Settings };

export const allNav: NavItem[] = [...workspaceNav, ...insightNav, settingsNav];

export function isActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function titleFor(pathname: string): string {
  return allNav.find((item) => isActive(item.href, pathname))?.title ?? "ADCC";
}
