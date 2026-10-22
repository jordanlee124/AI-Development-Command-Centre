import { describe, expect, it, vi } from "vitest";
import { load } from "./load";

describe("load", () => {
  it("wraps a successful read", async () => {
    expect(await load(async () => 42)).toEqual({ ok: true, data: 42 });
  });

  it("turns a failed read into an error value instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await load(async () => {
      throw new Error("\n  Can't reach database server  \n");
    });
    expect(result).toEqual({ ok: false, error: "Can't reach database server" });
  });
});
