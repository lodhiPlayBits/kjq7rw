import type { Metrics, MetricsGroup } from './api'

const MINUS = '−'

/** "12.3% lower" / "4.0% higher" for value relative to reference. */
export function relativeWording(value: number, reference: number): string | null {
  if (!reference) return null
  const change = value / reference - 1
  return `${(Math.abs(change) * 100).toFixed(1)}% ${change <= 0 ? 'lower' : 'higher'}`
}

/** Signed percentage, e.g. "+30.3%" or "−3.0%". */
export function signedPct(fraction: number): string {
  return `${fraction >= 0 ? '+' : MINUS}${(Math.abs(fraction) * 100).toFixed(1)}%`
}

export type MetricKey = 'mae' | 'rmse' | 'bias' | 'p90'

export const METRICS: { key: MetricKey; label: string; help: string }[] = [
  { key: 'mae', label: 'MAE', help: 'Mean absolute error, MW' },
  { key: 'rmse', label: 'RMSE', help: 'Root mean square error, MW: weights big misses more' },
  { key: 'bias', label: 'Bias', help: 'Mean of forecast − actual, MW: positive = over-forecast' },
  { key: 'p90', label: 'P90', help: '90th percentile of absolute error, MW' },
]

/** Lead buckets inside the day-ahead decision window (realised lead 20–28 h). */
export function isDayAheadBucket(key: number, bucketHours: number): boolean {
  const start = key * bucketHours
  return start >= 20 && start + bucketHours <= 28
}

export interface CalendarCell {
  date: string
  group: MetricsGroup | null
}

/** Monday-first weeks covering every day from the first to the last group, padded with nulls. */
export function calendarWeeks(groups: MetricsGroup[]): (CalendarCell | null)[][] {
  if (groups.length === 0) return []
  const byDate = new Map(groups.map((g) => [String(g.key), g]))
  const DAY = 86_400_000
  const first = Date.parse(`${groups[0].key}T00:00:00Z`)
  const last = Date.parse(`${groups[groups.length - 1].key}T00:00:00Z`)
  if (Number.isNaN(first) || Number.isNaN(last) || last < first) return [] // keys are not ISO dates
  const lead = (new Date(first).getUTCDay() + 6) % 7 // Monday = 0
  const cells: (CalendarCell | null)[] = Array(lead).fill(null)
  for (let t = first; t <= last; t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10)
    cells.push({ date, group: byDate.get(date) ?? null })
  }
  while (cells.length % 7) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** Axis ticks that always include 0, so bars start at zero even when every value has the same sign. */
export function zeroBasedTicks(values: number[], step: number): number[] {
  const lo = Math.min(0, Math.floor(Math.min(0, ...values) / step) * step)
  const hi = Math.max(step, Math.ceil(Math.max(0, ...values) / step) * step)
  const ticks = []
  for (let v = lo; v <= hi; v += step) ticks.push(v)
  return ticks
}

/** Mean of a metric over groups, weighted by sample count (pooled MAE/bias for the combined rows). */
export function weightedMean(groups: Metrics[], metric: MetricKey): number | null {
  const n = groups.reduce((s, g) => s + g.n, 0)
  return n ? groups.reduce((s, g) => s + g[metric] * g.n, 0) / n : null
}

/**
 * Direction of a systematic bias: 'high' / 'low' only when the bias at the chosen horizon and in
 * every lead bucket has the same non-zero sign; otherwise null (no consistent lean to report).
 */
export function consistentBias(overallBias: number, leadGroups: Metrics[]): 'high' | 'low' | null {
  const sign = Math.sign(overallBias)
  if (sign === 0 || leadGroups.length === 0) return null
  return leadGroups.every((g) => Math.sign(g.bias) === sign) ? (sign > 0 ? 'high' : 'low') : null
}

/** Diverging colour for signed values: blue below zero, white-ish at zero, red above. */
export function divergingColour(value: number, maxAbs: number): string {
  const t = maxAbs > 0 ? Math.min(1, Math.abs(value) / maxAbs) : 0
  const mid = [244, 246, 250]
  const end = value < 0 ? [62, 123, 250] : [229, 72, 77]
  const c = mid.map((v, i) => Math.round(v + (end[i] - v) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/** Colour from pale teal (low error) to red (high) on a 0..1 scale. */
export function heatColour(value: number, min: number, max: number): string {
  const t = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0
  const lo = [219, 245, 242]
  const hi = [229, 72, 77]
  const c = lo.map((v, i) => Math.round(v + (hi[i] - v) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

export function worst<T extends Metrics>(groups: T[], metric: MetricKey = 'mae', count = 1): T[] {
  return [...groups].sort((a, b) => Math.abs(b[metric]) - Math.abs(a[metric])).slice(0, count)
}

/** Ratio of the last to the first lead bucket for a metric, e.g. 1.3 = 30% worse at the longest lead. */
export function growth(groups: MetricsGroup[], metric: MetricKey = 'mae'): number | null {
  if (groups.length < 2 || groups[0][metric] === 0) return null
  return groups[groups.length - 1][metric] / groups[0][metric]
}
