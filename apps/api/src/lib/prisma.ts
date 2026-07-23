import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

/**
 * Prisma pool sizing: without an explicit cap, each API instance opens up to
 * (num_cpus * 2 + 1) connections. With several instances that can exhaust a
 * managed Postgres plan's connection budget. DB_CONNECTION_LIMIT caps the pool
 * per instance (instances × limit must stay below the plan's max connections);
 * pool_timeout bounds how long a request waits for a free connection instead
 * of queueing forever. An explicit connection_limit already present in
 * DATABASE_URL wins.
 */
function withPoolParams(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(env.DB_CONNECTION_LIMIT));
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '15');
    }
    return url.toString();
  } catch {
    // Unparseable URL — let Prisma surface the real error.
    return rawUrl;
  }
}

export const prisma = new PrismaClient({
  datasources: { db: { url: withPoolParams(env.DATABASE_URL) } },
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
