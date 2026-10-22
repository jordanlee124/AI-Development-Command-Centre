import { describe, expect, it } from "vitest";
import {
  isAbsoluteWindowsPath,
  projectInputSchema,
  repositoryRefSchema,
  slugify,
  uniqueSlug,
} from "./project";

describe("slugify", () => {
  it.each([
    ["My Project!", "my-project"],
    ["  Café  Déjà vu ", "cafe-deja-vu"],
    ["ADCC v2.0", "adcc-v2-0"],
    ["!!!", "project"],
  ])("%j → %j", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it("stays within the column limit without a trailing dash", () => {
    const slug = slugify(`${"a".repeat(79)} b`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("adds the first free number", () => {
    expect(uniqueSlug("app", new Set())).toBe("app");
    expect(uniqueSlug("app", new Set(["app", "app-2"]))).toBe("app-3");
  });
});

describe("local folder", () => {
  it.each(["D:\\Projects\\app", "c:\\", "\\\\server\\share\\repo"])("accepts %s", (path) => {
    expect(isAbsoluteWindowsPath(path)).toBe(true);
  });

  it.each(["Projects\\app", "D:", "D:\\a\\..\\b", "D:\\a\\.\\b", "/home/app", "D:\\a<b"])(
    "rejects %s",
    (path) => {
      expect(isAbsoluteWindowsPath(path)).toBe(false);
    },
  );

  it("normalises slashes and the trailing separator; blank is null", () => {
    const parse = (localPath: string) =>
      projectInputSchema.parse({ name: "x", localPath }).localPath;
    expect(parse(" D:/Projects/app/ ")).toBe("D:\\Projects\\app");
    expect(parse("C:\\")).toBe("C:\\");
    expect(parse("  ")).toBeNull();
    expect(projectInputSchema.safeParse({ name: "x", localPath: "app" }).success).toBe(false);
  });
});

describe("repositoryRefSchema", () => {
  it.each([
    ["Anthropic/Claude-Code", { owner: "anthropic", name: "claude-code" }],
    ["https://github.com/vercel/next.js.git", { owner: "vercel", name: "next.js" }],
    ["github.com/a/b/", { owner: "a", name: "b" }],
  ])("parses %s", (input, expected) => {
    expect(repositoryRefSchema.parse(input)).toEqual(expected);
  });

  it.each(["just-a-name", "a/b/c", "-bad/repo", "owner/..", "https://gitlab.com/a/b", ""])(
    "rejects %j",
    (input) => {
      expect(repositoryRefSchema.safeParse(input).success).toBe(false);
    },
  );
});
