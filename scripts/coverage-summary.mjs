// Prints the vitest json-summary as a Markdown table for the GitHub job summary.
// Usage: node scripts/coverage-summary.mjs web/coverage/coverage-summary.json
import { readFileSync } from 'node:fs'

const total = JSON.parse(readFileSync(process.argv[2], 'utf8')).total
const row = (k) => `| ${k} | ${total[k].pct}% | ${total[k].covered}/${total[k].total} |`

console.log(
  [
    '## Frontend coverage (vitest v8)',
    '',
    '| Metric | % | Covered |',
    '|---|---|---|',
    ...['lines', 'statements', 'functions', 'branches'].map(row),
    '',
    'React components have no render tests yet, so they count as uncovered; the logic modules are gated.',
  ].join('\n'),
)
