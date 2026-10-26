// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { METRICS, META, failWith, group, stubApi } from '../test/fixtures'
import { DEFAULT_STATE } from '../url'
import { AccuracyView, MetricTooltip } from './AccuracyView'

const json = (body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

function renderAccuracy(onChange = vi.fn()) {
  render(<AccuracyView meta={META} state={{ ...DEFAULT_STATE, view: 'accuracy' }} onChange={onChange} />)
  return onChange
}

describe('AccuracyView', () => {
  it('loads lead, hour and day metrics and shows KPIs computed from them', async () => {
    const fetchMock = stubApi()
    renderAccuracy()

    expect(await screen.findByText('1,932 MW')).toBeTruthy() // MAE at 24 h
    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls).toEqual(expect.arrayContaining(['/api/metrics?by=lead', '/api/metrics?by=hour&horizon_h=24', '/api/metrics?by=day&horizon_h=24']))
    expect(screen.getByText('17.1% nMAE · bias +1,736 MW')).toBeTruthy()
    // 0–4 h MAE 1,750 vs day-ahead (20–28 h buckets: 2,000 and 2,050, equal n) mean 2,025 → 13.6% lower
    expect(screen.getByText('13.6% lower than day-ahead (20–28 h)')).toBeTruthy()
    expect(screen.getByText('+31.4% vs 0–4 h')).toBeTruthy() // 2,300 / 1,750
    expect(screen.getByText('Sun 11 Jan')).toBeTruthy()
    expect(screen.getByText('MAE 5,020 MW')).toBeTruthy()
  })

  it('highlights the day-ahead rows in the lead-time table', async () => {
    stubApi()
    renderAccuracy()
    await screen.findByText('1,932 MW')
    const rows = await screen.findAllByRole('row')
    const highlighted = rows.filter((r) => r.classList.contains('highlight'))
    expect(highlighted.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['20–24 h · day-ahead', '24–28 h · day-ahead'])
  })

  it('states a consistent lean only when every lead bucket agrees, with the curtailment caveat', async () => {
    stubApi()
    renderAccuracy()
    expect(await screen.findByText('Forecasts lean high, at every lead time.')).toBeTruthy()
    expect(screen.getByText(/On average wind under-delivered, leaving the desk short\./)).toBeTruthy()
    expect(screen.getByText(/possible \(unverified\) cause/)).toBeTruthy()
    expect(screen.getByText('Watch 02:00, 03:00, 04:00, 05:00.')).toBeTruthy()
  })

  it('omits the lean takeaway and caveat when bias signs are mixed', async () => {
    const mixed = { ...METRICS.lead, groups: METRICS.lead.groups.map((g, i) => (i === 0 ? { ...g, bias: -50 } : g)) }
    stubApi({ '/api/metrics?by=lead': json(mixed) })
    renderAccuracy()
    await screen.findAllByText('Takeaways')
    expect(screen.queryByText(/Forecasts lean/)).toBeNull()
    expect(screen.queryByText(/possible \(unverified\) cause/)).toBeNull()
  })

  it('switches metric locally and horizon through onChange', async () => {
    stubApi()
    const onChange = renderAccuracy()
    await screen.findByText('1,932 MW')

    const bias = screen.getByRole('button', { name: 'Bias' })
    await userEvent.click(bias)
    expect(bias.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Mean of forecast − actual, MW: positive = over-forecast')).toBeTruthy()
    expect(screen.getByText(/red = forecast above actual, blue = below/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '12 h' }))
    expect(onChange).toHaveBeenCalledWith({ horizon: 12 })
  })

  it('labels calendar cells for screen readers', async () => {
    stubApi()
    renderAccuracy()
    expect(await screen.findByLabelText('Sun 11 Jan: MAE 5,020 MW')).toBeTruthy()
  })

  it('reports API errors', async () => {
    stubApi({ '/api/metrics': failWith(500) })
    renderAccuracy()
    expect((await screen.findByRole('alert')).textContent).toContain('API responded 500')
  })
})

describe('MetricTooltip', () => {
  it('lists every metric, highlights the selected one and formats day keys', () => {
    render(<MetricTooltip active metric="bias" countLabel="Hours" payload={[{ payload: group('2026-01-11', '2026-01-11', 5020, -400) }]} />)
    expect(screen.getByText('Sun 11 Jan')).toBeTruthy()
    expect(screen.getByText('−400 MW').className).toBe('tooltip-current')
    expect(screen.getByText('5,020 MW')).toBeTruthy()
    expect(screen.getByText('Hours')).toBeTruthy()
  })

  it('uses the group label for lead buckets and renders nothing when inactive', () => {
    const { rerender, container } = render(<MetricTooltip active metric="mae" countLabel="Forecast-hours" payload={[{ payload: group(5, '20–24 h', 2000, 1700) }]} />)
    expect(screen.getByText('20–24 h')).toBeTruthy()
    rerender(<MetricTooltip active={false} metric="mae" countLabel="Hours" payload={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
