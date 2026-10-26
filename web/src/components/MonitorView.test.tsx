// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { ChartRow } from '../chartData'
import { META, SERIES, failWith, point, stubApi } from '../test/fixtures'
import { DEFAULT_STATE } from '../url'
import { TooltipBody } from './ForecastChart'
import { MonitorView } from './MonitorView'

const json = (body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

// Browser APIs these tests define on shared objects; restored after each test so nothing leaks.
const originals = {
  clipboard: Object.getOwnPropertyDescriptor(navigator, 'clipboard'),
  createObjectURL: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
  revokeObjectURL: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
}
afterEach(() => {
  const restore = (target: object, key: string, d: PropertyDescriptor | undefined) =>
    d ? Object.defineProperty(target, key, d) : Reflect.deleteProperty(target, key)
  restore(navigator, 'clipboard', originals.clipboard)
  restore(URL, 'createObjectURL', originals.createObjectURL)
  restore(URL, 'revokeObjectURL', originals.revokeObjectURL)
})

function renderMonitor(onChange = vi.fn()) {
  render(<MonitorView meta={META} state={DEFAULT_STATE} onChange={onChange} />)
  return onChange
}

describe('MonitorView', () => {
  it('requests the selected range and shows headline metrics and the largest miss', async () => {
    const fetchMock = stubApi()
    renderMonitor()

    expect(await screen.findByText('2,603 MW')).toBeTruthy() // MAE
    expect(fetchMock.mock.calls[0][0]).toBe('/api/series?horizon_h=24&from=2026-01-10T00%3A00%3A00Z&to=2026-01-13T00%3A00%3A00Z')
    expect(screen.getByText('+2,337 MW')).toBeTruthy() // bias
    expect(screen.getByText('Wind over-forecast → risk of being short')).toBeTruthy()
    expect(screen.getByText('24.1% of mean output (nMAE)')).toBeTruthy()
    expect(screen.getByText('Largest miss in range')).toBeTruthy()
    expect(screen.getByText('Sun 11 Jan · 01:00')).toBeTruthy()
    expect(screen.getByText('+6,804 MW')).toBeTruthy()
    expect(screen.getByText('26.5 h')).toBeTruthy()
  })

  it('words negative bias as over-buying risk', async () => {
    stubApi({ '/api/series': json({ ...SERIES, summary: { ...SERIES.summary!, bias: -500 } }) })
    renderMonitor()
    expect(await screen.findByText('Wind under-forecast → risk of over-buying')).toBeTruthy()
  })

  it('shows a neutral caption for zero bias', async () => {
    stubApi({ '/api/series': json({ ...SERIES, summary: { ...SERIES.summary!, bias: 0, nmae: null } }) })
    renderMonitor()
    expect(await screen.findByText('No systematic over- or under-forecast')).toBeTruthy()
  })

  it('reports API errors', async () => {
    stubApi({ '/api/series': failWith(500) })
    renderMonitor()
    expect((await screen.findByRole('alert')).textContent).toContain('API responded 500')
  })

  it('sends slider and typed-date edits up, typed dates in keep mode', async () => {
    stubApi()
    const onChange = renderMonitor()
    await screen.findByText('2,603 MW')

    fireEvent.change(screen.getByLabelText('Forecast horizon'), { target: { value: '12' } })
    expect(onChange).toHaveBeenCalledWith({ horizon: 12 })
    fireEvent.change(screen.getByLabelText('First delivery day'), { target: { value: '2026-01-11' } })
    expect(onChange).toHaveBeenCalledWith({ from: '2026-01-11' }, 'keep')
    fireEvent.change(screen.getByLabelText('Last delivery day'), { target: { value: '2026-01-14' } })
    expect(onChange).toHaveBeenCalledWith({ to: '2026-01-14' }, 'keep')
  })

  it('copies a shareable link built from the state', async () => {
    stubApi()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderMonitor()

    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?from=2026-01-10&to=2026-01-12&horizon=24`)
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy()
  })

  it('falls back to a prompt when the clipboard is blocked', async () => {
    stubApi()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
    renderMonitor()

    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(prompt).toHaveBeenCalledWith('Copy this link', expect.stringContaining('horizon=24')))
  })

  it('exports the points as a CSV download and releases the object URL', async () => {
    stubApi()
    const createObjectURL = vi.fn().mockReturnValue('blob:csv')
    const revokeObjectURL = vi.fn()
    // jsdom does not implement object URLs.
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderMonitor()
    await screen.findByText('2,603 MW')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv')
    const blob = createObjectURL.mock.calls[0][0] as Blob
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader() // jsdom's Blob has no .text()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    expect(text).toContain('start_time,actual,forecast,error')
    expect(text).toContain('2026-01-11T01:00:00Z,14048,20852,6804')
    expect(click).toHaveBeenCalledTimes(1)
  })
})

describe('TooltipBody', () => {
  const row = (p: ReturnType<typeof point> | null, actual: number | null = 9000): ChartRow => ({
    t: Date.parse('2026-01-11T01:00:00Z'),
    actual,
    forecast: p?.forecast ?? null,
    error: p?.error ?? null,
    gap: null,
    point: p,
  })

  it('shows forecast, signed error, publish time and lead for an hourly point', () => {
    render(<TooltipBody active payload={[{ payload: row(point('2026-01-11T01:00:00Z', 9000, 8000, 26.5)) }]} />)
    expect(screen.getByText('Sun 11 Jan · 01:00')).toBeTruthy()
    expect(screen.getByText('8,000 MW')).toBeTruthy()
    expect(screen.getByText('−1,000 MW').className).toBe('tone-under')
    expect(screen.getByText('Fri 9 Jan · 22:30')).toBeTruthy() // 26.5 h before delivery
    expect(screen.getByText('26.5 h')).toBeTruthy()
  })

  it('explains half-hour rows and hours with no forecast, and renders nothing when inactive', () => {
    const { rerender, container } = render(<TooltipBody active payload={[{ payload: row(null) }]} />)
    expect(screen.getByText('Half-hour actual · forecasts are hourly')).toBeTruthy()
    rerender(<TooltipBody active payload={[{ payload: row(point('2026-01-11T01:00:00Z', 9000, null), null) }]} />)
    expect(screen.getByText('No forecast published early enough')).toBeTruthy()
    rerender(<TooltipBody active={false} payload={[]} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('App', () => {
  it('restores a non-default view from the URL and keeps the URL in sync when switching', async () => {
    const fetchMock = stubApi()
    window.history.replaceState(null, '', '/?view=accuracy&from=2026-01-15&to=2026-01-17&horizon=12')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Forecast accuracy' })).toBeTruthy()
    expect(screen.getByText('MAPE deliberately not used: it explodes at low wind.')).toBeTruthy()
    await waitFor(() => expect(fetchMock.mock.calls.map((c) => c[0])).toContain('/api/metrics?by=hour&horizon_h=12'))

    await userEvent.click(screen.getByRole('button', { name: 'Monitor' }))
    expect(await screen.findByRole('heading', { name: 'Forecast monitor' })).toBeTruthy()
    await waitFor(() =>
      expect(fetchMock.mock.calls.map((c) => c[0])).toContain('/api/series?horizon_h=12&from=2026-01-15T00%3A00%3A00Z&to=2026-01-18T00%3A00%3A00Z'),
    )
    await waitFor(() => expect(window.location.search).toBe('?from=2026-01-15&to=2026-01-17&horizon=12'))
  })

  it('shows an alert when the API is unreachable', async () => {
    stubApi({ '/api/meta': failWith(503) })
    render(<App />)
    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the API: API responded 503')
  })
})
