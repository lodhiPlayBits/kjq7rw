// @vitest-environment jsdom
import { act, render, renderHook, screen } from '@testing-library/react'
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
  it('goes loading → ready and marks data stale while refetching', async () => {
    const resolvers: ((v: string) => void)[] = []
    const load = (dep: number) => () => new Promise<string>((resolve) => resolvers.push(resolve)).then((v) => `${v}-${dep}`)
    const { result, rerender } = renderHook(({ dep }) => useApi(load(dep), [dep]), { initialProps: { dep: 1 } })

    expect(result.current).toEqual({ kind: 'loading' })
    await act(async () => resolvers[0]('a'))
    expect(result.current).toEqual({ kind: 'ready', data: 'a-1', stale: false })

    rerender({ dep: 2 })
    expect(result.current).toMatchObject({ kind: 'ready', data: 'a-1', stale: true })
    await act(async () => resolvers[1]('b'))
    expect(result.current).toEqual({ kind: 'ready', data: 'b-2', stale: false })
  })

  it('discards a late response from a superseded request', async () => {
    const resolvers: ((v: string) => void)[] = []
    const load = (dep: number) => () => new Promise<string>((resolve) => resolvers.push(resolve)).then((v) => `${v}-${dep}`)
    const { result, rerender } = renderHook(({ dep }) => useApi(load(dep), [dep]), { initialProps: { dep: 1 } })

    rerender({ dep: 2 }) // aborts request 1 while it is still in flight
    await act(async () => resolvers[1]('new'))
    await act(async () => resolvers[0]('old')) // arrives after the newer one
    expect(result.current).toEqual({ kind: 'ready', data: 'new-2', stale: false })
  })

  it('reports errors but discards a late error from a superseded request', async () => {
    const rejecters: ((e: unknown) => void)[] = []
    const load = () => () => new Promise<string>((_, reject) => rejecters.push(reject))
    const { result, rerender } = renderHook(({ dep }) => useApi(load(), [dep]), { initialProps: { dep: 1 } })

    rerender({ dep: 2 })
    await act(async () => rejecters[0](new Error('stale failure')))
    expect(result.current).toEqual({ kind: 'loading' })
    await act(async () => rejecters[1](new Error('API responded 500')))
    expect(result.current).toEqual({ kind: 'error', message: 'API responded 500' })
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
