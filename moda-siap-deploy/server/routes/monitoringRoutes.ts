import { Router } from 'express';
import { db, runInTransaction } from '../db.ts';
import { getClientIp, logActivity, requireAuth, requireRole } from '../auth.ts';
import type { AuthenticatedRequest } from '../auth.ts';
import type { AhpAssessment, TransporterKpiSummary } from '../../shared/types.ts';

export const monitoringRouter = Router();

monitoringRouter.use(requireAuth);

interface HistoricalRow {
  id: number;
  transporter_code: string;
  transporter_name: string;
  period_month: string;
  total_orders: number;
  completed_orders: number;
  on_time_orders: number;
  late_orders: number;
  avg_lead_time_hours: number;
  claim_rate_pct: number;
  capacity_fulfillment_pct: number;
  route_corridor: string;
  fleet_category: string;
}

export function getActiveAhpAssessment(): AhpAssessment {
  const row = db.prepare(`
    SELECT id, name, weight_otd, weight_completion, weight_lead_time, weight_claim, weight_capacity,
           consistency_ratio, pairwise_matrix, is_active, created_at
    FROM ahp_assessments
    WHERE is_active = 1
    ORDER BY id DESC LIMIT 1
  `).get() as {
    id: number;
    name: string;
    weight_otd: number;
    weight_completion: number;
    weight_lead_time: number;
    weight_claim: number;
    weight_capacity: number;
    consistency_ratio: number;
    pairwise_matrix: string;
    is_active: number;
    created_at: string;
  };

  return {
    ...row,
    pairwise_matrix: JSON.parse(row.pairwise_matrix || '[]'),
  };
}

export function computeKpiFromRows(rows: HistoricalRow[], ahp: AhpAssessment): TransporterKpiSummary[] {
  const grouped = new Map<string, HistoricalRow[]>();
  for (const r of rows) {
    const list = grouped.get(r.transporter_code) ?? [];
    list.push(r);
    grouped.set(r.transporter_code, list);
  }

  const summaries: TransporterKpiSummary[] = [];
  for (const [code, items] of grouped.entries()) {
    const totalOrders = items.reduce((s, x) => s + x.total_orders, 0);
    const completedOrders = items.reduce((s, x) => s + x.completed_orders, 0);
    const onTimeOrders = items.reduce((s, x) => s + x.on_time_orders, 0);
    const lateOrders = items.reduce((s, x) => s + x.late_orders, 0);
    const avgLeadTime =
      items.reduce((s, x) => s + x.avg_lead_time_hours * x.completed_orders, 0) /
      Math.max(1, completedOrders);
    const avgClaimRate =
      items.reduce((s, x) => s + x.claim_rate_pct * x.completed_orders, 0) /
      Math.max(1, completedOrders);
    const avgCapacity =
      items.reduce((s, x) => s + x.capacity_fulfillment_pct, 0) / Math.max(1, items.length);

    const otdPct = completedOrders > 0 ? (onTimeOrders / completedOrders) * 100 : 0;
    const completionPct = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;

    // Normalize Lead Time (14h -> 100, 32h -> 40) & Zero-Claim Score (0% claim -> 100, 5% -> 50)
    const leadTimeScore = Math.max(20, Math.min(100, 100 - ((avgLeadTime - 14) / 18) * 60));
    const zeroClaimScore = Math.max(0, Math.min(100, 100 - avgClaimRate * 15));

    const ahpScore =
      otdPct * ahp.weight_otd +
      completionPct * ahp.weight_completion +
      leadTimeScore * ahp.weight_lead_time +
      zeroClaimScore * ahp.weight_claim +
      avgCapacity * ahp.weight_capacity;

    summaries.push({
      transporter_code: code,
      transporter_name: items[0].transporter_name,
      total_orders: totalOrders,
      completed_orders: completedOrders,
      on_time_orders: onTimeOrders,
      late_orders: lateOrders,
      otd_pct: Number(otdPct.toFixed(1)),
      completion_pct: Number(completionPct.toFixed(1)),
      avg_lead_time_hours: Number(avgLeadTime.toFixed(1)),
      claim_rate_pct: Number(avgClaimRate.toFixed(2)),
      capacity_fulfillment_pct: Number(avgCapacity.toFixed(1)),
      ahp_score: Number(ahpScore.toFixed(2)),
      corridors: Array.from(new Set(items.map((i) => i.route_corridor))),
      fleets: Array.from(new Set(items.map((i) => i.fleet_category))),
    });
  }

  return summaries.sort((a, b) => b.ahp_score - a.ahp_score);
}

monitoringRouter.get('/summary', (req, res) => {
  const { period, corridor, fleet, search } = req.query;
  const conditions: string[] = ['1=1'];
  const params: string[] = [];

  if (period && typeof period === 'string' && period !== 'all') {
    conditions.push('period_month = ?');
    params.push(period);
  }
  if (corridor && typeof corridor === 'string' && corridor !== 'all') {
    conditions.push('route_corridor = ?');
    params.push(corridor);
  }
  if (fleet && typeof fleet === 'string' && fleet !== 'all') {
    conditions.push('fleet_category = ?');
    params.push(fleet);
  }
  if (search && typeof search === 'string' && search.trim()) {
    conditions.push('(LOWER(transporter_name) LIKE ? OR LOWER(transporter_code) LIKE ?)');
    const q = `%${search.trim().toLowerCase()}%`;
    params.push(q, q);
  }

  const rows = db.prepare(`
    SELECT * FROM historical_shipments
    WHERE ${conditions.join(' AND ')}
    ORDER BY period_month ASC, transporter_code ASC
  `).all(...params) as unknown as HistoricalRow[];

  const ahp = getActiveAhpAssessment();
  const transporters = computeKpiFromRows(rows, ahp);

  // Aggregate monthly trend across filtered rows
  const monthMap = new Map<string, { total: number; completed: number; onTime: number; late: number }>();
  for (const r of rows) {
    const cur = monthMap.get(r.period_month) ?? { total: 0, completed: 0, onTime: 0, late: 0 };
    cur.total += r.total_orders;
    cur.completed += r.completed_orders;
    cur.onTime += r.on_time_orders;
    cur.late += r.late_orders;
    monthMap.set(r.period_month, cur);
  }

  const monthlyTrend = Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, m]) => ({
      month,
      total_orders: m.total,
      completed_orders: m.completed,
      on_time_orders: m.onTime,
      late_orders: m.late,
      otd_pct: m.completed > 0 ? Number(((m.onTime / m.completed) * 100).toFixed(1)) : 0,
    }));

  const totalOrders = transporters.reduce((s, t) => s + t.total_orders, 0);
  const completedOrders = transporters.reduce((s, t) => s + t.completed_orders, 0);
  const onTimeOrders = transporters.reduce((s, t) => s + t.on_time_orders, 0);
  const lateOrders = transporters.reduce((s, t) => s + t.late_orders, 0);
  const avgOtd = completedOrders > 0 ? Number(((onTimeOrders / completedOrders) * 100).toFixed(1)) : 0;
  const avgAhpScore =
    transporters.length > 0
      ? Number((transporters.reduce((s, t) => s + t.ahp_score, 0) / transporters.length).toFixed(1))
      : 0;

  const allPeriods = (
    db.prepare(`SELECT DISTINCT period_month FROM historical_shipments ORDER BY period_month ASC`).all() as Array<{
      period_month: string;
    }>
  ).map((p) => p.period_month);
  const allCorridors = (
    db.prepare(`SELECT DISTINCT route_corridor FROM historical_shipments ORDER BY route_corridor ASC`).all() as Array<{
      route_corridor: string;
    }>
  ).map((c) => c.route_corridor);
  const allFleets = (
    db.prepare(`SELECT DISTINCT fleet_category FROM historical_shipments ORDER BY fleet_category ASC`).all() as Array<{
      fleet_category: string;
    }>
  ).map((f) => f.fleet_category);

  res.json({
    overview: {
      total_transporters: transporters.length,
      total_orders: totalOrders,
      completed_orders: completedOrders,
      on_time_orders: onTimeOrders,
      late_orders: lateOrders,
      avg_otd_pct: avgOtd,
      avg_ahp_score: avgAhpScore,
    },
    transporters,
    monthlyTrend,
    ahp,
    filterOptions: {
      periods: allPeriods,
      corridors: allCorridors,
      fleets: allFleets,
    },
  });
});

monitoringRouter.get('/transporter/:code', (req, res) => {
  const code = req.params.code;
  const rows = db.prepare(`
    SELECT * FROM historical_shipments
    WHERE transporter_code = ?
    ORDER BY period_month ASC
  `).all(code) as unknown as HistoricalRow[];

  if (rows.length === 0) {
    res.json({ hasHistoricalData: false, summary: null, monthly: [] });
    return;
  }

  const ahp = getActiveAhpAssessment();
  const [summary] = computeKpiFromRows(rows, ahp);
  const monthly = rows.map((r) => ({
    period_month: r.period_month,
    total_orders: r.total_orders,
    completed_orders: r.completed_orders,
    on_time_orders: r.on_time_orders,
    late_orders: r.late_orders,
    otd_pct: r.completed_orders > 0 ? Number(((r.on_time_orders / r.completed_orders) * 100).toFixed(1)) : 0,
    avg_lead_time_hours: r.avg_lead_time_hours,
    claim_rate_pct: r.claim_rate_pct,
    capacity_fulfillment_pct: r.capacity_fulfillment_pct,
    route_corridor: r.route_corridor,
    fleet_category: r.fleet_category,
  }));

  res.json({ hasHistoricalData: true, summary, monthly });
});

monitoringRouter.get('/ahp', (_req, res) => {
  const active = getActiveAhpAssessment();
  const history = db.prepare(`
    SELECT id, name, weight_otd, weight_completion, weight_lead_time, weight_claim, weight_capacity,
           consistency_ratio, is_active, created_at
    FROM ahp_assessments
    ORDER BY id DESC LIMIT 10
  `).all();
  res.json({ active, history });
});

monitoringRouter.put('/ahp', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const { name, matrix } = req.body ?? {};
  if (!Array.isArray(matrix) || matrix.length !== 5 || matrix.some((r) => !Array.isArray(r) || r.length !== 5)) {
    res.status(400).json({ error: 'Matriks AHP harus berukuran 5x5.' });
    return;
  }

  // Validate positive reciprocal values and compute priority vector via column normalization
  const n = 5;
  const parsed: number[][] = matrix.map((row: unknown[]) =>
    row.map((val) => {
      const num = Number(val);
      return Number.isFinite(num) && num > 0 ? num : 1;
    })
  );

  const colSums = Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      colSums[j] += parsed[i][j];
    }
  }

  const weights = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      rowSum += parsed[i][j] / colSums[j];
    }
    weights[i] = rowSum / n;
  }

  // Compute lambda_max, CI, CR (RI for n=5 is 1.12)
  let lambdaMax = 0;
  for (let i = 0; i < n; i++) {
    let aw = 0;
    for (let j = 0; j < n; j++) {
      aw += parsed[i][j] * weights[j];
    }
    lambdaMax += aw / weights[i];
  }
  lambdaMax /= n;
  const ci = (lambdaMax - n) / (n - 1);
  const ri = 1.12;
  const cr = Number((Math.max(0, ci) / ri).toFixed(4));

  if (cr >= 0.1) {
    res.status(400).json({
      error: `Consistency Ratio (CR = ${cr}) melebihi batas konsistensi (< 0.10). Sesuaikan perbandingan berpasangan.`,
      consistency_ratio: cr,
      weights,
    });
    return;
  }

  const assessmentName = String(name || 'Model Bobot AHP Diperbarui').trim();
  const [wOtd, wComp, wLead, wClaim, wCap] = weights.map((w) => Number(w.toFixed(4)));

  runInTransaction(() => {
    db.prepare(`UPDATE ahp_assessments SET is_active = 0`).run();
    db.prepare(`
      INSERT INTO ahp_assessments (
        name, weight_otd, weight_completion, weight_lead_time, weight_claim, weight_capacity,
        consistency_ratio, pairwise_matrix, updated_by, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      assessmentName,
      wOtd,
      wComp,
      wLead,
      wClaim,
      wCap,
      cr,
      JSON.stringify(parsed),
      req.authUser!.id
    );

    logActivity({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userRole: req.authUser!.role,
      activityType: 'AHP_WEIGHTS_UPDATED',
      detail: `Admin ${req.authUser!.username} menyimpan bobot AHP baru (CR=${cr}): OTD=${(wOtd * 100).toFixed(1)}%, Completion=${(wComp * 100).toFixed(1)}%.`,
      status: 'success',
      ipAddress: getClientIp(req),
    });
  });

  res.json({
    message: 'Bobot AHP berhasil disimpan dan diterapkan pada perhitungan KPI Monitoring.',
    active: getActiveAhpAssessment(),
  });
});
