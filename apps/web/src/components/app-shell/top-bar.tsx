"use client";

import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { CommandMenu } from "./command-menu";
import { titleFor } from "./nav";
import { Notifications } from "./notifications";
import { ThemeMenu } from "./theme-menu";

export function TopBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-backdrop-filter:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-4!" />
      <p className="hidden text-sm font-medium md:block">{titleFor(pathname)}</p>
      <div className="ml-auto flex flex-1 items-center justify-end gap-1 md:flex-none">
        <CommandMenu />
        <Notifications />
        <ThemeMenu />
      </div>
    </header>
  );
}
