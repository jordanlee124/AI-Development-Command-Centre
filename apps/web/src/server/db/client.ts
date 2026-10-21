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
    });
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.prisma;
}

export async function pingDatabase(): Promise<void> {
  await getPrisma().$queryRaw`SELECT 1`;
}
