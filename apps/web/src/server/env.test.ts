import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const validUrl = "postgresql://adcc:s3cret@127.0.0.1:5432/adcc?schema=public";

describe("parseEnv", () => {
  it("accepts a postgres URL and defaults NODE_ENV", () => {
    expect(parseEnv({ DATABASE_URL: validUrl })).toEqual({
      DATABASE_URL: validUrl,
      NODE_ENV: "development",
      GITHUB_API_URL: "https://api.github.com",
      GITHUB_SYNC_INTERVAL_MINUTES: 15,
    });
  });

  it("treats a blank GITHUB_TOKEN as not configured", () => {
    expect(parseEnv({ DATABASE_URL: validUrl, GITHUB_TOKEN: "" }).GITHUB_TOKEN).toBeUndefined();
  });

  it("accepts a fine-grained token", () => {
    const token = `github_pat_${"a".repeat(30)}`;
    expect(parseEnv({ DATABASE_URL: validUrl, GITHUB_TOKEN: token }).GITHUB_TOKEN).toBe(token);
  });

  it("rejects a classic or OAuth token without echoing it", () => {
    for (const token of ["ghp_topsecretvalue1234567890", "gho_topsecretvalue1234567890"]) {
      const parse = () => parseEnv({ DATABASE_URL: validUrl, GITHUB_TOKEN: token });
      expect(parse).toThrow(/fine-grained[\s\S]*GITHUB_TOKEN/);
      expect(parse).not.toThrow(/topsecret/);
    }
  });

  it("allows plain http only for a loopback API URL", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: validUrl, GITHUB_API_URL: "http://127.0.0.1:3101" }),
    ).not.toThrow();
    expect(() =>
      parseEnv({ DATABASE_URL: validUrl, GITHUB_API_URL: "http://example.com" }),
    ).toThrow(/GITHUB_API_URL/);
  });

  it("limits the sync interval to off or 5–1440 minutes", () => {
    const interval = (value: string) =>
      parseEnv({ DATABASE_URL: validUrl, GITHUB_SYNC_INTERVAL_MINUTES: value })
        .GITHUB_SYNC_INTERVAL_MINUTES;
    expect(interval("0")).toBe(0);
    expect(interval("30")).toBe(30);
    expect(() => interval("1")).toThrow(/GITHUB_SYNC_INTERVAL_MINUTES/);
  });

  it("treats a blank bridge token as off and refuses a short one without echoing it", () => {
    expect(
      parseEnv({ DATABASE_URL: validUrl, ADCC_BRIDGE_TOKEN: "" }).ADCC_BRIDGE_TOKEN,
    ).toBeUndefined();
    const token = "b".repeat(32);
    expect(parseEnv({ DATABASE_URL: validUrl, ADCC_BRIDGE_TOKEN: token }).ADCC_BRIDGE_TOKEN).toBe(
      token,
    );
    const parse = () => parseEnv({ DATABASE_URL: validUrl, ADCC_BRIDGE_TOKEN: "shortsecret" });
    expect(parse).toThrow(/ADCC_BRIDGE_TOKEN/);
    expect(parse).not.toThrow(/shortsecret/);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres URL without echoing its value", () => {
    const bad = "mysql://user:topsecret@localhost/db";
    expect(() => parseEnv({ DATABASE_URL: bad })).toThrow(/postgresql/);
    expect(() => parseEnv({ DATABASE_URL: bad })).not.toThrow(/topsecret/);
  });
});
