import type { ResolvedObject } from '../api/spherex'
import { ObjectFinder } from './ObjectSearch'

export default function Header({ onLocate, onClear }: { onLocate: (object: ResolvedObject) => void, onClear: () => void })
{
    return (
        <header className="app-header">
            <div className="brand">
                <div className="brand-copy">
                    <span className="eyebrow">2026 NASA Space Apps Challenge</span>
                    <strong>Planet X and SPHEREx</strong>
                </div>
            </div>

            <ObjectFinder onLocate={onLocate} onClear={onClear} />

            {/* shortcut: no settings exist yet, so the button opens nothing; give it an onClick when they do. */}
            <button type="button" className="header-settings" aria-label="Settings" title="Settings">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
                     strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
            </button>
        </header>
    )
}
