import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.ts";

const TOKEN = "t".repeat(32);
const valid = {
  ADCC_BRIDGE_TOKEN: TOKEN,
  BRIDGE_APPROVED_FOLDERS: "D:\\Projects; C:\\Work\\app ;",
};

describe("parseConfig", () => {
  it("accepts a minimal config and fills defaults", () => {
    const config = parseConfig(valid);
    expect(config.ADCC_WEB_URL).toBe("http://127.0.0.1:3000");
    expect(config.BRIDGE_APPROVED_FOLDERS).toEqual(["D:\\Projects", "C:\\Work\\app"]);
    expect(config.BRIDGE_POLL_SECONDS).toBe(10);
    expect(config.CLAUDE_EXE).toMatch(/claude-code[\\/]bin[\\/]claude\.exe$/);
    expect(config.CLAUDE_PROJECTS_DIR).toMatch(/\.claude[\\/]projects$/);
  });

  it.each([
    ["a non-loopback ADCC_WEB_URL", { ADCC_WEB_URL: "http://192.168.1.5:3000" }, "ADCC_WEB_URL"],
    ["an https ADCC_WEB_URL", { ADCC_WEB_URL: "https://localhost:3000" }, "ADCC_WEB_URL"],
    ["a short token", { ADCC_BRIDGE_TOKEN: "short" }, "ADCC_BRIDGE_TOKEN"],
    ["no approved folders", { BRIDGE_APPROVED_FOLDERS: " ; " }, "BRIDGE_APPROVED_FOLDERS"],
    ["a relative folder", { BRIDGE_APPROVED_FOLDERS: "Projects" }, "BRIDGE_APPROVED_FOLDERS"],
    [
      "a climbing folder",
      { BRIDGE_APPROVED_FOLDERS: "D:\\Projects\\..\\Users" },
      "BRIDGE_APPROVED_FOLDERS",
    ],
    ["claude.cmd", { CLAUDE_EXE: "C:\\npm\\claude.cmd" }, "CLAUDE_EXE"],
    ["a 1 s poll", { BRIDGE_POLL_SECONDS: "1" }, "BRIDGE_POLL_SECONDS"],
  ])("refuses %s", (_, override, key) => {
    expect(() => parseConfig({ ...valid, ...override })).toThrow(key);
  });

  it("never prints the token", () => {
    expect(() => parseConfig({ ...valid, ADCC_BRIDGE_TOKEN: "secret-but-short" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secret-but-short") }),
    );
  });

  it("refuses a relative CLAUDE_EXE, which Windows would look up in the current folder", () => {
    expect(() => parseConfig({ ...valid, CLAUDE_EXE: "claude.exe" })).toThrow("CLAUDE_EXE");
  });

  it("keeps folders within what the web app accepts, without repeats", () => {
    const many = Array.from({ length: 51 }, (_, i) => `D:\\p${i}`).join(";");
    expect(() => parseConfig({ ...valid, BRIDGE_APPROVED_FOLDERS: many })).toThrow(
      "BRIDGE_APPROVED_FOLDERS",
    );
    expect(
      parseConfig({ ...valid, BRIDGE_APPROVED_FOLDERS: "D:\\a;D:\\a" }).BRIDGE_APPROVED_FOLDERS,
    ).toEqual(["D:\\a"]);
  });

  it("requires approved folders", () => {
    expect(() => parseConfig({ ADCC_BRIDGE_TOKEN: TOKEN })).toThrow("BRIDGE_APPROVED_FOLDERS");
  });
});
