import { useEffect, useState } from 'react'
import { fetchHealth, type Health } from './api'

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; health: Health }

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetchHealth(controller.signal)
      .then((health) => setState({ kind: 'ready', health }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      })
    return () => controller.abort()
  }, [])

  return (
    <main className="shell">
      <h1>WindSight</h1>
      <p className="muted">GB wind forecast monitor · day-ahead desk · decisions in January 2026</p>
      <section className="card" aria-live="polite">
        {state.kind === 'loading' && <p>Loading data snapshot…</p>}
        {state.kind === 'error' && <p className="error">Could not reach the API: {state.message}</p>}
        {state.kind === 'ready' && (
          <p>
            API {state.health.status}: {state.health.actuals.toLocaleString('en-GB')} actual half-hours and{' '}
            {state.health.forecasts.toLocaleString('en-GB')} forecast points loaded.
          </p>
        )}
      </section>
    </main>
  )
}
