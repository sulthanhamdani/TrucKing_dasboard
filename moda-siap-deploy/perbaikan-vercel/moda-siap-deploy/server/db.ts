import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { INIT_MIGRATION_SQL } from './migrationSql.ts';
import {
  ALLOWED_TEMPLATE_PLACEHOLDERS,
  DEFAULT_WHATSAPP_TEMPLATE,
} from '../shared/types.ts';

const DATA_DIR = process.env.VERCEL ? '/tmp/moda-data' : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.MODA_DB_PATH
  ? path.resolve(process.env.MODA_DB_PATH)
  : path.join(DATA_DIR, 'moda.db');
export const db = new DatabaseSync(DB_PATH);

// Enable foreign keys & WAL mode for reliable concurrency
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

export function runInTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback error if transaction already closed
    }
    throw err;
  }
}

export function initializeDatabase(): void {
  db.exec(INIT_MIGRATION_SQL);

  // Safe incremental migration for existing SQLite databases
  const orderCols = db.prepare(`PRAGMA table_info(orders)`).all() as Array<{ name: string }>;
  const colNames = new Set(orderCols.map((c) => c.name));
  if (!colNames.has('is_deleted')) {
    db.exec(`ALTER TABLE orders ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!colNames.has('deleted_at')) {
    db.exec(`ALTER TABLE orders ADD COLUMN deleted_at TEXT;`);
  }
  if (!colNames.has('deleted_by')) {
    db.exec(`ALTER TABLE orders ADD COLUMN deleted_by INTEGER REFERENCES users(id);`);
  }

  seedBaseData();
}

function seedBaseData(): void {
  // 1. Seed Roles
  const insertRole = db.prepare(`
    INSERT OR IGNORE INTO roles (code, name, description)
    VALUES (?, ?, ?)
  `);
  insertRole.run('admin', 'Super Admin', 'Hak akses penuh terhadap seluruh modul monitoring, operasional, dan administrasi.');
  insertRole.run('staff', 'Staff / Operator', 'Pengguna operasional Supply Management untuk monitoring, order, dan WhatsApp vendor.');
  insertRole.run('viewer', 'Viewer', 'Akses baca untuk dashboard monitoring kinerja, KPI, dan grafik AHP.');

  // 2. Seed Default WhatsApp Template if none exists
  const tplCount = db.prepare(`SELECT COUNT(*) as cnt FROM whatsapp_templates`).get() as { cnt: number };
  if (tplCount.cnt === 0) {
    db.prepare(`
      INSERT INTO whatsapp_templates (name, code, body, allowed_placeholders, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(
      'Permintaan Armada Standar MODA',
      'ORDER_REQUEST_DEFAULT',
      DEFAULT_WHATSAPP_TEMPLATE,
      JSON.stringify(ALLOWED_TEMPLATE_PLACEHOLDERS.map((p) => p.key))
    );
  }

  // 3. Seed Default AHP Weights if none exists
  const ahpCount = db.prepare(`SELECT COUNT(*) as cnt FROM ahp_assessments`).get() as { cnt: number };
  if (ahpCount.cnt === 0) {
    const defaultMatrix = [
      [1, 2, 3, 2, 4],
      [0.5, 1, 2, 1, 3],
      [0.3333, 0.5, 1, 0.5, 2],
      [0.5, 1, 2, 1, 3],
      [0.25, 0.3333, 0.5, 0.3333, 1],
    ];
    db.prepare(`
      INSERT INTO ahp_assessments (
        name, weight_otd, weight_completion, weight_lead_time, weight_claim, weight_capacity,
        consistency_ratio, pairwise_matrix, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      'Model Bobot AHP Standar Supply Management',
      0.36,
      0.22,
      0.13,
      0.21,
      0.08,
      0.015,
      JSON.stringify(defaultMatrix)
    );
  }

  // 4. Seed System Settings
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)
  `);
  insertSetting.run('company_name', 'MODA Supply Management');
  insertSetting.run('timezone', 'Asia/Jakarta');
  insertSetting.run('whatsapp_provider', 'click_to_chat');
  insertSetting.run('ahp_cr_threshold', '0.10');

  // 5. Seed Historical Shipments Dataset (Monitoring Module - isolated from operational orders)
  const histCount = db.prepare(`SELECT COUNT(*) as cnt FROM historical_shipments`).get() as { cnt: number };
  if (histCount.cnt === 0) {
    const historicalSeed: Array<[string, string, string, number, number, number, number, number, number, number, string, string]> = [
      // TRP-001 PT Nusantara Logistik Jaya
      ['TRP-001', 'PT Nusantara Logistik Jaya', '2026-05', 48, 47, 45, 2, 18.4, 0.4, 96.5, 'Jakarta - Surabaya', 'Wingbox'],
      ['TRP-001', 'PT Nusantara Logistik Jaya', '2026-06', 52, 51, 49, 2, 17.9, 0.2, 97.0, 'Jakarta - Surabaya', 'Wingbox'],
      ['TRP-001', 'PT Nusantara Logistik Jaya', '2026-07', 50, 50, 48, 2, 18.1, 0.0, 98.0, 'Jakarta - Semarang', 'Tronton'],
      ['TRP-001', 'PT Nusantara Logistik Jaya', '2026-08', 56, 55, 53, 2, 17.6, 0.3, 97.2, 'Jakarta - Surabaya', 'Wingbox'],
      ['TRP-001', 'PT Nusantara Logistik Jaya', '2026-09', 54, 53, 51, 2, 18.0, 0.2, 96.8, 'Jakarta - Bandung', 'CDD'],
      ['TRP-001', 'PT Nusantara Logistik Jaya', '2026-10', 60, 59, 57, 2, 17.4, 0.1, 98.4, 'Jakarta - Surabaya', 'Wingbox'],

      // TRP-002 PT Lintas Jawa Ekspress
      ['TRP-002', 'PT Lintas Jawa Ekspress', '2026-05', 42, 40, 36, 4, 21.5, 0.9, 91.0, 'Jakarta - Semarang', 'Fuso'],
      ['TRP-002', 'PT Lintas Jawa Ekspress', '2026-06', 45, 44, 40, 4, 20.8, 0.7, 92.5, 'Jakarta - Yogyakarta', 'Fuso'],
      ['TRP-002', 'PT Lintas Jawa Ekspress', '2026-07', 44, 42, 39, 3, 20.2, 0.6, 93.0, 'Surabaya - Malang', 'CDD'],
      ['TRP-002', 'PT Lintas Jawa Ekspress', '2026-08', 48, 46, 42, 4, 19.9, 0.8, 92.0, 'Jakarta - Semarang', 'Fuso'],
      ['TRP-002', 'PT Lintas Jawa Ekspress', '2026-09', 46, 45, 41, 4, 20.1, 0.5, 93.5, 'Jakarta - Surabaya', 'Tronton'],
      ['TRP-002', 'PT Lintas Jawa Ekspress', '2026-10', 50, 48, 45, 3, 19.5, 0.5, 94.2, 'Jakarta - Semarang', 'Fuso'],

      // TRP-003 PT Sentral Armada Nusantara
      ['TRP-003', 'PT Sentral Armada Nusantara', '2026-05', 38, 38, 37, 1, 16.5, 0.2, 95.8, 'Jakarta - Bandung', 'CDD'],
      ['TRP-003', 'PT Sentral Armada Nusantara', '2026-06', 40, 39, 38, 1, 16.2, 0.1, 96.4, 'Jakarta - Bandung', 'CDD'],
      ['TRP-003', 'PT Sentral Armada Nusantara', '2026-07', 42, 42, 40, 2, 16.8, 0.3, 95.5, 'Jakarta - Cikampek', 'CDE'],
      ['TRP-003', 'PT Sentral Armada Nusantara', '2026-08', 41, 40, 39, 1, 16.1, 0.2, 96.8, 'Jakarta - Bandung', 'CDD'],
      ['TRP-003', 'PT Sentral Armada Nusantara', '2026-09', 44, 43, 42, 1, 15.9, 0.0, 97.5, 'Jakarta - Cirebon', 'CDD'],
      ['TRP-003', 'PT Sentral Armada Nusantara', '2026-10', 46, 45, 44, 1, 15.7, 0.1, 98.1, 'Jakarta - Bandung', 'CDD'],

      // TRP-004 CV Karya Mandiri Trans
      ['TRP-004', 'CV Karya Mandiri Trans', '2026-05', 30, 27, 21, 6, 26.2, 1.8, 84.0, 'Surabaya - Bali', 'Fuso'],
      ['TRP-004', 'CV Karya Mandiri Trans', '2026-06', 32, 29, 23, 6, 25.8, 1.5, 85.5, 'Surabaya - Bali', 'Fuso'],
      ['TRP-004', 'CV Karya Mandiri Trans', '2026-07', 28, 26, 20, 6, 27.1, 2.0, 82.0, 'Surabaya - Makassar', 'Tronton'],
      ['TRP-004', 'CV Karya Mandiri Trans', '2026-08', 34, 31, 25, 6, 24.9, 1.4, 86.2, 'Surabaya - Bali', 'Fuso'],
      ['TRP-004', 'CV Karya Mandiri Trans', '2026-09', 31, 28, 23, 5, 25.0, 1.6, 85.0, 'Surabaya - Semarang', 'CDD'],
      ['TRP-004', 'CV Karya Mandiri Trans', '2026-10', 35, 32, 26, 6, 24.3, 1.3, 87.0, 'Surabaya - Bali', 'Fuso'],

      // TRP-005 PT Samudra Darat Cargo
      ['TRP-005', 'PT Samudra Darat Cargo', '2026-05', 36, 35, 31, 4, 22.8, 0.8, 90.0, 'Jakarta - Medan', 'Tronton'],
      ['TRP-005', 'PT Samudra Darat Cargo', '2026-06', 38, 36, 32, 4, 22.4, 0.9, 91.2, 'Jakarta - Palembang', 'Tronton'],
      ['TRP-005', 'PT Samudra Darat Cargo', '2026-07', 40, 38, 34, 4, 21.9, 0.7, 91.8, 'Jakarta - Medan', 'Trailer'],
      ['TRP-005', 'PT Samudra Darat Cargo', '2026-08', 39, 37, 34, 3, 21.5, 0.6, 92.5, 'Jakarta - Lampung', 'Tronton'],
      ['TRP-005', 'PT Samudra Darat Cargo', '2026-09', 42, 40, 36, 4, 21.2, 0.8, 92.0, 'Jakarta - Medan', 'Trailer'],
      ['TRP-005', 'PT Samudra Darat Cargo', '2026-10', 44, 42, 38, 4, 20.8, 0.5, 93.4, 'Jakarta - Palembang', 'Tronton'],

      // TRP-006 PT Bintang Timur Logistik
      ['TRP-006', 'PT Bintang Timur Logistik', '2026-05', 25, 24, 21, 3, 23.5, 1.0, 88.5, 'Surabaya - Makassar', 'Wingbox'],
      ['TRP-006', 'PT Bintang Timur Logistik', '2026-06', 26, 25, 22, 3, 22.9, 0.8, 89.2, 'Surabaya - Balikpapan', 'Wingbox'],
      ['TRP-006', 'PT Bintang Timur Logistik', '2026-07', 28, 26, 23, 3, 23.1, 0.9, 89.0, 'Surabaya - Makassar', 'Tronton'],
      ['TRP-006', 'PT Bintang Timur Logistik', '2026-08', 27, 26, 23, 3, 22.4, 0.7, 90.4, 'Surabaya - Balikpapan', 'Wingbox'],
      ['TRP-006', 'PT Bintang Timur Logistik', '2026-09', 29, 28, 25, 3, 21.8, 0.6, 91.0, 'Surabaya - Banjarmasin', 'Wingbox'],
      ['TRP-006', 'PT Bintang Timur Logistik', '2026-10', 30, 29, 26, 3, 21.5, 0.7, 91.6, 'Surabaya - Makassar', 'Wingbox'],

      // TRP-007 PT Garuda Kargo Pratama
      ['TRP-007', 'PT Garuda Kargo Pratama', '2026-05', 45, 44, 41, 3, 19.2, 0.4, 94.0, 'Jakarta - Surabaya', 'Trailer'],
      ['TRP-007', 'PT Garuda Kargo Pratama', '2026-06', 47, 46, 43, 3, 18.8, 0.3, 95.1, 'Jakarta - Semarang', 'Wingbox'],
      ['TRP-007', 'PT Garuda Kargo Pratama', '2026-07', 49, 48, 46, 2, 18.5, 0.2, 95.8, 'Jakarta - Surabaya', 'Trailer'],
      ['TRP-007', 'PT Garuda Kargo Pratama', '2026-08', 48, 47, 44, 3, 18.9, 0.4, 94.6, 'Jakarta - Surabaya', 'Wingbox'],
      ['TRP-007', 'PT Garuda Kargo Pratama', '2026-09', 51, 50, 48, 2, 18.2, 0.3, 96.0, 'Jakarta - Semarang', 'Trailer'],
      ['TRP-007', 'PT Garuda Kargo Pratama', '2026-10', 53, 52, 50, 2, 17.9, 0.2, 96.5, 'Jakarta - Surabaya', 'Wingbox'],

      // TRP-008 PT Mitra Distribusi Utama
      ['TRP-008', 'PT Mitra Distribusi Utama', '2026-05', 33, 30, 25, 5, 24.4, 1.3, 86.5, 'Jakarta - Lampung', 'Fuso'],
      ['TRP-008', 'PT Mitra Distribusi Utama', '2026-06', 34, 31, 26, 5, 23.9, 1.2, 87.2, 'Jakarta - Palembang', 'Fuso'],
      ['TRP-008', 'PT Mitra Distribusi Utama', '2026-07', 36, 33, 28, 5, 23.5, 1.1, 88.0, 'Jakarta - Lampung', 'CDD'],
      ['TRP-008', 'PT Mitra Distribusi Utama', '2026-08', 35, 33, 29, 4, 22.8, 0.9, 89.5, 'Jakarta - Palembang', 'Fuso'],
      ['TRP-008', 'PT Mitra Distribusi Utama', '2026-09', 38, 36, 31, 5, 22.6, 1.0, 89.0, 'Jakarta - Lampung', 'Fuso'],
      ['TRP-008', 'PT Mitra Distribusi Utama', '2026-10', 40, 38, 34, 4, 21.9, 0.8, 90.2, 'Jakarta - Palembang', 'Fuso'],
    ];

    const insertHist = db.prepare(`
      INSERT INTO historical_shipments (
        transporter_code, transporter_name, period_month, total_orders, completed_orders,
        on_time_orders, late_orders, avg_lead_time_hours, claim_rate_pct,
        capacity_fulfillment_pct, route_corridor, fleet_category
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of historicalSeed) {
      insertHist.run(...row);
    }
  }

  // 6. Seed Master Transporters matching baseline vendors (operational master data)
  const trpCount = db.prepare(`SELECT COUNT(*) as cnt FROM transporters`).get() as { cnt: number };
  if (trpCount.cnt === 0) {
    const masterSeed = [
      {
        code: 'TRP-001',
        company_name: 'PT Nusantara Logistik Jaya',
        pic_name: 'Hendra Wijaya',
        phone: '021-5501188',
        whatsapp_raw: '081234567801',
        whatsapp_normalized: '6281234567801',
        email: 'dispatch@nusantaralogistik.co.id',
        address: 'Jl. Raya Cakung Cilincing Km 4, Jakarta Utara',
        fleet_types: ['Wingbox', 'Tronton', 'CDD'],
        service_routes: 'Jakarta - Surabaya, Jakarta - Semarang, Jakarta - Bandung',
        notes: 'Vendor utama koridor Jawa dengan armada Wingbox GPS-tracked.',
      },
      {
        code: 'TRP-002',
        company_name: 'PT Lintas Jawa Ekspress',
        pic_name: 'Budi Santoso',
        phone: '021-5502299',
        whatsapp_raw: '081234567802',
        whatsapp_normalized: '6281234567802',
        email: 'ops@lintasjawa.id',
        address: 'Jl. Industri Raya Blok B-12, Bekasi',
        fleet_types: ['Fuso', 'CDD', 'Tronton'],
        service_routes: 'Jakarta - Semarang, Jakarta - Yogyakarta, Surabaya - Malang',
        notes: 'Spesialis distribusi Jawa Tengah dan Jawa Timur.',
      },
      {
        code: 'TRP-003',
        company_name: 'PT Sentral Armada Nusantara',
        pic_name: 'Rina Kusuma',
        phone: '022-7804411',
        whatsapp_raw: '081234567803',
        whatsapp_normalized: '6281234567803',
        email: 'booking@sentralarmada.co.id',
        address: 'Jl. Soekarno Hatta No. 412, Bandung',
        fleet_types: ['CDD', 'CDE', 'Box'],
        service_routes: 'Jakarta - Bandung, Jakarta - Cikampek, Jakarta - Cirebon',
        notes: 'Fast response untuk pengiriman Jabodetabek & Jawa Barat.',
      },
      {
        code: 'TRP-004',
        company_name: 'CV Karya Mandiri Trans',
        pic_name: 'Agus Setiawan',
        phone: '031-8407722',
        whatsapp_raw: '081234567804',
        whatsapp_normalized: '6281234567804',
        email: 'admin@karyamandiritrans.id',
        address: 'Jl. Margomulyo Indah No. 28, Surabaya',
        fleet_types: ['Fuso', 'Tronton', 'CDD'],
        service_routes: 'Surabaya - Bali, Surabaya - Semarang, Surabaya - Makassar',
        notes: 'Armada lintas Jawa-Bali dan konsolidasi pelabuhan.',
      },
      {
        code: 'TRP-005',
        company_name: 'PT Samudra Darat Cargo',
        pic_name: 'Dedi Kurniawan',
        phone: '021-4409933',
        whatsapp_raw: '081234567805',
        whatsapp_normalized: '6281234567805',
        email: 'order@samudradarat.co.id',
        address: 'Jl. Yos Sudarso Kav. 88, Jakarta Utara',
        fleet_types: ['Tronton', 'Trailer', 'Wingbox'],
        service_routes: 'Jakarta - Medan, Jakarta - Palembang, Jakarta - Lampung',
        notes: 'Fokus rute lintas Sumatera dengan unit heavy duty.',
      },
      {
        code: 'TRP-006',
        company_name: 'PT Bintang Timur Logistik',
        pic_name: 'Siti Rahmawati',
        phone: '031-7508811',
        whatsapp_raw: '081234567806',
        whatsapp_normalized: '6281234567806',
        email: 'cs@bintangtimurlog.id',
        address: 'Jl. Perak Barat No. 105, Surabaya',
        fleet_types: ['Wingbox', 'Tronton'],
        service_routes: 'Surabaya - Makassar, Surabaya - Balikpapan, Surabaya - Banjarmasin',
        notes: 'Dukungan multimoda darat & RORO ke Kalimantan/Sulawesi.',
      },
      {
        code: 'TRP-007',
        company_name: 'PT Garuda Kargo Pratama',
        pic_name: 'Fajar Nugroho',
        phone: '021-8906655',
        whatsapp_raw: '081234567807',
        whatsapp_normalized: '6281234567807',
        email: 'fleet@garudakargo.co.id',
        address: 'Kawasan Industri Jababeka Tahap II, Cikarang',
        fleet_types: ['Trailer', 'Wingbox'],
        service_routes: 'Jakarta - Surabaya, Jakarta - Semarang',
        notes: 'Kontrak armada dedicated untuk muatan FMCG dan manufaktur.',
      },
      {
        code: 'TRP-008',
        company_name: 'PT Mitra Distribusi Utama',
        pic_name: 'Wahyu Pratama',
        phone: '021-6603344',
        whatsapp_raw: '081234567808',
        whatsapp_normalized: '6281234567808',
        email: 'dispatch@mitradistribusi.id',
        address: 'Jl. Daan Mogot Km 14, Jakarta Barat',
        fleet_types: ['Fuso', 'CDD'],
        service_routes: 'Jakarta - Lampung, Jakarta - Palembang',
        notes: 'Pengiriman reguler rute Sumatera bagian selatan.',
      },
    ];

    const insertTrp = db.prepare(`
      INSERT INTO transporters (
        code, company_name, pic_name, phone, whatsapp_raw, whatsapp_normalized,
        email, address, fleet_types, service_routes, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?)
    `);
    const insertContact = db.prepare(`
      INSERT INTO transporter_contacts (
        transporter_id, contact_name, role_title, phone, whatsapp_raw, whatsapp_normalized, is_primary
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of masterSeed) {
      const info = insertTrp.run(
        item.code,
        item.company_name,
        item.pic_name,
        item.phone,
        item.whatsapp_raw,
        item.whatsapp_normalized,
        item.email,
        item.address,
        JSON.stringify(item.fleet_types),
        item.service_routes,
        item.notes
      );
      insertContact.run(
        Number(info.lastInsertRowid),
        item.pic_name,
        'PIC Dispatch Utama',
        item.phone,
        item.whatsapp_raw,
        item.whatsapp_normalized,
        1
      );
    }
  }

  // 7. Optional Env-Based First Admin Bootstrap (never hardcoded credentials in source code)
  const adminCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE r.code = 'admin' AND u.is_deleted = 0
  `).get() as { cnt: number };

  if (adminCount.cnt === 0) {
    const envUser = process.env.ADMIN_BOOTSTRAP_USERNAME?.trim();
    const envEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim();
    const envPass = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim();
    const envName = process.env.ADMIN_BOOTSTRAP_FULL_NAME?.trim() || 'Super Administrator';

    if (envUser && envEmail && envPass && envPass.length >= 8) {
      const adminRole = db.prepare(`SELECT id FROM roles WHERE code = 'admin'`).get() as { id: number };
      const hash = bcrypt.hashSync(envPass, 12);
      db.prepare(`
        INSERT INTO users (
          full_name, username, email, password_hash, division, requested_role, role_id, status
        ) VALUES (?, ?, ?, ?, 'Supply Management', 'admin', ?, 'active')
      `).run(envName, envUser.toLowerCase(), envEmail.toLowerCase(), hash, adminRole.id);

      db.prepare(`
        INSERT INTO activity_logs (user_id, username, user_role, activity_type, detail, status)
        VALUES (NULL, ?, 'admin', 'BOOTSTRAP_ADMIN', 'Akun Super Admin awal dibuat melalui environment bootstrap.', 'success')
      `).run(envUser.toLowerCase());
    }
  }
}
