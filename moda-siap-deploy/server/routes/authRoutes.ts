import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, runInTransaction } from '../db.ts';
import {
  checkLoginRateLimit,
  clearFailedLoginAttempts,
  clearSessionCookie,
  createSessionForUser,
  getClientIp,
  logActivity,
  recordFailedLoginAttempt,
  requireAuth,
  setSessionCookie,
} from '../auth.ts';
import type { AuthenticatedRequest } from '../auth.ts';
import type { RoleCode } from '../../shared/types.ts';

export const authRouter = Router();

function countActiveAdmins(): number {
  const row = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE r.code = 'admin' AND u.is_deleted = 0 AND u.status = 'active'
  `).get() as { cnt: number };
  return row.cnt;
}

authRouter.get('/bootstrap-status', (_req, res) => {
  const adminCount = countActiveAdmins();
  res.json({ needsBootstrap: adminCount === 0 });
});

authRouter.post('/bootstrap-admin', (req, res) => {
  if (countActiveAdmins() > 0) {
    res.status(403).json({ error: 'Bootstrap Admin awal sudah selesai dan terkunci.' });
    return;
  }

  const { full_name, username, email, password, division } = req.body ?? {};
  const cleanName = String(full_name || '').trim();
  const cleanUser = String(username || '').trim().toLowerCase();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPass = String(password || '');
  const cleanDiv = String(division || 'Supply Management').trim();

  if (!cleanName || cleanName.length < 3) {
    res.status(400).json({ error: 'Nama lengkap minimal 3 karakter.' });
    return;
  }
  if (!/^[a-z0-9_.-]{3,32}$/.test(cleanUser)) {
    res.status(400).json({ error: 'Username harus 3–32 karakter (huruf kecil, angka, titik, underscore, atau strip).' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: 'Format email tidak valid.' });
    return;
  }
  if (cleanPass.length < 8) {
    res.status(400).json({ error: 'Password minimal 8 karakter.' });
    return;
  }

  const existing = db.prepare(`SELECT id FROM users WHERE username = ? OR email = ?`).get(cleanUser, cleanEmail);
  if (existing) {
    res.status(409).json({ error: 'Username atau email sudah terdaftar.' });
    return;
  }

  const adminRole = db.prepare(`SELECT id FROM roles WHERE code = 'admin'`).get() as { id: number };
  const passwordHash = bcrypt.hashSync(cleanPass, 12);
  const ip = getClientIp(req);

  const userId = runInTransaction(() => {
    const info = db.prepare(`
      INSERT INTO users (
        full_name, username, email, password_hash, division, requested_role, role_id, status
      ) VALUES (?, ?, ?, ?, ?, 'admin', ?, 'active')
    `).run(cleanName, cleanUser, cleanEmail, passwordHash, cleanDiv, adminRole.id);

    const newId = Number(info.lastInsertRowid);
    logActivity({
      userId: newId,
      username: cleanUser,
      userRole: 'admin',
      activityType: 'BOOTSTRAP_ADMIN',
      detail: 'Akun Super Admin pertama dibuat melalui setup awal aplikasi.',
      status: 'success',
      ipAddress: ip,
    });
    return newId;
  });

  const { rawToken } = createSessionForUser(userId, req);
  setSessionCookie(res, req, rawToken);

  const userRow = db.prepare(`
    SELECT u.id, u.full_name, u.username, u.email, u.division, r.code as role, r.name as role_name, u.status, u.created_at, u.last_login_at
    FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?
  `).get(userId);

  res.status(201).json({ user: userRow, token: rawToken });
});

authRouter.post('/register', (req, res) => {
  const { full_name, username, email, password, confirm_password, division, requested_role } = req.body ?? {};
  const cleanName = String(full_name || '').trim();
  const cleanUser = String(username || '').trim().toLowerCase();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPass = String(password || '');
  const cleanConfirm = String(confirm_password || '');
  const cleanDiv = String(division || '').trim();
  const reqRole = (['admin', 'staff', 'viewer'].includes(requested_role) ? requested_role : 'staff') as RoleCode;

  if (!cleanName || cleanName.length < 3) {
    res.status(400).json({ error: 'Nama lengkap wajib diisi (minimal 3 karakter).' });
    return;
  }
  if (!/^[a-z0-9_.-]{3,32}$/.test(cleanUser)) {
    res.status(400).json({ error: 'Username harus 3–32 karakter (huruf kecil, angka, titik, underscore, strip).' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: 'Format email tidak valid.' });
    return;
  }
  if (!cleanDiv) {
    res.status(400).json({ error: 'Divisi / jabatan wajib diisi.' });
    return;
  }
  if (cleanPass.length < 8) {
    res.status(400).json({ error: 'Password minimal 8 karakter.' });
    return;
  }
  if (cleanPass !== cleanConfirm) {
    res.status(400).json({ error: 'Konfirmasi password tidak cocok.' });
    return;
  }

  const dup = db.prepare(`SELECT id FROM users WHERE username = ? OR email = ?`).get(cleanUser, cleanEmail);
  if (dup) {
    res.status(409).json({ error: 'Username atau email sudah digunakan.' });
    return;
  }

  // Assign viewer role placeholder until admin approves and confirms role
  const defaultRoleRow = db.prepare(`SELECT id FROM roles WHERE code = 'viewer'`).get() as { id: number };
  const passwordHash = bcrypt.hashSync(cleanPass, 12);
  const ip = getClientIp(req);

  runInTransaction(() => {
    const info = db.prepare(`
      INSERT INTO users (
        full_name, username, email, password_hash, division, requested_role, role_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(cleanName, cleanUser, cleanEmail, passwordHash, cleanDiv, reqRole, defaultRoleRow.id);

    const newUserId = Number(info.lastInsertRowid);
    db.prepare(`
      INSERT INTO account_approval_requests (user_id, requested_role, status)
      VALUES (?, ?, 'pending')
    `).run(newUserId, reqRole);

    logActivity({
      userId: newUserId,
      username: cleanUser,
      userRole: 'guest',
      activityType: 'ACCOUNT_REGISTERED',
      detail: `Pendaftaran akun baru atas nama ${cleanName} (${cleanDiv}) dengan permintaan akses ${reqRole}. Status: Pending Approval.`,
      status: 'info',
      ipAddress: ip,
    });
  });

  res.status(201).json({
    message: 'Pendaftaran berhasil diajukan. Akun Anda berstatus Pending Approval dan menunggu persetujuan Admin sebelum dapat login.',
  });
});

authRouter.post('/login', (req, res) => {
  const { identifier, password } = req.body ?? {};
  const cleanId = String(identifier || '').trim().toLowerCase();
  const cleanPass = String(password || '');
  const ip = getClientIp(req);

  if (!cleanId || !cleanPass) {
    res.status(400).json({ error: 'Username/email dan password wajib diisi.' });
    return;
  }

  const rateLimit = checkLoginRateLimit(cleanId, ip);
  if (rateLimit.blocked) {
    logActivity({
      username: cleanId,
      userRole: 'unknown',
      activityType: 'LOGIN_FAILED',
      detail: `Percobaan login diblokir sementara karena terlalu banyak kegagalan (${rateLimit.retryAfterSeconds} detik tersisa).`,
      status: 'failure',
      ipAddress: ip,
    });
    res.status(429).json({
      error: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${rateLimit.retryAfterSeconds} detik.`,
    });
    return;
  }

  const user = db.prepare(`
    SELECT u.id, u.full_name, u.username, u.email, u.password_hash, u.division,
           r.code as role, r.name as role_name, u.status, u.rejection_reason, u.is_deleted,
           u.created_at, u.last_login_at
    FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE LOWER(u.username) = ? OR LOWER(u.email) = ?
  `).get(cleanId, cleanId) as
    | {
        id: number;
        full_name: string;
        username: string;
        email: string;
        password_hash: string;
        division: string;
        role: RoleCode;
        role_name: string;
        status: string;
        rejection_reason: string | null;
        is_deleted: number;
        created_at: string;
        last_login_at: string | null;
      }
    | undefined;

  if (!user || user.is_deleted === 1 || !bcrypt.compareSync(cleanPass, user.password_hash)) {
    recordFailedLoginAttempt(cleanId, ip);
    logActivity({
      userId: user?.id ?? null,
      username: cleanId,
      userRole: user?.role ?? 'unknown',
      activityType: 'LOGIN_FAILED',
      detail: `Login gagal untuk kredensial "${cleanId}".`,
      status: 'failure',
      ipAddress: ip,
    });
    res.status(401).json({ error: 'Username/email atau password tidak sesuai.' });
    return;
  }

  if (user.status === 'pending') {
    logActivity({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      activityType: 'LOGIN_FAILED',
      detail: 'Percobaan login ditolak karena akun masih berstatus Pending Approval.',
      status: 'failure',
      ipAddress: ip,
    });
    res.status(403).json({
      error: 'Akun Anda masih berstatus Pending Approval dan belum disetujui oleh Admin.',
    });
    return;
  }

  if (user.status === 'rejected') {
    res.status(403).json({
      error: user.rejection_reason
        ? `Pendaftaran akun ditolak: ${user.rejection_reason}`
        : 'Pendaftaran akun Anda ditolak oleh Admin.',
    });
    return;
  }

  if (user.status === 'suspended' || user.status === 'deleted') {
    res.status(403).json({ error: 'Akun Anda sedang dinonaktifkan. Hubungi Administrator.' });
    return;
  }

  clearFailedLoginAttempts(cleanId, ip);
  const nowIso = new Date().toISOString();
  db.prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`).run(nowIso, nowIso, user.id);

  const { rawToken } = createSessionForUser(user.id, req);
  setSessionCookie(res, req, rawToken);

  logActivity({
    userId: user.id,
    username: user.username,
    userRole: user.role,
    activityType: 'LOGIN_SUCCESS',
    detail: `Pengguna ${user.full_name} berhasil masuk ke sistem.`,
    status: 'success',
    ipAddress: ip,
  });

  res.json({
    user: {
      id: user.id,
      full_name: user.full_name,
      username: user.username,
      email: user.email,
      division: user.division,
      role: user.role,
      role_name: user.role_name,
      status: user.status,
      created_at: user.created_at,
      last_login_at: nowIso,
    },
    token: rawToken,
  });
});

authRouter.post('/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.sessionTokenHash) {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ?`).run(
      new Date().toISOString(),
      req.sessionTokenHash
    );
  }
  clearSessionCookie(res, req);

  if (req.authUser) {
    logActivity({
      userId: req.authUser.id,
      username: req.authUser.username,
      userRole: req.authUser.role,
      activityType: 'LOGOUT',
      detail: `Pengguna ${req.authUser.full_name} keluar dari sistem.`,
      status: 'success',
      ipAddress: getClientIp(req),
    });
  }

  res.json({ message: 'Logout berhasil.' });
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  let pendingApprovals = 0;
  let pendingDeletions = 0;

  if (user.role === 'admin') {
    const appRow = db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE status = 'pending' AND is_deleted = 0`).get() as {
      cnt: number;
    };
    const delRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM account_deletion_requests WHERE status = 'pending'`)
      .get() as { cnt: number };
    pendingApprovals = appRow.cnt;
    pendingDeletions = delRow.cnt;
  }

  const myDeletionReq = db.prepare(`
    SELECT id, reason, status, created_at
    FROM account_deletion_requests
    WHERE user_id = ? AND status = 'pending'
    ORDER BY id DESC LIMIT 1
  `).get(user.id);

  res.json({
    user,
    notifications: {
      pendingApprovals,
      pendingDeletions,
    },
    myPendingDeletionRequest: myDeletionReq ?? null,
  });
});

authRouter.post('/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
  const { current_password, new_password, confirm_password } = req.body ?? {};
  const user = req.authUser!;

  if (!current_password || !new_password || !confirm_password) {
    res.status(400).json({ error: 'Semua field password wajib diisi.' });
    return;
  }
  if (String(new_password).length < 8) {
    res.status(400).json({ error: 'Password baru minimal 8 karakter.' });
    return;
  }
  if (new_password !== confirm_password) {
    res.status(400).json({ error: 'Konfirmasi password baru tidak cocok.' });
    return;
  }

  const row = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(user.id) as
    | { password_hash: string }
    | undefined;
  if (!row || !bcrypt.compareSync(String(current_password), row.password_hash)) {
    res.status(400).json({ error: 'Password saat ini tidak sesuai.' });
    return;
  }

  const newHash = bcrypt.hashSync(String(new_password), 12);
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
    newHash,
    new Date().toISOString(),
    user.id
  );

  logActivity({
    userId: user.id,
    username: user.username,
    userRole: user.role,
    activityType: 'PASSWORD_CHANGED',
    detail: `Pengguna ${user.username} memperbarui password akunnya.`,
    status: 'success',
    ipAddress: getClientIp(req),
  });

  res.json({ message: 'Password berhasil diperbarui.' });
});

authRouter.post('/request-deletion', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) {
    res.status(400).json({ error: 'Alasan penonaktifan/penghapusan akun wajib diisi (minimal 5 karakter).' });
    return;
  }

  const existing = db.prepare(`
    SELECT id FROM account_deletion_requests WHERE user_id = ? AND status = 'pending'
  `).get(user.id);
  if (existing) {
    res.status(409).json({ error: 'Anda sudah memiliki permintaan penghapusan akun yang menunggu persetujuan Admin.' });
    return;
  }

  db.prepare(`
    INSERT INTO account_deletion_requests (user_id, reason, status)
    VALUES (?, ?, 'pending')
  `).run(user.id, reason);

  logActivity({
    userId: user.id,
    username: user.username,
    userRole: user.role,
    activityType: 'ACCOUNT_DELETION_REQUESTED',
    detail: `Pengguna ${user.username} mengajukan permintaan penghapusan/deaktivasi akun.`,
    status: 'info',
    ipAddress: getClientIp(req),
  });

  res.status(201).json({
    message: 'Permintaan penghapusan akun telah dikirim dan menunggu persetujuan Admin.',
  });
});
