import type { SeriesPoint } from './api'

const MINUS = '−'
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' })

export const fmtNumber = (n: number) => Math.round(n).toLocaleString('en-GB')
export const fmtMW = (n: number) => `${fmtNumber(n)} MW`
export const fmtSignedMW = (n: number) => `${n >= 0 ? '+' : MINUS}${fmtNumber(Math.abs(n))} MW`
export const fmtGW = (n: number) =>
  n === 0 ? '0' : `${n < 0 ? MINUS : ''}${(Math.abs(n) / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} GW`

/** Evenly spaced ticks from 0 (or −limit) to a round limit that covers ``max``. */
export function roundTicks(max: number, step: number, symmetric = false): number[] {
  const limit = Math.max(step, Math.ceil(max / step) * step)
  const ticks = []
  for (let v = symmetric ? -limit : 0; v <= limit; v += step) ticks.push(v)
  return ticks
}
export const fmtPct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`
export const fmtHours = (h: number) => `${h.toFixed(1)} h`

/** UK time in January = UTC, e.g. "Sat 10 Jan · 17:00". */
export function fmtWhen(iso: string | number): string {
  const d = new Date(iso)
  return `${dayFmt.format(d).replace(',', '')} · ${timeFmt.format(d)}`
}

export function fmtDay(iso: string | number): string {
  return dayFmt.format(new Date(iso)).replace(',', '')
}

const CSV_COLUMNS: (keyof SeriesPoint)[] = [
  'start_time',
  'actual',
  'forecast',
  'error',
  'publish_time',
  'decision_time',
  'lead_hours',
]

export function toCsv(points: SeriesPoint[]): string {
  const rows = points.map((p) => CSV_COLUMNS.map((c) => (p[c] ?? '').toString()).join(','))
  return [CSV_COLUMNS.join(','), ...rows].join('\n') + '\n'
}
