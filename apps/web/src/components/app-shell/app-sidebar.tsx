"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TerminalSquare } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { insightNav, isActive, settingsNav, workspaceNav, type NavItem } from "./nav";

function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenu>
      {items.map((item) => {
        const active = isActive(item.href, pathname);
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              isActive={active}
              tooltip={item.title}
              render={
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => isMobile && setOpenMobile(false)}
                />
              }
            >
              <item.icon aria-hidden />
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <TerminalSquare aria-hidden className="size-4" />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="font-semibold">ADCC</span>
                <span className="text-xs text-muted-foreground">Command Center</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label="Main">
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavLinks items={workspaceNav} />
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Insights</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavLinks items={insightNav} />
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarFooter>
        <NavLinks items={[settingsNav]} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
