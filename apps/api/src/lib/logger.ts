import pino from 'pino';
import { env } from '../config/env';

// Redact anything that could leak credentials or tokens into logs.
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.pin',
      '*.otp',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.cardNumber',
      '*.cvv',
    ],
    censor: '[REDACTED]',
  },
});
