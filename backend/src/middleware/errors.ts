import type { NextFunction, Request, Response } from 'express';
import { sendFailure } from '../utils/api-response.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function notFound(request: Request, response: Response): void {
  sendFailure(response, 404, 'NOT_FOUND', 'The requested resource was not found.', request.requestId);
}

/**
 * Body-parser rejects a malformed or oversized request body before any route sees
 * it, and reports that with a 4xx `status` of its own. Those are client mistakes,
 * not server faults, so they are answered as such instead of being flattened into
 * a 500. The parser's own message is deliberately discarded because it quotes the
 * offending bytes back to the caller.
 */
const bodyParserFailures: Record<string, { status: number; code: string; message: string }> = {
  'entity.parse.failed': { status: 400, code: 'REQUEST_BODY_INVALID', message: 'The request body could not be parsed as JSON.' },
  'entity.verify.failed': { status: 400, code: 'REQUEST_BODY_INVALID', message: 'The request body could not be parsed as JSON.' },
  'entity.too.large': { status: 413, code: 'REQUEST_BODY_TOO_LARGE', message: 'The request body is larger than this endpoint accepts.' },
  'request.aborted': { status: 400, code: 'REQUEST_ABORTED', message: 'The request ended before the body was fully received.' },
  'request.size.invalid': { status: 400, code: 'REQUEST_BODY_INVALID', message: 'The request body length did not match its Content-Length header.' },
  'encoding.unsupported': { status: 415, code: 'REQUEST_ENCODING_UNSUPPORTED', message: 'The request body encoding is not supported.' },
  'charset.unsupported': { status: 415, code: 'REQUEST_CHARSET_UNSUPPORTED', message: 'The request body charset is not supported.' },
};

export function errorHandler(error: unknown, request: Request, response: Response, _next: NextFunction): void {
  const apiError = error instanceof ApiError ? error : undefined;
  const parseFailure = apiError ? undefined : bodyParserFailures[(error as { type?: string } | null)?.type ?? ''];
  if (parseFailure) {
    sendFailure(response, parseFailure.status, parseFailure.code, parseFailure.message, request.requestId);
    return;
  }
  if (!apiError) console.error('Unhandled API error', { requestId: request.requestId, error });
  sendFailure(
    response,
    apiError?.status || 500,
    apiError?.code || 'INTERNAL_ERROR',
    apiError?.message || 'Something went wrong. Please try again later.',
    request.requestId
  );
}
