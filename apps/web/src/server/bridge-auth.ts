import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Bearer token check in constant time (hashing first makes the lengths equal). */
export function isBridgeAuthorized(header: string | null, token: string): boolean {
  const match = /^Bearer (\S+)$/.exec(header ?? "");
  return match !== null && timingSafeEqual(digest(match[1] ?? ""), digest(token));
}
