import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Ban,
  MessageSquare,
  Send,
  Truck,
  FileEdit,
  XCircle,
} from 'lucide-react';

export function StatusIndicator({ status }: { status: string }) {
  const s = status.toLowerCase();

  let style = 'text-slate-700 bg-slate-100 border-slate-200';
  let Icon = Clock;

  if (s === 'active' || s === 'approved' || s === 'success' || s === 'completed' || s === 'accepted') {
    style = 'text-emerald-800 bg-emerald-50 border-emerald-200';
    Icon = CheckCircle2;
  } else if (s === 'pending' || s === 'draft' || s === 'ready to send') {
    style = 'text-amber-800 bg-amber-50 border-amber-200';
    Icon = s === 'draft' ? FileEdit : Clock;
  } else if (s === 'whatsapp opened') {
    style = 'text-sky-800 bg-sky-50 border-sky-200';
    Icon = MessageSquare;
  } else if (s === 'sent (manual confirmation)') {
    style = 'text-teal-800 bg-teal-50 border-teal-200';
    Icon = Send;
  } else if (s === 'in progress') {
    style = 'text-indigo-800 bg-indigo-50 border-indigo-200';
    Icon = Truck;
  } else if (s === 'rejected' || s === 'failure' || s === 'failed') {
    style = 'text-rose-800 bg-rose-50 border-rose-200';
    Icon = XCircle;
  } else if (s === 'suspended' || s === 'inactive' || s === 'cancelled' || s === 'deleted') {
    style = 'text-slate-600 bg-slate-100 border-slate-300';
    Icon = Ban;
  } else if (s === 'info') {
    style = 'text-slate-700 bg-slate-100 border-slate-200';
    Icon = AlertCircle;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${style}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{status}</span>
    </span>
  );
}
