import { useEffect, useState, useCallback } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { AlertCircle, CheckCircle2, Download, Filter, Search, TrendingUp, Award, Clock, PackageCheck } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api.ts';
import { downloadAggregatedKpiCsv } from '../lib/kpiCsvExport.ts';
import type { AhpAssessment, RoleCode, TransporterKpiSummary } from '../../shared/types.ts';

interface MonitoringResponse {
  overview: {
    total_transporters: number;
    total_orders: number;
    completed_orders: number;
    on_time_orders: number;
    late_orders: number;
    avg_otd_pct: number;
    avg_ahp_score: number;
  };
  transporters: TransporterKpiSummary[];
  monthlyTrend: Array<{
    month: string;
    total_orders: number;
    completed_orders: number;
    on_time_orders: number;
    late_orders: number;
    otd_pct: number;
  }>;
  ahp: AhpAssessment;
  filterOptions: {
    periods: string[];
    corridors: string[];
    fleets: string[];
  };
}

interface TrackRecordDetail {
  hasHistoricalData: boolean;
  summary: TransporterKpiSummary | null;
  monthly: Array<{
    period_month: string;
    total_orders: number;
    completed_orders: number;
    on_time_orders: number;
    late_orders: number;
    otd_pct: number;
    avg_lead_time_hours: number;
    claim_rate_pct: number;
    capacity_fulfillment_pct: number;
    route_corridor: string;
    fleet_category: string;
  }>;
}

const AHP_CRITERIA = [
  { key: 'otd', label: 'On-Time Delivery (OTD)' },
  { key: 'completion', label: 'Order Completion' },
  { key: 'lead_time', label: 'Lead Time Efficiency' },
  { key: 'claim', label: 'Zero Claim / Safety' },
  { key: 'capacity', label: 'Capacity Fulfillment' },
];

function computeAhpPreview(matrix: number[][]) {
  const n = 5;
  const colSums = Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) colSums[j] += matrix[i][j];
  }
  const weights = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += matrix[i][j] / colSums[j];
    weights[i] = sum / n;
  }
  let lambdaMax = 0;
  for (let i = 0; i < n; i++) {
    let aw = 0;
    for (let j = 0; j < n; j++) aw += matrix[i][j] * weights[j];
    lambdaMax += aw / weights[i];
  }
  lambdaMax /= n;
  const ci = (lambdaMax - n) / (n - 1);
  const cr = Math.max(0, ci) / 1.12;
  return { weights, cr: Number(cr.toFixed(4)), lambdaMax: Number(lambdaMax.toFixed(4)) };
}

export function MonitoringPages({
  view,
  userRole,
  selectedCode,
  onSelectTransporterCode,
}: {
  view: 'overview' | 'monitoring' | 'track-record' | 'kpi' | 'ahp';
  userRole: RoleCode;
  selectedCode: string;
  onSelectTransporterCode: (code: string, navigateToDetail?: boolean) => void;
}) {
  const [period, setPeriod] = useState('all');
  const [corridor, setCorridor] = useState('all');
  const [fleet, setFleet] = useState('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track record state
  const [trackDetail, setTrackDetail] = useState<TrackRecordDetail | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);

  // AHP editing state
  const [matrix, setMatrix] = useState<number[][]>([]);
  const [ahpName, setAhpName] = useState('Model Bobot AHP Supply Management');
  const [ahpSaving, setAhpSaving] = useState(false);
  const [ahpMsg, setAhpMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ period, corridor, fleet, search });
      const res = await apiFetch<MonitoringResponse>(`/api/monitoring/summary?${qs.toString()}`);
      setData(res);
      if (res.ahp?.pairwise_matrix?.length === 5 && matrix.length === 0) {
        setMatrix(res.ahp.pairwise_matrix);
        setAhpName(res.ahp.name);
      }
      if (!selectedCode && res.transporters.length > 0) {
        onSelectTransporterCode(res.transporters[0].transporter_code, false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data monitoring.');
    } finally {
      setLoading(false);
    }
  }, [period, corridor, fleet, search, matrix.length, selectedCode, onSelectTransporterCode]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (view !== 'track-record' || !selectedCode) return;
    setTrackLoading(true);
    apiFetch<TrackRecordDetail>(`/api/monitoring/transporter/${encodeURIComponent(selectedCode)}`)
      .then((res) => setTrackDetail(res))
      .catch(() => setTrackDetail(null))
      .finally(() => setTrackLoading(false));
  }, [view, selectedCode]);

  function updateMatrixCell(i: number, j: number, rawVal: number) {
    setMatrix((prev) => {
      const next = prev.map((r) => [...r]);
      next[i][j] = rawVal;
      next[j][i] = Number((1 / rawVal).toFixed(4));
      return next;
    });
  }

  async function handleSaveAhp() {
    setAhpMsg(null);
    setAhpSaving(true);
    try {
      const res = await apiFetch<{ message: string; active: AhpAssessment }>('/api/monitoring/ahp', {
        method: 'PUT',
        body: JSON.stringify({ name: ahpName, matrix }),
      });
      setAhpMsg({ type: 'ok', text: res.message });
      await loadSummary();
    } catch (err) {
      setAhpMsg({
        type: 'err',
        text: err instanceof ApiError ? err.message : 'Gagal menyimpan bobot AHP.',
      });
    } finally {
      setAhpSaving(false);
    }
  }

  const filterBar = data && (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mr-1">
          <Filter className="h-4 w-4 text-slate-400" />
          <span>Filter Monitoring</span>
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari kode atau nama transporter..."
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-xs focus:border-emerald-700 focus:outline-none"
          />
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-emerald-700 focus:outline-none"
        >
          <option value="all">Semua Periode</option>
          {data.filterOptions.periods.map((p) => (
            <option key={p} value={p}>
              Periode {p}
            </option>
          ))}
        </select>
        <select
          value={corridor}
          onChange={(e) => setCorridor(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-emerald-700 focus:outline-none"
        >
          <option value="all">Semua Rute Koridor</option>
          {data.filterOptions.corridors.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={fleet}
          onChange={(e) => setFleet(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-emerald-700 focus:outline-none"
        >
          <option value="all">Semua Armada</option>
          {data.filterOptions.fleets.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
        <div className="h-80 rounded-xl border border-slate-200 bg-white animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800 flex items-center gap-3">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!data) return null;

  if (view === 'overview') {
    const chartTransporters = data.transporters.slice(0, 6).map((t) => ({
      name: t.transporter_code,
      fullName: t.transporter_name,
      ahp: t.ahp_score,
      otd: t.otd_pct,
    }));

    return (
      <div>
        {filterBar}

        {/* Top 4 KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Total Order Historis</span>
              <PackageCheck className="h-4 w-4 text-emerald-700" />
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums font-mono">
              {data.overview.total_orders.toLocaleString('id-ID')}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {data.overview.completed_orders.toLocaleString('id-ID')} pengiriman selesai
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>On-Time Delivery Rate</span>
              <Clock className="h-4 w-4 text-emerald-700" />
            </div>
            <div className="mt-2 text-2xl font-bold text-emerald-700 tabular-nums font-mono">
              {data.overview.avg_otd_pct.toFixed(1)}%
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {data.overview.on_time_orders} tepat waktu &middot; {data.overview.late_orders} terlambat
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Transporter Dievaluasi</span>
              <TrendingUp className="h-4 w-4 text-emerald-700" />
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums font-mono">
              {data.overview.total_transporters}
            </div>
            <div className="mt-1 text-xs text-slate-500">Data historis tervalidasi</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Rata-Rata Skor AHP</span>
              <Award className="h-4 w-4 text-emerald-700" />
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums font-mono">
              {data.overview.avg_ahp_score.toFixed(1)}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              CR Model: {data.ahp.consistency_ratio} (&lt; 0.10)
            </div>
          </div>
        </div>

        {/* Main 12-Col Layout: Monitoring Table Left + Summary Charts Right */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Peringkat Kinerja Transporter (KPI &amp; AHP)</h2>
                <p className="text-xs text-slate-500">
                  Berdasarkan dataset historis monitoring. Terpisah dari order operasional baru.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Rank</th>
                    <th className="py-2.5 px-4">Transporter</th>
                    <th className="py-2.5 px-3 text-right">Orders</th>
                    <th className="py-2.5 px-3 text-right">OTD %</th>
                    <th className="py-2.5 px-3 text-right">Comp %</th>
                    <th className="py-2.5 px-4 text-right">AHP Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {data.transporters.map((t, idx) => (
                    <tr
                      key={t.transporter_code}
                      onClick={() => onSelectTransporterCode(t.transporter_code, true)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-700">
                        #{idx + 1}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{t.transporter_name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{t.transporter_code}</div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {t.completed_orders}/{t.total_orders}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                        {t.otd_pct.toFixed(1)}%
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {t.completion_pct.toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                        {t.ahp_score.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {data.transporters.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                        Tidak ada data historis yang sesuai dengan filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="xl:col-span-5 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-bold text-slate-900">Tren On-Time Delivery Bulanan</h3>
              <p className="text-xs text-slate-500 mb-4">Persentase ketepatan waktu pengiriman historis (%)</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis domain={[70, 100]} tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="otd_pct"
                      name="OTD (%)"
                      stroke="#0F766E"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#0F766E' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-bold text-slate-900">Perbandingan Skor Komposit AHP</h3>
              <p className="text-xs text-slate-500 mb-4">Top 6 transporter berdasarkan bobot AHP aktif</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartTransporters}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip />
                    <Bar dataKey="ahp" name="Skor AHP" fill="#0F2A24" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'monitoring') {
    return (
      <div>
        {filterBar}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-900">Matriks Monitoring Kinerja Transporter</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Seluruh metrik KPI historis dengan bobot AHP aktif: OTD ({(data.ahp.weight_otd * 100).toFixed(0)}%),
              Completion ({(data.ahp.weight_completion * 100).toFixed(0)}%), Lead Time (
              {(data.ahp.weight_lead_time * 100).toFixed(0)}%), Zero Claim (
              {(data.ahp.weight_claim * 100).toFixed(0)}%), Capacity ({(data.ahp.weight_capacity * 100).toFixed(0)}%).
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-3 px-4">Kode</th>
                  <th className="py-3 px-4">Perusahaan Transporter</th>
                  <th className="py-3 px-3 text-right">Total</th>
                  <th className="py-3 px-3 text-right">On-Time</th>
                  <th className="py-3 px-3 text-right">Late</th>
                  <th className="py-3 px-3 text-right">OTD %</th>
                  <th className="py-3 px-3 text-right">Comp %</th>
                  <th className="py-3 px-3 text-right">Lead Time</th>
                  <th className="py-3 px-3 text-right">Claim %</th>
                  <th className="py-3 px-3 text-right">Cap %</th>
                  <th className="py-3 px-4 text-right">AHP Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {data.transporters.map((t) => (
                  <tr key={t.transporter_code} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono text-slate-600">{t.transporter_code}</td>
                    <td className="py-3 px-4 font-semibold text-slate-900">{t.transporter_name}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">{t.total_orders}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">{t.on_time_orders}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-rose-700">{t.late_orders}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">{t.otd_pct}%</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">{t.completion_pct}%</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">{t.avg_lead_time_hours} jam</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">{t.claim_rate_pct}%</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">{t.capacity_fulfillment_pct}%</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                      {t.ahp_score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'track-record') {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Track Record Historis Transporter</h2>
            <p className="text-xs text-slate-500">Pilih transporter untuk meninjau riwayat pengiriman per bulan.</p>
          </div>
          <select
            value={selectedCode}
            onChange={(e) => onSelectTransporterCode(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 focus:border-emerald-700 focus:outline-none"
          >
            {data.transporters.map((t) => (
              <option key={t.transporter_code} value={t.transporter_code}>
                {t.transporter_code} — {t.transporter_name}
              </option>
            ))}
          </select>
        </div>

        {trackLoading && (
          <div className="h-64 rounded-xl border border-slate-200 bg-white animate-pulse" />
        )}

        {!trackLoading && trackDetail && trackDetail.hasHistoricalData && trackDetail.summary && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Total Order</div>
                <div className="mt-1 text-xl font-bold font-mono tabular-nums">{trackDetail.summary.total_orders}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Completed Order</div>
                <div className="mt-1 text-xl font-bold font-mono tabular-nums">{trackDetail.summary.completed_orders}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">On-Time Delivery</div>
                <div className="mt-1 text-xl font-bold font-mono tabular-nums text-emerald-700">
                  {trackDetail.summary.on_time_orders} ({trackDetail.summary.otd_pct}%)
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Late Delivery</div>
                <div className="mt-1 text-xl font-bold font-mono tabular-nums text-rose-700">
                  {trackDetail.summary.late_orders}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Skor AHP</div>
                <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">
                  {trackDetail.summary.ahp_score}
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-4">
                Grafik On-Time vs Late Delivery per Bulan
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trackDetail.monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="period_month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="on_time_orders" name="On-Time" fill="#0F766E" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="late_orders" name="Terlambat" fill="#E11D48" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 font-bold text-sm text-slate-900">
                Riwayat Evaluasi Bulanan
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2.5 px-4">Periode</th>
                      <th className="py-2.5 px-4">Koridor</th>
                      <th className="py-2.5 px-3">Armada</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                      <th className="py-2.5 px-3 text-right">Completed</th>
                      <th className="py-2.5 px-3 text-right">OTD %</th>
                      <th className="py-2.5 px-3 text-right">Lead Time</th>
                      <th className="py-2.5 px-4 text-right">Claim %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {trackDetail.monthly.map((m) => (
                      <tr key={m.period_month} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono">{m.period_month}</td>
                        <td className="py-2.5 px-4">{m.route_corridor}</td>
                        <td className="py-2.5 px-3">{m.fleet_category}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{m.total_orders}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{m.completed_orders}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                          {m.otd_pct}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{m.avg_lead_time_hours} jam</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{m.claim_rate_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  if (view === 'kpi') {
    const handleDownloadKpiCsv = () => {
      if (!data || data.transporters.length === 0) return;
      downloadAggregatedKpiCsv(data.transporters, {
        period,
        corridor,
        fleet,
        search,
      });
    };

    return (
      <div className="space-y-6">
        {filterBar}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Monitoring Kepatuhan Target KPI Transporter</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Ambang standar SLA: OTD &ge; 90%, Order Completion &ge; 95%, Lead Time &le; 20 jam, Claim &le; 1.0%, Capacity &ge; 90%.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadKpiCsv}
              disabled={data.transporters.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-3 px-4">Transporter</th>
                  <th className="py-3 px-3 text-right">OTD (&ge;90%)</th>
                  <th className="py-3 px-3 text-right">Completion (&ge;95%)</th>
                  <th className="py-3 px-3 text-right">Lead Time (&le;20j)</th>
                  <th className="py-3 px-3 text-right">Claim (&le;1.0%)</th>
                  <th className="py-3 px-3 text-right">Capacity (&ge;90%)</th>
                  <th className="py-3 px-4 text-right">Status SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.transporters.map((t) => {
                  const metCount = [
                    t.otd_pct >= 90,
                    t.completion_pct >= 95,
                    t.avg_lead_time_hours <= 20,
                    t.claim_rate_pct <= 1,
                    t.capacity_fulfillment_pct >= 90,
                  ].filter(Boolean).length;
                  return (
                    <tr key={t.transporter_code} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{t.transporter_name}</div>
                        <div className="text-[11px] font-mono text-slate-500">{t.transporter_code}</div>
                      </td>
                      <td className={`py-3 px-3 text-right font-mono tabular-nums font-semibold ${t.otd_pct >= 90 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {t.otd_pct}%
                      </td>
                      <td className={`py-3 px-3 text-right font-mono tabular-nums font-semibold ${t.completion_pct >= 95 ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {t.completion_pct}%
                      </td>
                      <td className={`py-3 px-3 text-right font-mono tabular-nums font-semibold ${t.avg_lead_time_hours <= 20 ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {t.avg_lead_time_hours} j
                      </td>
                      <td className={`py-3 px-3 text-right font-mono tabular-nums font-semibold ${t.claim_rate_pct <= 1 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {t.claim_rate_pct}%
                      </td>
                      <td className={`py-3 px-3 text-right font-mono tabular-nums font-semibold ${t.capacity_fulfillment_pct >= 90 ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {t.capacity_fulfillment_pct}%
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-slate-700 tabular-nums">
                        {metCount}/5 Kriteria Terpenuhi
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // view === 'ahp'
  const workingMatrix =
    matrix.length === 5
      ? matrix
      : [
          [1, 2, 3, 2, 4],
          [0.5, 1, 2, 1, 3],
          [0.3333, 0.5, 1, 0.5, 2],
          [0.5, 1, 2, 1, 3],
          [0.25, 0.3333, 0.5, 0.3333, 1],
        ];
  const preview = computeAhpPreview(workingMatrix);
  const saatyOptions = [
    { label: '9 (Mutlak lebih penting)', val: 9 },
    { label: '7 (Sangat jauh lebih penting)', val: 7 },
    { label: '5 (Lebih penting)', val: 5 },
    { label: '3 (Sedikit lebih penting)', val: 3 },
    { label: '2 (Antara 1 & 3)', val: 2 },
    { label: '1 (Sama penting)', val: 1 },
    { label: '1/2 (0.5)', val: 0.5 },
    { label: '1/3 (0.33)', val: 0.3333 },
    { label: '1/5 (0.20)', val: 0.2 },
    { label: '1/7 (0.14)', val: 0.1429 },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Analytic Hierarchy Process (AHP) Weighting</h2>
            <p className="text-xs text-slate-500 mt-1">
              Pembobotan kriteria KPI evaluasi transporter berdasarkan skala Saaty (1–9). Syarat konsistensi: CR &lt; 0.10.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Consistency Ratio (CR)</div>
            <div
              className={`text-lg font-bold font-mono tabular-nums ${
                preview.cr < 0.1 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {preview.cr.toFixed(4)} {preview.cr < 0.1 ? '(Konsisten)' : '(Tidak Konsisten)'}
            </div>
          </div>
        </div>

        {ahpMsg && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs ${
              ahpMsg.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {ahpMsg.type === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span>{ahpMsg.text}</span>
          </div>
        )}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="py-2.5 px-3 font-semibold text-slate-700">Kriteria</th>
                {AHP_CRITERIA.map((c) => (
                  <th key={c.key} className="py-2.5 px-3 font-semibold text-slate-700">
                    {c.label}
                  </th>
                ))}
                <th className="py-2.5 px-3 text-right font-bold text-emerald-800">Bobot Prioritas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {AHP_CRITERIA.map((rowCrit, i) => (
                <tr key={rowCrit.key}>
                  <td className="py-2.5 px-3 font-semibold text-slate-900 whitespace-nowrap">{rowCrit.label}</td>
                  {AHP_CRITERIA.map((colCrit, j) => (
                    <td key={colCrit.key} className="py-2 px-3">
                      {i === j ? (
                        <span className="font-mono text-slate-400">1.00</span>
                      ) : i < j && userRole === 'admin' ? (
                        <select
                          value={workingMatrix[i][j]}
                          onChange={(e) => updateMatrixCell(i, j, Number(e.target.value))}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-mono"
                        >
                          {!saatyOptions.some((o) => Math.abs(o.val - workingMatrix[i][j]) < 0.01) && (
                            <option value={workingMatrix[i][j]}>{workingMatrix[i][j].toFixed(2)}</option>
                          )}
                          {saatyOptions.map((opt) => (
                            <option key={opt.val} value={opt.val}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-mono tabular-nums text-slate-600">
                          {workingMatrix[i][j].toFixed(2)}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-800">
                    {(preview.weights[i] * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {userRole === 'admin' ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-200">
            <input
              type="text"
              value={ahpName}
              onChange={(e) => setAhpName(e.target.value)}
              placeholder="Nama model bobot AHP"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs w-full sm:w-80 focus:border-emerald-700 focus:outline-none"
            />
            <button
              type="button"
              disabled={ahpSaving || preview.cr >= 0.1}
              onClick={handleSaveAhp}
              className="rounded-lg bg-[#0F2A24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163C33] disabled:opacity-50 transition-colors"
            >
              {ahpSaving ? 'Menyimpan...' : 'Simpan & Terapkan Bobot AHP'}
            </button>
          </div>
        ) : (
          <p className="mt-4 text-xs text-slate-500">
            Mode lihat (read-only). Hanya Super Admin yang dapat memperbarui matriks perbandingan AHP.
          </p>
        )}
      </div>
    </div>
  );
}
