import type { Metadata } from "next";
import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Development Command Center",
  description: "Local dashboard for AI-assisted software development",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col md:flex-row">
        <aside className="border-b bg-sidebar p-4 text-sidebar-foreground md:w-60 md:shrink-0 md:border-r md:border-b-0">
          <p className="mb-4 px-3 text-lg font-semibold">ADCC</p>
          <SidebarNav />
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </body>
    </html>
  );
}
