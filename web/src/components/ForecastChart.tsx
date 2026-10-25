import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SeriesPoint } from '../api'
import { type ChartRow, dayTicks } from '../chartData'
import { fmtDay, fmtGW, fmtHours, fmtMW, fmtSignedMW, fmtWhen, roundTicks } from '../format'

interface Props {
  rows: ChartRow[]
  horizon: number
  selected: SeriesPoint | null
  /** Start time of the hovered hour (hours with a forecast only). */
  onHover: (startTime: string) => void
}

const COLORS = { actual: '#0F1B2D', forecast: '#00A3A3', over: '#E5484D', under: '#3E7BFA', grid: '#EDF0F4', muted: '#5B6B80' }

function TooltipBody({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  const p = row.point
  return (
    <div className="chart-tooltip">
      <div className="tooltip-title">{fmtWhen(row.t)}</div>
      {row.actual !== null && <TooltipRow k="Actual" v={fmtMW(row.actual)} />}
      {p?.forecast != null && <TooltipRow k="Forecast" v={fmtMW(p.forecast)} />}
      {p?.error != null && <TooltipRow k="Error" v={fmtSignedMW(p.error)} tone={p.error >= 0 ? 'over' : 'under'} />}
      {p?.publish_time && <TooltipRow k="Published" v={fmtWhen(p.publish_time)} />}
      {p?.lead_hours != null && <TooltipRow k="Realised lead" v={fmtHours(p.lead_hours)} />}
      {p && p.forecast === null && <div className="tooltip-note">No forecast published early enough</div>}
      {!p && <div className="tooltip-note">Half-hour actual · forecasts are hourly</div>}
    </div>
  )
}

function TooltipRow({ k, v, tone }: { k: string; v: string; tone?: 'over' | 'under' }) {
  return (
    <div className="tooltip-row">
      <span>{k}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{v}</strong>
    </div>
  )
}

export function ForecastChart({ rows, horizon, selected, onHover }: Props) {
  const ticks = dayTicks(rows)
  const domain: [number, number] = rows.length ? [rows[0].t, rows[rows.length - 1].t] : [0, 1]
  const mwTicks = roundTicks(Math.max(0, ...rows.map((r) => Math.max(r.actual ?? 0, r.forecast ?? 0))), 5000)
  const errLimit = Math.max(1000, Math.ceil(Math.max(0, ...rows.map((r) => Math.abs(r.error ?? 0))) / 1000) * 1000)
  const selectedT = selected ? Date.parse(selected.start_time) : null
  const handleMove = (state: { activePayload?: { payload: ChartRow }[] }) => {
    const point = state?.activePayload?.[0]?.payload.point
    if (point && point.forecast !== null) onHover(point.start_time)
  }

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={rows} syncId="monitor" margin={{ top: 8, right: 8, bottom: 0, left: 0 }} onMouseMove={handleMove}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={domain} ticks={ticks} hide />
          <YAxis domain={[0, mwTicks[mwTicks.length - 1]]} ticks={mwTicks} tickFormatter={fmtGW} width={52} tick={{ fontSize: 12, fill: COLORS.muted }} axisLine={false} tickLine={false} />
          <Tooltip content={<TooltipBody />} isAnimationActive={false} />
          <Area dataKey="gap" fill={COLORS.over} fillOpacity={0.12} stroke="none" connectNulls isAnimationActive={false} activeDot={false} />
          <Line dataKey="actual" name="Actual" stroke={COLORS.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
          {/* connectNulls bridges the half-hour rows between hourly forecasts. Hours with no forecast cannot occur for h <= hmax (backend covered_horizon). */}
          <Line dataKey="forecast" name={`Forecast (${horizon} h)`} stroke={COLORS.forecast} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          {selectedT !== null && <ReferenceLine x={selectedT} stroke={COLORS.actual} strokeDasharray="4 3" />}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="overline chart-sublabel">Forecast error (MW)</div>
      <ResponsiveContainer width="100%" height={120}>
        <ComposedChart data={rows} syncId="monitor" margin={{ top: 4, right: 8, bottom: 0, left: 0 }} onMouseMove={handleMove}>
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain}
            ticks={ticks}
            tickFormatter={fmtDay}
            tick={{ fontSize: 12, fill: COLORS.actual }}
            tickLine={false}
            axisLine={{ stroke: COLORS.grid }}
          />
          <YAxis domain={[-errLimit, errLimit]} ticks={[-errLimit, 0, errLimit]} tickFormatter={fmtGW} width={52} tick={{ fontSize: 12, fill: COLORS.muted }} axisLine={false} tickLine={false} />
          <ReferenceLine y={0} stroke="#C9D1DC" />
          <Tooltip content={<TooltipBody />} isAnimationActive={false} />
          <Bar dataKey="error" isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.t} fill={(r.error ?? 0) >= 0 ? COLORS.over : COLORS.under} fillOpacity={0.8} />
            ))}
          </Bar>
          {selectedT !== null && <ReferenceLine x={selectedT} stroke={COLORS.actual} strokeDasharray="4 3" />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
