import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/server/env";

// One client per process; kept on globalThis so dev hot reloads don't open new pools.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Lazy so `next build` works without a DATABASE_URL.
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaPg({
      connectionString: getEnv().DATABASE_URL,
      connectionTimeoutMillis: 3000,
      // The adapter drops the UTC offset when parsing timestamptz, so a non-UTC session
      // (e.g. a server using the host's zone) would shift every timestamp. Pin UTC.
      options: "-c TimeZone=UTC",
    });
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.prisma;
}

export async function pingDatabase(): Promise<void> {
  await getPrisma().$queryRaw`SELECT 1`;
}
