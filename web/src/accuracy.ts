import type { Metrics, MetricsGroup } from './api'

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
