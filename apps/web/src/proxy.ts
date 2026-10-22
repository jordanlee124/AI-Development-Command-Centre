import { NextResponse, type NextRequest } from "next/server";

// DNS-rebinding guard (security model in ARCHITECTURE.md): a page on evil.example that rebinds
// its name to 127.0.0.1 would send Host: evil.example, and Next's Server Action check only
// compares Origin with Host. Pages now show private GitHub data, so reads are guarded too.
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLoopback(host: string | null) {
  if (!host) return false;
  try {
    return LOOPBACK.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  const originOk = !origin || (URL.canParse(origin) && isLoopback(new URL(origin).host));
  if (!isLoopback(request.headers.get("host")) || !originOk) {
    return new NextResponse("Forbidden: ADCC only answers on 127.0.0.1 or localhost.", {
      status: 403,
    });
  }
  return NextResponse.next();
}
