import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { corsOrigins, env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { apiLimiter } from './middleware/rate-limit';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { walletRouter } from './modules/wallet/wallet.routes';
import { discoveryRouter } from './modules/discovery/discovery.routes';
import { cartsRouter } from './modules/orders/carts.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { ridesRouter } from './modules/rides/rides.routes';
import { bookingsRouter } from './modules/bookings/bookings.routes';
import { rentalsRouter } from './modules/rentals/rentals.routes';
import { favoritesRouter, notificationsRouter, reviewsRouter } from './modules/reviews/reviews.routes';
import { partnerAuthRouter } from './modules/partner/partner-auth.routes';
import { partnerRouter } from './modules/partner/partner.routes';
import { adminAuthRouter } from './modules/admin/admin-auth.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { driverRouter } from './modules/driver/driver.routes';
import { chatRouter } from './modules/chat/chat.routes';
import { mapsRouter } from './modules/maps/maps.routes';
import { supportRouter } from './modules/support/support.routes';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  if (env.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        // Every request gets a correlation id (honouring an inbound
        // X-Request-Id from the load balancer). It is echoed on the response
        // and included in error payloads so users can quote it to support.
        genReqId: (req, res) => {
          const inbound = req.headers['x-request-id'];
          const id = typeof inbound === 'string' && inbound.length > 0 && inbound.length <= 64
            ? inbound
            : crypto.randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
        autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
      }),
    );
  }

  // Health endpoints sit BEFORE the rate limiter: load-balancer probes must
  // never be throttled away.
  //  - /health, /health/live — process liveness (no dependencies touched).
  //  - /health/ready — dependency readiness; 503 tells the load balancer to
  //    stop routing traffic to this instance until it recovers.
  app.get(['/health', '/health/live'], (_req, res) => {
    res.json({ status: 'ok', service: 'voryn-connect-api' });
  });

  app.get('/health/ready', async (_req, res) => {
    const withTimeout = <T>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
    const checks: Record<string, 'ok' | 'fail'> = { database: 'fail', redis: 'fail' };
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 2000);
      checks.database = 'ok';
    } catch { /* stays 'fail' */ }
    try {
      if ((await withTimeout(redis.ping(), 2000)) === 'PONG') checks.redis = 'ok';
    } catch { /* stays 'fail' */ }
    const ready = checks.database === 'ok' && checks.redis === 'ok';
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', checks });
  });

  app.use(apiLimiter);

  app.use('/v1/auth', authRouter);
  app.use('/v1/users', usersRouter);
  app.use('/v1/wallet', walletRouter);
  app.use('/v1/discovery', discoveryRouter);
  app.use('/v1/carts', cartsRouter);
  app.use('/v1/orders', ordersRouter);
  app.use('/v1/rides', ridesRouter);
  app.use('/v1/bookings', bookingsRouter);
  app.use('/v1/rentals', rentalsRouter);
  app.use('/v1/reviews', reviewsRouter);
  app.use('/v1/favorites', favoritesRouter);
  app.use('/v1/notifications', notificationsRouter);
  app.use('/v1/partner/auth', partnerAuthRouter);
  app.use('/v1/partner', partnerRouter);
  app.use('/v1/admin/auth', adminAuthRouter);
  app.use('/v1/admin', adminRouter);
  app.use('/v1/driver', driverRouter);
  app.use('/v1/chat', chatRouter);
  app.use('/v1/maps', mapsRouter);
  app.use('/v1/support', supportRouter);
  // Uploaded media (partner logos, product images, avatars). Served from local
  // disk only when MEDIA_STORAGE=local; with object storage the bucket/CDN
  // serves them directly (see publicUploadUrl). Public media must be embeddable
  // from app origins; helmet's default CORP blocks that.
  if (env.MEDIA_STORAGE === 'local') {
    app.use(
      '/uploads',
      (_req, res, next) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        next();
      },
      express.static(env.MEDIA_UPLOAD_DIR),
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
