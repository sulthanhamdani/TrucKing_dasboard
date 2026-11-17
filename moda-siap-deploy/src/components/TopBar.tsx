import { useState, useRef, useEffect } from 'react';
import { Bell, ChevronDown, KeyRound, LogOut, Menu, UserCircle } from 'lucide-react';
import type { AuthUser } from '../../shared/types.ts';
import type { NavSectionKey } from './Sidebar.tsx';

interface TopBarProps {
  title: string;
  subtitle: string;
  user: AuthUser;
  pendingCount: number;
  onOpenMobileMenu: () => void;
  onNavigate: (key: NavSectionKey) => void;
  onLogout: () => void;
}

export function TopBar({
  title,
  subtitle,
  user,
  pendingCount,
  onOpenMobileMenu,
  onNavigate,
  onLogout,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6 py-3.5">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
          aria-label="Buka menu navigasi"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">{title}</h1>
          <p className="text-xs text-slate-500 truncate">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {user.role === 'admin' && pendingCount > 0 && (
          <button
            type="button"
            onClick={() => onNavigate('account-approval')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 transition-colors whitespace-nowrap"
          >
            <Bell className="h-3.5 w-3.5 text-amber-700" />
            <span className="tabular-nums">{pendingCount} Persetujuan</span>
          </button>
        )}

        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left hover:bg-slate-50 transition-colors"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0F2A24] text-xs font-bold text-emerald-200">
              {user.full_name.slice(0, 2).toUpperCase()}
            </div>
            <div className="hidden sm:block leading-tight">
              <div className="text-xs font-semibold text-slate-900 max-w-[140px] truncate">{user.full_name}</div>
              <div className="text-[11px] text-slate-500 capitalize">{user.role_name}</div>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg z-40">
              <div className="px-3.5 py-2 border-b border-slate-100">
                <div className="text-xs font-semibold text-slate-900 truncate">{user.full_name}</div>
                <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
                <div className="mt-0.5 text-[11px] font-medium text-emerald-800">{user.role_name}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onNavigate('profile');
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 text-left"
              >
                <UserCircle className="h-4 w-4 text-slate-400" />
                My Profile
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onNavigate('change-password');
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 text-left"
              >
                <KeyRound className="h-4 w-4 text-slate-400" />
                Change Password
              </button>
              <div className="my-1 border-t border-slate-100" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 text-left"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
