"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { FolderKanban, ListTodo, Search } from "lucide-react";
import { searchAction } from "@/app/actions/search";
import type { SearchResults } from "@/server/services/search-service";
import { TASK_STATUS_LABELS } from "@/domain/task";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { allNav } from "./nav";
import { THEME_OPTIONS } from "./theme-menu";

const SEARCH_DEBOUNCE_MS = 200;

export function CommandMenu() {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) return;
    let stale = false;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await searchAction(query);
        // A newer query may have started while this one was in flight.
        if (stale) return;
        setSearchError(!result.ok);
        setResults(result.ok ? result.data : null);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const changeQuery = (value: string) => {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults(null);
      setSearchError(false);
    }
  };

  const run = (action: () => void) => {
    setOpen(false);
    setQuery("");
    setResults(null);
    action();
  };

  const showResults = query.trim().length >= 2 && results !== null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full max-w-64 justify-start gap-2 text-muted-foreground sm:w-64"
      >
        <Search aria-hidden />
        <span className="flex-1 text-left">Search…</span>
        <Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search pages, projects and tasks"
      >
        <Command>
          <CommandInput
            placeholder="Search pages, projects, tasks…"
            value={query}
            onValueChange={changeQuery}
          />
          <CommandList>
            <CommandEmpty>{pending ? "Searching…" : "No results."}</CommandEmpty>

            {showResults && results.projects.length > 0 && (
              <CommandGroup heading="Projects">
                {results.projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={`project ${project.id}`}
                    keywords={[project.name, project.slug, query]}
                    onSelect={() => run(() => router.push(`/projects/${project.id}`))}
                  >
                    <FolderKanban aria-hidden />
                    {project.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {showResults && results.tasks.length > 0 && (
              <CommandGroup heading="Tasks">
                {results.tasks.map((task) => (
                  <CommandItem
                    key={task.id}
                    value={`task ${task.id}`}
                    keywords={[task.title, query]}
                    onSelect={() => run(() => router.push(`/tasks/${task.id}`))}
                  >
                    <ListTodo aria-hidden />
                    <span className="truncate">{task.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {task.project.name} · {TASK_STATUS_LABELS[task.status]}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {searchError && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Project and task search is unavailable while the database is down.
              </p>
            )}

            <CommandGroup heading="Pages">
              {allNav.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`page ${item.title}`}
                  onSelect={() => run(() => router.push(item.href))}
                >
                  <item.icon aria-hidden />
                  {item.title}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Theme">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <CommandItem
                  key={value}
                  value={`theme ${label}`}
                  onSelect={() => run(() => setTheme(value))}
                >
                  <Icon aria-hidden />
                  {label} theme
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
