import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, ShieldAlert, UserCircle } from 'lucide-react';
import { apiFetch, ApiError, formatWib } from '../lib/api.ts';
import { StatusIndicator } from '../components/StatusIndicator.tsx';
import type { AuthUser } from '../../shared/types.ts';

export function AccountPages({
  view,
  user,
  pendingDeletionRequest,
  onDeletionSubmitted,
}: {
  view: 'profile' | 'change-password';
  user: AuthUser;
  pendingDeletionRequest: { id: number; reason: string; status: string; created_at: string } | null;
  onDeletionSubmitted: () => void;
}) {
  // Change password state
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  // Deletion request state
  const [delReason, setDelReason] = useState('');
  const [delMsg, setDelMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [delLoading, setDelLoading] = useState(false);

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    setPwLoading(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: curPass,
          new_password: newPass,
          confirm_password: confirmPass,
        }),
      });
      setPwMsg({ type: 'ok', text: res.message });
      setCurPass('');
      setNewPass('');
      setConfirmPass('');
    } catch (err) {
      setPwMsg({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal memperbarui password.',
      });
    } finally {
      setPwLoading(false);
    }
  }

  async function handleRequestDeletion(e: FormEvent) {
    e.preventDefault();
    setDelMsg(null);
    setDelLoading(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/request-deletion', {
        method: 'POST',
        body: JSON.stringify({ reason: delReason }),
      });
      setDelMsg({ type: 'ok', text: res.message });
      setDelReason('');
      onDeletionSubmitted();
    } catch (err) {
      setDelMsg({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal mengirim permintaan penghapusan akun.',
      });
    } finally {
      setDelLoading(false);
    }
  }

  if (view === 'change-password') {
    return (
      <div className="max-w-lg bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2.5 mb-1">
          <KeyRound className="h-5 w-5 text-emerald-700" />
          <h2 className="text-base font-bold text-slate-900">Ubah Password Akun</h2>
        </div>
        <p className="text-xs text-slate-500">Gunakan minimal 8 karakter untuk menjaga keamanan akun Anda.</p>

        {pwMsg && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
              pwMsg.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {pwMsg.type === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span>{pwMsg.text}</span>
          </div>
        )}

        <form onSubmit={handleChangePassword} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Password Saat Ini</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                required
                value={curPass}
                onChange={(e) => setCurPass(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2 pr-10 text-sm focus:border-emerald-700 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPass((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Password Baru</label>
            <input
              type={showPass ? 'text' : 'password'}
              required
              minLength={8}
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Konfirmasi Password Baru</label>
            <input
              type={showPass ? 'text' : 'password'}
              required
              minLength={8}
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pwLoading}
            className="rounded-lg bg-[#0F2A24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163C33] disabled:opacity-50"
          >
            {pwLoading ? 'Memperbarui...' : 'Simpan Password Baru'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0F2A24] text-emerald-200 font-bold">
              <UserCircle className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">{user.full_name}</h2>
              <p className="text-xs text-slate-500">
                @{user.username} &middot; {user.role_name}
              </p>
            </div>
          </div>
          <StatusIndicator status={user.status} />
        </div>

        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Divisi / Jabatan</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{user.division}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Tanggal Terdaftar</dt>
            <dd className="mt-0.5 font-medium text-slate-900 tabular-nums">{formatWib(user.created_at)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Login Terakhir</dt>
            <dd className="mt-0.5 font-medium text-slate-900 tabular-nums">{formatWib(user.last_login_at)}</dd>
          </div>
        </dl>
      </div>

      {/* Account Deactivation / Deletion Request */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <span>Permintaan Penonaktifan / Penghapusan Akun Pribadi</span>
        </div>
        <p className="mt-1 text-xs text-slate-500 leading-relaxed">
          Penghapusan akun dilakukan melalui mekanisme persetujuan Admin (soft delete) agar seluruh riwayat
          order dan audit aktivitas tetap terjaga.
        </p>

        {delMsg && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
              delMsg.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            <span>{delMsg.text}</span>
          </div>
        )}

        {pendingDeletionRequest ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            <div className="font-semibold">Permintaan Anda sedang menunggu tinjauan Admin</div>
            <p className="mt-1">Alasan: {pendingDeletionRequest.reason}</p>
            <p className="mt-1 text-[11px] text-amber-800">
              Diajukan pada: {formatWib(pendingDeletionRequest.created_at)}
            </p>
          </div>
        ) : (
          <form onSubmit={handleRequestDeletion} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Alasan Penonaktifan / Penghapusan Akun
              </label>
              <textarea
                rows={3}
                required
                minLength={5}
                value={delReason}
                onChange={(e) => setDelReason(e.target.value)}
                placeholder="Contoh: Mutasi divisi atau tidak lagi bertugas pada operasional TrucKing..."
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-xs focus:border-emerald-700 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={delLoading}
              className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50 transition-colors"
            >
              {delLoading ? 'Mengirim Permintaan...' : 'Ajukan Permintaan Penonaktifan Akun'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
