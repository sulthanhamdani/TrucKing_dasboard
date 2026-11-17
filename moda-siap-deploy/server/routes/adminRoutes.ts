import { Router } from 'express';
import { db, runInTransaction } from '../db.ts';
import { getClientIp, logActivity, requireAuth, requireRole } from '../auth.ts';
import type { AuthenticatedRequest } from '../auth.ts';
import { ALLOWED_TEMPLATE_PLACEHOLDERS } from '../../shared/types.ts';
import type { RoleCode } from '../../shared/types.ts';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

function countActiveAdminsExcluding(excludeUserId?: number): number {
  if (excludeUserId !== undefined) {
    const row = db.prepare(`
      SELECT COUNT(*) as cnt
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.code = 'admin' AND u.is_deleted = 0 AND u.status = 'active' AND u.id != ?
    `).get(excludeUserId) as { cnt: number };
    return row.cnt;
  }
  const row = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE r.code = 'admin' AND u.is_deleted = 0 AND u.status = 'active'
  `).get() as { cnt: number };
  return row.cnt;
}

adminRouter.get('/users', (_req, res) => {
  // Never select password_hash
  const users = db.prepare(`
    SELECT
      u.id, u.full_name, u.username, u.email, u.division,
      u.requested_role, r.code as role, r.name as role_name,
      u.status, u.rejection_reason, u.is_deleted,
      u.created_at, u.last_login_at,
      dr.id as pending_deletion_id,
      dr.reason as pending_deletion_reason
    FROM users u
    JOIN roles r ON u.role_id = r.id
    LEFT JOIN account_deletion_requests dr ON dr.user_id = u.id AND dr.status = 'pending'
    ORDER BY
      CASE WHEN u.status = 'pending' THEN 0 ELSE 1 END,
      CASE WHEN dr.id IS NOT NULL THEN 0 ELSE 1 END,
      u.created_at DESC
  `).all();

  res.json({ users });
});

adminRouter.post('/users/:id/approve', (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  const assignedRole = (['admin', 'staff', 'viewer'].includes(req.body?.role) ? req.body.role : 'staff') as RoleCode;
  const note = String(req.body?.note || '').trim();
  const admin = req.authUser!;

  const target = db.prepare(`
    SELECT id, username, full_name, status, is_deleted FROM users WHERE id = ?
  `).get(targetId) as { id: number; username: string; full_name: string; status: string; is_deleted: number } | undefined;

  if (!target || target.is_deleted === 1) {
    res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    return;
  }
  if (target.status !== 'pending') {
    res.status(400).json({ error: 'Hanya akun dengan status Pending Approval yang dapat disetujui.' });
    return;
  }

  const roleRow = db.prepare(`SELECT id FROM roles WHERE code = ?`).get(assignedRole) as { id: number };
  const nowIso = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(`
      UPDATE users SET role_id = ?, status = 'active', rejection_reason = NULL, updated_at = ? WHERE id = ?
    `).run(roleRow.id, nowIso, targetId);

    db.prepare(`
      UPDATE account_approval_requests
      SET status = 'approved', reviewed_by = ?, review_note = ?, reviewed_at = ?
      WHERE user_id = ? AND status = 'pending'
    `).run(admin.id, note || `Disetujui sebagai ${assignedRole}`, nowIso, targetId);

    logActivity({
      userId: admin.id,
      username: admin.username,
      userRole: admin.role,
      activityType: 'ACCOUNT_APPROVED',
      detail: `Admin ${admin.username} menyetujui pendaftaran akun ${target.username} dengan role ${assignedRole}.`,
      status: 'success',
      ipAddress: getClientIp(req),
    });
  });

  res.json({ message: `Akun ${target.username} berhasil disetujui sebagai ${assignedRole}.` });
});

adminRouter.post('/users/:id/reject', (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim();
  const admin = req.authUser!;

  if (reason.length < 3) {
    res.status(400).json({ error: 'Alasan penolakan wajib diisi.' });
    return;
  }

  const target = db.prepare(`
    SELECT id, username, status, is_deleted FROM users WHERE id = ?
  `).get(targetId) as { id: number; username: string; status: string; is_deleted: number } | undefined;

  if (!target || target.is_deleted === 1) {
    res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    return;
  }
  if (target.status !== 'pending') {
    res.status(400).json({ error: 'Hanya akun Pending Approval yang dapat ditolak.' });
    return;
  }

  const nowIso = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(`
      UPDATE users SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?
    `).run(reason, nowIso, targetId);

    db.prepare(`
      UPDATE account_approval_requests
      SET status = 'rejected', reviewed_by = ?, review_note = ?, reviewed_at = ?
      WHERE user_id = ? AND status = 'pending'
    `).run(admin.id, reason, nowIso, targetId);

    logActivity({
      userId: admin.id,
      username: admin.username,
      userRole: admin.role,
      activityType: 'ACCOUNT_REJECTED',
      detail: `Admin ${admin.username} menolak pendaftaran akun ${target.username}. Alasan: ${reason}`,
      status: 'info',
      ipAddress: getClientIp(req),
    });
  });

  res.json({ message: `Pendaftaran akun ${target.username} telah ditolak.` });
});

adminRouter.patch('/users/:id/role', (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  const nextRole = req.body?.role as RoleCode;
  const admin = req.authUser!;

  if (!['admin', 'staff', 'viewer'].includes(nextRole)) {
    res.status(400).json({ error: 'Role tidak valid.' });
    return;
  }

  const target = db.prepare(`
    SELECT u.id, u.username, r.code as current_role, u.status, u.is_deleted
    FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?
  `).get(targetId) as
    | { id: number; username: string; current_role: RoleCode; status: string; is_deleted: number }
    | undefined;

  if (!target || target.is_deleted === 1) {
    res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    return;
  }

  if (target.current_role === 'admin' && nextRole !== 'admin') {
    if (countActiveAdminsExcluding(targetId) === 0) {
      res.status(400).json({ error: 'Tidak dapat menurunkan role Admin terakhir dalam sistem.' });
      return;
    }
    if (targetId === admin.id) {
      res.status(400).json({ error: 'Anda tidak dapat menurunkan role Admin akun Anda sendiri.' });
      return;
    }
  }

  const roleRow = db.prepare(`SELECT id FROM roles WHERE code = ?`).get(nextRole) as { id: number };
  db.prepare(`UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?`).run(
    roleRow.id,
    new Date().toISOString(),
    targetId
  );

  logActivity({
    userId: admin.id,
    username: admin.username,
    userRole: admin.role,
    activityType: 'ROLE_CHANGED',
    detail: `Role pengguna ${target.username} diubah dari ${target.current_role} menjadi ${nextRole}.`,
    status: 'success',
    ipAddress: getClientIp(req),
  });

  res.json({ message: `Role pengguna ${target.username} berhasil diubah menjadi ${nextRole}.` });
});

adminRouter.patch('/users/:id/status', (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  const nextStatus = req.body?.status;
  const admin = req.authUser!;

  if (!['active', 'suspended'].includes(nextStatus)) {
    res.status(400).json({ error: 'Status hanya dapat diubah ke active atau suspended.' });
    return;
  }

  const target = db.prepare(`
    SELECT u.id, u.username, r.code as role, u.status, u.is_deleted
    FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?
  `).get(targetId) as
    | { id: number; username: string; role: RoleCode; status: string; is_deleted: number }
    | undefined;

  if (!target || target.is_deleted === 1) {
    res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    return;
  }

  if (targetId === admin.id && nextStatus === 'suspended') {
    res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun Anda sendiri.' });
    return;
  }
  if (target.role === 'admin' && nextStatus === 'suspended' && countActiveAdminsExcluding(targetId) === 0) {
    res.status(400).json({ error: 'Tidak dapat menonaktifkan Admin terakhir.' });
    return;
  }

  const nowIso = new Date().toISOString();
  runInTransaction(() => {
    db.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`).run(nextStatus, nowIso, targetId);
    if (nextStatus === 'suspended') {
      db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(nowIso, targetId);
    }

    logActivity({
      userId: admin.id,
      username: admin.username,
      userRole: admin.role,
      activityType: 'USER_STATUS_CHANGED',
      detail: `Status akun ${target.username} diubah menjadi ${nextStatus}.`,
      status: 'success',
      ipAddress: getClientIp(req),
    });
  });

  res.json({ message: `Status akun ${target.username} berhasil diubah menjadi ${nextStatus}.` });
});

adminRouter.get('/deletion-requests', (_req, res) => {
  const requests = db.prepare(`
    SELECT
      dr.id, dr.user_id, dr.reason, dr.status, dr.review_note, dr.created_at, dr.reviewed_at,
      u.full_name, u.username, u.email, r.code as user_role
    FROM account_deletion_requests dr
    JOIN users u ON dr.user_id = u.id
    JOIN roles r ON u.role_id = r.id
    ORDER BY CASE WHEN dr.status = 'pending' THEN 0 ELSE 1 END, dr.created_at DESC
  `).all();
  res.json({ requests });
});

adminRouter.post('/deletion-requests/:requestId/review', (req: AuthenticatedRequest, res) => {
  const requestId = Number(req.params.requestId);
  const decision = req.body?.decision; // 'approve' | 'reject'
  const reviewNote = String(req.body?.note || '').trim();
  const admin = req.authUser!;

  if (!['approve', 'reject'].includes(decision)) {
    res.status(400).json({ error: 'Keputusan harus approve atau reject.' });
    return;
  }

  const reqRow = db.prepare(`
    SELECT dr.id, dr.user_id, dr.status, u.username, r.code as user_role
    FROM account_deletion_requests dr
    JOIN users u ON dr.user_id = u.id
    JOIN roles r ON u.role_id = r.id
    WHERE dr.id = ?
  `).get(requestId) as
    | { id: number; user_id: number; status: string; username: string; user_role: RoleCode }
    | undefined;

  if (!reqRow) {
    res.status(404).json({ error: 'Permintaan penghapusan akun tidak ditemukan.' });
    return;
  }
  if (reqRow.status !== 'pending') {
    res.status(400).json({ error: 'Permintaan ini sudah diproses sebelumnya.' });
    return;
  }

  if (decision === 'approve') {
    if (reqRow.user_id === admin.id) {
      res.status(400).json({
        error: 'Demi keamanan audit, Admin tidak diizinkan menyetujui penghapusan akunnya sendiri.',
      });
      return;
    }
    if (reqRow.user_role === 'admin' && countActiveAdminsExcluding(reqRow.user_id) === 0) {
      res.status(400).json({ error: 'Tidak dapat menghapus akun Admin terakhir dalam sistem.' });
      return;
    }
  }

  const nowIso = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(`
      UPDATE account_deletion_requests
      SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = ?
      WHERE id = ?
    `).run(
      decision === 'approve' ? 'approved' : 'rejected',
      admin.id,
      reviewNote || null,
      nowIso,
      requestId
    );

    if (decision === 'approve') {
      // Soft delete to preserve audit logs & historical order attribution
      db.prepare(`
        UPDATE users SET status = 'deleted', is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?
      `).run(nowIso, nowIso, reqRow.user_id);

      db.prepare(`
        UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
      `).run(nowIso, reqRow.user_id);
    }

    logActivity({
      userId: admin.id,
      username: admin.username,
      userRole: admin.role,
      activityType: decision === 'approve' ? 'ACCOUNT_DELETION_APPROVED' : 'ACCOUNT_DELETION_REJECTED',
      detail:
        decision === 'approve'
          ? `Permintaan penghapusan (soft delete) akun ${reqRow.username} disetujui oleh ${admin.username}.`
          : `Permintaan penghapusan akun ${reqRow.username} ditolak oleh ${admin.username}.`,
      status: decision === 'approve' ? 'success' : 'info',
      ipAddress: getClientIp(req),
    });
  });

  res.json({
    message:
      decision === 'approve'
        ? `Akun ${reqRow.username} berhasil dinonaktifkan (soft delete). Riwayat audit tetap terjaga.`
        : `Permintaan penghapusan akun ${reqRow.username} telah ditolak.`,
  });
});

adminRouter.get('/activity-logs', (req, res) => {
  const { username, activity_type, status, date_from, date_to, search } = req.query;
  const conditions: string[] = ['1=1'];
  const params: Array<string | number> = [];

  if (username && typeof username === 'string' && username !== 'all') {
    conditions.push('username = ?');
    params.push(username);
  }
  if (activity_type && typeof activity_type === 'string' && activity_type !== 'all') {
    conditions.push('activity_type = ?');
    params.push(activity_type);
  }
  if (status && typeof status === 'string' && status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }
  if (date_from && typeof date_from === 'string') {
    conditions.push('date(created_at) >= date(?)');
    params.push(date_from);
  }
  if (date_to && typeof date_to === 'string') {
    conditions.push('date(created_at) <= date(?)');
    params.push(date_to);
  }
  if (search && typeof search === 'string' && search.trim()) {
    conditions.push('(LOWER(detail) LIKE ? OR LOWER(username) LIKE ? OR LOWER(activity_type) LIKE ?)');
    const q = `%${search.trim().toLowerCase()}%`;
    params.push(q, q, q);
  }

  const sql = `
    SELECT id, user_id, username, user_role, activity_type, detail, status, ip_address, created_at
    FROM activity_logs
    WHERE ${conditions.join(' AND ')}
    ORDER BY id DESC
    LIMIT 300
  `;

  const logs = db.prepare(sql).all(...params);
  const distinctUsers = db
    .prepare(`SELECT DISTINCT username FROM activity_logs ORDER BY username ASC`)
    .all() as Array<{ username: string }>;
  const distinctTypes = db
    .prepare(`SELECT DISTINCT activity_type FROM activity_logs ORDER BY activity_type ASC`)
    .all() as Array<{ activity_type: string }>;

  res.json({
    logs,
    filters: {
      users: distinctUsers.map((u) => u.username),
      activityTypes: distinctTypes.map((t) => t.activity_type),
    },
  });
});

adminRouter.get('/activity-logs/export', (req: AuthenticatedRequest, res) => {
  const logs = db.prepare(`
    SELECT id, created_at, username, user_role, activity_type, detail, status
    FROM activity_logs
    ORDER BY id DESC
    LIMIT 1000
  `).all() as Array<{
    id: number;
    created_at: string;
    username: string;
    user_role: string;
    activity_type: string;
    detail: string;
    status: string;
  }>;

  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['ID', 'Waktu (UTC ISO)', 'Waktu (WIB Asia/Jakarta)', 'Pengguna', 'Role', 'Aktivitas', 'Detail', 'Status'].join(','),
    ...logs.map((row) => {
      const wib = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(new Date(row.created_at));
      return [
        row.id,
        esc(row.created_at),
        esc(wib),
        esc(row.username),
        esc(row.user_role),
        esc(row.activity_type),
        esc(row.detail),
        esc(row.status),
      ].join(',');
    }),
  ];

  logActivity({
    userId: req.authUser!.id,
    username: req.authUser!.username,
    userRole: req.authUser!.role,
    activityType: 'ACTIVITY_LOGS_EXPORTED',
    detail: `Admin ${req.authUser!.username} mengekspor ${logs.length} baris log aktivitas sistem.`,
    status: 'info',
    ipAddress: getClientIp(req),
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="moda_activity_logs.csv"');
  res.send(lines.join('\n'));
});

adminRouter.get('/templates', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, name, code, body, allowed_placeholders, is_active, updated_by, updated_at, created_at
    FROM whatsapp_templates
    ORDER BY id ASC
  `).all() as Array<{
    id: number;
    name: string;
    code: string;
    body: string;
    allowed_placeholders: string;
    is_active: number;
    updated_by: number | null;
    updated_at: string;
    created_at: string;
  }>;

  res.json({
    templates: rows.map((r) => ({
      ...r,
      allowed_placeholders: JSON.parse(r.allowed_placeholders || '[]'),
    })),
    availablePlaceholders: ALLOWED_TEMPLATE_PLACEHOLDERS,
  });
});

adminRouter.put('/templates/:id', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const { name, body, allowed_placeholders } = req.body ?? {};
  const cleanName = String(name || '').trim();
  const cleanBody = String(body || '').trim();

  if (!cleanName || !cleanBody) {
    res.status(400).json({ error: 'Nama template dan isi pesan wajib diisi.' });
    return;
  }

  const validKeys = new Set(ALLOWED_TEMPLATE_PLACEHOLDERS.map((p) => p.key));
  const nextAllowed: string[] = Array.isArray(allowed_placeholders)
    ? allowed_placeholders.filter((k: unknown): k is string => typeof k === 'string' && validKeys.has(k))
    : Array.from(validKeys);

  // Verify no disallowed placeholders are used inside body
  const usedMatches = Array.from(cleanBody.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)).map((m) => m[1]);
  const unauthorized = usedMatches.filter((k) => !nextAllowed.includes(k));
  if (unauthorized.length > 0) {
    res.status(400).json({
      error: `Placeholder tidak diizinkan dalam template: ${unauthorized.map((k) => `{{${k}}}`).join(', ')}`,
    });
    return;
  }

  const existing = db.prepare(`SELECT id FROM whatsapp_templates WHERE id = ?`).get(id);
  if (!existing) {
    res.status(404).json({ error: 'Template tidak ditemukan.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE whatsapp_templates
    SET name = ?, body = ?, allowed_placeholders = ?, updated_by = ?, updated_at = ?
    WHERE id = ?
  `).run(cleanName, cleanBody, JSON.stringify(nextAllowed), req.authUser!.id, nowIso, id);

  logActivity({
    userId: req.authUser!.id,
    username: req.authUser!.username,
    userRole: req.authUser!.role,
    activityType: 'WHATSAPP_TEMPLATE_UPDATED',
    detail: `Admin ${req.authUser!.username} memperbarui template WhatsApp "${cleanName}".`,
    status: 'success',
    ipAddress: getClientIp(req),
  });

  res.json({ message: 'Template pesan WhatsApp berhasil diperbarui.' });
});

adminRouter.get('/settings', (_req, res) => {
  const rows = db.prepare(`SELECT key, value, updated_at FROM system_settings ORDER BY key ASC`).all();
  res.json({ settings: rows });
});

adminRouter.put('/settings', (req: AuthenticatedRequest, res) => {
  const updates = req.body?.settings as Record<string, string> | undefined;
  if (!updates || typeof updates !== 'object') {
    res.status(400).json({ error: 'Payload pengaturan tidak valid.' });
    return;
  }
  const nowIso = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO system_settings (key, value, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `);

  runInTransaction(() => {
    for (const [k, v] of Object.entries(updates)) {
      if (['company_name', 'timezone', 'ahp_cr_threshold'].includes(k)) {
        upsert.run(k, String(v).trim(), req.authUser!.id, nowIso);
      }
    }
    logActivity({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userRole: req.authUser!.role,
      activityType: 'SYSTEM_SETTINGS_UPDATED',
      detail: `Admin ${req.authUser!.username} memperbarui konfigurasi sistem.`,
      status: 'success',
      ipAddress: getClientIp(req),
    });
  });

  res.json({ message: 'Pengaturan sistem berhasil disimpan.' });
});
