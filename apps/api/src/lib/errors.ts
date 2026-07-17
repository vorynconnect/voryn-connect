/** Application error with an HTTP status and stable machine-readable code. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: unknown) {
    return new AppError(400, code, message, details);
  }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new AppError(401, code, message);
  }
  static forbidden(message = 'You do not have access to this resource', code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }
  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new AppError(404, code, message);
  }
  static conflict(message: string, code = 'CONFLICT') {
    return new AppError(409, code, message);
  }
  static tooMany(message = 'Too many requests, please try again shortly', code = 'RATE_LIMITED') {
    return new AppError(429, code, message);
  }
  static internal(message = 'Something went wrong on our side', code = 'INTERNAL') {
    return new AppError(500, code, message);
  }
  static badGateway(message = 'An upstream service failed', code = 'BAD_GATEWAY') {
    return new AppError(502, code, message);
  }
  static serviceUnavailable(message = 'This feature is not available yet', code = 'SERVICE_UNAVAILABLE') {
    return new AppError(503, code, message);
  }
}
