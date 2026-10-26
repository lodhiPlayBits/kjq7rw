// Shared setup for component tests (files that opt into `// @vitest-environment jsdom`).
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (typeof window !== 'undefined') window.history.replaceState(null, '', '/') // URL state must not leak between tests
})

// jsdom has no layout engine: recharts' ResponsiveContainer needs ResizeObserver. Charts render at 0×0, so chart
// internals (axes, bars, mouse handlers) are not exercised here; their logic lives in tested helpers instead.
if (typeof window !== 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
}
