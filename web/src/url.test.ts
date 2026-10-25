import { describe, expect, it } from 'vitest'
import { DEFAULT_STATE, apiRange, deliveryDays, parseState, toSearch } from './url'

describe('parseState', () => {
  it('restores a shared view', () => {
    expect(parseState('?from=2026-01-15&to=2026-01-16&horizon=12', 43)).toEqual({
      view: 'monitor',
      from: '2026-01-15',
      to: '2026-01-16',
      horizon: 12,
    })
  })

  it('falls back to defaults for missing or malformed values', () => {
    expect(parseState('', 43)).toEqual(DEFAULT_STATE)
    expect(parseState('?from=2026-13-40&to=nope&horizon=abc', 43)).toEqual(DEFAULT_STATE)
  })

  it('clamps the horizon to 0..hmax and rejects fractions', () => {
    expect(parseState('?horizon=99', 43).horizon).toBe(43)
    expect(parseState('?horizon=-5', 43).horizon).toBe(0)
    expect(parseState('?horizon=2.5', 43).horizon).toBe(24)
  })

  it('clamps days to the delivery window for the horizon and orders them', () => {
    expect(parseState('?from=2025-12-01&to=2026-03-01&horizon=24', 43)).toMatchObject({ from: '2026-01-02', to: '2026-02-01' })
    expect(parseState('?from=2026-01-20&to=2026-01-18', 43)).toMatchObject({ from: '2026-01-18', to: '2026-01-20' })
  })

  it('reads the accuracy view', () => {
    expect(parseState('?view=accuracy', 43).view).toBe('accuracy')
  })
})

describe('toSearch', () => {
  it('round-trips through parseState', () => {
    const state = { view: 'accuracy' as const, from: '2026-01-05', to: '2026-01-07', horizon: 6 }
    expect(parseState(toSearch(state), 43)).toEqual(state)
  })
})

describe('deliveryDays', () => {
  it('shifts with the horizon', () => {
    expect(deliveryDays(0)).toEqual({ min: '2026-01-01', max: '2026-01-31' })
    expect(deliveryDays(43)).toEqual({ min: '2026-01-02', max: '2026-02-02' })
  })
})

describe('apiRange', () => {
  it('makes the last day inclusive', () => {
    expect(apiRange({ ...DEFAULT_STATE, from: '2026-01-10', to: '2026-01-12' })).toEqual({
      from: '2026-01-10T00:00:00Z',
      to: '2026-01-13T00:00:00Z',
    })
  })
})
