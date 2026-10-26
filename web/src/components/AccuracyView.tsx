import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { UpdateState } from '../App'
import { type Meta, type MetricsGroup, fetchMetrics } from '../api'
import {
  METRICS,
  type MetricKey,
  calendarWeeks,
  consistentBias,
  divergingColour,
  growth,
  heatColour,
  isDayAheadBucket,
  relativeWording,
  signedPct,
  weightedMean,
  worst,
  zeroBasedTicks,
} from '../accuracy'
import { fmtDay, fmtGW, fmtMW, fmtNumber, fmtPct, fmtSignedMW } from '../format'
import { useApi } from '../useApi'
import type { ViewState } from '../url'
import { KpiCard } from './KpiCard'

interface Props {
  meta: Meta
  state: ViewState
  onChange: UpdateState
}

const COLORS = { bar: '#00A3A3', ink: '#0F1B2D', muted: '#5B6B80', grid: '#EDF0F4', primary: '#1F5EFF', over: '#E5484D', under: '#3E7BFA' }
const HORIZON_CHOICES = [1, 4, 12, 24, 36]
const axisTick = { fontSize: 12, fill: COLORS.muted }

const fmtMetric = (metric: MetricKey, v: number) => (metric === 'bias' ? fmtSignedMW(v) : fmtMW(v))

export function MetricTooltip({ active, payload, metric, countLabel }: { active?: boolean; payload?: { payload: MetricsGroup }[]; metric: MetricKey; countLabel: string }) {
  const g = payload?.[0]?.payload
  if (!active || !g) return null
  return (
    <div className="chart-tooltip">
      <div className="tooltip-title">{/^\d{4}-/.test(String(g.key)) ? fmtDay(String(g.key)) : g.label}</div>
      {METRICS.map((m) => (
        <div key={m.key} className="tooltip-row">
          <span>{m.label}</span>
          <strong className={m.key === metric ? 'tooltip-current' : undefined}>{fmtMetric(m.key, g[m.key])}</strong>
        </div>
      ))}
      <div className="tooltip-row">
        <span>{countLabel}</span>
        <strong>{fmtNumber(g.n)}</strong>
      </div>
    </div>
  )
}

function Segmented<T extends string | number>({ label, options, value, onChange, format }: { label: string; options: T[]; value: T; onChange: (v: T) => void; format: (v: T) => string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} className={o === value ? 'seg selected' : 'seg'} onClick={() => onChange(o)}>
          {format(o)}
        </button>
      ))}
    </div>
  )
}

export function AccuracyView({ meta, state, onChange }: Props) {
  const [metric, setMetric] = useState<MetricKey>('mae')
  const h = state.horizon
  const lead = useApi((s) => fetchMetrics('lead', undefined, s), [])
  const hour = useApi((s) => fetchMetrics('hour', h, s), [h])
  const day = useApi((s) => fetchMetrics('day', h, s), [h])

  const leadGroups = lead.kind === 'ready' ? lead.data.groups : []
  const hourData = hour.kind === 'ready' ? hour.data : null
  const dayGroups = day.kind === 'ready' ? day.data.groups : []
  const overall = hourData?.overall ?? null
  // Label with the horizon the data was computed for, not the one just requested.
  const hourH = hourData?.horizon_h ?? h
  const dayH = day.kind === 'ready' ? day.data.horizon_h ?? h : h
  const stale = (hour.kind === 'ready' && hour.stale) || (day.kind === 'ready' && day.stale)
  const failed = [lead, hour, day].find((s) => s.kind === 'error')

  const metricInfo = METRICS.find((m) => m.key === metric)!
  const first = leadGroups[0]
  const last = leadGroups[leadGroups.length - 1]
  const dayAhead = leadGroups.filter((g) => isDayAheadBucket(Number(g.key), meta.lead_bucket_hours))
  const dayAheadMae = weightedMean(dayAhead, 'mae')
  const leadGrowth = growth(leadGroups)
  const lean = overall ? consistentBias(overall.bias, leadGroups) : null
  const worstDay = worst(dayGroups)[0]
  const worstHours = worst(hourData?.groups ?? [], 'mae', 4)
  const worstHourKeys = new Set(worstHours.map((g) => g.key))
  const worstHourLabels = [...worstHours].sort((a, b) => Number(a.key) - Number(b.key)).map((g) => g.label).join(', ')
  // Bias keeps its sign on a diverging scale (blue = wind beat the forecast, red = fell short).
  const dayValues = dayGroups.map((g) => g[metric])
  const heatMin = Math.min(...dayValues)
  const heatMax = Math.max(...dayValues)
  const heatAbs = Math.max(...dayValues.map(Math.abs))
  const cellColour = (v: number) => (metric === 'bias' ? divergingColour(v, heatAbs) : heatColour(v, heatMin, heatMax))
  const horizonChoices = [...new Set([...HORIZON_CHOICES.filter((c) => c <= meta.hmax), meta.hmax, h])].sort((a, b) => a - b)

  const leadTicks = zeroBasedTicks(leadGroups.flatMap((g) => (metric === 'p90' ? [g.p90] : [g[metric], g.p90])), 1000)
  const hourTicks = zeroBasedTicks((hourData?.groups ?? []).map((g) => g[metric]), 500)

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Forecast accuracy</h1>
          <p className="muted">How far off were the wind forecasts, and how does the error grow with lead time? All decisions made in January 2026.</p>
        </div>
      </div>

      <section className="card controls" aria-label="Controls">
        <div className="field">
          <span className="overline">Metric</span>
          <Segmented label="Metric" options={METRICS.map((m) => m.key)} value={metric} onChange={setMetric} format={(k) => METRICS.find((m) => m.key === k)!.label} />
          <span className="caption">{metricInfo.help}</span>
        </div>
        <div className="field">
          <span className="overline">Horizon for breakdowns</span>
          <Segmented label="Horizon for breakdowns" options={horizonChoices} value={h} onChange={(v) => onChange({ horizon: v })} format={(v) => `${v} h`} />
          <span className="caption">Used by the hour-of-day and daily views; shared with the Monitor</span>
        </div>
      </section>

      {failed?.kind === 'error' && (
        <div className="card error" role="alert">
          Could not load metrics: {failed.message}
        </div>
      )}

      <section className={stale ? 'kpi-row stale' : 'kpi-row'} aria-label="Headline metrics" aria-busy={stale}>
        <KpiCard
          label={`Error at ${hourH} h ahead (MAE)`}
          value={overall ? fmtMW(overall.mae) : '–'}
          caption={overall ? `${overall.nmae != null ? fmtPct(overall.nmae) + ' nMAE · ' : ''}bias ${fmtSignedMW(overall.bias)}` : ' '}
        />
        <KpiCard
          label={`Short-range error (${first?.label ?? '0–4 h'})`}
          value={first ? fmtMW(first.mae) : '–'}
          caption={first && dayAheadMae ? `${relativeWording(first.mae, dayAheadMae)} than day-ahead (20–28 h)` : ' '}
          tone="good"
        />
        <KpiCard
          label={`Long-range error (${last?.label ?? '44–48 h'})`}
          value={last ? fmtMW(last.mae) : '–'}
          caption={leadGrowth ? `${signedPct(leadGrowth - 1)} vs ${first.label}` : ' '}
        />
        <KpiCard label={`Worst delivery day (${dayH} h)`} value={worstDay ? fmtDay(String(worstDay.key)) : '–'} caption={worstDay ? `MAE ${fmtMW(worstDay.mae)}` : ' '} tone="over" />
      </section>

      <section className="card chart-card" aria-label="Error by lead time">
        <div className="chart-header">
          <div>
            <h2>Error grows with lead time</h2>
            <p className="caption">
              {metricInfo.label} by realised lead time (delivery − publish time), {meta.lead_bucket_hours}-hour buckets, every forecast run published in January
            </p>
          </div>
          <div className="legend">
            <span><i className="swatch box" />{metricInfo.label}</span>
            {metric !== 'p90' && <span><i className="swatch line actual" />P90 abs. error</span>}
            <span><i className="swatch window" />Day-ahead window</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={leadGroups} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            {dayAhead.length > 0 && (
              <ReferenceArea x1={dayAhead[0].label} x2={dayAhead[dayAhead.length - 1].label} fill={COLORS.primary} fillOpacity={0.07} label={{ value: 'DAY-AHEAD DECISION WINDOW', position: 'insideTop', fontSize: 11, fill: COLORS.primary }} />
            )}
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: COLORS.grid }} />
            <YAxis domain={[leadTicks[0], leadTicks[leadTicks.length - 1]]} ticks={leadTicks} tickFormatter={fmtGW} width={52} tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip content={<MetricTooltip metric={metric} countLabel="Forecast-hours" />} cursor={{ fill: 'rgba(15,27,45,0.04)' }} />
            <Bar dataKey={metric} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {leadGroups.map((g) => (
                <Cell key={g.key} fill={COLORS.bar} fillOpacity={isDayAheadBucket(Number(g.key), meta.lead_bucket_hours) ? 1 : 0.55} />
              ))}
            </Bar>
            {metric !== 'p90' && <Line dataKey="p90" stroke={COLORS.ink} strokeWidth={2} dot={{ r: 3.5, fill: 'white', strokeWidth: 2 }} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </section>

      <div className="breakdown-row">
        <section className={stale ? 'card chart-card stale' : 'card chart-card'} aria-label="Error by hour of day">
          <div>
            <h2>When in the day is the forecast weakest?</h2>
            <p className="caption">
              {metricInfo.label} by hour of delivery (UK time) · {hourH} h horizon · red = four worst hours by MAE
            </p>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hourData?.groups ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} interval={2} axisLine={{ stroke: COLORS.grid }} />
              <YAxis domain={[hourTicks[0], hourTicks[hourTicks.length - 1]]} ticks={hourTicks} tickFormatter={fmtGW} width={52} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip content={<MetricTooltip metric={metric} countLabel="Hours" />} cursor={{ fill: 'rgba(15,27,45,0.04)' }} />
              <Bar dataKey={metric} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {(hourData?.groups ?? []).map((g) => (
                  <Cell key={g.key} fill={worstHourKeys.has(g.key) ? COLORS.over : COLORS.bar} fillOpacity={worstHourKeys.has(g.key) ? 0.85 : 0.55} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="stat-strip">
            {worstHours.length > 0 && (
              <>
                <div className="stat">
                  <span className="caption">Worst hours</span>
                  <strong className="tone-over">{worstHourLabels}</strong>
                </div>
                <div className="stat">
                  <span className="caption">Calmest hour</span>
                  <strong>{(() => { const best = [...(hourData?.groups ?? [])].sort((a, b) => a.mae - b.mae)[0]; return best ? `${best.label} · ${fmtMW(best.mae)}` : '–' })()}</strong>
                </div>
              </>
            )}
          </div>
        </section>

        <section className={stale ? 'card chart-card stale' : 'card chart-card'} aria-label="Daily error calendar">
          <div>
            <h2>Daily error</h2>
            <p className="caption">
              {metricInfo.label} per delivery day · {dayH} h horizon
              {metric === 'bias' ? ' · red = forecast above actual, blue = below' : ''}
            </p>
          </div>
          <table className="calendar">
            <caption className="visually-hidden">
              {metricInfo.label} per delivery day, January 2026, {dayH} h horizon
            </caption>
            <thead>
              <tr>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <th key={d} scope="col">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calendarWeeks(dayGroups).map((week, i) => (
                <tr key={i}>
                  {week.map((cell, j) =>
                    cell?.group ? (
                      <td
                        key={j}
                        className={cell.group === worstDay ? 'day worst' : 'day'}
                        style={{ background: cellColour(cell.group[metric]) }}
                        title={`${fmtDay(cell.date)}: ${metricInfo.label} ${fmtMetric(metric, cell.group[metric])}`}
                        aria-label={`${fmtDay(cell.date)}: ${metricInfo.label} ${fmtMetric(metric, cell.group[metric])}`}
                      >
                        <span className="day-num">{Number(cell.date.slice(8))}</span>
                        <span className="day-val">{fmtGW(cell.group[metric])}</span>
                      </td>
                    ) : (
                      <td key={j} className="day empty" />
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {dayGroups.length > 0 && (
            <div className="scale caption">
              <span>{fmtGW(metric === 'bias' ? -heatAbs : heatMin)}</span>
              <i
                className="scale-bar"
                style={{
                  background:
                    metric === 'bias'
                      ? `linear-gradient(to right, ${divergingColour(-1, 1)}, ${divergingColour(0, 1)}, ${divergingColour(1, 1)})`
                      : `linear-gradient(to right, ${heatColour(0, 0, 1)}, ${heatColour(1, 0, 1)})`,
                }}
              />
              <span>{fmtGW(metric === 'bias' ? heatAbs : heatMax)}</span>
            </div>
          )}
        </section>
      </div>

      <div className="detail-row">
        <section className="card" aria-label="Metrics by lead time">
          <h2>Metrics by lead time</h2>
          <p className="caption">Error = forecast − actual, MW. nMAE = MAE ÷ mean actual output.</p>
          <table className="metrics-table">
            <thead>
              <tr>
                <th scope="col">Lead time</th>
                <th scope="col">Forecast-hours</th>
                <th scope="col">MAE</th>
                <th scope="col">RMSE</th>
                <th scope="col">Bias</th>
                <th scope="col">P90 |error|</th>
                <th scope="col">nMAE</th>
              </tr>
            </thead>
            <tbody>
              {leadGroups.map((g) => (
                <tr key={g.key} className={isDayAheadBucket(Number(g.key), meta.lead_bucket_hours) ? 'highlight' : undefined}>
                  <th scope="row">
                    {g.label}
                    {isDayAheadBucket(Number(g.key), meta.lead_bucket_hours) ? ' · day-ahead' : ''}
                  </th>
                  <td>{fmtNumber(g.n)}</td>
                  <td>{fmtNumber(g.mae)}</td>
                  <td>{fmtNumber(g.rmse)}</td>
                  <td className={g.bias > 0 ? 'tone-over' : g.bias < 0 ? 'tone-under' : undefined}>{fmtSignedMW(g.bias).replace(' MW', '')}</td>
                  <td>{fmtNumber(g.p90)}</td>
                  <td>{g.nmae != null ? fmtPct(g.nmae) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card insights" aria-label="Takeaways">
          <div className="overline">What this means for the desk</div>
          <h2>Takeaways</h2>
          <ol>
            {overall && (
              <li>
                <strong>Plan for about {fmtGW(overall.mae)} of error at {hourH} h ahead.</strong>
                <span className="caption">9 in 10 hours were within {fmtGW(overall.p90)}. Size the buffer you buy against that, not the average.</span>
              </li>
            )}
            {lean && overall && first && (
              <li>
                <strong>Forecasts lean {lean}, at every lead time.</strong>
                <span className="caption">
                  Bias is {fmtSignedMW(overall.bias)} at {hourH} h and still {fmtSignedMW(first.bias)} only {first.label} ahead, so it is a steady offset rather than
                  weather uncertainty.{' '}
                  {lean === 'high' ? 'On average wind under-delivered, leaving the desk short.' : 'On average wind over-delivered, leaving the desk long.'}
                </span>
              </li>
            )}
            {worstHours.length > 0 && (
              <li>
                <strong>Watch {worstHourLabels}.</strong>
                <span className="caption">The largest misses cluster in these hours at the {hourH} h horizon.</span>
              </li>
            )}
          </ol>
          <p className="note">
            Bias = forecast − actual. Positive means the wind came in below forecast, so you under-procured and must buy back closer to delivery.
            {lean === 'high' &&
              ' A possible (unverified) cause of the steady positive offset is curtailment: actuals are metered output after wind farms are turned down.'}
          </p>
        </section>
      </div>
    </>
  )
}
