import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Eye,
  FilePlus2,
  MessageCircle,
  Plus,
  Power,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, ApiError, formatWib } from '../lib/api.ts';
import { normalizeWhatsAppNumber } from '../../shared/whatsapp.ts';
import { StatusIndicator } from '../components/StatusIndicator.tsx';
import type { RoleCode, TransporterKpiSummary, TransporterRecord } from '../../shared/types.ts';

interface TransporterListResponse {
  transporters: TransporterRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface TransporterDetailResponse {
  transporter: TransporterRecord;
  hasHistoricalData: boolean;
  historicalSummary: TransporterKpiSummary | null;
  operationalOrders: Array<{
    id: number;
    order_number: string;
    customer_name: string;
    origin: string;
    destination: string;
    planned_pickup_at: string;
    status: string;
    created_by_name: string;
    created_at: string;
  }>;
}

const FLEET_OPTIONS = ['CDE', 'CDD', 'Fuso', 'Wingbox', 'Tronton', 'Trailer', 'Box', 'Pickup'];

export function TransporterPage({
  userRole,
  onCreateOrderForTransporter,
}: {
  userRole: RoleCode;
  onCreateOrderForTransporter: (transporterId: number) => void;
}) {
  const [items, setItems] = useState<TransporterRecord[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fleetFilter, setFleetFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Add/Edit Modal State
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [picName, setPicName] = useState('');
  const [phone, setPhone] = useState('');
  const [waRaw, setWaRaw] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [selectedFleets, setSelectedFleets] = useState<string[]>(['CDD']);
  const [serviceRoutes, setServiceRoutes] = useState('');
  const [trpStatus, setTrpStatus] = useState<'Active' | 'Inactive'>('Active');
  const [notes, setNotes] = useState('');
  const [extraContacts, setExtraContacts] = useState<
    Array<{ contact_name: string; role_title: string; phone: string; whatsapp_raw: string }>
  >([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Detail Modal State
  const [detailData, setDetailData] = useState<TransporterDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadTransporters = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        search,
        status: statusFilter,
        fleet: fleetFilter,
        page: String(page),
        pageSize: '10',
      });
      const res = await apiFetch<TransporterListResponse>(`/api/transporters?${qs.toString()}`);
      setItems(res.transporters);
      setPagination(res.pagination);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memuat daftar transporter.',
      });
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, fleetFilter, page]);

  useEffect(() => {
    loadTransporters();
  }, [loadTransporters]);

  function openAddModal() {
    setEditingId(null);
    setCompanyName('');
    setPicName('');
    setPhone('');
    setWaRaw('');
    setEmail('');
    setAddress('');
    setSelectedFleets(['CDD']);
    setServiceRoutes('');
    setTrpStatus('Active');
    setNotes('');
    setExtraContacts([]);
    setFormError(null);
    setFormOpen(true);
  }

  function openEditModal(t: TransporterRecord) {
    setEditingId(t.id);
    setCompanyName(t.company_name);
    setPicName(t.pic_name);
    setPhone(t.phone);
    setWaRaw(t.whatsapp_raw);
    setEmail(t.email || '');
    setAddress(t.address || '');
    setSelectedFleets(t.fleet_types.length > 0 ? t.fleet_types : ['CDD']);
    setServiceRoutes(t.service_routes || '');
    setTrpStatus(t.status);
    setNotes(t.notes || '');
    setExtraContacts(
      (t.contacts || [])
        .filter((c) => c.is_primary === 0)
        .map((c) => ({
          contact_name: c.contact_name,
          role_title: c.role_title,
          phone: c.phone,
          whatsapp_raw: c.whatsapp_raw,
        }))
    );
    setFormError(null);
    setFormOpen(true);
  }

  async function openDetailModal(id: number) {
    setDetailLoading(true);
    setDetailData(null);
    try {
      const res = await apiFetch<TransporterDetailResponse>(`/api/transporters/${id}`);
      setDetailData(res);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memuat detail transporter.',
      });
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleSaveTransporter(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const waValidation = normalizeWhatsAppNumber(waRaw);
    if (!waValidation.valid) {
      setFormError(waValidation.error || 'Nomor WhatsApp tidak valid.');
      return;
    }
    if (selectedFleets.length === 0) {
      setFormError('Pilih minimal 1 jenis armada yang tersedia.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        company_name: companyName,
        pic_name: picName,
        phone,
        whatsapp_raw: waRaw,
        email,
        address,
        fleet_types: selectedFleets,
        service_routes: serviceRoutes,
        status: trpStatus,
        notes,
        extra_contacts: extraContacts,
      };
      if (editingId) {
        const res = await apiFetch<{ message: string }>(`/api/transporters/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setFeedback({ type: 'ok', text: res.message });
      } else {
        const res = await apiFetch<{ message: string }>('/api/transporters', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setFeedback({ type: 'ok', text: res.message });
      }
      setFormOpen(false);
      await loadTransporters();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Gagal menyimpan transporter.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(t: TransporterRecord) {
    const nextStatus = t.status === 'Active' ? 'Inactive' : 'Active';
    try {
      const res = await apiFetch<{ message: string }>(`/api/transporters/${t.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setFeedback({ type: 'ok', text: res.message });
      await loadTransporters();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memperbarui status transporter.',
      });
    }
  }

  const waPreview = normalizeWhatsAppNumber(waRaw);

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          <span className="flex items-center gap-2">
            {feedback.type === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            {feedback.text}
          </span>
          <button type="button" onClick={() => setFeedback(null)} className="text-slate-500 hover:text-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari kode, nama vendor, PIC, rute..."
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-xs focus:border-emerald-700 focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
          >
            <option value="all">Semua Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          <select
            value={fleetFilter}
            onChange={(e) => {
              setFleetFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
          >
            <option value="all">Semua Armada</option>
            {FLEET_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        {userRole === 'admin' && (
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F2A24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163C33] transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Add Transporter
          </button>
        )}
      </div>

      {/* Transporter Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-3 px-4">ID</th>
                <th className="py-3 px-4">Perusahaan Transporter</th>
                <th className="py-3 px-4">PIC &amp; WhatsApp</th>
                <th className="py-3 px-4">Armada</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    Memuat data transporter...
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">{t.code}</td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{t.company_name}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[260px]">
                        {t.service_routes || 'Rute belum dicatat'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{t.pic_name}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        +{t.whatsapp_normalized} &middot; {t.phone}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">{t.fleet_types.join(', ')}</td>
                    <td className="py-3 px-4">
                      <StatusIndicator status={t.status} />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => openDetailModal(t.id)}
                          title="View Details"
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Details
                        </button>
                        {userRole !== 'viewer' && (
                          <a
                            href={`https://wa.me/${t.whatsapp_normalized}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Contact via WhatsApp"
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            WhatsApp
                          </a>
                        )}
                        {userRole !== 'viewer' && t.status === 'Active' && (
                          <button
                            type="button"
                            onClick={() => onCreateOrderForTransporter(t.id)}
                            className="inline-flex items-center gap-1 rounded-md bg-[#0F2A24] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#163C33]"
                          >
                            <FilePlus2 className="h-3.5 w-3.5" />
                            Order
                          </button>
                        )}
                        {userRole === 'admin' && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(t)}
                              title="Edit Transporter"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(t)}
                              title={t.status === 'Active' ? 'Disable Transporter' : 'Activate Transporter'}
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${
                                t.status === 'Active'
                                  ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                                  : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                              }`}
                            >
                              <Power className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-xs text-slate-500">
                    Tidak ada transporter ditemukan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
          <span className="tabular-nums">
            Total {pagination.total} transporter &middot; Halaman {pagination.page} dari {pagination.totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 hover:bg-slate-50"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 hover:bg-slate-50"
            >
              Berikutnya
            </button>
          </div>
        </div>
      </div>

      {/* Add / Edit Transporter Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white border border-slate-200 p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingId ? 'Edit Data Transporter' : 'Tambah Transporter Baru'}
              </h3>
              <button type="button" onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveTransporter} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nama Perusahaan Transporter *</label>
                  <input
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="PT Contoh Logistik"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Status Kerja Sama *</label>
                  <select
                    value={trpStatus}
                    onChange={(e) => setTrpStatus(e.target.value as 'Active' | 'Inactive')}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nama PIC Utama *</label>
                  <input
                    type="text"
                    required
                    value={picName}
                    onChange={(e) => setPicName(e.target.value)}
                    placeholder="Nama PIC"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nomor Telepon PIC *</label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="021-5501122 / 0812..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Nomor WhatsApp PIC *</label>
                  <input
                    type="text"
                    required
                    value={waRaw}
                    onChange={(e) => setWaRaw(e.target.value)}
                    placeholder="081234567890 / 62812..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                  />
                  {waRaw && (
                    <div className={`mt-1 text-[11px] ${waPreview.valid ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {waPreview.valid
                        ? `Format Click-to-Chat: ${waPreview.normalized}`
                        : waPreview.error}
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Catatan: Validasi format nomor WhatsApp (08... / 628...) tidak membuktikan nomor terdaftar aktif di aplikasi WhatsApp.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Email (Opsional)</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ops@vendor.co.id"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Rute Pelayanan (Opsional)</label>
                  <input
                    type="text"
                    value={serviceRoutes}
                    onChange={(e) => setServiceRoutes(e.target.value)}
                    placeholder="Jakarta - Surabaya, Jakarta - Semarang"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Alamat Perusahaan (Opsional)</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Alamat pool atau kantor operasional"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1.5">Jenis Armada Tersedia *</label>
                <div className="flex flex-wrap gap-2">
                  {FLEET_OPTIONS.map((f) => {
                    const checked = selectedFleets.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() =>
                          setSelectedFleets((prev) =>
                            checked ? prev.filter((x) => x !== f) : [...prev, f]
                          )
                        }
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                          checked
                            ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {f}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Additional PIC Contacts */}
              <div className="border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-slate-800">Kontak PIC Tambahan (Opsional)</span>
                  <button
                    type="button"
                    onClick={() =>
                      setExtraContacts((prev) => [
                        ...prev,
                        { contact_name: '', role_title: 'PIC Dispatch', phone: '', whatsapp_raw: '' },
                      ])
                    }
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" /> Tambah Kontak
                  </button>
                </div>
                {extraContacts.map((ec, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-2 items-center">
                    <input
                      type="text"
                      placeholder="Nama PIC"
                      value={ec.contact_name}
                      onChange={(e) => {
                        const val = e.target.value;
                        setExtraContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, contact_name: val } : c)));
                      }}
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="text"
                      placeholder="Jabatan"
                      value={ec.role_title}
                      onChange={(e) => {
                        const val = e.target.value;
                        setExtraContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, role_title: val } : c)));
                      }}
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="text"
                      placeholder="WhatsApp (08...)"
                      value={ec.whatsapp_raw}
                      onChange={(e) => {
                        const val = e.target.value;
                        setExtraContacts((prev) =>
                          prev.map((c, i) => (i === idx ? { ...c, whatsapp_raw: val, phone: val } : c))
                        );
                      }}
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setExtraContacts((prev) => prev.filter((_, i) => i !== idx))}
                      className="inline-flex items-center justify-center rounded-lg border border-rose-200 px-2.5 py-1.5 text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Catatan Tambahan</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#0F2A24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163C33] disabled:opacity-50"
                >
                  {saving ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Simpan Transporter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {(detailLoading || detailData) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white border border-slate-200 p-6">
            {detailLoading && <div className="py-10 text-center text-xs text-slate-500">Memuat profil transporter...</div>}
            {detailData && (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <div className="text-xs font-mono text-slate-500">{detailData.transporter.code}</div>
                    <h3 className="text-lg font-bold text-slate-900">{detailData.transporter.company_name}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <StatusIndicator status={detailData.transporter.status} />
                      <span className="text-xs text-slate-500">
                        Armada: {detailData.transporter.fleet_types.join(', ')}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailData(null)}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Master Contact Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-slate-500">PIC Utama</div>
                    <div className="font-semibold text-slate-900">{detailData.transporter.pic_name}</div>
                    <div className="font-mono text-slate-600">
                      WA: +{detailData.transporter.whatsapp_normalized} &middot; Telp: {detailData.transporter.phone}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Email &amp; Rute</div>
                    <div className="font-medium text-slate-900">{detailData.transporter.email || '-'}</div>
                    <div className="text-slate-600">{detailData.transporter.service_routes || '-'}</div>
                  </div>
                </div>

                {/* Monitoring Historical Performance */}
                <div className="border-t border-slate-200 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-slate-900">Rekam Jejak Monitoring Historis (KPI &amp; AHP)</h4>
                    <span className="text-[11px] text-slate-500">Sumber: Dataset Evaluasi Historis</span>
                  </div>
                  {detailData.hasHistoricalData && detailData.historicalSummary ? (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                      <div className="rounded-lg border border-slate-200 p-3">
                        <div className="text-slate-500">Total Order</div>
                        <div className="mt-1 text-base font-bold font-mono tabular-nums">
                          {detailData.historicalSummary.total_orders}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-3">
                        <div className="text-slate-500">Completed</div>
                        <div className="mt-1 text-base font-bold font-mono tabular-nums">
                          {detailData.historicalSummary.completed_orders}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-3">
                        <div className="text-slate-500">On-Time</div>
                        <div className="mt-1 text-base font-bold font-mono tabular-nums text-emerald-700">
                          {detailData.historicalSummary.on_time_orders} ({detailData.historicalSummary.otd_pct}%)
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-3">
                        <div className="text-slate-500">Late Delivery</div>
                        <div className="mt-1 text-base font-bold font-mono tabular-nums text-rose-700">
                          {detailData.historicalSummary.late_orders}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-3">
                        <div className="text-slate-500">Skor AHP</div>
                        <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900">
                          {detailData.historicalSummary.ahp_score}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                      Belum Ada Data Historis. Transporter baru ini belum tercatat dalam dataset evaluasi KPI historis.
                    </div>
                  )}
                </div>

                {/* Operational Orders (Hidden for Viewer) */}
                {userRole !== 'viewer' && (
                  <div className="border-t border-slate-200 pt-4">
                    <h4 className="text-sm font-bold text-slate-900 mb-2">
                      Riwayat Order Operasional Terbaru (Terpisah dari KPI Historis)
                    </h4>
                    {detailData.operationalOrders.length === 0 ? (
                      <p className="text-xs text-slate-500">Belum ada order operasional yang dikirimkan ke vendor ini.</p>
                    ) : (
                      <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                              <th className="py-2 px-3">Order ID</th>
                              <th className="py-2 px-3">Customer</th>
                              <th className="py-2 px-3">Rute</th>
                              <th className="py-2 px-3">Status</th>
                              <th className="py-2 px-3">Dibuat</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {detailData.operationalOrders.map((ord) => (
                              <tr key={ord.id}>
                                <td className="py-2 px-3 font-mono">{ord.order_number}</td>
                                <td className="py-2 px-3">{ord.customer_name}</td>
                                <td className="py-2 px-3">
                                  {ord.origin} &rarr; {ord.destination}
                                </td>
                                <td className="py-2 px-3">
                                  <StatusIndicator status={ord.status} />
                                </td>
                                <td className="py-2 px-3 text-slate-500">{formatWib(ord.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                  {userRole !== 'viewer' && detailData.transporter.status === 'Active' && (
                    <button
                      type="button"
                      onClick={() => {
                        const tid = detailData.transporter.id;
                        setDetailData(null);
                        onCreateOrderForTransporter(tid);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F2A24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163C33]"
                    >
                      <FilePlus2 className="h-4 w-4" />
                      Create Order
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDetailData(null)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
