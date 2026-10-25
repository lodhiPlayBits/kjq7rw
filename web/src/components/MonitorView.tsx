import { type CSSProperties, useMemo, useState } from 'react'
import type { UpdateState } from '../App'
import { type Meta, fetchSeries } from '../api'
import { buildRows, resolveSelection } from '../chartData'
import { fmtHours, fmtMW, fmtPct, fmtSignedMW, fmtWhen, toCsv } from '../format'
import { useApi } from '../useApi'
import { type ViewState, apiRange, deliveryDays, toSearch } from '../url'
import { ForecastChart } from './ForecastChart'
import { KpiCard } from './KpiCard'

interface Props {
  meta: Meta
  state: ViewState
  onChange: UpdateState
}

function biasCopy(bias: number): { caption: string; tone: 'muted' | 'over' | 'under' } {
  if (bias > 0) return { caption: 'Wind over-forecast → risk of being short', tone: 'over' }
  if (bias < 0) return { caption: 'Wind under-forecast → risk of over-buying', tone: 'under' }
  return { caption: 'No systematic over- or under-forecast', tone: 'muted' }
}

export function MonitorView({ meta, state, onChange }: Props) {
  const range = apiRange(state)
  const series = useApi((signal) => fetchSeries({ horizon: state.horizon, ...range }, signal), [state.horizon, range.from, range.to])
  const data = series.kind === 'ready' ? series.data : null
  const stale = series.kind === 'ready' && series.stale
  const rows = useMemo(() => (data ? buildRows(data) : []), [data])
  const [hoveredStart, setHoveredStart] = useState<string | null>(null)
  const { point: selected, hovered } = resolveSelection(data?.points ?? [], hoveredStart)
  const [copied, setCopied] = useState(false)
  const days = deliveryDays(state.horizon)
  const bias = data?.summary ? biasCopy(data.summary.bias) : null

  const copyLink = () => {
    const link = `${window.location.origin}${window.location.pathname}${toSearch(state)}`
    navigator.clipboard
      ?.writeText(link)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => window.prompt('Copy this link', link))
  }

  const exportCsv = () => {
    if (!data) return
    const url = URL.createObjectURL(new Blob([toCsv(data.points)], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `windsight_${state.from}_${state.to}_h${state.horizon}.csv` })
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Forecast monitor</h1>
          <p className="muted">
            The latest national wind forecast your desk could have seen at decision time, against what the wind actually delivered.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn secondary" onClick={copyLink} aria-live="polite">
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <button type="button" className="btn primary" onClick={exportCsv} disabled={!data}>
            Export CSV
          </button>
        </div>
      </div>

      <section className="card controls" aria-label="Controls">
        <fieldset className="field">
          <legend className="overline">Delivery period</legend>
          <div className="date-range">
            <input type="date" aria-label="First delivery day" value={state.from} min={days.min} max={state.to} onChange={(e) => onChange({ from: e.target.value }, 'keep')} />
            <span aria-hidden="true">→</span>
            <input type="date" aria-label="Last delivery day" value={state.to} min={state.from} max={days.max} onChange={(e) => onChange({ to: e.target.value }, 'keep')} />
          </div>
          <span className="caption">Deliveries whose decision fell in January 2026</span>
        </fieldset>
        <div className="field horizon">
          <label className="overline" htmlFor="horizon">
            Forecast horizon
          </label>
          <div className="slider-row">
            <input
              id="horizon"
              type="range"
              min={0}
              max={meta.hmax}
              step={1}
              value={state.horizon}
              aria-valuetext={`${state.horizon} hours ahead`}
              onChange={(e) => onChange({ horizon: Number(e.target.value) })}
              style={{ '--fill': `${(state.horizon / meta.hmax) * 100}%` } as CSSProperties}
            />
            <span className="value-pill">{state.horizon} h ahead</span>
          </div>
          <div className="ticks caption">
            <span>0 h</span>
            <span>{Math.round(meta.hmax / 2)} h</span>
            <span>{meta.hmax} h</span>
          </div>
          <span className="caption">Latest forecast published ≥ {state.horizon} h before each hour</span>
        </div>
      </section>

      {series.kind === 'error' && (
        <div className="card error" role="alert">
          Could not load forecasts: {series.message}
        </div>
      )}

      <section className={stale ? 'kpi-row stale' : 'kpi-row'} aria-label="Headline metrics" aria-busy={stale}>
        <KpiCard label="Mean absolute error" value={data?.summary ? fmtMW(data.summary.mae) : '–'} caption={data?.summary?.nmae != null ? `${fmtPct(data.summary.nmae)} of mean output (nMAE)` : ' '} />
        <KpiCard label="Root mean square error" value={data?.summary ? fmtMW(data.summary.rmse) : '–'} caption="Weights the big misses more heavily" />
        <KpiCard
          label="Bias (forecast − actual)"
          value={data?.summary ? fmtSignedMW(data.summary.bias) : '–'}
          caption={bias?.caption ?? ' '}
          tone={bias?.tone ?? 'muted'}
        />
        <KpiCard label="P90 absolute error" value={data?.summary ? fmtMW(data.summary.p90) : '–'} caption="9 in 10 hours were within this" />
      </section>

      <div className="main-grid">
        <section className={stale ? 'card chart-card stale' : 'card chart-card'} aria-label="Forecast versus actual chart" aria-busy={stale}>
          <div className="chart-header">
            <div>
              <h2>Forecast vs actual · GB wind generation</h2>
              <p className="caption">MW · forecast = latest WINDFOR run published ≥ {state.horizon} h before delivery (hourly); actual = FUELHH (half-hourly)</p>
            </div>
            <div className="legend">
              <span><i className="swatch line actual" />Actual</span>
              <span><i className="swatch line forecast" />Forecast ({state.horizon} h)</span>
              <span><i className="swatch band" />Gap</span>
            </div>
          </div>
          {series.kind === 'loading' ? (
            <div className="chart-placeholder" role="status">
              Loading forecasts…
            </div>
          ) : (
            <ForecastChart rows={rows} horizon={data?.horizon_h ?? state.horizon} selected={selected} onHover={setHoveredStart} />
          )}
        </section>

        <aside className="side-panel">
          <section className="card">
            <div className="overline">{hovered ? 'Selected hour' : 'Largest miss in range'}</div>
            <h2>{selected ? fmtWhen(selected.start_time) : '–'}</h2>
            {selected && (
              <dl className="kv">
                <dt>Actual</dt>
                <dd>{fmtMW(selected.actual)}</dd>
                <dt>Forecast used</dt>
                <dd>{selected.forecast !== null ? fmtMW(selected.forecast) : 'none'}</dd>
                <dt>Error</dt>
                <dd className={selected.error !== null ? (selected.error >= 0 ? 'tone-over' : 'tone-under') : undefined}>{selected.error !== null ? fmtSignedMW(selected.error) : '–'}</dd>
                <dt>Decision time</dt>
                <dd>{fmtWhen(selected.decision_time)}</dd>
                <dt>Forecast published</dt>
                <dd>{selected.publish_time ? fmtWhen(selected.publish_time) : '–'}</dd>
                <dt>Realised lead</dt>
                <dd>{selected.lead_hours !== null ? fmtHours(selected.lead_hours) : '–'}</dd>
              </dl>
            )}
          </section>
          <section className="card">
            <div className="overline">How the forecast is chosen</div>
            <svg className="timeline" viewBox="0 0 298 64" role="img" aria-label="Forecast runs before the decision time are eligible; the latest one is used">
              <path d="M4 22H294" stroke="#C9D1DC" strokeWidth="2" />
              <circle cx="30" cy="22" r="4" fill="#9AA6B5" />
              <circle cx="70" cy="22" r="4" fill="#9AA6B5" />
              <circle cx="110" cy="22" r="6" fill="#00A3A3" stroke="white" strokeWidth="2" />
              <circle cx="160" cy="22" r="4" fill="#9AA6B5" fillOpacity="0.35" />
              <circle cx="200" cy="22" r="4" fill="#9AA6B5" fillOpacity="0.35" />
              <circle cx="240" cy="22" r="4" fill="#9AA6B5" fillOpacity="0.35" />
              <path d="M134 6V38" stroke="#1F5EFF" strokeWidth="2" strokeDasharray="3 3" />
              <path d="M280 6V38" stroke="#0F1B2D" strokeWidth="2" />
              <text x="96" y="58" className="tl used">Used</text>
              <text x="140" y="58" className="tl decision">Decision</text>
              <text x="246" y="58" className="tl delivery">Delivery</text>
            </svg>
            <p className="muted small">
              For every hour we take the most recent forecast published at least {state.horizon} h before delivery: what your desk could
              actually have seen when bidding. Later runs (faded) are ignored.
            </p>
          </section>
          <div className="tip">Tip: drag the horizon down to 1 h to see how much the forecast improves close to delivery.</div>
        </aside>
      </div>
    </>
  )
}
