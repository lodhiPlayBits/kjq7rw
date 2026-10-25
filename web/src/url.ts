/** Page state kept in the URL so any view can be shared and restored, e.g. ?from=2026-01-15&to=2026-01-16&horizon=12 */

export type View = 'monitor' | 'accuracy'

export interface ViewState {
  view: View
  /** First delivery day, YYYY-MM-DD (UTC = UK time in January). */
  from: string
  /** Last delivery day, inclusive. */
  to: string
  /** Requested horizon h in hours. */
  horizon: number
}

export const DEFAULT_STATE: ViewState = { view: 'monitor', from: '2026-01-10', to: '2026-01-12', horizon: 24 }

const JANUARY_START = Date.UTC(2026, 0, 1)
const JANUARY_END = Date.UTC(2026, 1, 1)
const HOUR = 3_600_000
const DAY = 24 * HOUR
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Delivery days that contain at least one hour whose decision time T − h falls in January. */
export function deliveryDays(horizon: number): { min: string; max: string } {
  return { min: day(JANUARY_START + horizon * HOUR), max: day(JANUARY_END + horizon * HOUR - 1) }
}

function validDay(value: string | null): string | null {
  if (!value || !ISO_DAY.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isNaN(ms) || day(ms) !== value ? null : value
}

const clampDay = (value: string, min: string, max: string) => (value < min ? min : value > max ? max : value)

/**
 * The single place state is made valid, used for URL input and every UI edit: horizon is an
 * integer in 0..hmax, days are real dates (else ``fallback``), clamped to the horizon's
 * delivery window and ordered. With ``outside: 'keep'`` (typed dates) a day outside the window
 * is ignored rather than clamped, so half-typed years like 0002 don't make the range jump.
 */
export function normalize(
  candidate: ViewState,
  hmax: number,
  fallback: ViewState = DEFAULT_STATE,
  outside: 'clamp' | 'keep' = 'clamp',
): ViewState {
  const horizon = Number.isInteger(candidate.horizon) ? Math.min(Math.max(candidate.horizon, 0), hmax) : Math.min(fallback.horizon, hmax)
  const { min, max } = deliveryDays(horizon)
  const pick = (value: string, prev: string) => {
    const valid = validDay(value)
    return valid && (outside === 'clamp' || (valid >= min && valid <= max)) ? valid : prev
  }
  let from = clampDay(pick(candidate.from, fallback.from), min, max)
  let to = clampDay(pick(candidate.to, fallback.to), min, max)
  if (from > to) [from, to] = [to, from]
  return { view: candidate.view === 'accuracy' ? 'accuracy' : 'monitor', from, to, horizon }
}

export function parseState(search: string, hmax: number): ViewState {
  const q = new URLSearchParams(search)
  const rawHorizon = q.get('horizon') ?? ''
  return normalize(
    {
      view: q.get('view') === 'accuracy' ? 'accuracy' : 'monitor',
      from: q.get('from') ?? '',
      to: q.get('to') ?? '',
      horizon: /^-?\d+$/.test(rawHorizon) ? Number(rawHorizon) : NaN,
    },
    hmax,
  )
}

export function toSearch(state: ViewState): string {
  const q = new URLSearchParams()
  if (state.view !== 'monitor') q.set('view', state.view)
  q.set('from', state.from)
  q.set('to', state.to)
  q.set('horizon', String(state.horizon))
  return `?${q}`
}

/** Half-open UTC range for /api/series: from midnight of ``from`` to midnight after ``to``. */
export function apiRange(state: ViewState): { from: string; to: string } {
  const end = Date.parse(`${state.to}T00:00:00Z`) + DAY
  return { from: `${state.from}T00:00:00Z`, to: new Date(end).toISOString().replace('.000Z', 'Z') }
}
