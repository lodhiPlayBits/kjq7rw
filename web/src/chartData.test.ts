import { describe, expect, it } from 'vitest'
import type { Series, SeriesPoint } from './api'
import { buildRows, dayTicks, worstPoint } from './chartData'
import { fmtGW, fmtSignedMW, fmtWhen, roundTicks, toCsv } from './format'

const point = (start: string, actual: number, forecast: number | null): SeriesPoint => ({
  start_time: start,
  actual,
  forecast,
  publish_time: forecast === null ? null : '2026-01-09T09:30:00Z',
  decision_time: '2026-01-09T12:00:00Z',
  lead_hours: forecast === null ? null : 26.5,
  error: forecast === null ? null : forecast - actual,
})

const series: Series = {
  horizon_h: 24,
  window: ['2026-01-10T12:00:00Z', '2026-01-10T14:00:00Z'],
  actual: [
    { start_time: '2026-01-10T12:00:00Z', generation: 9000 },
    { start_time: '2026-01-10T12:30:00Z', generation: 9100 },
    { start_time: '2026-01-10T13:00:00Z', generation: 9200 },
    { start_time: '2026-01-10T13:30:00Z', generation: 9300 },
  ],
  points: [point('2026-01-10T12:00:00Z', 9000, 9600), point('2026-01-10T13:00:00Z', 9200, null)],
  summary: null,
}

describe('buildRows', () => {
  it('merges hourly forecasts into half-hourly actual rows', () => {
    const rows = buildRows(series)
    expect(rows.map((r) => r.actual)).toEqual([9000, 9100, 9200, 9300])
    expect(rows[0]).toMatchObject({ forecast: 9600, error: 600, gap: [9000, 9600] })
    expect(rows[1]).toMatchObject({ forecast: null, point: null })
    // 13:00 has a point but no forecast old enough: it stays a gap in the forecast line.
    expect(rows[2]).toMatchObject({ forecast: null, error: null, gap: null })
    expect(rows[2].point?.start_time).toBe('2026-01-10T13:00:00Z')
  })
})

describe('worstPoint', () => {
  it('picks the largest absolute error and skips points without a forecast', () => {
    const pts = [point('2026-01-10T12:00:00Z', 9000, 8000), point('2026-01-10T13:00:00Z', 9000, 9500), point('2026-01-10T14:00:00Z', 1, null)]
    expect(worstPoint(pts)?.start_time).toBe('2026-01-10T12:00:00Z')
    expect(worstPoint([])).toBeNull()
  })
})

describe('dayTicks', () => {
  it('returns each midnight inside the data', () => {
    const rows = buildRows({ ...series, actual: [{ start_time: '2026-01-10T12:00:00Z', generation: 1 }, { start_time: '2026-01-12T01:00:00Z', generation: 1 }], points: [] })
    expect(dayTicks(rows)).toEqual([Date.parse('2026-01-11T00:00:00Z'), Date.parse('2026-01-12T00:00:00Z')])
  })
})

describe('format', () => {
  it('formats signed MW with a real minus sign and UK time labels', () => {
    expect(fmtSignedMW(1736.2)).toBe('+1,736 MW')
    expect(fmtSignedMW(-50)).toBe('−50 MW')
    expect(fmtWhen('2026-01-11T17:30:00Z')).toBe('Sun 11 Jan · 17:30')
  })

  it('exports points as CSV with blanks for missing forecasts', () => {
    expect(toCsv(series.points).split('\n')).toEqual([
      'start_time,actual,forecast,error,publish_time,decision_time,lead_hours',
      '2026-01-10T12:00:00Z,9000,9600,600,2026-01-09T09:30:00Z,2026-01-09T12:00:00Z,26.5',
      '2026-01-10T13:00:00Z,9200,,,,2026-01-09T12:00:00Z,',
      '',
    ])
  })
})

describe('axis helpers', () => {
  it('rounds ticks up to cover the data and formats GW with a minus sign', () => {
    expect(roundTicks(21_300, 5000)).toEqual([0, 5000, 10000, 15000, 20000, 25000])
    expect(roundTicks(6_804, 1000, true)[0]).toBe(-7000)
    expect(roundTicks(0, 5000)).toEqual([0, 5000])
    expect(fmtGW(-7000)).toBe('−7 GW')
    expect(fmtGW(0)).toBe('0')
  })
})
