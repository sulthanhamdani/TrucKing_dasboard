import { useCallback, useEffect, useState } from 'react';
import { apiFetch, clearClientSessionToken, setClientSessionToken } from './lib/api.ts';
import { AuthPages } from './pages/AuthPages.tsx';
import { Sidebar, type NavSectionKey } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { MonitoringPages } from './pages/MonitoringPages.tsx';
import { TransporterPage } from './pages/TransporterPage.tsx';
import { CreateOrderPage, OrderManagementPage } from './pages/OrderPages.tsx';
import { AdminPages } from './pages/AdminPages.tsx';
import { AccountPages } from './pages/AccountPages.tsx';
import type { AuthUser, OrderRecord } from '../shared/types.ts';

interface MeResponse {
  user: AuthUser;
  notifications: {
    pendingApprovals: number;
    pendingDeletions: number;
  };
  myPendingDeletionRequest: {
    id: number;
    reason: string;
    status: string;
    created_at: string;
  } | null;
}

const PAGE_TITLES: Record<NavSectionKey, { title: string; subtitle: string }> = {
  overview: {
    title: 'Dashboard Overview',
    subtitle: 'Ringkasan kinerja transporter berbasis KPI historis & model pembobotan AHP',
  },
  monitoring: {
    title: 'Monitoring Kinerja',
    subtitle: 'Evaluasi komprehensif indikator OTD, Completion, Lead Time, Claim, dan Kapasitas',
  },
  'track-record': {
    title: 'Track Record Transporter',
    subtitle: 'Rekam jejak bulanan pengiriman historis per vendor transporter',
  },
  kpi: {
    title: 'KPI Monitoring',
    subtitle: 'Pemantauan kepatuhan target SLA terhadap performa aktual transporter',
  },
  ahp: {
    title: 'AHP Weighting',
    subtitle: 'Matriks perbandingan berpasangan & konsistensi bobot kriteria seleksi',
  },
  transporters: {
    title: 'Transporter Management',
    subtitle: 'Master data vendor transporter, kontak WhatsApp, dan tautan rekam jejak',
  },
  'create-order': {
    title: 'Create Order',
    subtitle: 'Pembuatan permintaan armada manual dan pengiriman template via WhatsApp Click-to-Chat',
  },
  orders: {
    title: 'Order Management',
    subtitle: 'Riwayat order operasional, status pengiriman, dan konfirmasi manual WhatsApp',
  },
  'user-management': {
    title: 'User Management',
    subtitle: 'Pengelolaan akun pengguna, hak akses role (RBAC), dan status aktif',
  },
  'account-approval': {
    title: 'Account Approval',
    subtitle: 'Persetujuan pendaftaran akun baru dan tinjauan permintaan penghapusan akun',
  },
  'activity-logs': {
    title: 'Activity Logs',
    subtitle: 'Audit trail aktivitas sistem pengguna dalam zona waktu Asia/Jakarta (WIB)',
  },
  'whatsapp-templates': {
    title: 'WhatsApp Templates',
    subtitle: 'Pengaturan format pesan permintaan armada dan placeholder yang diizinkan',
  },
  'system-settings': {
    title: 'System Settings',
    subtitle: 'Konfigurasi global TrucKing Transporter System',
  },
  profile: {
    title: 'My Profile',
    subtitle: 'Informasi akun pribadi dan pengajuan penonaktifan akun',
  },
  'change-password': {
    title: 'Change Password',
    subtitle: 'Pembaruan kata sandi akun pengguna',
  },
};

function canAccessNav(role: AuthUser['role'], nav: NavSectionKey): boolean {
  if (
    ['user-management', 'account-approval', 'activity-logs', 'whatsapp-templates', 'system-settings'].includes(nav)
  ) {
    return role === 'admin';
  }
  if (['create-order', 'orders'].includes(nav)) {
    return role === 'admin' || role === 'staff';
  }
  return true;
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [myDeletionReq, setMyDeletionReq] = useState<MeResponse['myPendingDeletionRequest']>(null);

  const [activeNav, setActiveNav] = useState<NavSectionKey>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedTransporterCode, setSelectedTransporterCode] = useState('');
  const [preselectedOrderTransporterId, setPreselectedOrderTransporterId] = useState<number | null>(null);
  const [editingOrder, setEditingOrder] = useState<OrderRecord | null>(null);

  const checkSession = useCallback(async () => {
    try {
      const boot = await apiFetch<{ needsBootstrap: boolean }>('/api/auth/bootstrap-status');
      setNeedsBootstrap(boot.needsBootstrap);
      if (boot.needsBootstrap) {
        setUser(null);
        setAuthChecked(true);
        return;
      }

      const me = await apiFetch<MeResponse>('/api/auth/me');
      setUser(me.user);
      setPendingCount((me.notifications?.pendingApprovals || 0) + (me.notifications?.pendingDeletions || 0));
      setMyDeletionReq(me.myPendingDeletionRequest);
    } catch {
      setUser(null);
      if (window.location.pathname !== '/login') {
        window.history.replaceState(null, '', '/login');
      }
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Prevent accessing protected views via browser Back button after logout
  useEffect(() => {
    const handlePopState = () => {
      if (!user) {
        if (window.location.pathname !== '/login') {
          window.history.replaceState(null, '', '/login');
        }
        return;
      }
      // Re-verify session silently on navigation
      apiFetch<MeResponse>('/api/auth/me')
        .then((me) => setUser(me.user))
        .catch(() => {
          setUser(null);
          window.history.replaceState(null, '', '/login');
        });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user]);

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Proceed clearing client state regardless
    }
    clearClientSessionToken();
    setUser(null);
    setActiveNav('overview');
    setEditingOrder(null);
    setPreselectedOrderTransporterId(null);
    window.history.replaceState(null, '', '/login');
  }

  function navigateTo(key: NavSectionKey) {
    if (!user) return;
    if (!canAccessNav(user.role, key)) {
      setActiveNav('overview');
      return;
    }
    if (key !== 'create-order') {
      setEditingOrder(null);
      setPreselectedOrderTransporterId(null);
    }
    setActiveNav(key);
    window.history.pushState({ nav: key }, '', `/${key}`);
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs font-medium text-slate-500">Memeriksa sesi autentikasi...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthPages
        needsBootstrap={needsBootstrap}
        onLoginSuccess={(loggedInUser, token) => {
          setClientSessionToken(token);
          setUser(loggedInUser);
          setActiveNav('overview');
          window.history.replaceState({ nav: 'overview' }, '', '/overview');
          checkSession();
        }}
        onBootstrapDone={(adminUser, token) => {
          setClientSessionToken(token);
          setNeedsBootstrap(false);
          setUser(adminUser);
          setActiveNav('overview');
          window.history.replaceState({ nav: 'overview' }, '', '/overview');
          checkSession();
        }}
      />
    );
  }

  const effectiveNav: NavSectionKey = canAccessNav(user.role, activeNav) ? activeNav : 'overview';
  const headerMeta = PAGE_TITLES[effectiveNav];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar
        activeNav={effectiveNav}
        userRole={user.role}
        pendingCount={pendingCount}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onSelect={navigateTo}
        onLogout={handleLogout}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          title={headerMeta.title}
          subtitle={headerMeta.subtitle}
          user={user}
          pendingCount={pendingCount}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onNavigate={navigateTo}
          onLogout={handleLogout}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {['overview', 'monitoring', 'track-record', 'kpi', 'ahp'].includes(effectiveNav) && (
            <MonitoringPages
              view={effectiveNav as 'overview' | 'monitoring' | 'track-record' | 'kpi' | 'ahp'}
              userRole={user.role}
              selectedCode={selectedTransporterCode}
              onSelectTransporterCode={(code, navigateToDetail) => {
                setSelectedTransporterCode(code);
                if (navigateToDetail && effectiveNav === 'overview') {
                  navigateTo('track-record');
                }
              }}
            />
          )}

          {effectiveNav === 'transporters' && (
            <TransporterPage
              userRole={user.role}
              onCreateOrderForTransporter={(tid) => {
                setEditingOrder(null);
                setPreselectedOrderTransporterId(tid);
                navigateTo('create-order');
              }}
            />
          )}

          {effectiveNav === 'create-order' && (
            <CreateOrderPage
              user={user}
              preselectedTransporterId={preselectedOrderTransporterId}
              editingOrder={editingOrder}
              onOrderSaved={() => navigateTo('orders')}
              onCancel={() => navigateTo('orders')}
            />
          )}

          {effectiveNav === 'orders' && (
            <OrderManagementPage
              userRole={user.role}
              onCreateNew={() => {
                setEditingOrder(null);
                setPreselectedOrderTransporterId(null);
                navigateTo('create-order');
              }}
              onEditDraft={(order) => {
                setEditingOrder(order);
                setPreselectedOrderTransporterId(order.transporter_id);
                navigateTo('create-order');
              }}
            />
          )}

          {[
            'user-management',
            'account-approval',
            'activity-logs',
            'whatsapp-templates',
            'system-settings',
          ].includes(effectiveNav) && (
            <AdminPages
              view={
                effectiveNav as
                  | 'user-management'
                  | 'account-approval'
                  | 'activity-logs'
                  | 'whatsapp-templates'
                  | 'system-settings'
              }
              currentUserId={user.id}
              onNotificationsChanged={checkSession}
            />
          )}

          {(effectiveNav === 'profile' || effectiveNav === 'change-password') && (
            <AccountPages
              view={effectiveNav}
              user={user}
              pendingDeletionRequest={myDeletionReq}
              onDeletionSubmitted={checkSession}
            />
          )}
        </main>
      </div>
    </div>
  );
}
