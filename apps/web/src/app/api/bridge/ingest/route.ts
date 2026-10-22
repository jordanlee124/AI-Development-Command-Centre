import { ingestRequestSchema } from "@adcc/shared";
import { isBridgeAuthorized } from "@/server/bridge-auth";
import { getEnv } from "@/server/env";
import { ingestBridgeReport } from "@/server/services/agent-service";

export const dynamic = "force-dynamic";

// 500 events × ~1 KB stays far below this; anything bigger isn't from the bridge.
const MAX_BODY_CHARS = 8 * 1024 * 1024;

function fail(status: number, error: string) {
  return Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

/** The Agent Bridge's only endpoint (ADR-003, ADR-017). Messages never echo the token. */
export async function POST(request: Request) {
  const token = getEnv().ADCC_BRIDGE_TOKEN;
  if (!token) return fail(503, "The bridge API is off: set ADCC_BRIDGE_TOKEN in apps/web/.env.");
  if (!isBridgeAuthorized(request.headers.get("authorization"), token)) {
    return fail(401, "Missing or wrong bridge token.");
  }
  // A length up front, so a chunked body can't be buffered without limit before the check.
  const length = Number(request.headers.get("content-length") ?? Number.NaN);
  if (!Number.isFinite(length)) return fail(411, "Content-Length is required.");
  if (length > MAX_BODY_CHARS) return fail(413, "Report too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return fail(413, "Report too large.");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "Body is not JSON.");
  }
  const parsed = ingestRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    return fail(400, `Report doesn't match the bridge contract. ${issues.join("; ")}`);
  }

  try {
    const result = await ingestBridgeReport(parsed.data);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[bridge] ingest failed", error);
    return fail(500, "Couldn't store the report. Check that the database is running.");
  }
}
