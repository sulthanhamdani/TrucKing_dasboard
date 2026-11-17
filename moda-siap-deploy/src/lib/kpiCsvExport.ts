import type { TransporterKpiSummary } from '../../shared/types.ts';

export interface KpiCsvFilterContext {
  period: string;
  corridor: string;
  fleet: string;
  search: string;
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Aggregates the current filtered transporter KPI dataset into a UTF-8 BOM CSV string,
 * including per-transporter SLA compliance breakdown and an aggregate TOTAL / RATA-RATA row.
 */
export function buildAggregatedKpiCsv(
  transporters: TransporterKpiSummary[],
  filters: KpiCsvFilterContext
): string {
  const headers = [
    'Kode Transporter',
    'Nama Transporter',
    'Koridor Rute',
    'Armada',
    'Total Orders',
    'Completed Orders',
    'On-Time Orders',
    'Late Orders',
    'OTD (%)',
    'Target OTD (>=90%)',
    'Completion (%)',
    'Target Completion (>=95%)',
    'Avg Lead Time (Jam)',
    'Target Lead Time (<=20j)',
    'Claim Rate (%)',
    'Target Claim (<=1.0%)',
    'Capacity Fulfillment (%)',
    'Target Capacity (>=90%)',
    'Skor AHP',
    'Kriteria SLA Terpenuhi',
  ];

  const dataRows = transporters.map((t) => {
    const passOtd = t.otd_pct >= 90;
    const passComp = t.completion_pct >= 95;
    const passLead = t.avg_lead_time_hours <= 20;
    const passClaim = t.claim_rate_pct <= 1;
    const passCap = t.capacity_fulfillment_pct >= 90;
    const metCount = [passOtd, passComp, passLead, passClaim, passCap].filter(Boolean).length;

    return [
      escapeCsvCell(t.transporter_code),
      escapeCsvCell(t.transporter_name),
      escapeCsvCell(t.corridors.join('; ')),
      escapeCsvCell(t.fleets.join('; ')),
      t.total_orders,
      t.completed_orders,
      t.on_time_orders,
      t.late_orders,
      t.otd_pct.toFixed(1),
      escapeCsvCell(passOtd ? 'Memenuhi' : 'Tidak Memenuhi'),
      t.completion_pct.toFixed(1),
      escapeCsvCell(passComp ? 'Memenuhi' : 'Tidak Memenuhi'),
      t.avg_lead_time_hours.toFixed(1),
      escapeCsvCell(passLead ? 'Memenuhi' : 'Tidak Memenuhi'),
      t.claim_rate_pct.toFixed(2),
      escapeCsvCell(passClaim ? 'Memenuhi' : 'Tidak Memenuhi'),
      t.capacity_fulfillment_pct.toFixed(1),
      escapeCsvCell(passCap ? 'Memenuhi' : 'Tidak Memenuhi'),
      t.ahp_score.toFixed(2),
      escapeCsvCell(`${metCount}/5`),
    ].join(',');
  });

  // Aggregate totals and weighted averages across all current transporters
  const totalOrders = transporters.reduce((acc, t) => acc + t.total_orders, 0);
  const completedOrders = transporters.reduce((acc, t) => acc + t.completed_orders, 0);
  const onTimeOrders = transporters.reduce((acc, t) => acc + t.on_time_orders, 0);
  const lateOrders = transporters.reduce((acc, t) => acc + t.late_orders, 0);

  const aggOtdPct = completedOrders > 0 ? (onTimeOrders / completedOrders) * 100 : 0;
  const aggCompletionPct = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
  const aggLeadTime =
    completedOrders > 0
      ? transporters.reduce((acc, t) => acc + t.avg_lead_time_hours * t.completed_orders, 0) / completedOrders
      : 0;
  const aggClaimRate =
    completedOrders > 0
      ? transporters.reduce((acc, t) => acc + t.claim_rate_pct * t.completed_orders, 0) / completedOrders
      : 0;
  const aggCapacity =
    transporters.length > 0
      ? transporters.reduce((acc, t) => acc + t.capacity_fulfillment_pct, 0) / transporters.length
      : 0;
  const aggAhp =
    transporters.length > 0
      ? transporters.reduce((acc, t) => acc + t.ahp_score, 0) / transporters.length
      : 0;

  const filterLabel = [
    filters.period !== 'all' ? `Periode:${filters.period}` : 'Semua Periode',
    filters.corridor !== 'all' ? `Rute:${filters.corridor}` : 'Semua Rute',
    filters.fleet !== 'all' ? `Armada:${filters.fleet}` : 'Semua Armada',
    filters.search ? `Cari:${filters.search}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const summaryRow = [
    escapeCsvCell('TOTAL / RATA-RATA'),
    escapeCsvCell(`${transporters.length} Transporter`),
    escapeCsvCell(filterLabel),
    escapeCsvCell('-'),
    totalOrders,
    completedOrders,
    onTimeOrders,
    lateOrders,
    aggOtdPct.toFixed(1),
    escapeCsvCell(aggOtdPct >= 90 ? 'Memenuhi' : 'Tidak Memenuhi'),
    aggCompletionPct.toFixed(1),
    escapeCsvCell(aggCompletionPct >= 95 ? 'Memenuhi' : 'Tidak Memenuhi'),
    aggLeadTime.toFixed(1),
    escapeCsvCell(aggLeadTime <= 20 ? 'Memenuhi' : 'Tidak Memenuhi'),
    aggClaimRate.toFixed(2),
    escapeCsvCell(aggClaimRate <= 1 ? 'Memenuhi' : 'Tidak Memenuhi'),
    aggCapacity.toFixed(1),
    escapeCsvCell(aggCapacity >= 90 ? 'Memenuhi' : 'Tidak Memenuhi'),
    aggAhp.toFixed(2),
    escapeCsvCell('-'),
  ].join(',');

  return '\uFEFF' + [headers.join(','), ...dataRows, summaryRow].join('\n');
}

/**
 * Triggers a browser file download of the aggregated KPI CSV for offline analysis.
 */
export function downloadAggregatedKpiCsv(
  transporters: TransporterKpiSummary[],
  filters: KpiCsvFilterContext
): void {
  if (transporters.length === 0) return;

  const csvContent = buildAggregatedKpiCsv(transporters, filters);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const periodSlug = filters.period !== 'all' ? filters.period : 'all';
  const dateStamp = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `moda_kpi_monitoring_${periodSlug}_${dateStamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
