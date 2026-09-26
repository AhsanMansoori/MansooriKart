import type { PropsWithChildren } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getAccessToken } from '../../services/authSession';

type JwtPayload = { role?: string; exp?: number };

function readJwtPayload(token: string): JwtPayload | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as JwtPayload;
  } catch {
    return null;
  }
}

export function AdminGuard({ children }: PropsWithChildren) {
  const location = useLocation();
  const token = getAccessToken();
  const payload = token ? readJwtPayload(token) : null;
  const expired = payload?.exp ? payload.exp * 1000 <= Date.now() : false;

  if (!token || !payload || expired) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (payload.role !== 'SUPER_ADMIN') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
