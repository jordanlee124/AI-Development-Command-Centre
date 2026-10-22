import type { NextRequest } from "next/server";
import { exportUsageCsv } from "@/server/services/analytics-service";

export const dynamic = "force-dynamic";

/** CSV of recorded usage for ?from=&to= (the Analytics page's range). */
export async function GET(request: NextRequest) {
  try {
    const { csv, filename } = await exportUsageCsv(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[analytics] export failed", error);
    return new Response("Couldn't export usage: the database could not be read.", { status: 503 });
  }
}
