import { describe, expect, it } from 'vitest'
import { calendarWeeks, growth, heatColour, isDayAheadBucket, worst } from './accuracy'
import type { MetricsGroup } from './api'

const group = (key: number | string, mae: number, bias = 0): MetricsGroup => ({
  key,
  label: String(key),
  n: 24,
  mae,
  rmse: mae * 1.2,
  bias,
  p50: mae * 0.8,
  p90: mae * 2,
  nmae: 0.1,
})

describe('isDayAheadBucket', () => {
  it('marks only the 20–24 h and 24–28 h buckets for 4 h buckets', () => {
    expect([...Array(12).keys()].filter((k) => isDayAheadBucket(k, 4))).toEqual([5, 6])
  })
})

describe('calendarWeeks', () => {
  it('starts on Monday and pads both ends', () => {
    // 2 Jan 2026 is a Friday; 1 Feb 2026 is a Sunday.
    const days = Array.from({ length: 31 }, (_, i) => group(new Date(Date.UTC(2026, 0, 2 + i)).toISOString().slice(0, 10), 1000))
    const weeks = calendarWeeks(days)

    expect(weeks).toHaveLength(5)
    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, null])
    expect(weeks[0][4]?.date).toBe('2026-01-02')
    expect(weeks[4][6]?.date).toBe('2026-02-01')
    expect(weeks.flat().filter(Boolean)).toHaveLength(31)
  })

  it('keeps days without data as empty cells', () => {
    const weeks = calendarWeeks([group('2026-01-05', 1), group('2026-01-07', 2)])
    expect(weeks[0].slice(0, 3).map((c) => c?.group?.mae ?? null)).toEqual([1, null, 2])
  })

  it('returns nothing for no groups', () => {
    expect(calendarWeeks([])).toEqual([])
  })
})

describe('heatColour', () => {
  it('maps the range ends to the two colours and clamps', () => {
    expect(heatColour(0, 0, 10)).toBe('rgb(219, 245, 242)')
    expect(heatColour(10, 0, 10)).toBe('rgb(229, 72, 77)')
    expect(heatColour(99, 0, 10)).toBe('rgb(229, 72, 77)')
    expect(heatColour(5, 5, 5)).toBe('rgb(219, 245, 242)')
  })
})

describe('worst and growth', () => {
  it('ranks by absolute value so negative bias counts', () => {
    expect(worst([group('a', 1, 50), group('b', 1, -90)], 'bias')[0].key).toBe('b')
  })

  it('compares the last bucket with the first', () => {
    expect(growth([group(0, 1000), group(1, 1100), group(2, 1300)])).toBeCloseTo(1.3)
    expect(growth([group(0, 1000)])).toBeNull()
  })
})
