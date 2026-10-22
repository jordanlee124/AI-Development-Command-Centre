import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const status = (headers: Record<string, string>) =>
  proxy(new NextRequest("http://127.0.0.1:3000/github", { headers })).status;

describe("proxy (DNS-rebinding guard)", () => {
  it("lets loopback requests through on any port", () => {
    expect(status({ host: "127.0.0.1:3000" })).toBe(200);
    expect(status({ host: "localhost:3100", origin: "http://localhost:3100" })).toBe(200);
    expect(status({ host: "[::1]:3000" })).toBe(200);
  });

  it("refuses a rebound host name or a foreign origin", () => {
    expect(status({ host: "evil.example:3000" })).toBe(403);
    expect(status({ host: "127.0.0.1:3000", origin: "http://evil.example:3000" })).toBe(403);
    expect(status({ host: "127.0.0.1.evil.example" })).toBe(403);
    expect(status({ host: "127.0.0.1:3000", origin: "null" })).toBe(403);
  });
});
