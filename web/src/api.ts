export interface Health {
  status: string
  actuals: number
  forecasts: number
}

export interface Meta {
  hmax: number
  default_horizon_h: number
  lead_bucket_hours: number
  max_lead_hours: number
  decision_window: [string, string]
}

/** Error metrics in MW; nmae is a fraction of mean actual output. Null when there is nothing to measure. */
export interface Metrics {
  n: number
  mae: number
  rmse: number
  bias: number
  p50: number
  p90: number
  nmae: number | null
}

export interface SeriesPoint {
  start_time: string
  actual: number
  forecast: number | null
  publish_time: string | null
  decision_time: string
  lead_hours: number | null
  error: number | null
}

export interface Series {
  horizon_h: number
  window: [string, string]
  actual: { start_time: string; generation: number }[]
  points: SeriesPoint[]
  summary: Metrics | null
}

export interface MetricsGroup extends Metrics {
  key: number | string
  label: string
}

export interface GroupedMetrics {
  by: 'lead' | 'hour' | 'day'
  horizon_h: number | null
  groups: MetricsGroup[]
  overall: Metrics | null
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(path, { signal })
  if (!resp.ok) {
    throw new Error(`API responded ${resp.status}`)
  }
  return (await resp.json()) as T
}

export function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return getJson<Health>('/api/health', signal)
}

export function fetchMeta(signal?: AbortSignal): Promise<Meta> {
  return getJson<Meta>('/api/meta', signal)
}

export function fetchSeries(params: { horizon: number; from: string; to: string }, signal?: AbortSignal): Promise<Series> {
  const q = new URLSearchParams({ horizon_h: String(params.horizon), from: params.from, to: params.to })
  return getJson<Series>(`/api/series?${q}`, signal)
}

export function fetchMetrics(by: GroupedMetrics['by'], horizon?: number, signal?: AbortSignal): Promise<GroupedMetrics> {
  const q = new URLSearchParams({ by })
  if (horizon !== undefined) q.set('horizon_h', String(horizon))
  return getJson<GroupedMetrics>(`/api/metrics?${q}`, signal)
}
