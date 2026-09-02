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

export function errorHandler(error: unknown, request: Request, response: Response, _next: NextFunction): void {
  const apiError = error instanceof ApiError ? error : undefined;
  if (!apiError) console.error('Unhandled API error', { requestId: request.requestId, error });
  sendFailure(
    response,
    apiError?.status || 500,
    apiError?.code || 'INTERNAL_ERROR',
    apiError?.message || 'Something went wrong. Please try again later.',
    request.requestId
  );
}
