import { describe, expect, it } from 'vitest'
import { calendarWeeks, consistentBias, divergingColour, growth, heatColour, isDayAheadBucket, relativeWording, signedPct, weightedMean, worst, zeroBasedTicks } from './accuracy'
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

  it('returns nothing for no groups or keys that are not dates', () => {
    expect(calendarWeeks([])).toEqual([])
    expect(calendarWeeks([group(0, 1), group(11, 2)])).toEqual([])
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

describe('isDayAheadBucket with other bucket sizes', () => {
  it('excludes buckets that only partly overlap 20–28 h', () => {
    // 3 h buckets: 18–21 and 27–30 only partly overlap; 21–24 and 24–27 lie inside.
    expect([...Array(16).keys()].filter((k) => isDayAheadBucket(k, 3))).toEqual([7, 8])
    expect([...Array(8).keys()].filter((k) => isDayAheadBucket(k, 6))).toEqual([])
  })
})

describe('zeroBasedTicks', () => {
  it('includes zero when all values are positive or all negative', () => {
    expect(zeroBasedTicks([1200, 1800], 500)).toEqual([0, 500, 1000, 1500, 2000])
    expect(zeroBasedTicks([-1200, -300], 500)).toEqual([-1500, -1000, -500, 0, 500])
    expect(zeroBasedTicks([-300, 700], 500)).toEqual([-500, 0, 500, 1000])
  })
})

describe('weightedMean', () => {
  it('weights by sample count', () => {
    expect(weightedMean([{ ...group(0, 1000), n: 3 }, { ...group(1, 2000), n: 1 }], 'mae')).toBe(1250)
    expect(weightedMean([], 'mae')).toBeNull()
  })
})

describe('consistentBias', () => {
  const leads = (...biases: number[]) => biases.map((b, i) => group(i, 1000, b))

  it('reports a lean only when every bucket shares the sign of the overall bias', () => {
    expect(consistentBias(1700, leads(1500, 1800))).toBe('high')
    expect(consistentBias(-400, leads(-100, -900))).toBe('low')
    expect(consistentBias(300, leads(-200, 500))).toBeNull()
    expect(consistentBias(0, leads(100))).toBeNull()
    expect(consistentBias(100, [])).toBeNull()
  })
})

describe('wording helpers', () => {
  it('words relative change by direction and signs percentages', () => {
    expect(relativeWording(1758, 1946)).toBe('9.7% lower')
    expect(relativeWording(1050, 1000)).toBe('5.0% higher')
    expect(relativeWording(1, 0)).toBeNull()
    expect(signedPct(0.303)).toBe('+30.3%')
    expect(signedPct(-0.03)).toBe('−3.0%')
  })
})

describe('divergingColour', () => {
  it('is blue below zero, red above and neutral at zero', () => {
    expect(divergingColour(-10, 10)).toBe('rgb(62, 123, 250)')
    expect(divergingColour(10, 10)).toBe('rgb(229, 72, 77)')
    expect(divergingColour(0, 10)).toBe('rgb(244, 246, 250)')
  })
})
