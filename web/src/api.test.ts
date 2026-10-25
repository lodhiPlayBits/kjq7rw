import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHealth } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('fetchHealth', () => {
  it('returns the parsed health payload', async () => {
    const body = { status: 'ok', actuals: 1584, forecasts: 19272 }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchHealth()).resolves.toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith('/api/health', { signal: undefined })
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))

    await expect(fetchHealth()).rejects.toThrow('API responded 500')
  })
})

describe('query building', () => {
  it('fetchSeries sends horizon_h and the half-open range', async () => {
    const { fetchSeries, fetchMetrics } = await import('./api')
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    await fetchSeries({ horizon: 12, from: '2026-01-15T00:00:00Z', to: '2026-01-17T00:00:00Z' })
    await fetchMetrics('hour', 24)
    await fetchMetrics('lead')

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/series?horizon_h=12&from=2026-01-15T00%3A00%3A00Z&to=2026-01-17T00%3A00%3A00Z',
      '/api/metrics?by=hour&horizon_h=24',
      '/api/metrics?by=lead',
    ])
  })
})
