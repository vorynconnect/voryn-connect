import http from 'node:http';
import type { TrackingSubjectType, UserRole } from '@prisma/client';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createApp } from './app';
import { corsOrigins, env } from './config/env';
import { ensureBootstrapAdmin } from './lib/bootstrap-admin';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { registerIo } from './lib/realtime';
import { verifyAccessToken } from './modules/auth/token.service';
import { canAccessTracking } from './modules/tracking/tracking.service';

const TRACKING_SUBJECTS = new Set(['RIDE', 'ORDER', 'BOOKING', 'RENTAL']);

const app = createApp();
const server = http.createServer(app);

/**
 * Real-time gateway. Clients authenticate with their access token, then join
 * rooms per tracked subject (ride/order/booking/rental) to receive status and
 * location events. Domain services emit through this instance.
 *
 * The Redis adapter fans emits out across every running API instance, so an
 * event emitted by instance A reaches clients connected to instance B. This is
 * what makes horizontal scaling (numInstances > 1) safe for realtime.
 */
// Adapter clients use maxRetriesPerRequest: null — the standard setting for
// pub/sub connections. During a Redis outage, subscribe/publish commands queue
// and complete on reconnect instead of rejecting (a rejection here would be an
// unhandled promise inside the adapter). duplicate() also does not copy the
// base client's error listener, so each client needs its own — without one, a
// connection error raises an unhandled 'error' event and kills the process.
const pubClient = redis.duplicate({ maxRetriesPerRequest: null });
const subClient = redis.duplicate({ maxRetriesPerRequest: null });
for (const [name, client] of [['socket-pub', pubClient], ['socket-sub', subClient]] as const) {
  client.on('error', (err) => logger.warn({ err: err.message }, `[redis:${name}] connection error`));
}

// A stray rejection anywhere (a fire-and-forget promise in a library or
// background task) must never take down a serving instance. Log it — readiness
// checks and the process supervisor handle genuinely broken states.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

export const io = new SocketIOServer(server, {
  cors: { origin: corsOrigins },
  adapter: createAdapter(pubClient, subClient),
});
registerIo(io);

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('unauthorized'));
    socket.data.auth = verifyAccessToken(token);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.data.auth.sub as string;
  const role = socket.data.auth.role as UserRole;
  socket.join(`user:${userId}`);

  socket.on('track:subscribe', async ({ subjectType, subjectId }: { subjectType: string; subjectId: string }) => {
    // Authorize before joining: live GPS and status events flow to this room,
    // so a socket may only follow a trip/order it is actually party to.
    if (typeof subjectType !== 'string' || typeof subjectId !== 'string') return;
    if (!TRACKING_SUBJECTS.has(subjectType)) return;
    try {
      const allowed = await canAccessTracking(userId, role, subjectType as TrackingSubjectType, subjectId);
      if (allowed) {
        socket.join(`track:${subjectType}:${subjectId}`);
      } else {
        socket.emit('track:error', { subjectType, subjectId, code: 'FORBIDDEN' });
      }
    } catch {
      socket.emit('track:error', { subjectType, subjectId, code: 'FORBIDDEN' });
    }
  });

  socket.on('track:unsubscribe', ({ subjectType, subjectId }: { subjectType: string; subjectId: string }) => {
    socket.leave(`track:${subjectType}:${subjectId}`);
  });
});

server.listen(env.PORT, () => {
  logger.info(`Voryn Connect API listening on http://localhost:${env.PORT}`);
  ensureBootstrapAdmin().catch((err) => logger.error({ err }, '[bootstrap-admin] failed'));
});

/**
 * Graceful shutdown: on SIGTERM/SIGINT (deploys, scale-downs, restarts) stop
 * accepting new work, let in-flight requests finish, then release DB/Redis
 * connections. A hard cap force-exits if draining hangs, so a stuck request
 * can never block a deploy.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — draining connections`);

  const forceExit = setTimeout(() => {
    logger.error('Drain timed out after 10s — forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  // io.close() disconnects sockets and closes the underlying HTTP server,
  // waiting for in-flight HTTP requests to complete.
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await prisma.$disconnect().catch((err) => logger.warn({ err }, 'Prisma disconnect failed'));
  await Promise.allSettled([redis.quit(), pubClient.quit(), subClient.quit()]);

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
