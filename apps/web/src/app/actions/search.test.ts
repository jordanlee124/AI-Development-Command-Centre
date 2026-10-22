import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchProjects } from "@/server/db/projects";
import { searchTasks } from "@/server/db/tasks";
import { searchAction } from "./search";

vi.mock("@/server/db/projects", () => ({ searchProjects: vi.fn() }));
vi.mock("@/server/db/tasks", () => ({ searchTasks: vi.fn() }));

describe("searchAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(searchProjects).mockResolvedValue([]);
    vi.mocked(searchTasks).mockResolvedValue([]);
  });

  it.each([undefined, 42, "a", " b ", "x".repeat(101)])(
    "rejects invalid input %j without querying",
    async (input) => {
      expect(await searchAction(input)).toEqual({ ok: true, data: { projects: [], tasks: [] } });
      expect(searchProjects).not.toHaveBeenCalled();
    },
  );

  it("trims the query before searching", async () => {
    await searchAction("  adcc ");
    expect(searchProjects).toHaveBeenCalledWith("adcc", 5);
    expect(searchTasks).toHaveBeenCalledWith("adcc", 5);
  });

  it("reports a database failure as an error result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(searchProjects).mockRejectedValue(new Error("down"));
    expect(await searchAction("adcc")).toEqual({ ok: false });
  });
});
