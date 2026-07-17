import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import type { NextFunction, Request, Response } from 'express';
import { redis } from '../lib/redis';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

function makeLimiter(keyPrefix: string, points: number, durationSec: number) {
  if (env.NODE_ENV === 'test') {
    return new RateLimiterMemory({ keyPrefix, points, duration: durationSec });
  }
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix,
    points,
    duration: durationSec,
    insuranceLimiter: new RateLimiterMemory({ points, duration: durationSec }),
  });
}

export function rateLimit(keyPrefix: string, points: number, durationSec: number) {
  const limiter = makeLimiter(keyPrefix, points, durationSec);
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const key = req.ip ?? 'unknown';
      await limiter.consume(key);
      next();
    } catch {
      next(AppError.tooMany());
    }
  };
}

/** General API limiter — generous; sensitive routes add stricter ones. */
export const apiLimiter = rateLimit('rl:api', 300, 60);
/** Strict limiter for credential endpoints. */
export const authLimiter = rateLimit('rl:auth', 10, 60);
/** OTP request limiter. */
export const otpLimiter = rateLimit('rl:otp', 5, 300);
