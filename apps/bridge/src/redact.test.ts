import { describe, expect, it } from "vitest";
import { redact } from "./redact.ts";

describe("redact", () => {
  it.each([
    ["Error: sk-ant-api03-abcdefghijklmnop failed", "Error: [redacted] failed"],
    ["push failed for github_pat_11ABCDEFG0123456789_xyz", "push failed for [redacted]"],
    ["auth ghp_abcdefghijklmnopqrstuvwxyz0123", "auth [redacted]"],
    ["Authorization: Bearer abcdef0123456789xyz", "Authorization: [redacted]"],
    ["PGPASSWORD=hunter2 psql failed", "PGPASSWORD=[redacted] psql failed"],
    ["password=hunter2 rejected", "password=[redacted] rejected"],
    ["api_key: abc123 invalid", "api_key: [redacted] invalid"],
    ["connect postgres://adcc:s3cret@127.0.0.1/adcc", "connect [redacted]127.0.0.1/adcc"],
    ["AKIAABCDEFGHIJKLMNOP denied", "[redacted] denied"],
    // Shapes the security audit found passing through an earlier version.
    ["mysql -u root --password hunter2hunter2", "mysql -u root --password [redacted]"],
    ["DB_PASS=hunter2 refused", "DB_PASS=[redacted] refused"],
    ["curl -H 'Cookie: session=abcdef123456'", "curl -H 'Cookie: [redacted]"],
    ["charge sk_live_51Habcdefghijklmn0123 declined", "charge [redacted] declined"],
    ["slack xoxb-1234-5678-abcdefghijkl failed", "slack [redacted] failed"],
    ["OPENAI=sk-proj-Ab12Cd34Ef56Gh78 rejected", "OPENAI=[redacted] rejected"],
    ["mysql -u root -p hunter2", "mysql -u root -p [redacted]"],
    ['export AUTH_SECRET="two words"', "export AUTH_SECRET=[redacted]"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "jwt [redacted]"],
  ])("masks %s", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it("leaves ordinary error text alone", () => {
    expect(redact("Exit code 1")).toBe("Exit code 1");
    expect(redact("You've hit your session limit · resets 2:50pm")).toBe(
      "You've hit your session limit · resets 2:50pm",
    );
    expect(redact("authentication failed for user")).toBe("authentication failed for user");
    expect(redact("File has not been read yet. Read it first before writing to it.")).toBe(
      "File has not been read yet. Read it first before writing to it.",
    );
  });

  it("keeps only the first non-empty line", () => {
    expect(redact("\n  Exit code 1\nsecret output\n")).toBe("Exit code 1");
  });

  it("drops control and bidi characters", () => {
    expect(redact("abc\u202Eevil\u0007")).toBe("abc evil");
  });

  it("clips long lines", () => {
    const out = redact("word ".repeat(100), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith("…")).toBe(true);
  });

  it("masks long opaque strings such as keys and hashes", () => {
    expect(redact(`value ${"Zx9".repeat(10)} end`)).toBe("value [redacted] end");
    expect(redact(`commit a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0`)).toBe("commit [redacted]");
  });
});
