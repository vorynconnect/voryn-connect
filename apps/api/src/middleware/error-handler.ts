import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

/** Correlation id assigned by pino-http (absent in tests, where pino is off). */
function requestId(req: Request): string | undefined {
  const id = (req as Request & { id?: string | number }).id;
  return id == null ? undefined : String(id);
}

/**
 * Central error handler. Customers never see raw error objects:
 * every response is a stable { error: { code, message, details?, requestId? } }
 * shape. The requestId matches the X-Request-Id response header and the server
 * logs, so a user-reported error can be traced to its exact log line.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const reqId = requestId(req);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined, requestId: reqId },
    });
    return;
  }

  if (err instanceof MulterError) {
    // File-upload limit/shape violations are client errors, not server faults.
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'That image is too large. Please choose a smaller file.'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Unexpected file field. Attach the image in the "image" field.'
          : 'That file could not be uploaded. Please try a different image.';
    res.status(400).json({ error: { code: err.code, message, requestId: reqId } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId: reqId,
      },
    });
    return;
  }

  logger.error({ err, requestId: reqId }, 'Unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', requestId: reqId },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}
