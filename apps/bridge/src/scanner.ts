// Reads what's new in agent session files, for any provider (Claude Code, Codex). A provider
// lists the files and parses their lines; the scanner tracks offsets, reads in bounded chunks,
// and sends a session only once one of its records says its working folder is inside an
// approved folder.
import { open, stat } from "node:fs/promises";
import {
  MAX_EVENTS_PER_BATCH,
  isInsideFolder,
  type AgentSource,
  type SessionBatch,
  type SessionEvent,
} from "@adcc/shared";

/** Most bytes read from one file at a time, so a long history can't exhaust memory. */
export const MAX_READ_BYTES = 16 * 1024 * 1024;
/** A session with no working folder recorded in this many bytes is never sent. */
const CWD_WITHIN_BYTES = 1024 * 1024;

export interface Line {
  text: string;
  lineNo: number;
}

/** What one file has said about its session so far. */
export interface SessionInfo {
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
  title: string | null;
  details: SessionBatch["details"];
}

/** Parses one file from its first line on; keeps whatever state that needs. */
export interface SessionParser {
  /** Safe to call again with lines already parsed (after a failed send). */
  parse(lines: readonly Line[]): { events: SessionEvent[]; skipped: number };
  session(): SessionInfo;
}

/** One agent tool: where its session files are and how to read them. */
export interface Provider {
  source: AgentSource;
  dataDir: string;
  /** Session files that may belong to an approved folder. Nothing is opened yet. */
  listFiles(): Promise<{ files: string[]; errors: string[] }>;
  newParser(path: string): SessionParser;
}

interface FileState {
  offset: number;
  lineNo: number;
  skipped: number;
  /** Working folder outside the approved folders (or never recorded): never read again. */
  excluded: boolean;
  parser: SessionParser;
}

export interface PendingFile {
  path: string;
  /** Empty when the read only skipped an oversized line. */
  batches: SessionBatch[];
  /** Call once every batch was accepted; until then the same bytes are read again. */
  commit(): void;
}

async function readAt(path: string, position: number, length: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// shortcut: offsets live in memory, so a restart re-reads and re-sends every session file (the
// web side dedupes); persist offsets if start-up traffic ever matters.
export class TranscriptScanner {
  private readonly files = new Map<string, FileState>();
  readonly provider: Provider;
  private readonly approvedFolders: readonly string[];

  constructor(provider: Provider, approvedFolders: readonly string[]) {
    this.provider = provider;
    this.approvedFolders = approvedFolders;
  }

  listFiles(): Promise<{ files: string[]; errors: string[] }> {
    return this.provider.listFiles();
  }

  /** The next unread complete lines of one file (up to MAX_READ_BYTES), or null. */
  async read(path: string): Promise<PendingFile | null> {
    let state = this.files.get(path);
    const { size } = await stat(path);
    if (!state || size < state.offset) {
      // New, or shorter than before (rewritten): start over; the web side dedupes.
      state = {
        offset: 0,
        lineNo: 0,
        skipped: 0,
        excluded: false,
        parser: this.provider.newParser(path),
      };
      this.files.set(path, state);
    }
    if (state.excluded || size === state.offset) return null;
    const file = state;

    // Until a file says which folder it belongs to, read no more than it has to say so in: a
    // file outside the approved folders is read up to CWD_WITHIN_BYTES once, then never again.
    const unplaced = file.parser.session().cwd === null;
    const limit = unplaced ? CWD_WITHIN_BYTES : MAX_READ_BYTES;
    const chunk = await readAt(path, file.offset, Math.min(size - file.offset, limit));
    // The tool may be mid-write: only complete lines count.
    const end = chunk.lastIndexOf(0x0a);
    if (end === -1) {
      if (unplaced && chunk.length === limit) file.excluded = true;
      if (unplaced || chunk.length < MAX_READ_BYTES) return null;
      return this.skipLongLine(path, file, size);
    }
    const texts = chunk
      .subarray(0, end + 1)
      .toString("utf8")
      .split("\n");
    texts.pop(); // after the final newline
    const lines: Line[] = texts.map((text, i) => ({
      text: text.replace(/\r$/, ""),
      lineNo: file.lineNo + i + 1,
    }));

    const { events, skipped } = file.parser.parse(lines);
    const { sessionId, cwd, gitBranch, title, details } = file.parser.session();
    if (cwd === null || sessionId === null) {
      // Can't tell whether it's approved yet; give up once there's been plenty to tell from.
      if (chunk.length === limit) file.excluded = true;
      return null;
    }
    if (!this.approvedFolders.some((folder) => isInsideFolder(cwd, folder))) {
      file.excluded = true;
      return null;
    }

    const base = {
      source: this.provider.source,
      sessionId,
      sourcePath: path,
      cwd,
      gitBranch,
      title,
      details,
    };
    const skippedRecords = file.skipped + skipped;
    const batches: SessionBatch[] = [];
    for (let i = 0; i === 0 || i < events.length; i += MAX_EVENTS_PER_BATCH) {
      batches.push({ ...base, skippedRecords, events: events.slice(i, i + MAX_EVENTS_PER_BATCH) });
    }
    return {
      path,
      batches,
      commit() {
        file.offset += end + 1;
        file.lineNo += lines.length;
        file.skipped = skippedRecords;
      },
    };
  }

  /** One line longer than MAX_READ_BYTES: count it as unrecognised and move past it. */
  private async skipLongLine(path: string, file: FileState, size: number) {
    for (let at = file.offset + MAX_READ_BYTES; at < size; at += 1024 * 1024) {
      const newline = (await readAt(path, at, Math.min(1024 * 1024, size - at))).indexOf(0x0a);
      if (newline !== -1) {
        const next = at + newline + 1;
        return {
          path,
          batches: [],
          commit() {
            file.offset = next;
            file.lineNo += 1;
            file.skipped += 1;
          },
        };
      }
    }
    return null; // still being written
  }
}

/** An fs error's code ("ENOENT"), never its message (which can hold more of the path). */
export function code(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "unreadable";
}
