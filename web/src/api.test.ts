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
