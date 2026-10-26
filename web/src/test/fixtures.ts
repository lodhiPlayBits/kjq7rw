import { vi } from 'vitest'
import type { GroupedMetrics, Meta, MetricsGroup, Series, SeriesPoint } from '../api'

export const META: Meta = {
  hmax: 43,
  default_horizon_h: 24,
  lead_bucket_hours: 4,
  max_lead_hours: 48,
  decision_window: ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'],
}

export function point(start: string, actual: number, forecast: number | null, lead = 24.5): SeriesPoint {
  const t = Date.parse(start)
  return {
    start_time: start,
    actual,
    forecast,
    publish_time: forecast === null ? null : new Date(t - lead * 3_600_000).toISOString().replace('.000Z', 'Z'),
    decision_time: new Date(t - 24 * 3_600_000).toISOString().replace('.000Z', 'Z'),
    lead_hours: forecast === null ? null : lead,
    error: forecast === null ? null : forecast - actual,
  }
}

export const SERIES: Series = {
  horizon_h: 24,
  window: ['2026-01-10T00:00:00Z', '2026-01-13T00:00:00Z'],
  actual: [
    { start_time: '2026-01-10T00:00:00Z', generation: 9000 },
    { start_time: '2026-01-10T00:30:00Z', generation: 9100 },
    { start_time: '2026-01-10T01:00:00Z', generation: 9200 },
    { start_time: '2026-01-11T01:00:00Z', generation: 14048 },
  ],
  points: [
    point('2026-01-10T00:00:00Z', 9000, 9600),
    point('2026-01-10T01:00:00Z', 9200, 8800),
    point('2026-01-11T01:00:00Z', 14048, 20852, 26.5),
  ],
  summary: { n: 3, mae: 2602.7, rmse: 3970.1, bias: 2337.3, p50: 600, p90: 5563.2, nmae: 0.2414 },
}

export function group(key: number | string, label: string, mae: number, bias: number, n = 24): MetricsGroup {
  return { key, label, n, mae, rmse: mae * 1.25, bias, p50: mae * 0.8, p90: mae * 2, nmae: mae / 11_000 }
}

const leadGroups = Array.from({ length: 12 }, (_, i) => group(i, `${i * 4}–${i * 4 + 4} h`, 1750 + i * 50, 1500 + i * 30, 992))
const hourGroups = Array.from({ length: 24 }, (_, h) => group(h, `${String(h).padStart(2, '0')}:00`, h >= 2 && h <= 5 ? 2400 : 1800, 1700))
const dayGroups = Array.from({ length: 31 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 0, 2 + i)).toISOString().slice(0, 10)
  return group(date, date, date === '2026-01-11' ? 5020 : 1500 + i * 20, i === 5 ? -400 : 1600)
})

export const METRICS: Record<'lead' | 'hour' | 'day', GroupedMetrics> = {
  lead: { by: 'lead', horizon_h: null, groups: leadGroups, overall: { n: 11873, mae: 1950, rmse: 2440, bias: 1700, p50: 1600, p90: 3900, nmae: 0.17 } },
  hour: { by: 'hour', horizon_h: 24, groups: hourGroups, overall: { n: 744, mae: 1932.2, rmse: 2399.4, bias: 1736.2, p50: 1620.5, p90: 3849.8, nmae: 0.1712 } },
  day: { by: 'day', horizon_h: 24, groups: dayGroups, overall: { n: 744, mae: 1932.2, rmse: 2399.4, bias: 1736.2, p50: 1620.5, p90: 3849.8, nmae: 0.1712 } },
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

/** Stubs fetch with the fixture API; ``overrides`` replace responses by path prefix (e.g. '/api/series'). */
export function stubApi(overrides: Record<string, () => Promise<Response>> = {}) {
  const fetchMock = vi.fn((input: string) => {
    const url = new URL(input, 'http://localhost')
    // Override keys match the path, optionally with the query too (e.g. '/api/metrics?by=lead').
    for (const [prefix, respond] of Object.entries(overrides)) if (`${url.pathname}${url.search}`.startsWith(prefix)) return respond()
    if (url.pathname === '/api/meta') return json(META)
    if (url.pathname === '/api/series') return json({ ...SERIES, horizon_h: Number(url.searchParams.get('horizon_h')) })
    if (url.pathname === '/api/metrics') {
      const by = url.searchParams.get('by') as 'lead' | 'hour' | 'day'
      const h = url.searchParams.get('horizon_h')
      return json({ ...METRICS[by], horizon_h: by === 'lead' ? null : Number(h) })
    }
    return json({ detail: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export const failWith = (status: number) => () => json({ detail: 'boom' }, status)
