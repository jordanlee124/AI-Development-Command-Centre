// Error lines and AI titles are the only free text taken from a transcript. Keep one line, mask
// anything shaped like a credential, drop control and bidi characters, and clip it.
// shortcut: a denylist can't know every secret format; if error lines prove too risky, keep
// only the tool name and a coarse class (exit code, denied, timeout) instead.
const KEY = String.raw`[\w.-]*(?:password|passwd|passphrase|pass|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|cookie|session|auth)[\w-]*`;

const SECRETS: RegExp[] = [
  // Known token shapes, whatever their length.
  /\b(?:sk|pk|rk)[-_](?:ant|live|test|proj)[\w-]*/gi,
  /\bsk-[\w-]{16,}/g,
  /\bgithub_pat_\w+/g,
  /\bgh[pousr]_\w{16,}/g,
  /\bxox[abposr]-[\w-]+/g,
  /\bnpm_\w{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g, // JWT
  // "Authorization: Bearer x", "Cookie: a=b".
  /\b(bearer|basic|token)\s+[\w.~+/=-]{8,}/gi,
  // key=value, key: value; a space separates only after a flag (--password x), so prose such
  // as "session limit" keeps its words.
  new RegExp(String.raw`(${KEY})(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)`, "gi"),
  new RegExp(String.raw`(--?${KEY})(\s+)("[^"]*"|'[^']*'|\S+)`, "gi"),
  /(\s-p)(\s*)(\S+)/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi, // user:password@ in URLs
  /\b(?=[\w+/=-]*\d)(?=[\w+/=-]*[a-zA-Z])[\w+/=-]{24,}\b/g, // long mixed opaque strings
];

// C0/C1 controls and bidi overrides could disguise how the text reads.
const UNSAFE_CHARS = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2066-\u2069]/gu;

export function redact(text: string, max = 200): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  let clean = line.replace(UNSAFE_CHARS, " ").trim();
  for (const pattern of SECRETS) {
    clean = clean.replace(pattern, (match, ...groups: unknown[]) =>
      // Keep the key name and separator ("password=", "--token ") so the message still reads.
      typeof groups[0] === "string" &&
      typeof groups[1] === "string" &&
      typeof groups[2] === "string"
        ? `${groups[0]}${groups[1]}[redacted]`
        : "[redacted]",
    );
  }
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
