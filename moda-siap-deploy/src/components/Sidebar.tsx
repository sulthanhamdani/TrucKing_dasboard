import {
  Activity,
  BarChart3,
  ClipboardList,
  FilePlus2,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Scale,
  Settings,
  ShieldAlert,
  TrendingUp,
  Truck,
  UserCheck,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { ModaLogo } from './ModaLogo.tsx';
import type { RoleCode } from '../../shared/types.ts';

export type NavSectionKey =
  | 'overview'
  | 'monitoring'
  | 'track-record'
  | 'kpi'
  | 'ahp'
  | 'transporters'
  | 'create-order'
  | 'orders'
  | 'user-management'
  | 'account-approval'
  | 'activity-logs'
  | 'whatsapp-templates'
  | 'system-settings'
  | 'profile'
  | 'change-password';

interface SidebarProps {
  activeNav: NavSectionKey;
  userRole: RoleCode;
  pendingCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onSelect: (key: NavSectionKey) => void;
  onLogout: () => void;
}

interface MenuItem {
  key: NavSectionKey;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

export function Sidebar({
  activeNav,
  userRole,
  pendingCount,
  mobileOpen,
  onCloseMobile,
  onSelect,
  onLogout,
}: SidebarProps) {
  const mainMenu: MenuItem[] = [
    { key: 'overview', label: 'Dashboard Overview', icon: LayoutDashboard },
    { key: 'monitoring', label: 'Monitoring Kinerja', icon: BarChart3 },
    { key: 'track-record', label: 'Track Record Transporter', icon: TrendingUp },
    { key: 'kpi', label: 'KPI Monitoring', icon: Activity },
    { key: 'ahp', label: 'AHP Weighting', icon: Scale },
  ];

  const operationsMenu: MenuItem[] =
    userRole === 'viewer'
      ? [{ key: 'transporters', label: 'Transporter Directory', icon: Truck }]
      : [
          { key: 'transporters', label: 'Transporter Management', icon: Truck },
          { key: 'create-order', label: 'Create Order', icon: FilePlus2 },
          { key: 'orders', label: 'Order Management', icon: ClipboardList },
        ];

  const adminMenu: MenuItem[] = [
    { key: 'user-management', label: 'User Management', icon: Users },
    { key: 'account-approval', label: 'Account Approval', icon: UserCheck, badge: pendingCount },
    { key: 'activity-logs', label: 'Activity Logs', icon: History },
    { key: 'whatsapp-templates', label: 'WhatsApp Templates', icon: MessageSquareText },
    { key: 'system-settings', label: 'System Settings', icon: Settings },
  ];

  const accountMenu: MenuItem[] = [
    { key: 'profile', label: 'My Profile', icon: UserCircle },
    { key: 'change-password', label: 'Change Password', icon: KeyRound },
  ];

  const renderGroup = (title: string, items: MenuItem[]) => (
    <div className="mb-5">
      <div className="px-3 mb-2 text-[11px] font-semibold tracking-wider text-emerald-300/60 uppercase">
        {title}
      </div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeNav === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                onSelect(item.key);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors text-left ${
                isActive
                  ? 'bg-emerald-500/20 text-white border border-emerald-400/25'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-emerald-300' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </span>
              {typeof item.badge === 'number' && item.badge > 0 && (
                <span className="shrink-0 rounded-md bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-slate-950 tabular-nums">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const sidebarContent = (
    <aside className="flex h-full w-[264px] flex-col bg-[#0C1F1C] text-white border-r border-emerald-950">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <ModaLogo light />
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-lg text-slate-300 hover:bg-white/10"
          aria-label="Tutup menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {renderGroup('MAIN MENU', mainMenu)}
        {renderGroup('OPERATIONS', operationsMenu)}
        {userRole === 'admin' && renderGroup('ADMINISTRATION', adminMenu)}

        <div className="mb-2">
          <div className="px-3 mb-2 text-[11px] font-semibold tracking-wider text-emerald-300/60 uppercase">
            ACCOUNT
          </div>
          <div className="space-y-0.5">
            {accountMenu.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    onSelect(item.key);
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors text-left ${
                    isActive
                      ? 'bg-emerald-500/20 text-white border border-emerald-400/25'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white border border-transparent'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-emerald-300' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={onLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-rose-300 hover:bg-rose-500/15 hover:text-rose-200 transition-colors text-left"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </nav>

      {userRole === 'admin' && pendingCount > 0 && (
        <div className="mx-3 mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          <div className="flex items-center gap-2 font-semibold text-amber-300">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>Persetujuan Menunggu</span>
          </div>
          <p className="mt-1 text-[11px] text-amber-100/80">
            {pendingCount} permintaan akun atau penghapusan menunggu tinjauan Admin.
          </p>
        </div>
      )}
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block shrink-0 h-screen sticky top-0">{sidebarContent}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/60" onClick={onCloseMobile} />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
