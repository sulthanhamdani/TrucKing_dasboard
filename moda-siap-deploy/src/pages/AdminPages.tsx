import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Download,
  Search,
  Trash2,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { apiFetch, ApiError, downloadAuthedCsv, formatWib, formatWibDateOnly } from '../lib/api.ts';
import { renderWhatsAppOrderTemplate } from '../../shared/whatsapp.ts';
import { StatusIndicator } from '../components/StatusIndicator.tsx';
import type {
  ActivityLogRecord,
  RoleCode,
  UserRecord,
  WhatsAppTemplateRecord,
} from '../../shared/types.ts';

export function AdminPages({
  view,
  currentUserId,
  onNotificationsChanged,
}: {
  view:
    | 'user-management'
    | 'account-approval'
    | 'activity-logs'
    | 'whatsapp-templates'
    | 'system-settings';
  currentUserId: number;
  onNotificationsChanged: () => void;
}) {
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Users & Approvals State
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [approveModal, setApproveModal] = useState<{ user: UserRecord; role: RoleCode } | null>(null);
  const [rejectModal, setRejectModal] = useState<{ user: UserRecord; reason: string } | null>(null);
  const [deleteReviewModal, setDeleteReviewModal] = useState<{ user: UserRecord; note: string } | null>(null);

  // Activity Logs State
  const [logs, setLogs] = useState<ActivityLogRecord[]>([]);
  const [logFilters, setLogFilters] = useState<{ users: string[]; activityTypes: string[] }>({
    users: [],
    activityTypes: [],
  });
  const [filterUser, setFilterUser] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [logSearch, setLogSearch] = useState('');

  // Templates State
  const [templates, setTemplates] = useState<WhatsAppTemplateRecord[]>([]);
  const [availPlaceholders, setAvailPlaceholders] = useState<
    Array<{ key: string; label: string; description: string }>
  >([]);
  const [editTemplateId, setEditTemplateId] = useState<number>(0);
  const [tplName, setTplName] = useState('');
  const [tplBody, setTplBody] = useState('');
  const [tplAllowed, setTplAllowed] = useState<string[]>([]);

  // System Settings State
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({
    company_name: 'MODA Supply Management',
    timezone: 'Asia/Jakarta',
    ahp_cr_threshold: '0.10',
  });

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await apiFetch<{ users: UserRecord[] }>('/api/admin/users');
      setUsers(res.users);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memuat daftar pengguna.',
      });
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        username: filterUser,
        activity_type: filterType,
        status: filterStatus,
        date_from: dateFrom,
        date_to: dateTo,
        search: logSearch,
      });
      const res = await apiFetch<{
        logs: ActivityLogRecord[];
        filters: { users: string[]; activityTypes: string[] };
      }>(`/api/admin/activity-logs?${qs.toString()}`);
      setLogs(res.logs);
      setLogFilters(res.filters);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memuat log aktivitas.',
      });
    }
  }, [filterUser, filterType, filterStatus, dateFrom, dateTo, logSearch]);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await apiFetch<{
        templates: WhatsAppTemplateRecord[];
        availablePlaceholders: Array<{ key: string; label: string; description: string }>;
      }>('/api/admin/templates');
      setTemplates(res.templates);
      setAvailPlaceholders(res.availablePlaceholders);
      if (res.templates.length > 0) {
        const active = res.templates[0];
        setEditTemplateId(active.id);
        setTplName(active.name);
        setTplBody(active.body);
        setTplAllowed(active.allowed_placeholders);
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memuat template WhatsApp.',
      });
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await apiFetch<{ settings: Array<{ key: string; value: string }> }>('/api/admin/settings');
      const map: Record<string, string> = {};
      for (const s of res.settings) map[s.key] = s.value;
      setSettingsMap((prev) => ({ ...prev, ...map }));
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memuat pengaturan sistem.',
      });
    }
  }, []);

  useEffect(() => {
    setFeedback(null);
    if (view === 'user-management' || view === 'account-approval') loadUsers();
    if (view === 'activity-logs') loadLogs();
    if (view === 'whatsapp-templates') loadTemplates();
    if (view === 'system-settings') loadSettings();
  }, [view, loadUsers, loadLogs, loadTemplates, loadSettings]);

  async function handleApproveSubmit(e: FormEvent) {
    e.preventDefault();
    if (!approveModal) return;
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/users/${approveModal.user.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ role: approveModal.role }),
      });
      setFeedback({ type: 'ok', text: res.message });
      setApproveModal(null);
      await loadUsers();
      onNotificationsChanged();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof ApiError ? err.message : 'Gagal menyetujui akun.' });
    }
  }

  async function handleRejectSubmit(e: FormEvent) {
    e.preventDefault();
    if (!rejectModal) return;
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/users/${rejectModal.user.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectModal.reason }),
      });
      setFeedback({ type: 'ok', text: res.message });
      setRejectModal(null);
      await loadUsers();
      onNotificationsChanged();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof ApiError ? err.message : 'Gagal menolak akun.' });
    }
  }

  async function handleRoleChange(userId: number, role: RoleCode) {
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setFeedback({ type: 'ok', text: res.message });
      await loadUsers();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof ApiError ? err.message : 'Gagal mengubah role.' });
    }
  }

  async function handleToggleSuspend(u: UserRecord) {
    const nextStatus = u.status === 'suspended' ? 'active' : 'suspended';
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/users/${u.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setFeedback({ type: 'ok', text: res.message });
      await loadUsers();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof ApiError ? err.message : 'Gagal mengubah status akun.' });
    }
  }

  async function handleDeletionDecision(decision: 'approve' | 'reject') {
    if (!deleteReviewModal || !deleteReviewModal.user.pending_deletion_id) return;
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/admin/deletion-requests/${deleteReviewModal.user.pending_deletion_id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ decision, note: deleteReviewModal.note }),
        }
      );
      setFeedback({ type: 'ok', text: res.message });
      setDeleteReviewModal(null);
      await loadUsers();
      onNotificationsChanged();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memproses permintaan penghapusan.',
      });
    }
  }

  async function handleSaveTemplate(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/templates/${editTemplateId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: tplName,
          body: tplBody,
          allowed_placeholders: tplAllowed,
        }),
      });
      setFeedback({ type: 'ok', text: res.message });
      await loadTemplates();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof ApiError ? err.message : 'Gagal menyimpan template.' });
    }
  }

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await apiFetch<{ message: string }>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: settingsMap }),
      });
      setFeedback({ type: 'ok', text: res.message });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof ApiError ? err.message : 'Gagal menyimpan pengaturan.' });
    }
  }

  const alertBanner = feedback && (
    <div
      className={`mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
        feedback.type === 'ok'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-rose-200 bg-rose-50 text-rose-800'
      }`}
    >
      <span className="flex items-center gap-2">
        {feedback.type === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
        {feedback.text}
      </span>
      <button type="button" onClick={() => setFeedback(null)}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  if (view === 'user-management' || view === 'account-approval') {
    const displayedUsers =
      view === 'account-approval'
        ? users.filter((u) => u.status === 'pending' || u.pending_deletion_id !== null)
        : users;

    return (
      <div>
        {alertBanner}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {view === 'account-approval'
                  ? 'Antrean Persetujuan Akun & Permintaan Penghapusan'
                  : 'User Management'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Kelola persetujuan registrasi, peran akses (RBAC), aktivasi, dan soft-delete akun.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                  <th className="py-3 px-4">Nama</th>
                  <th className="py-3 px-4">Username</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-3">Role</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Tanggal Daftar</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {usersLoading && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500">
                      Memuat daftar pengguna...
                    </td>
                  </tr>
                )}
                {!usersLoading &&
                  displayedUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{u.full_name}</div>
                        <div className="text-[11px] text-slate-500">{u.division}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700">{u.username}</td>
                      <td className="py-3 px-4 text-slate-600">{u.email}</td>
                      <td className="py-3 px-3">
                        {u.status === 'active' && u.id !== currentUserId ? (
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.id, e.target.value as RoleCode)}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                          >
                            <option value="admin">Admin</option>
                            <option value="staff">Staff</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        ) : (
                          <span className="font-medium capitalize text-slate-700">
                            {u.status === 'pending' ? `Minta: ${u.requested_role}` : u.role}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <div className="space-y-1">
                          <StatusIndicator status={u.status} />
                          {u.pending_deletion_id && (
                            <div className="text-[11px] font-semibold text-rose-700">
                              Ajuan Hapus Akun
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-500 tabular-nums whitespace-nowrap">
                        {formatWibDateOnly(u.created_at)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {u.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setApproveModal({ user: u, role: u.requested_role })}
                                className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800"
                              >
                                <UserCheck className="h-3.5 w-3.5" />
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => setRejectModal({ user: u, reason: '' })}
                                className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-800 hover:bg-rose-100"
                              >
                                <UserX className="h-3.5 w-3.5" />
                                Reject
                              </button>
                            </>
                          )}
                          {(u.status === 'active' || u.status === 'suspended') && u.id !== currentUserId && (
                            <button
                              type="button"
                              onClick={() => handleToggleSuspend(u)}
                              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                                u.status === 'suspended'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <Ban className="h-3.5 w-3.5" />
                              {u.status === 'suspended' ? 'Aktifkan' : 'Suspend'}
                            </button>
                          )}
                          {u.pending_deletion_id && (
                            <button
                              type="button"
                              onClick={() => setDeleteReviewModal({ user: u, note: '' })}
                              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Review Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                {!usersLoading && displayedUsers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-xs text-slate-500">
                      {view === 'account-approval'
                        ? 'Tidak ada pendaftaran atau permintaan penghapusan akun yang menunggu persetujuan.'
                        : 'Tidak ada data pengguna.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Approve Modal */}
        {approveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <form
              onSubmit={handleApproveSubmit}
              className="w-full max-w-md rounded-xl bg-white border border-slate-200 p-6 space-y-4 text-xs"
            >
              <h3 className="text-sm font-bold text-slate-900">Setujui Pendaftaran Akun</h3>
              <p className="text-slate-600">
                Tetapkan role untuk <strong>{approveModal.user.full_name}</strong> (@{approveModal.user.username}):
              </p>
              <select
                value={approveModal.role}
                onChange={(e) => setApproveModal({ ...approveModal, role: e.target.value as RoleCode })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              >
                <option value="staff">Staff / Operator</option>
                <option value="viewer">Viewer</option>
                <option value="admin">Super Admin</option>
              </select>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setApproveModal(null)}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 font-medium"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800"
                >
                  Approve Akun
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Reject Modal */}
        {rejectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <form
              onSubmit={handleRejectSubmit}
              className="w-full max-w-md rounded-xl bg-white border border-slate-200 p-6 space-y-4 text-xs"
            >
              <h3 className="text-sm font-bold text-slate-900">Tolak Pendaftaran Akun</h3>
              <p className="text-slate-600">
                Masukkan alasan penolakan untuk <strong>{rejectModal.user.full_name}</strong>:
              </p>
              <textarea
                rows={3}
                required
                minLength={3}
                value={rejectModal.reason}
                onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })}
                placeholder="Contoh: Divisi tidak sesuai atau data belum terverifikasi..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectModal(null)}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 font-medium"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800"
                >
                  Tolak Pendaftaran
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Review Account Deletion Modal */}
        {deleteReviewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <div className="w-full max-w-md rounded-xl bg-white border border-slate-200 p-6 space-y-4 text-xs">
              <h3 className="text-sm font-bold text-slate-900">Tinjau Permintaan Penghapusan Akun</h3>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
                <div>
                  <span className="text-slate-500">Pengguna:</span>{' '}
                  <strong>{deleteReviewModal.user.full_name}</strong> (@{deleteReviewModal.user.username})
                </div>
                <div>
                  <span className="text-slate-500">Alasan:</span> {deleteReviewModal.user.pending_deletion_reason}
                </div>
              </div>
              <textarea
                rows={2}
                value={deleteReviewModal.note}
                onChange={(e) => setDeleteReviewModal({ ...deleteReviewModal, note: e.target.value })}
                placeholder="Catatan keputusan Admin (opsional)..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteReviewModal(null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 font-medium"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletionDecision('reject')}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Tolak Permintaan
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletionDecision('approve')}
                  className="rounded-lg bg-rose-700 px-3.5 py-2 font-semibold text-white hover:bg-rose-800"
                >
                  Setujui Soft Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === 'activity-logs') {
    return (
      <div className="space-y-5">
        {alertBanner}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <div className="relative min-w-[180px] flex-1 max-w-xs">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Cari detail aktivitas..."
                className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-xs"
              />
            </div>
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="all">Semua Pengguna</option>
              {logFilters.users.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="all">Semua Aktivitas</option>
              {logFilters.activityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="all">Semua Status</option>
              <option value="success">success</option>
              <option value="failure">failure</option>
              <option value="info">info</option>
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>

          <button
            type="button"
            onClick={() => downloadAuthedCsv('/api/admin/activity-logs/export', 'moda_activity_logs.csv')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                  <th className="py-3 px-4">Waktu (Asia/Jakarta)</th>
                  <th className="py-3 px-4">Pengguna</th>
                  <th className="py-3 px-3">Role</th>
                  <th className="py-3 px-4">Aktivitas</th>
                  <th className="py-3 px-4">Detail</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[11px] text-slate-600 whitespace-nowrap">
                      {formatWib(l.created_at)}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{l.username}</td>
                    <td className="py-2.5 px-3 capitalize text-slate-600">{l.user_role}</td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-800">{l.activity_type}</td>
                    <td className="py-2.5 px-4 text-slate-700">{l.detail}</td>
                    <td className="py-2.5 px-4">
                      <StatusIndicator status={l.status} />
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-xs text-slate-500">
                      Tidak ada log aktivitas yang sesuai dengan filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'whatsapp-templates') {
    const samplePreview = renderWhatsAppOrderTemplate(tplBody, {
      nama_pic: 'Hendra Wijaya',
      nama_transporter: 'PT Nusantara Logistik Jaya',
      nomor_order: 'ORD-20261113-0001',
      nama_customer: 'PT Sumber Makmur',
      jenis_layanan: 'Dedicated Charter',
      origin: 'Jakarta',
      alamat_muat: 'Kawasan Industri Pulogadung Blok J-3',
      destination: 'Surabaya',
      alamat_bongkar: 'Pergudangan Margomulyo Permai No. 12',
      tanggal_jam_muat: '14 Nov 2026 08:00 WIB',
      tanggal_jam_bongkar: '15 Nov 2026 14:00 WIB',
      jenis_armada: 'Wingbox',
      jenis_barang: 'Produk Kemasan Karton',
      jumlah_barang: '24 Palet',
      berat_barang: '8.5 Ton',
      informasi_biaya: 'Sesuai Kontrak',
      catatan: 'Harap unit membawa terpal cadangan.',
      dibuat_oleh: 'Operator MODA',
    });

    return (
      <div>
        {alertBanner}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <form
            onSubmit={handleSaveTemplate}
            className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4 text-xs"
          >
            <div>
              <h2 className="text-base font-bold text-slate-900">WhatsApp Order Template Management</h2>
              <p className="text-slate-500 mt-0.5">
                Sesuaikan format pesan permintaan armada dan kelola daftar placeholder yang diizinkan.
              </p>
            </div>

            {templates.length > 0 && (
              <div>
                <label className="block font-medium text-slate-700 mb-1">Nama Template</label>
                <input
                  type="text"
                  required
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
            )}

            <div>
              <label className="block font-medium text-slate-700 mb-1.5">
                Placeholder yang Diizinkan (Klik untuk toggle / sisipkan)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {availPlaceholders.map((p) => {
                  const active = tplAllowed.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      title={p.description}
                      onClick={() =>
                        setTplAllowed((prev) =>
                          active ? prev.filter((k) => k !== p.key) : [...prev, p.key]
                        )
                      }
                      className={`rounded-md border px-2 py-1 text-[11px] font-mono transition-colors ${
                        active
                          ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                          : 'border-slate-200 bg-slate-50 text-slate-400'
                      }`}
                    >
                      {`{{${p.key}}}`}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Isi Template Pesan</label>
              <textarea
                rows={18}
                required
                value={tplBody}
                onChange={(e) => setTplBody(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs leading-relaxed focus:border-emerald-700 focus:outline-none"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-lg bg-[#0F2A24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163C33]"
              >
                Simpan Template WhatsApp
              </button>
            </div>
          </form>

          <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Simulasi Hasil Render Pesan</h3>
            <p className="text-xs text-slate-500">Contoh pesan dengan data sampel order:</p>
            <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800">
              {samplePreview}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  // system-settings
  return (
    <div className="max-w-xl">
      {alertBanner}
      <form
        onSubmit={handleSaveSettings}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 text-xs"
      >
        <div>
          <h2 className="text-base font-bold text-slate-900">System Settings</h2>
          <p className="text-slate-500 mt-0.5">Konfigurasi umum aplikasi TrucKing Transporter System.</p>
        </div>

        <div>
          <label className="block font-medium text-slate-700 mb-1">Nama Organisasi</label>
          <input
            type="text"
            value={settingsMap.company_name || ''}
            onChange={(e) => setSettingsMap({ ...settingsMap, company_name: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-700 mb-1">Zona Waktu Tampilan Log</label>
          <select
            value={settingsMap.timezone || 'Asia/Jakarta'}
            onChange={(e) => setSettingsMap({ ...settingsMap, timezone: e.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
          >
            <option value="Asia/Jakarta">Asia/Jakarta (WIB)</option>
            <option value="Asia/Makassar">Asia/Makassar (WITA)</option>
            <option value="Asia/Jayapura">Asia/Jayapura (WIT)</option>
          </select>
        </div>
        <div>
          <label className="block font-medium text-slate-700 mb-1">Batas Consistency Ratio (CR) AHP</label>
          <input
            type="text"
            value={settingsMap.ahp_cr_threshold || '0.10'}
            onChange={(e) => setSettingsMap({ ...settingsMap, ahp_cr_threshold: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-[#0F2A24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163C33]"
        >
          Simpan Pengaturan
        </button>
      </form>
    </div>
  );
}
