import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { AuthedRequest } from './decorators';

/** Error body returned by every endpoint. Documented in docs/API_CONTRACTS.md. */
export class ApiErrorDto {
  statusCode: number;
  /** Stable machine-readable code, e.g. VALIDATION_ERROR, TIMER_ALREADY_ACTIVE. */
  code: string;
  message: string;
  /** Field-level problems for validation errors. */
  details?: string[];
  requestId?: string;
}

/** Business-rule failure with a stable code the frontend can branch on. */
export class DomainError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: string[],
  ) {
    super({ code, message, details }, status);
  }

  static badRequest = (code: string, message: string, details?: string[]) =>
    new DomainError(HttpStatus.BAD_REQUEST, code, message, details);
  static unauthorized = (code: string, message: string) => new DomainError(HttpStatus.UNAUTHORIZED, code, message);
  static forbidden = (code: string, message: string) => new DomainError(HttpStatus.FORBIDDEN, code, message);
  static notFound = (entity: string) =>
    new DomainError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${entity} was not found`);
  static conflict = (code: string, message: string) => new DomainError(HttpStatus.CONFLICT, code, message);
  static unprocessable = (code: string, message: string, details?: string[]) =>
    new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
  static tooMany = (code: string, message: string) => new DomainError(HttpStatus.TOO_MANY_REQUESTS, code, message);
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
};

/**
 * Single place that turns any thrown value into the public error contract.
 * Internal details (stack traces, SQL, Prisma messages) are logged, never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong on our side. Please try again.';
    let details: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = STATUS_CODES[status] ?? 'ERROR';
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { code?: string; message?: string | string[]; details?: string[] };
        if (Array.isArray(b.message)) {
          // class-validator output from the global ValidationPipe
          code = 'VALIDATION_ERROR';
          message = 'Some fields are invalid.';
          details = b.message;
        } else {
          message = b.message ?? exception.message;
          details = b.details;
        }
        if (b.code) code = b.code;
      }
      if (status === HttpStatus.TOO_MANY_REQUESTS && code === 'RATE_LIMITED') {
        message = 'Too many requests. Please slow down and try again shortly.';
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'CONFLICT';
        message = 'This record already exists.';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'The requested record was not found.';
      } else if (exception.code === 'P2003' || exception.code === 'P2014') {
        status = HttpStatus.CONFLICT;
        code = 'REFERENCE_CONFLICT';
        message = 'This record is still referenced by other data.';
      }
    }

    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(`${req.method} ${req.originalUrl} -> ${status}: ${err.message}`, err.stack);
    }

    const body: ApiErrorDto = { statusCode: status, code, message, details, requestId: req.requestId };
    res.status(status).json(body);
  }
}
