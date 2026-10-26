import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev: run the API from the repo root with `PYTHONPATH=backend uvicorn windsight.app:app --port 8000`.
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    // Pure modules run in node; component tests opt into jsdom with `// @vitest-environment jsdom`.
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
      // lcov for SonarCloud, json-summary for the CI job summary, html as a downloadable artifact.
      reporter: ['text', 'lcov', 'json-summary', 'html'],
      // Gate the pure logic modules. React components have no render tests yet, so they are
      // reported but not gated.
      thresholds: {
        'src/{accuracy,api,chartData,format,url}.ts': { lines: 90, branches: 85, functions: 60, statements: 90 },
      },
    },
  },
})
