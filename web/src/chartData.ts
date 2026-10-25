import type { Series, SeriesPoint } from './api'

export interface ChartRow {
  t: number
  actual: number | null
  forecast: number | null
  error: number | null
  /** [low, high] between forecast and actual, for the shaded gap. */
  gap: [number, number] | null
  point: SeriesPoint | null
}

/** Merge half-hourly actuals with hourly forecast points into one time-sorted row list. */
export function buildRows(series: Series): ChartRow[] {
  const rows = new Map<number, ChartRow>()
  const row = (t: number) => {
    let r = rows.get(t)
    if (!r) {
      r = { t, actual: null, forecast: null, error: null, gap: null, point: null }
      rows.set(t, r)
    }
    return r
  }
  for (const a of series.actual) row(Date.parse(a.start_time)).actual = a.generation
  for (const p of series.points) {
    const r = row(Date.parse(p.start_time))
    r.point = p
    if (p.forecast !== null) {
      r.forecast = p.forecast
      r.error = p.error
      r.gap = [Math.min(p.forecast, p.actual), Math.max(p.forecast, p.actual)]
    }
  }
  return [...rows.values()].sort((a, b) => a.t - b.t)
}

/** The matched point with the largest absolute error, used as the initial selection. */
export function worstPoint(points: SeriesPoint[]): SeriesPoint | null {
  let worst: SeriesPoint | null = null
  for (const p of points) {
    if (p.error !== null && (worst === null || Math.abs(p.error) > Math.abs(worst.error!))) worst = p
  }
  return worst
}

/**
 * The point the side panel describes: the hovered hour looked up in the *current* points (so a
 * horizon change shows the new forecast), else the largest miss.
 */
export function resolveSelection(points: SeriesPoint[], hoveredStart: string | null): { point: SeriesPoint | null; hovered: boolean } {
  const hovered = hoveredStart ? points.find((p) => p.start_time === hoveredStart && p.forecast !== null) : undefined
  return hovered ? { point: hovered, hovered: true } : { point: worstPoint(points), hovered: false }
}

/** Midnight ticks (ms) covering the rows, for day labels on the x axis. */
export function dayTicks(rows: ChartRow[]): number[] {
  if (rows.length === 0) return []
  const DAY = 86_400_000
  const first = Math.ceil(rows[0].t / DAY) * DAY
  const ticks = []
  for (let t = first; t <= rows[rows.length - 1].t; t += DAY) ticks.push(t)
  return ticks
}
