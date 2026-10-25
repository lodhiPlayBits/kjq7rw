import { useEffect, useState } from 'react'

export type ApiState<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: T }

/** Runs ``load`` whenever ``deps`` change, cancelling the previous request. */
export function useApi<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }))
    load(controller.signal)
      .then((data) => setState({ kind: 'ready', data }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
