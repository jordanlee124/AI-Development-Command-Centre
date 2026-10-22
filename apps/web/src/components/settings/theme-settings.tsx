"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { THEME_OPTIONS } from "@/components/app-shell/theme-menu";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const subscribe = () => () => {};

export function ThemeSettings() {
  const { theme, setTheme } = useTheme();
  // The stored theme is only known in the browser; render no selection on the server.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <RadioGroup
      aria-label="Theme"
      value={mounted ? theme : null}
      onValueChange={(value) => setTheme(String(value))}
      className="grid gap-2 sm:grid-cols-3"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <Label
          key={value}
          className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-data-checked:border-primary has-data-checked:bg-accent"
        >
          <RadioGroupItem value={value} aria-label={label} />
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          {label}
        </Label>
      ))}
    </RadioGroup>
  );
}
