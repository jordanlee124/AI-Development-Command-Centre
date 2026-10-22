import { z } from "zod";
import { idSchema, optionalText } from "./validation";

// Mirrors the Prisma enum; the db layer passes it straight through, so drift fails typecheck.
export const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
};

/** "My Project!" → "my-project". Never empty. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || "project";
}

/** First of slug, slug-2, slug-3… not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const SEGMENT = String.raw`[^<>:"|?*\\/\x00-\x1f]+`;
const DRIVE_PATH = new RegExp(String.raw`^[A-Za-z]:\\(?:${SEGMENT}(?:\\${SEGMENT})*)?$`);
const UNC_PATH = new RegExp(String.raw`^\\\\${SEGMENT}\\${SEGMENT}(?:\\${SEGMENT})*$`);

/** Forward slashes → backslashes, no trailing separator (except a drive root like "C:\"). */
export function normalizeWindowsPath(path: string): string {
  const backslashed = path.trim().replace(/\//g, "\\");
  return /^[A-Za-z]:\\$/.test(backslashed) ? backslashed : backslashed.replace(/\\+$/, "");
}

/**
 * Absolute drive or UNC path with no "." or ".." segments. The folder is later the boundary for
 * approved commands (ADR-005), so a path that climbs out of itself is refused.
 */
export function isAbsoluteWindowsPath(path: string): boolean {
  if (!DRIVE_PATH.test(path) && !UNC_PATH.test(path)) return false;
  return !path.split("\\").some((segment) => segment === "." || segment === "..");
}

const localPathSchema = z
  .string()
  .max(500)
  .optional()
  .transform((value) => (value?.trim() ? normalizeWindowsPath(value) : null))
  .refine(
    (value) => value === null || isAbsoluteWindowsPath(value),
    "Enter an absolute Windows folder path, such as D:\\Projects\\my-app",
  );

export const projectInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: optionalText(5000),
  status: z.enum(PROJECT_STATUSES).default("ACTIVE"),
  localPath: localPathSchema,
});

export const projectUpdateSchema = projectInputSchema.extend({ id: idSchema });

export const projectDeleteSchema = z.object({ id: idSchema, confirmName: z.string() });

const GITHUB_OWNER = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;
const GITHUB_REPO = /^[a-z0-9._-]{1,100}$/;

/** "owner/name" or a github.com URL → lowercase owner and name (GitHub names ignore case). */
export const repositoryRefSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const path = value
      .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    const [owner, name, ...rest] = path.split("/");
    if (
      !owner ||
      !name ||
      rest.length > 0 ||
      !GITHUB_OWNER.test(owner) ||
      !GITHUB_REPO.test(name) ||
      name === "." ||
      name === ".."
    ) {
      ctx.addIssue({ code: "custom", message: "Enter a GitHub repository as owner/name" });
      return z.NEVER;
    }
    return { owner, name };
  });

export const repositoryLinkSchema = z.object({
  projectId: idSchema,
  repository: repositoryRefSchema,
});

export const repositoryUnlinkSchema = z.object({ projectId: idSchema, repositoryId: idSchema });
