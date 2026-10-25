import { useCallback, useEffect, useState } from 'react'
import { fetchMeta } from './api'
import { AccuracyView } from './components/AccuracyView'
import { MonitorView } from './components/MonitorView'
import { TopBar } from './components/TopBar'
import { useApi } from './useApi'
import { type ViewState, normalize, parseState, toSearch } from './url'

export type UpdateState = (patch: Partial<ViewState>, outside?: 'clamp' | 'keep') => void

export default function App() {
  const meta = useApi(fetchMeta, [])
  const hmax = meta.kind === 'ready' ? meta.data.hmax : null
  const [state, setState] = useState<ViewState | null>(null)

  useEffect(() => {
    if (hmax !== null) setState(parseState(window.location.search, hmax))
  }, [hmax])

  const update = useCallback<UpdateState>(
    (patch, outside = 'clamp') => {
      setState((prev) => (prev && hmax !== null ? normalize({ ...prev, ...patch }, hmax, prev, outside) : prev))
    },
    [hmax],
  )

  useEffect(() => {
    if (!state) return
    // Debounced: browsers throttle (and Firefox/Safari throw on) rapid replaceState calls while dragging.
    const timer = setTimeout(() => {
      try {
        window.history.replaceState(null, '', toSearch(state))
      } catch {
        // A dropped URL update only affects sharing; never break the page for it.
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [state])

  return (
    <>
      <TopBar view={state?.view ?? 'monitor'} onViewChange={(view) => update({ view })} />
      <main className="shell">
        {meta.kind === 'loading' && (
          <p className="muted" role="status">
            Loading…
          </p>
        )}
        {meta.kind === 'error' && (
          <div className="card error" role="alert">
            Could not reach the API: {meta.message}
          </div>
        )}
        {meta.kind === 'ready' && state?.view === 'monitor' && <MonitorView meta={meta.data} state={state} onChange={update} />}
        {meta.kind === 'ready' && state?.view === 'accuracy' && <AccuracyView meta={meta.data} state={state} onChange={update} />}
        <footer className="footer caption">
          <span>Source: Elexon BMRS — FUELHH (fuelType WIND) actuals, WINDFOR national forecasts. UK time (GMT in January).</span>
          {state?.view === 'accuracy' && <span>MAPE deliberately not used: it explodes at low wind.</span>}
        </footer>
      </main>
    </>
  )
}
