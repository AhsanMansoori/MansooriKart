import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { sendFailure } from '../utils/api-response.js';

export function validate<T>(schema: ZodType<T>, source: 'body' | 'params' | 'query' = 'body') {
  return (request: Request, response: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(request[source]);
    if (!parsed.success) return void sendFailure(response, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message || 'Invalid request', request.requestId);
    Object.assign(request[source], parsed.data);
    next();
  };
}
