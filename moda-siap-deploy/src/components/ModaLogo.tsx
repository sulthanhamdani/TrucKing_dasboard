export function ModaLogo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3 select-none">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          light ? 'bg-emerald-500/20 border border-emerald-400/30' : 'bg-[#0F2A24] border border-emerald-800/40'
        }`}
      >
        <svg viewBox="0 0 28 28" className="h-5 w-5" fill="none" aria-hidden="true">
          <path
            d="M4 20V8L10.5 15L14 10.5L17.5 15L24 8V20"
            stroke="#34D399"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 22.5H24"
            stroke={light ? '#A7F3D0' : '#6EE7B7'}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="leading-tight">
        <div className={`text-base font-bold tracking-tight ${light ? 'text-white' : 'text-slate-900'}`}>
          TrucKing
        </div>
        <div className={`text-[11px] font-medium ${light ? 'text-emerald-200/80' : 'text-slate-500'}`}>
          Transporter System
        </div>
      </div>
    </div>
  );
}
