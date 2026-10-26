// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { hoveredStart } from '../chartData'
import { useApi } from '../useApi'
import { point } from '../test/fixtures'
import { KpiCard } from './KpiCard'
import { TopBar } from './TopBar'

describe('TopBar', () => {
  it('marks the current view and switches views', async () => {
    const onViewChange = vi.fn()
    render(<TopBar view="monitor" onViewChange={onViewChange} />)

    expect(screen.getByRole('button', { name: 'Monitor' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Accuracy' }).getAttribute('aria-current')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Accuracy' }))
    expect(onViewChange).toHaveBeenCalledWith('accuracy')
  })
})

describe('KpiCard', () => {
  it('renders label, value and a toned caption', () => {
    const { container } = render(<KpiCard label="Bias" value="+1,736 MW" caption="short" tone="over" />)
    expect(screen.getByText('Bias')).toBeTruthy()
    expect(screen.getByText('+1,736 MW')).toBeTruthy()
    expect(container.querySelector('.tone-over')?.textContent).toBe('short')
  })
})

describe('useApi', () => {
  it('goes loading → ready, marks data stale while refetching, and ignores aborted requests', async () => {
    const resolvers: ((v: string) => void)[] = []
    const load = vi.fn((dep: number) => (signal: AbortSignal) => {
      void signal
      return new Promise<string>((resolve) => resolvers.push(resolve)).then((v) => `${v}-${dep}`)
    })
    const { result, rerender } = renderHook(({ dep }) => useApi(load(dep), [dep]), { initialProps: { dep: 1 } })

    expect(result.current).toEqual({ kind: 'loading' })
    await act(async () => resolvers[resolvers.length - 1]('a'))
    expect(result.current).toEqual({ kind: 'ready', data: 'a-1', stale: false })

    rerender({ dep: 2 })
    expect(result.current).toMatchObject({ kind: 'ready', data: 'a-1', stale: true })
    await act(async () => resolvers[resolvers.length - 1]('b'))
    expect(result.current).toEqual({ kind: 'ready', data: 'b-2', stale: false })
  })

  it('reports errors but not errors from cancelled requests', async () => {
    let reject: (e: unknown) => void = () => {}
    const { result, unmount } = renderHook(() =>
      useApi(() => new Promise((_, r) => (reject = r)), []),
    )
    await act(async () => reject(new Error('API responded 500')))
    await waitFor(() => expect(result.current).toEqual({ kind: 'error', message: 'API responded 500' }))
    unmount()

    let rejectLater: (e: unknown) => void = () => {}
    const second = renderHook(() => useApi(() => new Promise((_, r) => (rejectLater = r)), []))
    second.unmount()
    await act(async () => rejectLater('late'))
    expect(second.result.current).toEqual({ kind: 'loading' })
  })

  it('stringifies non-Error rejections', async () => {
    let reject: (e: unknown) => void = () => {}
    const { result } = renderHook(() => useApi(() => new Promise((_, r) => (reject = r)), []))
    await act(async () => reject('plain'))
    expect(result.current).toEqual({ kind: 'error', message: 'plain' })
  })
})

describe('hoveredStart', () => {
  it('returns the hour only when it has a forecast', () => {
    const withForecast = point('2026-01-10T01:00:00Z', 9000, 9500)
    const without = point('2026-01-10T02:00:00Z', 9000, null)
    const row = (p: typeof withForecast | null) => ({ activePayload: [{ payload: { t: 0, actual: 1, forecast: null, error: null, gap: null, point: p } }] })
    expect(hoveredStart(row(withForecast))).toBe('2026-01-10T01:00:00Z')
    expect(hoveredStart(row(without))).toBeNull()
    expect(hoveredStart(row(null))).toBeNull()
    expect(hoveredStart(undefined)).toBeNull()
  })
})
