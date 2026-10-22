import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DomainError } from "@/domain/errors";
import { formObject, mutate } from "./mutate";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe("mutate", () => {
  it("refreshes pages after a successful change", async () => {
    expect(await mutate(async () => {})).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("returns a broken rule as a message on its field", async () => {
    const state = await mutate(async () => {
      throw new DomainError("CONFLICT", "Taken.", "title");
    });
    expect(state).toEqual({ ok: false, error: "Taken.", fieldErrors: { title: ["Taken."] } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns validation errors per field", async () => {
    const state = await mutate(async () => {
      z.object({ name: z.string().min(1, "Name is required") }).parse({ name: "" });
    });
    expect(state).toMatchObject({ ok: false, fieldErrors: { name: ["Name is required"] } });
  });

  it("logs unexpected failures and says the save failed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = await mutate(async () => {
      throw new Error("connection refused");
    });
    expect(state).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't save/) });
    expect(log).toHaveBeenCalled();
  });
});

describe("formObject", () => {
  it("keeps every value of list fields and drops Next's action keys", () => {
    const form = new FormData();
    form.append("$ACTION_ID_abc", "");
    form.append("title", "x");
    form.append("dependsOnIds", "a");
    form.append("dependsOnIds", "b");
    expect(formObject(form, ["dependsOnIds"])).toEqual({ title: "x", dependsOnIds: ["a", "b"] });
  });

  it("gives an empty list when no box is ticked", () => {
    expect(formObject(new FormData(), ["dependsOnIds"])).toEqual({ dependsOnIds: [] });
  });
});
