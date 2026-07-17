import Redis from 'ioredis';
import { env } from '../config/env';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  lazyConnect: false,
});

redis.on('error', (err) => {
  // Log once per failure burst; server keeps running (rate limits degrade open).
  // eslint-disable-next-line no-console
  console.error('[redis]', err.message);
});
