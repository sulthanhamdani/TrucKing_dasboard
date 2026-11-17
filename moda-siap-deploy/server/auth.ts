import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';
import type { AuthUser, RoleCode } from '../shared/types.ts';

export const SESSION_COOKIE_NAME = 'moda_session';
const SESSION_TTL_HOURS = 12;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 5;

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16) {
    return process.env.SESSION_SECRET.trim();
  }
  const dataDir = process.env.VERCEL ? '/tmp/moda-data' : path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const secretFile = path.join(dataDir, '.session_secret');
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf-8').trim();
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

const SESSION_SECRET = getSessionSecret();

export function hashSessionToken(rawToken: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(rawToken).digest('hex');
}

export function createSessionForUser(userId: number, req: Request): { rawToken: string; expiresAt: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const expiresDate = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const expiresAt = expiresDate.toISOString();

  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    tokenHash,
    userId,
    getClientIp(req),
    String(req.headers['user-agent'] || '').slice(0, 255),
    expiresAt
  );

  return { rawToken, expiresAt };
}

export function setSessionCookie(res: Response, req: Request, rawToken: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response, req: Request): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
  });
}

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function logActivity(params: {
  userId?: number | null;
  username: string;
  userRole: string;
  activityType: string;
  detail: string;
  status?: 'success' | 'failure' | 'info';
  ipAddress?: string | null;
}): void {
  // Never store tokens, passwords, or secrets in audit log details
  db.prepare(`
    INSERT INTO activity_logs (user_id, username, user_role, activity_type, detail, status, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.userId ?? null,
    params.username,
    params.userRole,
    params.activityType,
    params.detail,
    params.status ?? 'success',
    params.ipAddress ?? null,
    new Date().toISOString()
  );
}

export function checkLoginRateLimit(identifier: string, ipAddress: string): { blocked: boolean; retryAfterSeconds: number } {
  const row = db.prepare(`
    SELECT attempt_count, locked_until, last_attempt_at
    FROM login_attempts
    WHERE identifier = ? AND ip_address = ?
  `).get(identifier.toLowerCase(), ipAddress) as
    | { attempt_count: number; locked_until: string | null; last_attempt_at: string }
    | undefined;

  if (!row || !row.locked_until) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const lockedUntilMs = Date.parse(row.locked_until);
  if (Number.isFinite(lockedUntilMs) && lockedUntilMs > Date.now()) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((lockedUntilMs - Date.now()) / 1000),
    };
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

export function recordFailedLoginAttempt(identifier: string, ipAddress: string): void {
  const normalizedId = identifier.toLowerCase();
  const existing = db.prepare(`
    SELECT id, attempt_count, last_attempt_at
    FROM login_attempts
    WHERE identifier = ? AND ip_address = ?
  `).get(normalizedId, ipAddress) as
    | { id: number; attempt_count: number; last_attempt_at: string }
    | undefined;

  const nowIso = new Date().toISOString();
  const fifteenMinsAgo = Date.now() - 15 * 60 * 1000;

  if (!existing) {
    db.prepare(`
      INSERT INTO login_attempts (identifier, ip_address, attempt_count, locked_until, last_attempt_at)
      VALUES (?, ?, 1, NULL, ?)
    `).run(normalizedId, ipAddress, nowIso);
    return;
  }

  const lastMs = Date.parse(existing.last_attempt_at);
  const nextCount = Number.isFinite(lastMs) && lastMs < fifteenMinsAgo ? 1 : existing.attempt_count + 1;
  const lockedUntil =
    nextCount >= MAX_FAILED_LOGIN_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
      : null;

  db.prepare(`
    UPDATE login_attempts
    SET attempt_count = ?, locked_until = ?, last_attempt_at = ?
    WHERE id = ?
  `).run(nextCount, lockedUntil, nowIso, existing.id);
}

export function clearFailedLoginAttempts(identifier: string, ipAddress: string): void {
  db.prepare(`
    DELETE FROM login_attempts WHERE identifier = ? AND ip_address = ?
  `).run(identifier.toLowerCase(), ipAddress);
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  sessionTokenHash?: string;
}

export function getAuthUserFromRequest(req: Request): { user: AuthUser; tokenHash: string } | null {
  let rawToken: string | undefined = req.cookies?.[SESSION_COOKIE_NAME];
  if (!rawToken) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      rawToken = authHeader.slice(7).trim();
    }
  }
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);
  const row = db.prepare(`
    SELECT
      u.id, u.full_name, u.username, u.email, u.division,
      r.code as role, r.name as role_name, u.status, u.is_deleted,
      u.created_at, u.last_login_at, s.expires_at, s.revoked_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    JOIN roles r ON u.role_id = r.id
    WHERE s.token_hash = ?
  `).get(tokenHash) as
    | (AuthUser & { is_deleted: number; expires_at: string; revoked_at: string | null })
    | undefined;

  if (!row) return null;
  if (row.revoked_at) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  if (row.is_deleted === 1 || row.status !== 'active') return null;

  const user: AuthUser = {
    id: row.id,
    full_name: row.full_name,
    username: row.username,
    email: row.email,
    division: row.division,
    role: row.role,
    role_name: row.role_name,
    status: row.status,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };

  return { user, tokenHash };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const session = getAuthUserFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan login kembali.' });
    return;
  }
  req.authUser = session.user;
  req.sessionTokenHash = session.tokenHash;
  next();
}

export function requireRole(...allowedRoles: RoleCode[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Autentikasi diperlukan.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'Akses ditolak. Anda tidak memiliki kewenangan untuk tindakan ini.' });
      return;
    }
    next();
  };
}
