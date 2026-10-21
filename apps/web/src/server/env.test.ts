import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const validUrl = "postgresql://adcc:s3cret@127.0.0.1:5432/adcc?schema=public";

describe("parseEnv", () => {
  it("accepts a postgres URL and defaults NODE_ENV", () => {
    expect(parseEnv({ DATABASE_URL: validUrl })).toEqual({
      DATABASE_URL: validUrl,
      NODE_ENV: "development",
    });
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
