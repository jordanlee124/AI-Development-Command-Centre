import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ThemeProvider } from "next-themes";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { TopBar } from "@/components/app-shell/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ADCC", template: "%s · ADCC" },
  description: "Local dashboard for AI-assisted software development",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Cookie written by the shadcn sidebar, so the collapsed state survives reloads without a flash.
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            <SidebarProvider defaultOpen={sidebarOpen}>
              <a
                href="#main"
                className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
              >
                Skip to content
              </a>
              <AppSidebar />
              <SidebarInset id="main" tabIndex={-1} className="outline-none">
                <TopBar />
                <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 duration-300 animate-in fade-in md:p-6">
                  {children}
                </div>
              </SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
