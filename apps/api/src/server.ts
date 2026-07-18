import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { createApp } from './app';
import { corsOrigins, env } from './config/env';
import { ensureBootstrapAdmin } from './lib/bootstrap-admin';
import { logger } from './lib/logger';
import { registerIo } from './lib/realtime';
import { verifyAccessToken } from './modules/auth/token.service';

const app = createApp();
const server = http.createServer(app);

/**
 * Real-time gateway. Clients authenticate with their access token, then join
 * rooms per tracked subject (ride/order/booking/rental) to receive status and
 * location events. Domain services emit through this instance.
 */
export const io = new SocketIOServer(server, {
  cors: { origin: corsOrigins },
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
  socket.join(`user:${userId}`);

  socket.on('track:subscribe', ({ subjectType, subjectId }: { subjectType: string; subjectId: string }) => {
    if (typeof subjectType === 'string' && typeof subjectId === 'string') {
      socket.join(`track:${subjectType}:${subjectId}`);
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
