import { useCallback, useEffect, useState } from 'react'
import { fetchMeta } from './api'
import { MonitorView } from './components/MonitorView'
import { TopBar } from './components/TopBar'
import { useApi } from './useApi'
import { type ViewState, parseState, toSearch } from './url'

export default function App() {
  const meta = useApi(fetchMeta, [])
  const [state, setState] = useState<ViewState | null>(null)

  useEffect(() => {
    if (meta.kind === 'ready') setState(parseState(window.location.search, meta.data.hmax))
  }, [meta])

  const update = useCallback((patch: Partial<ViewState>) => {
    setState((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  useEffect(() => {
    if (state) window.history.replaceState(null, '', toSearch(state))
  }, [state])

  return (
    <>
      <TopBar view={state?.view ?? 'monitor'} onViewChange={(view) => update({ view })} />
      <main className="shell">
        {meta.kind === 'loading' && <p className="muted">Loading…</p>}
        {meta.kind === 'error' && <div className="card error">Could not reach the API: {meta.message}</div>}
        {meta.kind === 'ready' && state?.view === 'monitor' && <MonitorView meta={meta.data} state={state} onChange={update} />}
        {meta.kind === 'ready' && state?.view === 'accuracy' && (
          <div className="card">
            <h1>Forecast accuracy</h1>
            <p className="muted">Coming in the next release.</p>
          </div>
        )}
        <footer className="footer caption">
          <span>Source: Elexon BMRS — FUELHH (fuelType WIND) actuals, WINDFOR national forecasts. UK time (GMT in January).</span>
        </footer>
      </main>
    </>
  )
}
