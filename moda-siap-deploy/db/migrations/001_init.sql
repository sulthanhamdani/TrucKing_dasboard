-- MODA Transporter Management System
-- Relational Database Schema (SQLite / PostgreSQL-compatible design)

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  division TEXT NOT NULL,
  requested_role TEXT NOT NULL DEFAULT 'staff',
  role_id INTEGER NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(identifier, ip_address)
);

CREATE TABLE IF NOT EXISTS account_approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  requested_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS transporters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  pic_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  whatsapp_raw TEXT NOT NULL,
  whatsapp_normalized TEXT NOT NULL,
  email TEXT,
  address TEXT,
  fleet_types TEXT NOT NULL DEFAULT '[]',
  service_routes TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  notes TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transporter_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transporter_id INTEGER NOT NULL REFERENCES transporters(id),
  contact_name TEXT NOT NULL,
  role_title TEXT NOT NULL DEFAULT 'PIC Operasional',
  phone TEXT NOT NULL,
  whatsapp_raw TEXT NOT NULL,
  whatsapp_normalized TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_by_name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  origin TEXT NOT NULL,
  origin_address TEXT NOT NULL,
  destination TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  planned_pickup_at TEXT NOT NULL,
  planned_delivery_at TEXT NOT NULL,
  cargo_type TEXT NOT NULL,
  cargo_qty TEXT NOT NULL,
  cargo_weight TEXT,
  fleet_needed TEXT NOT NULL,
  special_notes TEXT,
  transporter_id INTEGER NOT NULL REFERENCES transporters(id),
  transporter_name TEXT NOT NULL,
  contact_id INTEGER REFERENCES transporter_contacts(id),
  pic_name TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL,
  rate_info TEXT,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Ready to Send',
  whatsapp_opened_at TEXT,
  manual_sent_confirmed_at TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  changed_by_name TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  allowed_placeholders TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  username TEXT NOT NULL,
  user_role TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ahp_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  weight_otd REAL NOT NULL,
  weight_completion REAL NOT NULL,
  weight_lead_time REAL NOT NULL,
  weight_claim REAL NOT NULL,
  weight_capacity REAL NOT NULL,
  consistency_ratio REAL NOT NULL,
  pairwise_matrix TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dedicated Monitoring Historical Dataset (Isolated from Operational Orders)
CREATE TABLE IF NOT EXISTS historical_shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transporter_code TEXT NOT NULL,
  transporter_name TEXT NOT NULL,
  period_month TEXT NOT NULL,
  total_orders INTEGER NOT NULL,
  completed_orders INTEGER NOT NULL,
  on_time_orders INTEGER NOT NULL,
  late_orders INTEGER NOT NULL,
  avg_lead_time_hours REAL NOT NULL,
  claim_rate_pct REAL NOT NULL,
  capacity_fulfillment_pct REAL NOT NULL,
  route_corridor TEXT NOT NULL,
  fleet_category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_transporter ON orders(transporter_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_historical_transporter ON historical_shipments(transporter_code, period_month);
