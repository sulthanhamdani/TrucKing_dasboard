import { Router } from 'express';
import { db, runInTransaction } from '../db.ts';
import { getClientIp, logActivity, requireAuth, requireRole } from '../auth.ts';
import type { AuthenticatedRequest } from '../auth.ts';
import { normalizeWhatsAppNumber } from '../../shared/whatsapp.ts';
import { computeKpiFromRows, getActiveAhpAssessment } from './monitoringRoutes.ts';

export const transporterRouter = Router();

transporterRouter.use(requireAuth);

function generateNextTransporterCode(): string {
  const rows = db.prepare(`SELECT code FROM transporters`).all() as Array<{ code: string }>;
  let maxNum = 0;
  for (const r of rows) {
    const m = /^TRP-(\d+)$/i.exec(r.code);
    if (m) {
      const n = Number(m[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `TRP-${String(maxNum + 1).padStart(3, '0')}`;
}

transporterRouter.get('/', (req, res) => {
  const { search, status, fleet, page = '1', pageSize = '10' } = req.query;
  const conditions: string[] = ['is_deleted = 0'];
  const params: Array<string | number> = [];

  if (status && typeof status === 'string' && status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }
  if (fleet && typeof fleet === 'string' && fleet !== 'all') {
    conditions.push('LOWER(fleet_types) LIKE ?');
    params.push(`%${fleet.toLowerCase()}%`);
  }
  if (search && typeof search === 'string' && search.trim()) {
    const q = `%${search.trim().toLowerCase()}%`;
    conditions.push('(LOWER(code) LIKE ? OR LOWER(company_name) LIKE ? OR LOWER(pic_name) LIKE ? OR LOWER(service_routes) LIKE ?)');
    params.push(q, q, q, q);
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limit = Math.min(100, Math.max(1, Number(pageSize) || 10));
  const offset = (pageNum - 1) * limit;

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM transporters WHERE ${conditions.join(' AND ')}`)
    .get(...params) as { total: number };

  const rows = db
    .prepare(
      `SELECT id, code, company_name, pic_name, phone, whatsapp_raw, whatsapp_normalized,
              email, address, fleet_types, service_routes, status, notes, created_at, updated_at
       FROM transporters
       WHERE ${conditions.join(' AND ')}
       ORDER BY company_name ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Array<{
    id: number;
    code: string;
    company_name: string;
    pic_name: string;
    phone: string;
    whatsapp_raw: string;
    whatsapp_normalized: string;
    email: string | null;
    address: string | null;
    fleet_types: string;
    service_routes: string | null;
    status: 'Active' | 'Inactive';
    notes: string | null;
    created_at: string;
    updated_at: string;
  }>;

  const contactStmt = db.prepare(`
    SELECT id, transporter_id, contact_name, role_title, phone, whatsapp_raw, whatsapp_normalized, is_primary, created_at
    FROM transporter_contacts
    WHERE transporter_id = ?
    ORDER BY is_primary DESC, id ASC
  `);

  const transporters = rows.map((r) => ({
    ...r,
    fleet_types: JSON.parse(r.fleet_types || '[]') as string[],
    contacts: contactStmt.all(r.id),
  }));

  res.json({
    transporters,
    pagination: {
      page: pageNum,
      pageSize: limit,
      total: countRow.total,
      totalPages: Math.max(1, Math.ceil(countRow.total / limit)),
    },
  });
});

transporterRouter.get('/:id', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare(
      `SELECT id, code, company_name, pic_name, phone, whatsapp_raw, whatsapp_normalized,
              email, address, fleet_types, service_routes, status, notes, created_at, updated_at
       FROM transporters
       WHERE id = ? AND is_deleted = 0`
    )
    .get(id) as
    | {
        id: number;
        code: string;
        company_name: string;
        pic_name: string;
        phone: string;
        whatsapp_raw: string;
        whatsapp_normalized: string;
        email: string | null;
        address: string | null;
        fleet_types: string;
        service_routes: string | null;
        status: 'Active' | 'Inactive';
        notes: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'Transporter tidak ditemukan.' });
    return;
  }

  const contacts = db
    .prepare(
      `SELECT id, transporter_id, contact_name, role_title, phone, whatsapp_raw, whatsapp_normalized, is_primary, created_at
       FROM transporter_contacts WHERE transporter_id = ? ORDER BY is_primary DESC, id ASC`
    )
    .all(id);

  // Match strictly against historical_shipments without altering historical data
  const histRows = db
    .prepare(
      `SELECT * FROM historical_shipments
       WHERE UPPER(transporter_code) = UPPER(?) OR LOWER(transporter_name) = LOWER(?)
       ORDER BY period_month ASC`
    )
    .all(row.code, row.company_name) as Array<{
    id: number;
    transporter_code: string;
    transporter_name: string;
    period_month: string;
    total_orders: number;
    completed_orders: number;
    on_time_orders: number;
    late_orders: number;
    avg_lead_time_hours: number;
    claim_rate_pct: number;
    capacity_fulfillment_pct: number;
    route_corridor: string;
    fleet_category: string;
  }>;

  let historicalSummary = null;
  if (histRows.length > 0) {
    const ahp = getActiveAhpAssessment();
    [historicalSummary] = computeKpiFromRows(histRows, ahp);
  }

  const operationalOrders =
    req.authUser!.role === 'viewer'
      ? []
      : db
          .prepare(
            `SELECT id, order_number, customer_name, origin, destination, planned_pickup_at, status, created_by_name, created_at
             FROM orders
             WHERE transporter_id = ? AND is_deleted = 0
             ORDER BY id DESC
             LIMIT 25`
          )
          .all(id);

  res.json({
    transporter: {
      ...row,
      fleet_types: JSON.parse(row.fleet_types || '[]'),
      contacts,
    },
    hasHistoricalData: histRows.length > 0,
    historicalSummary,
    historicalMonthly: histRows,
    operationalOrders,
  });
});

transporterRouter.post('/', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const {
    company_name,
    pic_name,
    phone,
    whatsapp_raw,
    email,
    address,
    fleet_types,
    service_routes,
    status = 'Active',
    notes,
    extra_contacts,
  } = req.body ?? {};

  const cleanCompany = String(company_name || '').trim();
  const cleanPic = String(pic_name || '').trim();
  const cleanPhone = String(phone || '').trim();
  const cleanWa = String(whatsapp_raw || '').trim();

  if (!cleanCompany || cleanCompany.length < 2) {
    res.status(400).json({ error: 'Nama perusahaan transporter wajib diisi.' });
    return;
  }
  if (!cleanPic) {
    res.status(400).json({ error: 'Nama PIC / Contact Person wajib diisi.' });
    return;
  }
  if (!cleanPhone) {
    res.status(400).json({ error: 'Nomor telepon PIC wajib diisi.' });
    return;
  }

  const waCheck = normalizeWhatsAppNumber(cleanWa);
  if (!waCheck.valid) {
    res.status(400).json({ error: waCheck.error });
    return;
  }

  const fleets: string[] = Array.isArray(fleet_types)
    ? fleet_types.map((f) => String(f).trim()).filter(Boolean)
    : String(fleet_types || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  if (fleets.length === 0) {
    res.status(400).json({ error: 'Minimal satu jenis armada harus dipilih.' });
    return;
  }

  // Validate optional extra contacts
  const validExtraContacts: Array<{
    contact_name: string;
    role_title: string;
    phone: string;
    whatsapp_raw: string;
    whatsapp_normalized: string;
  }> = [];

  if (Array.isArray(extra_contacts)) {
    for (const c of extra_contacts) {
      const cName = String(c?.contact_name || '').trim();
      const cWa = String(c?.whatsapp_raw || '').trim();
      if (!cName && !cWa) continue;
      if (!cName) {
        res.status(400).json({ error: 'Nama kontak tambahan tidak boleh kosong.' });
        return;
      }
      const cCheck = normalizeWhatsAppNumber(cWa);
      if (!cCheck.valid) {
        res.status(400).json({ error: `Kontak tambahan (${cName}): ${cCheck.error}` });
        return;
      }
      validExtraContacts.push({
        contact_name: cName,
        role_title: String(c?.role_title || 'PIC Operasional').trim(),
        phone: String(c?.phone || cWa).trim(),
        whatsapp_raw: cWa,
        whatsapp_normalized: cCheck.normalized,
      });
    }
  }

  const code = generateNextTransporterCode();
  const cleanStatus = status === 'Inactive' ? 'Inactive' : 'Active';
  const admin = req.authUser!;

  const createdId = runInTransaction(() => {
    const info = db
      .prepare(
        `INSERT INTO transporters (
          code, company_name, pic_name, phone, whatsapp_raw, whatsapp_normalized,
          email, address, fleet_types, service_routes, status, notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        code,
        cleanCompany,
        cleanPic,
        cleanPhone,
        cleanWa,
        waCheck.normalized,
        email ? String(email).trim() : null,
        address ? String(address).trim() : null,
        JSON.stringify(fleets),
        service_routes ? String(service_routes).trim() : null,
        cleanStatus,
        notes ? String(notes).trim() : null,
        admin.id
      );

    const trpId = Number(info.lastInsertRowid);
    const insertContact = db.prepare(`
      INSERT INTO transporter_contacts (
        transporter_id, contact_name, role_title, phone, whatsapp_raw, whatsapp_normalized, is_primary
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertContact.run(trpId, cleanPic, 'PIC Utama', cleanPhone, cleanWa, waCheck.normalized, 1);
    for (const ec of validExtraContacts) {
      insertContact.run(trpId, ec.contact_name, ec.role_title, ec.phone, ec.whatsapp_raw, ec.whatsapp_normalized, 0);
    }

    logActivity({
      userId: admin.id,
      username: admin.username,
      userRole: admin.role,
      activityType: 'TRANSPORTER_CREATED',
      detail: `Menambahkan transporter baru ${code} (${cleanCompany}) dengan PIC ${cleanPic} (WA: ${waCheck.normalized}).`,
      status: 'success',
      ipAddress: getClientIp(req),
    });

    return trpId;
  });

  res.status(201).json({
    id: createdId,
    code,
    message: `Transporter ${cleanCompany} (${code}) berhasil ditambahkan.`,
  });
});

transporterRouter.put('/:id', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT id, code, company_name FROM transporters WHERE id = ? AND is_deleted = 0`).get(id) as
    | { id: number; code: string; company_name: string }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Transporter tidak ditemukan.' });
    return;
  }

  const {
    company_name,
    pic_name,
    phone,
    whatsapp_raw,
    email,
    address,
    fleet_types,
    service_routes,
    status = 'Active',
    notes,
    extra_contacts,
  } = req.body ?? {};

  const cleanCompany = String(company_name || '').trim();
  const cleanPic = String(pic_name || '').trim();
  const cleanPhone = String(phone || '').trim();
  const cleanWa = String(whatsapp_raw || '').trim();

  if (!cleanCompany || !cleanPic || !cleanPhone) {
    res.status(400).json({ error: 'Nama perusahaan, nama PIC, dan telepon wajib diisi.' });
    return;
  }

  const waCheck = normalizeWhatsAppNumber(cleanWa);
  if (!waCheck.valid) {
    res.status(400).json({ error: waCheck.error });
    return;
  }

  const fleets: string[] = Array.isArray(fleet_types)
    ? fleet_types.map((f) => String(f).trim()).filter(Boolean)
    : String(fleet_types || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  if (fleets.length === 0) {
    res.status(400).json({ error: 'Minimal satu jenis armada harus dipilih.' });
    return;
  }

  const validExtraContacts: Array<{
    contact_name: string;
    role_title: string;
    phone: string;
    whatsapp_raw: string;
    whatsapp_normalized: string;
  }> = [];

  if (Array.isArray(extra_contacts)) {
    for (const c of extra_contacts) {
      const cName = String(c?.contact_name || '').trim();
      const cWa = String(c?.whatsapp_raw || '').trim();
      if (!cName && !cWa) continue;
      if (!cName) {
        res.status(400).json({ error: 'Nama kontak tambahan tidak boleh kosong.' });
        return;
      }
      const cCheck = normalizeWhatsAppNumber(cWa);
      if (!cCheck.valid) {
        res.status(400).json({ error: `Kontak tambahan (${cName}): ${cCheck.error}` });
        return;
      }
      validExtraContacts.push({
        contact_name: cName,
        role_title: String(c?.role_title || 'PIC Operasional').trim(),
        phone: String(c?.phone || cWa).trim(),
        whatsapp_raw: cWa,
        whatsapp_normalized: cCheck.normalized,
      });
    }
  }

  const cleanStatus = status === 'Inactive' ? 'Inactive' : 'Active';
  const admin = req.authUser!;
  const nowIso = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      `UPDATE transporters SET
        company_name = ?, pic_name = ?, phone = ?, whatsapp_raw = ?, whatsapp_normalized = ?,
        email = ?, address = ?, fleet_types = ?, service_routes = ?, status = ?, notes = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      cleanCompany,
      cleanPic,
      cleanPhone,
      cleanWa,
      waCheck.normalized,
      email ? String(email).trim() : null,
      address ? String(address).trim() : null,
      JSON.stringify(fleets),
      service_routes ? String(service_routes).trim() : null,
      cleanStatus,
      notes ? String(notes).trim() : null,
      nowIso,
      id
    );

    db.prepare(`DELETE FROM transporter_contacts WHERE transporter_id = ?`).run(id);
    const insertContact = db.prepare(`
      INSERT INTO transporter_contacts (
        transporter_id, contact_name, role_title, phone, whatsapp_raw, whatsapp_normalized, is_primary
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertContact.run(id, cleanPic, 'PIC Utama', cleanPhone, cleanWa, waCheck.normalized, 1);
    for (const ec of validExtraContacts) {
      insertContact.run(id, ec.contact_name, ec.role_title, ec.phone, ec.whatsapp_raw, ec.whatsapp_normalized, 0);
    }

    logActivity({
      userId: admin.id,
      username: admin.username,
      userRole: admin.role,
      activityType: 'TRANSPORTER_UPDATED',
      detail: `Memperbarui data transporter ${existing.code} (${cleanCompany}).`,
      status: 'success',
      ipAddress: getClientIp(req),
    });
  });

  res.json({ message: `Data transporter ${cleanCompany} berhasil diperbarui.` });
});

transporterRouter.patch('/:id/status', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const nextStatus = req.body?.status === 'Inactive' ? 'Inactive' : 'Active';
  const existing = db.prepare(`SELECT id, code, company_name FROM transporters WHERE id = ? AND is_deleted = 0`).get(id) as
    | { id: number; code: string; company_name: string }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Transporter tidak ditemukan.' });
    return;
  }

  db.prepare(`UPDATE transporters SET status = ?, updated_at = ? WHERE id = ?`).run(
    nextStatus,
    new Date().toISOString(),
    id
  );

  logActivity({
    userId: req.authUser!.id,
    username: req.authUser!.username,
    userRole: req.authUser!.role,
    activityType: 'TRANSPORTER_STATUS_CHANGED',
    detail: `Status kerja sama transporter ${existing.code} (${existing.company_name}) diubah menjadi ${nextStatus}.`,
    status: 'success',
    ipAddress: getClientIp(req),
  });

  res.json({ message: `Status transporter ${existing.company_name} diubah menjadi ${nextStatus}.` });
});
