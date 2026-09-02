import type { Response } from 'express';

export type ApiMeta = Record<string, boolean | number | string | null>;
export type ApiErrorCode = string;

export function sendSuccess<T>(response: Response, data: T, status = 200, meta?: ApiMeta): Response {
  return response.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function sendFailure(response: Response, status: number, code: ApiErrorCode, message: string, requestId?: string): Response {
  return response.status(status).json({ success: false, error: { code, message }, ...(requestId ? { requestId } : {}) });
}
