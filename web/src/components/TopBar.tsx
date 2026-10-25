import type { View } from '../url'

interface Props {
  view: View
  onViewChange: (view: View) => void
}

const TABS: { view: View; label: string }[] = [
  { view: 'monitor', label: 'Monitor' },
  { view: 'accuracy', label: 'Accuracy' },
]

export function TopBar({ view, onViewChange }: Props) {
  return (
    <header className="topbar">
      <div className="brand">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="var(--primary)" />
          <path d="M16 15.5V26" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <path d="M16 15.5L16.8 6.5C16.85 6 16.2 5.8 15.95 6.25L13.5 11" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M16 15.5L23.6 19.8C24 20.05 24.45 19.55 24.15 19.15L20.6 15" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M16 15.5L8.5 19.6C8.05 19.85 8.3 20.5 8.8 20.4L13 19.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="16" cy="15.5" r="1.8" fill="white" />
        </svg>
        <div>
          <div className="brand-name">WindSight</div>
          <div className="caption">GB wind forecast monitor · Day-ahead desk</div>
        </div>
      </div>
      <nav className="segmented" aria-label="Views">
        {TABS.map((t) => (
          <button
            key={t.view}
            type="button"
            className={t.view === view ? 'seg selected' : 'seg'}
            aria-current={t.view === view ? 'page' : undefined}
            onClick={() => onViewChange(t.view)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="source-chip">
        <span className="dot" aria-hidden="true" />
        Elexon BMRS · FUELHH + WINDFOR · decisions in Jan 2026
      </div>
    </header>
  )
}
