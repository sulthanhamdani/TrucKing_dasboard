import crypto from 'node:crypto';
import { Router } from 'express';
import { db, runInTransaction } from '../db.ts';
import { getClientIp, logActivity, requireAuth, requireRole } from '../auth.ts';
import type { AuthenticatedRequest } from '../auth.ts';
import { ORDER_STATUSES, DEFAULT_WHATSAPP_TEMPLATE } from '../../shared/types.ts';
import type { OrderStatus } from '../../shared/types.ts';
import { normalizeWhatsAppNumber, renderWhatsAppOrderTemplate } from '../../shared/whatsapp.ts';
import { getWhatsAppProvider } from '../services/whatsappProvider.ts';

export const orderRouter = Router();

// Strictly operational access: Admin and Staff only (Viewers are blocked on backend)
orderRouter.use(requireAuth, requireRole('admin', 'staff'));

function generateUniqueOrderNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const datePart = `${y}${m}${d}`;

  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM orders WHERE order_number LIKE ?`)
    .get(`ORD-${datePart}-%`) as { cnt: number };

  let seq = row.cnt + 1;
  while (true) {
    const candidate = `ORD-${datePart}-${String(seq).padStart(4, '0')}`;
    const exists = db.prepare(`SELECT id FROM orders WHERE order_number = ?`).get(candidate);
    if (!exists) return candidate;
    seq += 1;
  }
}

function getActiveTemplateBody(): string {
  const row = db
    .prepare(`SELECT body FROM whatsapp_templates WHERE is_active = 1 ORDER BY id DESC LIMIT 1`)
    .get() as { body: string } | undefined;
  return row?.body || DEFAULT_WHATSAPP_TEMPLATE;
}

orderRouter.get('/next-preview', (_req, res) => {
  const template = db
    .prepare(`SELECT id, name, code, body, allowed_placeholders FROM whatsapp_templates WHERE is_active = 1 ORDER BY id DESC LIMIT 1`)
    .get() as
    | { id: number; name: string; code: string; body: string; allowed_placeholders: string }
    | undefined;

  res.json({
    suggestedOrderNumber: generateUniqueOrderNumber(),
    template: template
      ? { ...template, allowed_placeholders: JSON.parse(template.allowed_placeholders || '[]') }
      : { id: 0, name: 'Default', code: 'ORDER_REQUEST_DEFAULT', body: DEFAULT_WHATSAPP_TEMPLATE, allowed_placeholders: [] },
  });
});

orderRouter.get('/export/csv', (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT order_number, customer_name, service_type, origin, destination,
              planned_pickup_at, planned_delivery_at, fleet_needed, transporter_name,
              pic_name, whatsapp_number, status, created_by_name, created_at
       FROM orders WHERE is_deleted = 0 ORDER BY id DESC LIMIT 500`
    )
    .all() as Array<Record<string, unknown>>;

  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = [
    'Order ID',
    'Customer',
    'Layanan',
    'Origin',
    'Destination',
    'Rencana Muat',
    'Rencana Bongkar',
    'Armada',
    'Transporter',
    'PIC',
    'WhatsApp',
    'Status',
    'Dibuat Oleh',
    'Waktu Dibuat',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        esc(r.order_number),
        esc(r.customer_name),
        esc(r.service_type),
        esc(r.origin),
        esc(r.destination),
        esc(r.planned_pickup_at),
        esc(r.planned_delivery_at),
        esc(r.fleet_needed),
        esc(r.transporter_name),
        esc(r.pic_name),
        esc(r.whatsapp_number),
        esc(r.status),
        esc(r.created_by_name),
        esc(r.created_at),
      ].join(',')
    ),
  ];

  logActivity({
    userId: req.authUser!.id,
    username: req.authUser!.username,
    userRole: req.authUser!.role,
    activityType: 'ORDERS_EXPORTED',
    detail: `Pengguna ${req.authUser!.username} mengekspor ${rows.length} order operasional.`,
    status: 'info',
    ipAddress: getClientIp(req),
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="moda_orders.csv"');
  res.send(lines.join('\n'));
});

orderRouter.get('/', (req, res) => {
  const { search, status, transporter_id, page = '1', pageSize = '15' } = req.query;
  const conditions: string[] = ['is_deleted = 0'];
  const params: Array<string | number> = [];

  if (status && typeof status === 'string' && status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }
  if (transporter_id && typeof transporter_id === 'string' && transporter_id !== 'all') {
    conditions.push('transporter_id = ?');
    params.push(Number(transporter_id));
  }
  if (search && typeof search === 'string' && search.trim()) {
    const q = `%${search.trim().toLowerCase()}%`;
    conditions.push(
      '(LOWER(order_number) LIKE ? OR LOWER(customer_name) LIKE ? OR LOWER(origin) LIKE ? OR LOWER(destination) LIKE ? OR LOWER(transporter_name) LIKE ?)'
    );
    params.push(q, q, q, q, q);
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limit = Math.min(100, Math.max(1, Number(pageSize) || 15));
  const offset = (pageNum - 1) * limit;

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM orders WHERE ${conditions.join(' AND ')}`)
    .get(...params) as { total: number };

  const orders = db
    .prepare(
      `SELECT * FROM orders
       WHERE ${conditions.join(' AND ')}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({
    orders,
    pagination: {
      page: pageNum,
      pageSize: limit,
      total: countRow.total,
      totalPages: Math.max(1, Math.ceil(countRow.total / limit)),
    },
  });
});

orderRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare(`SELECT * FROM orders WHERE id = ? AND is_deleted = 0`).get(id);
  if (!order) {
    res.status(404).json({ error: 'Order tidak ditemukan.' });
    return;
  }

  const history = db
    .prepare(`SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id DESC`)
    .all(id);

  res.json({ order, history });
});

orderRouter.post('/', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const body = req.body ?? {};

  // Prevent duplicate submission on double click / refresh
  const idempotencyKey = body.idempotency_key
    ? String(body.idempotency_key).trim()
    : crypto.randomUUID();

  const existingByKey = db
    .prepare(`SELECT * FROM orders WHERE idempotency_key = ?`)
    .get(idempotencyKey);
  if (existingByKey) {
    res.status(200).json({ order: existingByKey, deduplicated: true });
    return;
  }

  const requiredFields: Array<[string, string]> = [
    ['customer_name', 'Nama customer'],
    ['service_type', 'Jenis layanan'],
    ['origin', 'Origin / lokasi muat'],
    ['origin_address', 'Alamat lengkap lokasi muat'],
    ['destination', 'Destination / lokasi bongkar'],
    ['destination_address', 'Alamat lengkap lokasi bongkar'],
    ['planned_pickup_at', 'Tanggal & jam rencana muat'],
    ['planned_delivery_at', 'Tanggal & jam rencana bongkar'],
    ['cargo_type', 'Jenis barang'],
    ['cargo_qty', 'Jumlah barang / koli'],
    ['fleet_needed', 'Jenis armada yang dibutuhkan'],
  ];

  for (const [field, label] of requiredFields) {
    if (!String(body[field] || '').trim()) {
      res.status(400).json({ error: `${label} wajib diisi.` });
      return;
    }
  }

  const transporterId = Number(body.transporter_id);
  if (!transporterId) {
    res.status(400).json({ error: 'Silakan pilih transporter tujuan pengiriman secara manual.' });
    return;
  }

  const transporter = db
    .prepare(`SELECT id, company_name, pic_name, whatsapp_normalized, status FROM transporters WHERE id = ? AND is_deleted = 0`)
    .get(transporterId) as
    | { id: number; company_name: string; pic_name: string; whatsapp_normalized: string; status: string }
    | undefined;

  if (!transporter) {
    res.status(404).json({ error: 'Transporter tidak ditemukan.' });
    return;
  }
  if (transporter.status !== 'Active') {
    res.status(400).json({ error: 'Transporter berstatus Inactive dan tidak dapat menerima order baru.' });
    return;
  }

  let picName = String(body.pic_name || transporter.pic_name).trim();
  let waRaw = String(body.whatsapp_number || transporter.whatsapp_normalized).trim();
  const contactId = body.contact_id ? Number(body.contact_id) : null;

  if (contactId) {
    const contact = db
      .prepare(`SELECT id, contact_name, whatsapp_normalized FROM transporter_contacts WHERE id = ? AND transporter_id = ?`)
      .get(contactId, transporterId) as
      | { id: number; contact_name: string; whatsapp_normalized: string }
      | undefined;
    if (contact) {
      picName = String(body.pic_name || contact.contact_name).trim();
      waRaw = String(body.whatsapp_number || contact.whatsapp_normalized).trim();
    }
  }

  const waCheck = normalizeWhatsAppNumber(waRaw);
  if (!waCheck.valid) {
    res.status(400).json({ error: waCheck.error });
    return;
  }

  const orderNumber = generateUniqueOrderNumber();
  const initialStatus: OrderStatus = body.save_as_draft ? 'Draft' : 'Ready to Send';

  const renderedTemplate = renderWhatsAppOrderTemplate(getActiveTemplateBody(), {
    nama_pic: picName,
    nama_transporter: transporter.company_name,
    nomor_order: orderNumber,
    nama_customer: String(body.customer_name).trim(),
    jenis_layanan: String(body.service_type).trim(),
    origin: String(body.origin).trim(),
    alamat_muat: String(body.origin_address).trim(),
    destination: String(body.destination).trim(),
    alamat_bongkar: String(body.destination_address).trim(),
    tanggal_jam_muat: String(body.planned_pickup_at).trim(),
    tanggal_jam_bongkar: String(body.planned_delivery_at).trim(),
    jenis_armada: String(body.fleet_needed).trim(),
    jenis_barang: String(body.cargo_type).trim(),
    jumlah_barang: String(body.cargo_qty).trim(),
    berat_barang: body.cargo_weight ? String(body.cargo_weight).trim() : '-',
    informasi_biaya: body.rate_info ? String(body.rate_info).trim() : '-',
    catatan: body.special_notes ? String(body.special_notes).trim() : '-',
    dibuat_oleh: user.full_name,
  });

  const finalMessageText =
    typeof body.message_text === 'string' && body.message_text.trim().length > 0
      ? body.message_text.trim()
      : renderedTemplate;

  const nowIso = new Date().toISOString();

  const createdOrder = runInTransaction(() => {
    const info = db
      .prepare(
        `INSERT INTO orders (
          order_number, idempotency_key, created_by, created_by_name,
          customer_name, service_type, origin, origin_address, destination, destination_address,
          planned_pickup_at, planned_delivery_at, cargo_type, cargo_qty, cargo_weight,
          fleet_needed, special_notes, transporter_id, transporter_name, contact_id,
          pic_name, whatsapp_number, rate_info, message_text, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orderNumber,
        idempotencyKey,
        user.id,
        user.full_name,
        String(body.customer_name).trim(),
        String(body.service_type).trim(),
        String(body.origin).trim(),
        String(body.origin_address).trim(),
        String(body.destination).trim(),
        String(body.destination_address).trim(),
        String(body.planned_pickup_at).trim(),
        String(body.planned_delivery_at).trim(),
        String(body.cargo_type).trim(),
        String(body.cargo_qty).trim(),
        body.cargo_weight ? String(body.cargo_weight).trim() : null,
        String(body.fleet_needed).trim(),
        body.special_notes ? String(body.special_notes).trim() : null,
        transporter.id,
        transporter.company_name,
        contactId,
        picName,
        waCheck.normalized,
        body.rate_info ? String(body.rate_info).trim() : null,
        finalMessageText,
        initialStatus,
        nowIso,
        nowIso
      );

    const orderId = Number(info.lastInsertRowid);

    db.prepare(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, changed_by_name, note, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`
    ).run(
      orderId,
      initialStatus,
      user.id,
      user.full_name,
      initialStatus === 'Draft' ? 'Order disimpan sebagai Draft.' : 'Order dibuat dan siap dikirim via WhatsApp.',
      nowIso
    );

    logActivity({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      activityType: 'ORDER_CREATED',
      detail: `Order ${orderNumber} dibuat untuk customer ${String(body.customer_name).trim()} ke transporter ${transporter.company_name} (status: ${initialStatus}).`,
      status: 'success',
      ipAddress: getClientIp(req),
    });

    return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  });

  res.status(201).json({ order: createdOrder });
});

orderRouter.put('/:id', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const user = req.authUser!;
  const existing = db.prepare(`SELECT * FROM orders WHERE id = ? AND is_deleted = 0`).get(id) as
    | { id: number; order_number: string; status: OrderStatus }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Order tidak ditemukan.' });
    return;
  }
  if (user.role !== 'admin' && !['Draft', 'Ready to Send'].includes(existing.status)) {
    res.status(403).json({
      error: 'Hanya Super Admin yang dapat mengedit order yang sudah diproses.',
    });
    return;
  }

  const body = req.body ?? {};
  const transporterId = Number(body.transporter_id);
  const transporter = db
    .prepare(`SELECT id, company_name, pic_name, whatsapp_normalized FROM transporters WHERE id = ? AND is_deleted = 0`)
    .get(transporterId) as
    | { id: number; company_name: string; pic_name: string; whatsapp_normalized: string }
    | undefined;

  if (!transporter) {
    res.status(404).json({ error: 'Transporter tidak ditemukan.' });
    return;
  }

  const waCheck = normalizeWhatsAppNumber(String(body.whatsapp_number || transporter.whatsapp_normalized));
  if (!waCheck.valid) {
    res.status(400).json({ error: waCheck.error });
    return;
  }

  const isDraftOrReady = ['Draft', 'Ready to Send'].includes(existing.status);
  const nextStatus: OrderStatus =
    body.preserve_status || (user.role === 'admin' && !isDraftOrReady)
      ? existing.status
      : body.save_as_draft
        ? 'Draft'
        : 'Ready to Send';
  const nowIso = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      `UPDATE orders SET
        customer_name = ?, service_type = ?, origin = ?, origin_address = ?,
        destination = ?, destination_address = ?, planned_pickup_at = ?, planned_delivery_at = ?,
        cargo_type = ?, cargo_qty = ?, cargo_weight = ?, fleet_needed = ?, special_notes = ?,
        transporter_id = ?, transporter_name = ?, contact_id = ?, pic_name = ?, whatsapp_number = ?,
        rate_info = ?, message_text = ?, status = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      String(body.customer_name || '').trim(),
      String(body.service_type || '').trim(),
      String(body.origin || '').trim(),
      String(body.origin_address || '').trim(),
      String(body.destination || '').trim(),
      String(body.destination_address || '').trim(),
      String(body.planned_pickup_at || '').trim(),
      String(body.planned_delivery_at || '').trim(),
      String(body.cargo_type || '').trim(),
      String(body.cargo_qty || '').trim(),
      body.cargo_weight ? String(body.cargo_weight).trim() : null,
      String(body.fleet_needed || '').trim(),
      body.special_notes ? String(body.special_notes).trim() : null,
      transporter.id,
      transporter.company_name,
      body.contact_id ? Number(body.contact_id) : null,
      String(body.pic_name || transporter.pic_name).trim(),
      waCheck.normalized,
      body.rate_info ? String(body.rate_info).trim() : null,
      String(body.message_text || '').trim(),
      nextStatus,
      nowIso,
      id
    );

    db.prepare(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, changed_by_name, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      existing.status,
      nextStatus,
      user.id,
      user.full_name,
      user.role === 'admin' && !isDraftOrReady
        ? `Data order diperbarui oleh Super Admin (${user.username}).`
        : 'Order diperbarui.',
      nowIso
    );

    logActivity({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      activityType: 'ORDER_UPDATED',
      detail: `Order ${existing.order_number} diperbarui oleh ${user.username} (${user.role}).`,
      status: 'success',
      ipAddress: getClientIp(req),
    });
  });

  res.json({ order: db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) });
});

orderRouter.delete('/:id', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const admin = req.authUser!;
  const reason = String(req.body?.reason || '').trim();

  const existing = db
    .prepare(`SELECT id, order_number, customer_name, status FROM orders WHERE id = ? AND is_deleted = 0`)
    .get(id) as { id: number; order_number: string; customer_name: string; status: string } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Order tidak ditemukan atau sudah dihapus.' });
    return;
  }

  const nowIso = new Date().toISOString();

  runInTransaction(() => {
    db.prepare(
      `UPDATE orders SET is_deleted = 1, deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?`
    ).run(nowIso, admin.id, nowIso, id);

    db.prepare(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, changed_by_name, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      existing.status,
      'Deleted',
      admin.id,
      admin.full_name,
      reason ? `Order dihapus (soft delete) oleh Super Admin: ${reason}` : 'Order dihapus (soft delete) oleh Super Admin.',
      nowIso
    );

    logActivity({
      userId: admin.id,
      username: admin.username,
      userRole: admin.role,
      activityType: 'ORDER_DELETED',
      detail: `Super Admin ${admin.username} menghapus order ${existing.order_number} (${existing.customer_name})${reason ? `. Alasan: ${reason}` : '.'}`,
      status: 'success',
      ipAddress: getClientIp(req),
    });
  });

  res.json({ message: `Order ${existing.order_number} berhasil dihapus.` });
});

orderRouter.post('/:id/duplicate', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const user = req.authUser!;
  const src = db.prepare(`SELECT * FROM orders WHERE id = ? AND is_deleted = 0`).get(id) as Record<string, unknown> | undefined;

  if (!src) {
    res.status(404).json({ error: 'Order sumber tidak ditemukan.' });
    return;
  }

  const newOrderNumber = generateUniqueOrderNumber();
  const nowIso = new Date().toISOString();

  const updatedMessage = String(src.message_text || '').replace(
    String(src.order_number),
    newOrderNumber
  );

  const cloned = runInTransaction(() => {
    const info = db
      .prepare(
        `INSERT INTO orders (
          order_number, idempotency_key, created_by, created_by_name,
          customer_name, service_type, origin, origin_address, destination, destination_address,
          planned_pickup_at, planned_delivery_at, cargo_type, cargo_qty, cargo_weight,
          fleet_needed, special_notes, transporter_id, transporter_name, contact_id,
          pic_name, whatsapp_number, rate_info, message_text, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?)`
      )
      .run(
        newOrderNumber,
        crypto.randomUUID(),
        user.id,
        user.full_name,
        src.customer_name as string,
        src.service_type as string,
        src.origin as string,
        src.origin_address as string,
        src.destination as string,
        src.destination_address as string,
        src.planned_pickup_at as string,
        src.planned_delivery_at as string,
        src.cargo_type as string,
        src.cargo_qty as string,
        (src.cargo_weight as string | null) ?? null,
        src.fleet_needed as string,
        (src.special_notes as string | null) ?? null,
        src.transporter_id as number,
        src.transporter_name as string,
        (src.contact_id as number | null) ?? null,
        src.pic_name as string,
        src.whatsapp_number as string,
        (src.rate_info as string | null) ?? null,
        updatedMessage,
        nowIso,
        nowIso
      );

    const newId = Number(info.lastInsertRowid);
    db.prepare(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, changed_by_name, note, created_at)
       VALUES (?, NULL, 'Draft', ?, ?, ?, ?)`
    ).run(newId, user.id, user.full_name, `Duplikasi dari order ${String(src.order_number)}.`, nowIso);

    logActivity({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      activityType: 'ORDER_DUPLICATED',
      detail: `Order ${newOrderNumber} diduplikasi dari ${String(src.order_number)}.`,
      status: 'success',
      ipAddress: getClientIp(req),
    });

    return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(newId);
  });

  res.status(201).json({ order: cloned });
});

orderRouter.post('/:id/whatsapp-opened', async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const user = req.authUser!;
  const order = db.prepare(`SELECT * FROM orders WHERE id = ? AND is_deleted = 0`).get(id) as
    | {
        id: number;
        order_number: string;
        whatsapp_number: string;
        message_text: string;
        status: OrderStatus;
        transporter_name: string;
      }
    | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order tidak ditemukan.' });
    return;
  }

  const customMessage =
    typeof req.body?.message_text === 'string' && req.body.message_text.trim().length > 0
      ? req.body.message_text.trim()
      : order.message_text;

  try {
    const provider = getWhatsAppProvider();
    const dispatch = await provider.prepareDispatch({
      orderNumber: order.order_number,
      recipientPhone: order.whatsapp_number,
      messageText: customMessage,
    });

    const nowIso = new Date().toISOString();
    // Important: Opening WhatsApp ONLY sets technical status 'WhatsApp Opened' when Draft or Ready to Send.
    // It NEVER automatically marks as Sent, Accepted, or Completed.
    const shouldAdvance = ['Draft', 'Ready to Send'].includes(order.status);
    const nextStatus: OrderStatus = shouldAdvance ? 'WhatsApp Opened' : order.status;

    runInTransaction(() => {
      db.prepare(
        `UPDATE orders SET message_text = ?, status = ?, whatsapp_opened_at = ?, updated_at = ? WHERE id = ?`
      ).run(customMessage, nextStatus, nowIso, nowIso, id);

      if (shouldAdvance) {
        db.prepare(
          `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, changed_by_name, note, created_at)
           VALUES (?, ?, 'WhatsApp Opened', ?, ?, ?, ?)`
        ).run(
          id,
          order.status,
          user.id,
          user.full_name,
          'Link Click-to-Chat WhatsApp dibuka oleh operator. Menunggu konfirmasi kirim manual.',
          nowIso
        );
      }

      logActivity({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        activityType: 'WHATSAPP_OPENED',
        detail: `Membuka WhatsApp untuk order ${order.order_number} ke ${order.transporter_name} (${dispatch.normalizedPhone}).`,
        status: 'success',
        ipAddress: getClientIp(req),
      });
    });

    res.json({
      clickToChatUrl: dispatch.clickToChatUrl,
      note: dispatch.note,
      order: db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id),
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menyiapkan link WhatsApp.' });
  }
});

orderRouter.post('/:id/confirm-sent', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const user = req.authUser!;
  const note = String(req.body?.note || '').trim();
  const order = db.prepare(`SELECT id, order_number, status FROM orders WHERE id = ? AND is_deleted = 0`).get(id) as
    | { id: number; order_number: string; status: OrderStatus }
    | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order tidak ditemukan.' });
    return;
  }

  const nowIso = new Date().toISOString();
  runInTransaction(() => {
    db.prepare(
      `UPDATE orders SET status = 'Sent (Manual Confirmation)', manual_sent_confirmed_at = ?, updated_at = ? WHERE id = ?`
    ).run(nowIso, nowIso, id);

    db.prepare(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, changed_by_name, note, created_at)
       VALUES (?, ?, 'Sent (Manual Confirmation)', ?, ?, ?, ?)`
    ).run(
      id,
      order.status,
      user.id,
      user.full_name,
      note || 'Pengiriman pesan WhatsApp dikonfirmasi secara manual oleh pengguna.',
      nowIso
    );

    logActivity({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      activityType: 'ORDER_MARKED_SENT',
      detail: `Order ${order.order_number} ditandai sudah dikirim (konfirmasi manual) oleh ${user.username}.`,
      status: 'success',
      ipAddress: getClientIp(req),
    });
  });

  res.json({ order: db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) });
});

orderRouter.patch('/:id/status', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const user = req.authUser!;
  const nextStatus = req.body?.status as OrderStatus;
  const note = String(req.body?.note || '').trim();

  if (!ORDER_STATUSES.includes(nextStatus)) {
    res.status(400).json({ error: 'Status order tidak valid.' });
    return;
  }

  const order = db.prepare(`SELECT id, order_number, status FROM orders WHERE id = ? AND is_deleted = 0`).get(id) as
    | { id: number; order_number: string; status: OrderStatus }
    | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order tidak ditemukan.' });
    return;
  }

  const nowIso = new Date().toISOString();
  runInTransaction(() => {
    db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).run(nextStatus, nowIso, id);

    db.prepare(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, changed_by_name, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, order.status, nextStatus, user.id, user.full_name, note || `Status diperbarui ke ${nextStatus}.`, nowIso);

    logActivity({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      activityType: 'ORDER_STATUS_UPDATED',
      detail: `Status order ${order.order_number} diubah dari ${order.status} menjadi ${nextStatus}.`,
      status: 'success',
      ipAddress: getClientIp(req),
    });
  });

  res.json({ order: db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) });
});
