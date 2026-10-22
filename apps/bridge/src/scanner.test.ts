import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeProvider, folderMayMatch } from "./claude-transcript.ts";
import { MAX_READ_BYTES, TranscriptScanner } from "./scanner.ts";

const scannerFor = (dir: string, approved: string[]) =>
  new TranscriptScanner(claudeProvider(dir, approved), approved);

/** Every candidate file read once, as one bridge cycle would before sending. */
async function scan(scanner: TranscriptScanner) {
  const { files, errors } = await scanner.listFiles();
  const pending = [];
  for (const file of files) {
    const read = await scanner.read(file);
    if (read) pending.push(read);
  }
  return { pending, errors };
}

const FIXTURE = readFileSync(
  new URL("./__fixtures__/claude-session.jsonl", import.meta.url),
  "utf8",
);
const SESSION = "0b1e2c3d-4f50-4a6b-8c7d-9e0f1a2b3c4d";

describe("folderMayMatch", () => {
  const approved = ["D:\\Projects\\fixture-app"];
  it.each([
    ["D--Projects-fixture-app", true],
    ["d--Projects-fixture-app", true], // drive letter case varies
    ["D--Projects-fixture-app-sub", true], // a subfolder (or a sibling: the cwd check decides)
    ["D--Projects-other", false],
    ["C--Users-me", false],
  ])("%s → %s", (dir, expected) => {
    expect(folderMayMatch(dir, approved)).toBe(expected);
  });
});

describe("TranscriptScanner", () => {
  let root: string;
  let dir: string;
  let file: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "adcc-bridge-"));
    dir = join(root, "D--Projects-fixture-app");
    mkdirSync(dir);
    file = join(dir, `${SESSION}.jsonl`);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("sends a transcript in an approved folder, then only what's new", async () => {
    writeFileSync(file, FIXTURE);
    const scanner = scannerFor(root, ["D:\\Projects\\fixture-app"]);

    const first = await scan(scanner);
    expect(first.errors).toEqual([]);
    expect(first.pending).toHaveLength(1);
    const batch = first.pending[0]!.batches[0]!;
    expect(batch).toMatchObject({
      sessionId: SESSION,
      sourcePath: file,
      cwd: "D:\\Projects\\fixture-app",
      title: "Fixture session title",
      skippedRecords: 2,
    });
    expect(batch.events).toHaveLength(7);
    first.pending[0]!.commit();

    expect((await scan(scanner)).pending).toEqual([]);

    appendFileSync(file, '{"type":"unknown-again"}\n');
    const next = (await scan(scanner)).pending[0]!;
    expect(next.batches[0]).toMatchObject({ events: [], skippedRecords: 3 });
    expect(next.batches[0]!.events).toEqual([]);
  });

  it("re-reads the same lines next time when a send failed (no commit)", async () => {
    writeFileSync(file, FIXTURE);
    const scanner = scannerFor(root, ["D:\\Projects"]);
    const first = await scan(scanner);
    const again = await scan(scanner);
    expect(again.pending[0]!.batches).toEqual(first.pending[0]!.batches);
  });

  it("waits for a line Claude Code is still writing", async () => {
    const lines = FIXTURE.split("\n");
    writeFileSync(file, `${lines.slice(0, 3).join("\n")}\n${lines[3]!.slice(0, 50)}`);
    const scanner = scannerFor(root, ["D:\\Projects\\fixture-app"]);
    const first = (await scan(scanner)).pending[0]!;
    expect(first.batches[0]!.events.map((e) => e.sourceLine)).toEqual([2]);
    first.commit();

    appendFileSync(file, `${lines[3]!.slice(50)}\n`);
    const second = (await scan(scanner)).pending[0]!;
    expect(second.batches[0]!.events.map((e) => [e.type, e.sourceLine])).toEqual([
      ["message.assistant", 4],
    ]);
    expect(second.batches[0]!.skippedRecords).toBe(0);
  });

  it("never sends a session whose folder is outside the approved folders", async () => {
    writeFileSync(
      file,
      FIXTURE.replaceAll("D:\\\\Projects\\\\fixture-app", "D:\\\\Projects\\\\fixture-app-old"),
    );
    const scanner = scannerFor(root, ["D:\\Projects\\fixture-app"]);
    expect((await scan(scanner)).pending).toEqual([]);
    appendFileSync(file, FIXTURE);
    expect((await scan(scanner)).pending).toEqual([]); // excluded for good
  });

  it("doesn't open folders that can't belong to an approved folder", async () => {
    writeFileSync(file, FIXTURE);
    const scanner = scannerFor(root, ["C:\\Work"]);
    expect(await scan(scanner)).toEqual({ pending: [], errors: [] });
  });

  it("ignores subfolders and non-session files", async () => {
    mkdirSync(join(dir, SESSION, "subagents"), { recursive: true });
    writeFileSync(join(dir, SESSION, "subagents", "agent-1.jsonl"), FIXTURE);
    writeFileSync(join(dir, "notes.txt"), FIXTURE);
    const scanner = scannerFor(root, ["D:\\Projects"]);
    expect((await scan(scanner)).pending).toEqual([]);
  });

  it("starts over when a transcript gets shorter", async () => {
    writeFileSync(file, FIXTURE);
    const scanner = scannerFor(root, ["D:\\Projects"]);
    (await scan(scanner)).pending[0]!.commit();
    writeFileSync(file, FIXTURE.split("\n").slice(0, 3).join("\n") + "\n");
    const restart = (await scan(scanner)).pending[0]!;
    expect(restart.batches[0]!.events.map((e) => e.sourceLine)).toEqual([2]);
  });

  it("splits many events into batches the web app accepts", async () => {
    const prompt = (i: number) =>
      JSON.stringify({
        type: "user",
        uuid: `u${i}`,
        timestamp: "2026-10-21T06:30:00.000Z",
        cwd: "D:\\Projects\\fixture-app",
        message: { role: "user", content: "x" },
      });
    writeFileSync(file, Array.from({ length: 1201 }, (_, i) => prompt(i)).join("\n") + "\n");
    const scanner = scannerFor(root, ["D:\\Projects"]);
    const read = (await scan(scanner)).pending[0]!;
    expect(read.batches.map((b) => b.events.length)).toEqual([500, 500, 201]);
  });

  it("reads a large backlog in bounded steps and skips a line too long to read", async () => {
    const lines = FIXTURE.split("\n");
    const huge = `{"type":"user","pad":"${"x".repeat(MAX_READ_BYTES)}"}`;
    writeFileSync(file, `${lines.slice(0, 2).join("\n")}\n${huge}\n${lines[3]}\n`);
    const scanner = scannerFor(root, ["D:\\Projects"]);

    const first = (await scanner.read(file))!; // lines 1–2; the huge line didn't fit
    expect(first.batches[0]!.events.map((e) => e.sourceLine)).toEqual([2]);
    first.commit();
    const skip = (await scanner.read(file))!; // the huge line: skipped and counted
    expect(skip.batches).toEqual([]);
    skip.commit();
    const last = (await scanner.read(file))!;
    expect(last.batches[0]).toMatchObject({ skippedRecords: 1 });
    expect(last.batches[0]!.events.map((e) => [e.type, e.sourceLine])).toEqual([
      ["message.assistant", 4],
    ]);
    last.commit();
    expect(await scanner.read(file)).toBeNull();
  });

  it("gives up on a transcript that records no working folder in its first megabyte", async () => {
    const noCwd = JSON.stringify({ type: "file-history-snapshot", pad: "x".repeat(1000) });
    writeFileSync(file, `${Array.from({ length: 1100 }, () => noCwd).join("\n")}\n`);
    const scanner = scannerFor(root, ["D:\\Projects"]);
    expect(await scanner.read(file)).toBeNull();
    appendFileSync(file, FIXTURE);
    expect(await scanner.read(file)).toBeNull(); // excluded for good
  });

  it("reads no more than 1 MB of a file that hasn't said where it ran", async () => {
    // A first line longer than the limit: no folder can be learned, so it's dropped unread.
    writeFileSync(file, `${JSON.stringify({ type: "x", pad: "x".repeat(1100 * 1024) })}\n`);
    appendFileSync(file, FIXTURE);
    const scanner = scannerFor(root, ["D:\\Projects"]);
    expect(await scanner.read(file)).toBeNull();
    expect(await scanner.read(file)).toBeNull(); // excluded for good
  });

  it("reports a missing projects folder without its contents", async () => {
    const scanner = scannerFor(join(root, "missing"), ["D:\\Projects"]);
    const { pending, errors } = await scan(scanner);
    expect(pending).toEqual([]);
    expect(errors[0]).toMatch(/Can't read the Claude Code projects folder .*ENOENT/);
  });
});
