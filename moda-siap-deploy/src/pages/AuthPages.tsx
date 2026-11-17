import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck, UserPlus, ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api.ts';
import { ModaLogo } from '../components/ModaLogo.tsx';
import type { AuthUser, RoleCode } from '../../shared/types.ts';

interface AuthPagesProps {
  needsBootstrap: boolean;
  onLoginSuccess: (user: AuthUser, token?: string) => void;
  onBootstrapDone: (user: AuthUser, token?: string) => void;
}

export function AuthPages({ needsBootstrap, onLoginSuccess, onBootstrapDone }: AuthPagesProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Bootstrap first admin state
  const [bootName, setBootName] = useState('');
  const [bootUser, setBootUser] = useState('');
  const [bootEmail, setBootEmail] = useState('');
  const [bootDivision, setBootDivision] = useState('Supply Management');
  const [bootPass, setBootPass] = useState('');
  const [bootConfirm, setBootConfirm] = useState('');
  const [showBootPass, setShowBootPass] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootLoading, setBootLoading] = useState(false);

  // Register state
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regDivision, setRegDivision] = useState('');
  const [regRole, setRegRole] = useState<RoleCode>('staff');
  const [regPass, setRegPass] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [showRegPass, setShowRegPass] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState<string | null>(null);
  const [regLoading, setRegLoading] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await apiFetch<{ user: AuthUser; token?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      onLoginSuccess(res.user, res.token);
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : 'Gagal terhubung ke server.');
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleBootstrap(e: FormEvent) {
    e.preventDefault();
    setBootError(null);
    if (bootPass !== bootConfirm) {
      setBootError('Konfirmasi password tidak cocok.');
      return;
    }
    setBootLoading(true);
    try {
      const res = await apiFetch<{ user: AuthUser; token?: string }>('/api/auth/bootstrap-admin', {
        method: 'POST',
        body: JSON.stringify({
          full_name: bootName,
          username: bootUser,
          email: bootEmail,
          division: bootDivision,
          password: bootPass,
        }),
      });
      onBootstrapDone(res.user, res.token);
    } catch (err) {
      setBootError(err instanceof ApiError ? err.message : 'Gagal membuat akun Admin awal.');
    } finally {
      setBootLoading(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setRegError(null);
    setRegSuccess(null);
    setRegLoading(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          full_name: regName,
          username: regUsername,
          email: regEmail,
          division: regDivision,
          requested_role: regRole,
          password: regPass,
          confirm_password: regConfirm,
        }),
      });
      setRegSuccess(res.message);
      setRegName('');
      setRegUsername('');
      setRegEmail('');
      setRegDivision('');
      setRegPass('');
      setRegConfirm('');
    } catch (err) {
      setRegError(err instanceof ApiError ? err.message : 'Gagal mengajukan pendaftaran.');
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center gap-2">
          <ModaLogo />
          <p className="text-xs font-medium text-slate-500">TrucKing Transporter System</p>
        </div>
        <div>
          {needsBootstrap ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8">
              <div className="flex items-center gap-2.5 text-emerald-800 mb-2">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-xs font-semibold tracking-wide">Initial Setup</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900">Buat Akun Super Admin Pertama</h2>
              <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                Belum ada akun Administrator di database. Buat akun Super Admin pertama untuk mulai mengelola
                persetujuan pengguna, master transporter, dan sistem monitoring.
              </p>

              {bootError && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{bootError}</span>
                </div>
              )}

              <form onSubmit={handleBootstrap} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap</label>
                  <input
                    type="text"
                    required
                    value={bootName}
                    onChange={(e) => setBootName(e.target.value)}
                    placeholder="Contoh: Sulthan Hamdani"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Username</label>
                    <input
                      type="text"
                      required
                      value={bootUser}
                      onChange={(e) => setBootUser(e.target.value)}
                      placeholder="admin.moda"
                      className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Divisi / Jabatan</label>
                    <input
                      type="text"
                      required
                      value={bootDivision}
                      onChange={(e) => setBootDivision(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={bootEmail}
                    onChange={(e) => setBootEmail(e.target.value)}
                    placeholder="admin@moda.co.id"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Password (min. 8 karakter)</label>
                  <div className="relative">
                    <input
                      type={showBootPass ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={bootPass}
                      onChange={(e) => setBootPass(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3.5 py-2 pr-10 text-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBootPass((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                      aria-label={showBootPass ? 'Sembunyikan password' : 'Tampilkan password'}
                    >
                      {showBootPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Konfirmasi Password</label>
                  <input
                    type={showBootPass ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={bootConfirm}
                    onChange={(e) => setBootConfirm(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15"
                  />
                </div>
                <button
                  type="submit"
                  disabled={bootLoading}
                  className="w-full rounded-lg bg-[#0F2A24] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#163C33] transition-colors disabled:opacity-60"
                >
                  {bootLoading ? 'Menyiapkan Akun...' : 'Aktifkan Super Admin & Masuk'}
                </button>
              </form>
            </div>
          ) : mode === 'login' ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Masuk ke Dashboard</h2>
                  <p className="mt-1 text-xs text-slate-500">TrucKing Transporter System</p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                  <Lock className="h-5 w-5" />
                </div>
              </div>

              {loginError && (
                <div
                  role="alert"
                  className="mt-5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{loginError}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="login-identifier" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Username atau Email
                  </label>
                  <input
                    id="login-identifier"
                    type="text"
                    required
                    autoComplete="username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="Masukkan username atau email"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15"
                  />
                </div>

                <div>
                  <label htmlFor="login-password" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPass ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Masukkan password"
                      className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 pr-10 text-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                      aria-label={showPass ? 'Sembunyikan password' : 'Tampilkan password'}
                    >
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full rounded-lg bg-[#0F2A24] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#163C33] transition-colors disabled:opacity-60"
                >
                  {loginLoading ? 'Memverifikasi...' : 'Login'}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-slate-200 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500">Belum memiliki akses akun?</span>
                <button
                  type="button"
                  onClick={() => {
                    setLoginError(null);
                    setMode('register');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-950 whitespace-nowrap"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Register / Request Account
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-8">
              <button
                type="button"
                onClick={() => {
                  setRegError(null);
                  setRegSuccess(null);
                  setMode('login');
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 mb-4"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Kembali ke Login
              </button>

              <h2 className="text-xl font-bold text-slate-900">Pendaftaran Akun Baru</h2>
              <p className="mt-1 text-xs text-slate-500">
                Pengajuan akun akan berstatus Pending Approval sampai disetujui oleh Admin.
              </p>

              {regError && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{regError}</span>
                </div>
              )}

              {regSuccess && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-700" />
                  <span>{regSuccess}</span>
                </div>
              )}

              <form onSubmit={handleRegister} className="mt-5 space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap</label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Nama lengkap Anda"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Username</label>
                    <input
                      type="text"
                      required
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value)}
                      placeholder="nama.pengguna"
                      className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Divisi / Jabatan</label>
                    <input
                      type="text"
                      required
                      value={regDivision}
                      onChange={(e) => setRegDivision(e.target.value)}
                      placeholder="Supply Management"
                      className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="nama@perusahaan.co.id"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Permintaan Jenis Akses</label>
                  <select
                    value={regRole}
                    onChange={(e) => setRegRole(e.target.value as RoleCode)}
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm bg-white focus:border-emerald-700 focus:outline-none"
                  >
                    <option value="staff">Staff / Operator (Operasional &amp; Order)</option>
                    <option value="viewer">Viewer (Monitoring &amp; KPI Read-Only)</option>
                    <option value="admin">Admin (Manajemen Sistem)</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                    <div className="relative">
                      <input
                        type={showRegPass ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={regPass}
                        onChange={(e) => setRegPass(e.target.value)}
                        placeholder="Min. 8 karakter"
                        className="w-full rounded-lg border border-slate-300 px-3.5 py-2 pr-9 text-sm focus:border-emerald-700 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPass((s) => !s)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                        aria-label="Toggle password"
                      >
                        {showRegPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Konfirmasi Password</label>
                    <input
                      type={showRegPass ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={regConfirm}
                      onChange={(e) => setRegConfirm(e.target.value)}
                      placeholder="Ulangi password"
                      className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-emerald-700 focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={regLoading}
                  className="w-full rounded-lg bg-[#0F2A24] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#163C33] transition-colors disabled:opacity-60"
                >
                  {regLoading ? 'Mengirim Pendaftaran...' : 'Ajukan Pendaftaran'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
