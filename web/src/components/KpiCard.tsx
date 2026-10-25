interface Props {
  label: string
  value: string
  caption: string
  tone?: 'muted' | 'over' | 'under' | 'good'
}

export function KpiCard({ label, value, caption, tone = 'muted' }: Props) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className={`caption tone-${tone}`}>{caption}</div>
    </div>
  )
}
