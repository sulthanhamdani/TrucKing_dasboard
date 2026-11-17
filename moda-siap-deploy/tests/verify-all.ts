import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const testDbFile = path.resolve(process.cwd(), 'data/moda.test.db');
for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(testDbFile + ext)) fs.unlinkSync(testDbFile + ext);
}

process.env.MODA_DB_PATH = testDbFile;
process.env.MODA_NO_LISTEN = 'true';

const { app } = await import('../server.ts');

const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const addr = server.address();
const baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';

async function req(
  pathname: string,
  opts: { method?: string; body?: unknown; cookie?: string } = {}
): Promise<{ status: number; json: Record<string, any>; setCookie: string }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.cookie) headers['Cookie'] = opts.cookie;

  const res = await fetch(`${baseUrl}${pathname}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const setCookieHeader = res.headers.get('set-cookie') || '';
  const cookiePair = setCookieHeader ? setCookieHeader.split(';')[0] : '';
  const text = await res.text();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, setCookie: cookiePair };
}

async function runTests() {
  console.log('Running MODA 16-scenario verification suite...');

  // 1. Unauthenticated users cannot access protected dashboard/monitoring/admin APIs
  const unauthMonitor = await req('/api/monitoring/summary');
  assert.equal(unauthMonitor.status, 401, '1. Unauthenticated /api/monitoring/summary must return 401');

  // Check bootstrap needed
  const bootStatus = await req('/api/auth/bootstrap-status');
  assert.equal(bootStatus.json.needsBootstrap, true, 'Bootstrap status should initially be true');

  // Bootstrap first Super Admin
  const bootRes = await req('/api/auth/bootstrap-admin', {
    method: 'POST',
    body: {
      full_name: 'Admin Utama',
      username: 'superadmin',
      email: 'superadmin@moda.test',
      password: 'PasswordKuat123!',
      division: 'Supply Management',
    },
  });
  assert.equal(bootRes.status, 201, 'Bootstrap admin should succeed');
  const adminCookie = bootRes.setCookie;
  assert.ok(adminCookie.includes('moda_session='), 'Admin session cookie must be issued');

  // Verify bootstrap cannot be called again
  const bootAgain = await req('/api/auth/bootstrap-admin', {
    method: 'POST',
    body: {
      full_name: 'Fake Admin',
      username: 'fakeadmin',
      email: 'fake@moda.test',
      password: 'PasswordKuat123!',
    },
  });
  assert.equal(bootAgain.status, 403, 'Second bootstrap attempt must be rejected');

  // 2. New registration produces Pending Approval status
  const regStaff = await req('/api/auth/register', {
    method: 'POST',
    body: {
      full_name: 'Budi Staff',
      username: 'budistaff',
      email: 'budi@moda.test',
      division: 'Operasional',
      requested_role: 'staff',
      password: 'StaffPassword123!',
      confirm_password: 'StaffPassword123!',
    },
  });
  assert.equal(regStaff.status, 201, '2. Staff registration should succeed with Pending Approval');

  const regRejectUser = await req('/api/auth/register', {
    method: 'POST',
    body: {
      full_name: 'User Ditolak',
      username: 'ditolak',
      email: 'ditolak@moda.test',
      division: 'Eksternal',
      requested_role: 'viewer',
      password: 'RejectPassword123!',
      confirm_password: 'RejectPassword123!',
    },
  });
  assert.equal(regRejectUser.status, 201);

  // 3. Pending account cannot login
  const pendingLogin = await req('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'budistaff', password: 'StaffPassword123!' },
  });
  assert.equal(pendingLogin.status, 403, '3. Pending user must not be able to login');

  // 4. Admin can approve and reject registrations
  const usersList = await req('/api/admin/users', { cookie: adminCookie });
  assert.equal(usersList.status, 200);
  const staffRow = usersList.json.users.find((u: any) => u.username === 'budistaff');
  const rejectRow = usersList.json.users.find((u: any) => u.username === 'ditolak');
  assert.equal(staffRow.status, 'pending');
  assert.equal('password_hash' in staffRow, false, 'Admin must never receive password_hash');

  const approveRes = await req(`/api/admin/users/${staffRow.id}/approve`, {
    method: 'POST',
    cookie: adminCookie,
    body: { role: 'staff' },
  });
  assert.equal(approveRes.status, 200, '4a. Admin approve must succeed');

  const rejectRes = await req(`/api/admin/users/${rejectRow.id}/reject`, {
    method: 'POST',
    cookie: adminCookie,
    body: { reason: 'Bukan karyawan aktif' },
  });
  assert.equal(rejectRes.status, 200, '4b. Admin reject must succeed');

  // Approved staff can login
  const staffLogin = await req('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'budistaff', password: 'StaffPassword123!' },
  });
  assert.equal(staffLogin.status, 200, 'Approved staff can login');
  const staffCookie = staffLogin.setCookie;

  // 5. Staff cannot access admin endpoints
  const staffAdminAccess = await req('/api/admin/users', { cookie: staffCookie });
  assert.equal(staffAdminAccess.status, 403, '5. Staff accessing /api/admin/users must receive 403 Forbidden');

  // 15 & 16 Baseline KPI snapshot before creating new orders
  const baselineSummary = await req('/api/monitoring/summary', { cookie: staffCookie });
  assert.equal(baselineSummary.status, 200);
  const baselineTotalHistOrders = baselineSummary.json.overview.total_orders;
  const baselineOtdPct = baselineSummary.json.overview.avg_otd_pct;

  // 9. Admin can add transporter and WhatsApp number (08... normalized to 628...)
  const addTrp = await req('/api/transporters', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      company_name: 'PT Ekspedisi Baru Mandiri',
      pic_name: 'Andi Saputra',
      phone: '021-88990011',
      whatsapp_raw: '0812-3456-7890',
      email: 'ops@ekspedisibaru.id',
      fleet_types: ['Wingbox', 'CDD'],
      service_routes: 'Jakarta - Surabaya',
      status: 'Active',
    },
  });
  assert.equal(addTrp.status, 201, '9. Admin adding transporter must succeed');
  const newTrpId = addTrp.json.id;

  // Verify new transporter has "Belum Ada Data Historis" (hasHistoricalData: false)
  const trpDetail = await req(`/api/transporters/${newTrpId}`, { cookie: staffCookie });
  assert.equal(trpDetail.status, 200);
  assert.equal(trpDetail.json.hasHistoricalData, false);
  assert.equal(trpDetail.json.transporter.whatsapp_normalized, '6281234567890');

  // 10 & 11. Staff can create order using saved transporter and template populates from form data
  const createOrder = await req('/api/orders', {
    method: 'POST',
    cookie: staffCookie,
    body: {
      idempotency_key: 'test-key-001',
      customer_name: 'PT Maju Jaya FMCG',
      service_type: 'Dedicated Charter',
      origin: 'Jakarta',
      origin_address: 'Kawasan Industri Pulogadung Blok A1',
      destination: 'Surabaya',
      destination_address: 'Pergudangan Margomulyo Blok C2',
      planned_pickup_at: '2026-11-15T08:00',
      planned_delivery_at: '2026-11-16T14:00',
      cargo_type: 'Makanan Kemasan',
      cargo_qty: '20 Palet',
      cargo_weight: '6 Ton',
      fleet_needed: 'Wingbox',
      special_notes: 'Wajib segel kontainer',
      transporter_id: newTrpId,
    },
  });
  assert.equal(createOrder.status, 201, '10. Staff creating order must succeed');
  const order = createOrder.json.order;
  assert.ok(order.message_text.includes('Andi Saputra'), '11a. Template must include PIC name');
  assert.ok(order.message_text.includes('PT Ekspedisi Baru Mandiri'), '11b. Template must include transporter name');
  assert.ok(order.message_text.includes('PT Maju Jaya FMCG'), '11c. Template must include customer name');

  // Test idempotency prevents duplicate order creation on double submit
  const dupSubmit = await req('/api/orders', {
    method: 'POST',
    cookie: staffCookie,
    body: {
      idempotency_key: 'test-key-001',
      customer_name: 'PT Maju Jaya FMCG',
      service_type: 'Dedicated Charter',
      origin: 'Jakarta',
      origin_address: 'Kawasan Industri Pulogadung Blok A1',
      destination: 'Surabaya',
      destination_address: 'Pergudangan Margomulyo Blok C2',
      planned_pickup_at: '2026-11-15T08:00',
      planned_delivery_at: '2026-11-16T14:00',
      cargo_type: 'Makanan Kemasan',
      cargo_qty: '20 Palet',
      fleet_needed: 'Wingbox',
      transporter_id: newTrpId,
    },
  });
  assert.equal(dupSubmit.json.deduplicated, true, 'Duplicate submit with same idempotency_key must deduplicate');

  // 12 & 13. WhatsApp Click-to-Chat URL points to correct vendor & status does NOT auto-become Sent
  const waOpen = await req(`/api/orders/${order.id}/whatsapp-opened`, {
    method: 'POST',
    cookie: staffCookie,
    body: {},
  });
  assert.equal(waOpen.status, 200);
  assert.ok(
    waOpen.json.clickToChatUrl.startsWith('https://wa.me/6281234567890?text='),
    '12. Click-to-Chat URL must target normalized vendor WhatsApp'
  );
  assert.equal(
    waOpen.json.order.status,
    'WhatsApp Opened',
    '13. Opening WhatsApp must ONLY set technical status WhatsApp Opened, never Sent'
  );

  // Manual Sent confirmation
  const confirmSent = await req(`/api/orders/${order.id}/confirm-sent`, {
    method: 'POST',
    cookie: staffCookie,
    body: { note: 'Pesan sudah terkirim via WA Web' },
  });
  assert.equal(confirmSent.status, 200);
  assert.equal(confirmSent.json.order.status, 'Sent (Manual Confirmation)');

  // 14. Order history persists and can be reopened
  const orderDetail = await req(`/api/orders/${order.id}`, { cookie: staffCookie });
  assert.equal(orderDetail.status, 200);
  assert.ok(orderDetail.json.history.length >= 3, '14. Order status history must record full audit trail');

  // 14b. Staff cannot edit non-draft/active order and cannot delete order (403)
  const staffEditActive = await req(`/api/orders/${order.id}`, {
    method: 'PUT',
    cookie: staffCookie,
    body: {
      customer_name: 'PT Maju Jaya Edit Staff',
      service_type: 'Dedicated Charter',
      origin: 'Jakarta',
      origin_address: 'Pulogadung',
      destination: 'Surabaya',
      destination_address: 'Margomulyo',
      planned_pickup_at: '2026-11-15T08:00',
      planned_delivery_at: '2026-11-16T14:00',
      cargo_type: 'Makanan Kemasan',
      cargo_qty: '20 Palet',
      fleet_needed: 'Wingbox',
      transporter_id: newTrpId,
      message_text: order.message_text,
    },
  });
  assert.equal(staffEditActive.status, 403, '14b. Staff must be forbidden from editing non-draft order');

  const staffDeleteOrder = await req(`/api/orders/${order.id}`, {
    method: 'DELETE',
    cookie: staffCookie,
    body: { reason: 'Percobaan hapus oleh staff' },
  });
  assert.equal(staffDeleteOrder.status, 403, '14b. Staff must be forbidden from deleting orders');

  // 14c. Super Admin CAN edit active order while preserving its operational status
  const adminEditActive = await req(`/api/orders/${order.id}`, {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      customer_name: 'PT Maju Jaya FMCG (Revisi Admin)',
      service_type: 'Dedicated Charter',
      origin: 'Jakarta',
      origin_address: 'Kawasan Industri Pulogadung Blok A1',
      destination: 'Surabaya',
      destination_address: 'Pergudangan Margomulyo Blok C2',
      planned_pickup_at: '2026-11-15T09:30',
      planned_delivery_at: '2026-11-16T15:00',
      cargo_type: 'Makanan Kemasan',
      cargo_qty: '24 Palet',
      cargo_weight: '7 Ton',
      fleet_needed: 'Wingbox',
      special_notes: 'Revisi jumlah palet oleh Super Admin',
      transporter_id: newTrpId,
      whatsapp_number: '081234567890',
      message_text: order.message_text.replace('20 Palet', '24 Palet'),
      preserve_status: true,
    },
  });
  assert.equal(adminEditActive.status, 200, '14c. Super Admin can edit active order');
  assert.equal(
    adminEditActive.json.order.customer_name,
    'PT Maju Jaya FMCG (Revisi Admin)',
    '14c. Edited customer name persisted'
  );
  assert.equal(
    adminEditActive.json.order.status,
    'Sent (Manual Confirmation)',
    '14c. Editing active order preserves operational status'
  );

  // 14d. Super Admin CAN soft-delete order and it disappears from active lists
  const adminDeleteOrder = await req(`/api/orders/${order.id}`, {
    method: 'DELETE',
    cookie: adminCookie,
    body: { reason: 'Order uji selesai diverifikasi' },
  });
  assert.equal(adminDeleteOrder.status, 200, '14d. Super Admin can soft-delete order');

  const getDeletedOrder = await req(`/api/orders/${order.id}`, { cookie: adminCookie });
  assert.equal(getDeletedOrder.status, 404, '14d. Soft-deleted order is excluded from active GET /api/orders/:id');

  const ordersAfterDelete = await req('/api/orders', { cookie: adminCookie });
  assert.equal(
    ordersAfterDelete.json.orders.some((o: any) => o.id === order.id),
    false,
    '14d. Soft-deleted order is excluded from GET /api/orders list'
  );

  // 15. Historical KPI data must NOT change after creating/editing/deleting operational orders
  const afterOrderSummary = await req('/api/monitoring/summary', { cookie: staffCookie });
  assert.equal(afterOrderSummary.json.overview.total_orders, baselineTotalHistOrders, '15. Historical KPI total orders unchanged');
  assert.equal(afterOrderSummary.json.overview.avg_otd_pct, baselineOtdPct, '15. Historical KPI OTD unchanged');

  // 16. AHP weighting update works for Admin and recalculates scores
  const ahpUpdate = await req('/api/monitoring/ahp', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      name: 'Bobot Uji',
      matrix: [
        [1, 2, 3, 2, 4],
        [0.5, 1, 2, 1, 3],
        [0.3333, 0.5, 1, 0.5, 2],
        [0.5, 1, 2, 1, 3],
        [0.25, 0.3333, 0.5, 0.3333, 1],
      ],
    },
  });
  assert.equal(ahpUpdate.status, 200, '16. AHP assessment update succeeds');

  // 7. Admin can view other users' activity logs
  const logsRes = await req('/api/admin/activity-logs', { cookie: adminCookie });
  assert.equal(logsRes.status, 200);
  assert.ok(
    logsRes.json.logs.some((l: any) => l.username === 'budistaff' && l.activity_type === 'ORDER_CREATED'),
    '7. Admin can inspect staff activities in persistent activity logs'
  );

  // 8. Account deletion requires approval & uses soft delete
  const delReqRes = await req('/api/auth/request-deletion', {
    method: 'POST',
    cookie: staffCookie,
    body: { reason: 'Mutasi ke unit lain' },
  });
  assert.equal(delReqRes.status, 201, '8a. Staff can request account deletion');

  const delQueue = await req('/api/admin/deletion-requests', { cookie: adminCookie });
  const pendingDel = delQueue.json.requests.find((r: any) => r.username === 'budistaff' && r.status === 'pending');
  assert.ok(pendingDel, '8b. Deletion request appears in admin queue');

  const approveDel = await req(`/api/admin/deletion-requests/${pendingDel.id}/review`, {
    method: 'POST',
    cookie: adminCookie,
    body: { decision: 'approve', note: 'Disetujui sesuai mutasi' },
  });
  assert.equal(approveDel.status, 200, '8c. Admin approves soft-delete request');

  // Soft-deleted staff session is immediately invalidated
  const deletedStaffMe = await req('/api/auth/me', { cookie: staffCookie });
  assert.equal(deletedStaffMe.status, 401, 'Soft-deleted account cannot continue using old session');

  // 6. Logout ends admin session
  const logoutRes = await req('/api/auth/logout', { method: 'POST', cookie: adminCookie });
  assert.equal(logoutRes.status, 200, '6a. Logout succeeds');
  const afterLogoutMe = await req('/api/auth/me', { cookie: adminCookie });
  assert.equal(afterLogoutMe.status, 401, '6b. Revoked session cannot access protected endpoint after logout');

  console.log('ALL 16 VERIFICATION SCENARIOS PASSED SUCCESSFULLY!');
}

try {
  await runTests();
} finally {
  server.close();
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(testDbFile + ext)) fs.unlinkSync(testDbFile + ext);
  }
}
