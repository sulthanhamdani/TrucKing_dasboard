export type RoleCode = 'admin' | 'staff' | 'viewer';

export type UserStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'deleted';

export type OrderStatus =
  | 'Draft'
  | 'Ready to Send'
  | 'WhatsApp Opened'
  | 'Sent (Manual Confirmation)'
  | 'Accepted'
  | 'Rejected'
  | 'Cancelled'
  | 'In Progress'
  | 'Completed';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'Draft',
  'Ready to Send',
  'WhatsApp Opened',
  'Sent (Manual Confirmation)',
  'Accepted',
  'Rejected',
  'Cancelled',
  'In Progress',
  'Completed',
] as const;

export const ALLOWED_TEMPLATE_PLACEHOLDERS: readonly { key: string; label: string; description: string }[] = [
  { key: 'nama_pic', label: 'Nama PIC', description: 'Nama kontak PIC transporter' },
  { key: 'nama_transporter', label: 'Nama Transporter', description: 'Nama perusahaan vendor transporter' },
  { key: 'nomor_order', label: 'Nomor Order', description: 'Nomor unik order pengiriman' },
  { key: 'nama_customer', label: 'Nama Customer', description: 'Nama pelanggan / pengirim' },
  { key: 'jenis_layanan', label: 'Jenis Layanan', description: 'Jenis layanan pengiriman' },
  { key: 'origin', label: 'Origin', description: 'Kota / lokasi asal muat' },
  { key: 'alamat_muat', label: 'Alamat Muat', description: 'Alamat lengkap lokasi muat' },
  { key: 'destination', label: 'Destination', description: 'Kota / lokasi tujuan bongkar' },
  { key: 'alamat_bongkar', label: 'Alamat Bongkar', description: 'Alamat lengkap lokasi bongkar' },
  { key: 'tanggal_jam_muat', label: 'Rencana Muat', description: 'Tanggal dan jam rencana muat' },
  { key: 'tanggal_jam_bongkar', label: 'Rencana Bongkar', description: 'Tanggal dan jam rencana bongkar' },
  { key: 'jenis_armada', label: 'Jenis Armada', description: 'Tipe truk / armada yang dibutuhkan' },
  { key: 'jenis_barang', label: 'Jenis Barang', description: 'Jenis muatan / kargo' },
  { key: 'jumlah_barang', label: 'Jumlah Barang', description: 'Jumlah koli / unit barang' },
  { key: 'berat_barang', label: 'Berat Barang', description: 'Estimasi berat barang' },
  { key: 'informasi_biaya', label: 'Informasi Biaya', description: 'Rate / biaya pengiriman jika diisi' },
  { key: 'catatan', label: 'Catatan', description: 'Instruksi atau catatan khusus' },
  { key: 'dibuat_oleh', label: 'Dibuat Oleh', description: 'Nama pembuat order' },
];

export const DEFAULT_WHATSAPP_TEMPLATE = `*PERMINTAAN ARMADA — MODA*

Selamat pagi/siang/sore, Bapak/Ibu {{nama_pic}} dari {{nama_transporter}}.

Kami dari MODA ingin mengajukan permintaan armada dengan rincian berikut:

*Nomor Order:* {{nomor_order}}

*Customer:* {{nama_customer}}

*Origin:* {{origin}}

*Lokasi Muat:* {{alamat_muat}}

*Destination:* {{destination}}

*Lokasi Bongkar:* {{alamat_bongkar}}

*Rencana Muat:* {{tanggal_jam_muat}}

*Rencana Bongkar:* {{tanggal_jam_bongkar}}

*Jenis Armada:* {{jenis_armada}}

*Jenis Barang:* {{jenis_barang}}

*Jumlah Barang:* {{jumlah_barang}}

*Berat:* {{berat_barang}}

*Catatan:* {{catatan}}

Mohon konfirmasi ketersediaan armada untuk kebutuhan tersebut.

Terima kasih.

*Supply Management — MODA*`;

export interface AuthUser {
  id: number;
  full_name: string;
  username: string;
  email: string;
  division: string;
  role: RoleCode;
  role_name: string;
  status: UserStatus;
  created_at: string;
  last_login_at: string | null;
}

export interface UserRecord extends AuthUser {
  requested_role: RoleCode;
  rejection_reason: string | null;
  is_deleted: number;
  pending_deletion_id: number | null;
  pending_deletion_reason: string | null;
}

export interface TransporterContact {
  id: number;
  transporter_id: number;
  contact_name: string;
  role_title: string;
  phone: string;
  whatsapp_raw: string;
  whatsapp_normalized: string;
  is_primary: number;
  created_at: string;
}

export interface TransporterRecord {
  id: number;
  code: string;
  company_name: string;
  pic_name: string;
  phone: string;
  whatsapp_raw: string;
  whatsapp_normalized: string;
  email: string | null;
  address: string | null;
  fleet_types: string[];
  service_routes: string | null;
  status: 'Active' | 'Inactive';
  notes: string | null;
  created_at: string;
  updated_at: string;
  contacts?: TransporterContact[];
}

export interface OrderRecord {
  id: number;
  order_number: string;
  created_by: number;
  created_by_name: string;
  customer_name: string;
  service_type: string;
  origin: string;
  origin_address: string;
  destination: string;
  destination_address: string;
  planned_pickup_at: string;
  planned_delivery_at: string;
  cargo_type: string;
  cargo_qty: string;
  cargo_weight: string | null;
  fleet_needed: string;
  special_notes: string | null;
  transporter_id: number;
  transporter_name: string;
  contact_id: number | null;
  pic_name: string;
  whatsapp_number: string;
  rate_info: string | null;
  message_text: string;
  status: OrderStatus;
  whatsapp_opened_at: string | null;
  manual_sent_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderStatusHistoryRecord {
  id: number;
  order_id: number;
  from_status: string | null;
  to_status: string;
  changed_by: number;
  changed_by_name: string;
  note: string | null;
  created_at: string;
}

export interface WhatsAppTemplateRecord {
  id: number;
  name: string;
  code: string;
  body: string;
  allowed_placeholders: string[];
  is_active: number;
  updated_by: number | null;
  updated_at: string;
  created_at: string;
}

export interface ActivityLogRecord {
  id: number;
  user_id: number | null;
  username: string;
  user_role: string;
  activity_type: string;
  detail: string;
  status: 'success' | 'failure' | 'info';
  ip_address: string | null;
  created_at: string;
}

export interface AhpAssessment {
  id: number;
  name: string;
  weight_otd: number;
  weight_completion: number;
  weight_lead_time: number;
  weight_claim: number;
  weight_capacity: number;
  consistency_ratio: number;
  pairwise_matrix: number[][];
  is_active: number;
  created_at: string;
}

export interface TransporterKpiSummary {
  transporter_code: string;
  transporter_name: string;
  total_orders: number;
  completed_orders: number;
  on_time_orders: number;
  late_orders: number;
  otd_pct: number;
  completion_pct: number;
  avg_lead_time_hours: number;
  claim_rate_pct: number;
  capacity_fulfillment_pct: number;
  ahp_score: number;
  corridors: string[];
  fleets: string[];
}
