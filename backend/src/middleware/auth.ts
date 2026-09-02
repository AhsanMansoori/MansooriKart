import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { User } from '../models/user.js';
import { getConfig } from '../config/env.js';
import { sendFailure } from '../utils/api-response.js';

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; role: 'CUSTOMER' | 'SUPER_ADMIN' };
    }
  }
}

export async function requireAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  const token = request.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return void sendFailure(response, 401, 'AUTH_UNAUTHORIZED', 'Authentication is required.', request.requestId);
  try {
    const payload = jwt.verify(token, getConfig().jwtSecret) as { sub?: string; role?: 'CUSTOMER' | 'SUPER_ADMIN' };
    if (!payload.sub) return void sendFailure(response, 401, 'AUTH_UNAUTHORIZED', 'Authentication is required.', request.requestId);
    const user = await User.findById(payload.sub).select('_id role status').lean();
    if (!user || user.status !== 'ACTIVE') return void sendFailure(response, 401, 'AUTH_UNAUTHORIZED', 'Authentication is required.', request.requestId);
    request.auth = { userId: String(user._id), role: user.role as 'CUSTOMER' | 'SUPER_ADMIN' };
    next();
  } catch {
    sendFailure(response, 401, 'AUTH_UNAUTHORIZED', 'Authentication is required.', request.requestId);
  }
}

export function requireSuperAdmin(request: Request, response: Response, next: NextFunction): void {
  if (request.auth?.role !== 'SUPER_ADMIN')
    return void sendFailure(response, 403, 'AUTH_FORBIDDEN', 'You do not have permission to access this resource.', request.requestId);
  next();
}
