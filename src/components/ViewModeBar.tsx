import './ViewModeBar.css'

import { SURVEYS, type ViewMode } from '../api/spherex'

export type BodiesStatus = 'off' | 'loading' | 'ready' | 'error' | 'unavailable'

type ViewModeBarProps = {
    mode:          ViewMode
    onChange:      (mode: ViewMode) => void
    diffAvailable: boolean   // needs at least two frames
    showBodies:    boolean
    onToggleBodies: () => void
    bodiesStatus:  BodiesStatus
    bodiesCount:   number   // in the image
    bodiesVisible: number   // of those, bright enough for SPHEREx to see
}

type ModeButton = {
    mode:     ViewMode
    label:    string
    detail:   string
    title:    string
    disabled?: boolean
}

/**
 * Vertical stack of view-mode buttons under the sky gizmo. Exactly one is active:
 * SPHEREx frames, their difference from the reference frame, or another telescope.
 */
export default function ViewModeBar({ mode, onChange, diffAvailable, showBodies, onToggleBodies,
                                     bodiesStatus, bodiesCount, bodiesVisible }: ViewModeBarProps)
{
    const bodiesDetail =
        bodiesStatus === 'off'         ? 'hidden'
        : bodiesStatus === 'loading'   ? 'searching…'
        : bodiesStatus === 'error'     ? 'search failed'
        : bodiesStatus === 'unavailable' ? 'SPHEREx views only'
        : bodiesCount === 0            ? 'no asteroids here'
        : `${bodiesCount} in field · ${bodiesVisible} bright`

    const spherexModes: ModeButton[] = [
        {
            mode: 'spherex', label: 'SPHEREx', detail: 'frames',
            title: 'Show the SPHEREx frame selected on the timeline',
        },
        {
            mode: 'diff', label: 'Difference', detail: 'vs. reference',
            title: 'Subtract a reference frame from the current frame, to see what moved or changed brightness. Pick the reference with the REF marker on the timeline.',
            disabled: !diffAvailable,
        },
    ]

    const surveyModes: ModeButton[] = SURVEYS.map((survey) => ({
        mode: `survey:${survey.id}`,
        label: survey.label,
        detail: survey.wavelength,
        title: `Show the ${survey.label} image (${survey.wavelength}) of the same field for comparison`,
    }))

    const render = (button: ModeButton) => (
        <button
            key={button.mode}
            type="button"
            role="radio"
            aria-checked={mode === button.mode}
            className={mode === button.mode ? 'vm-button vm-button-on' : 'vm-button'}
            disabled={button.disabled}
            title={button.title}
            onClick={() => onChange(button.mode)}
        >
            <span className="vm-label">{button.label}</span>
            <span className="vm-detail">{button.detail}</span>
        </button>
    )

    return (
        <div className="view-mode-bar" role="radiogroup" aria-label="View mode">
            {spherexModes.map(render)}
            <div className="vm-heading">Other telescopes</div>
            {surveyModes.map(render)}

            <div className="vm-heading">Overlays</div>
            <button
                type="button"
                role="switch"
                aria-checked={showBodies}
                className={showBodies ? 'vm-button vm-toggle-on' : 'vm-button'}
                onClick={onToggleBodies}
                title={'Tag known asteroids, comets and planets at the time of the current frame (from IMCCE SkyBoT), '
                    + 'with arrows showing which way they move. "Bright" = V 20 or brighter, roughly what SPHEREx can see; '
                    + 'fainter ones get small dashed rings (hover for names).'}
            >
                <span className="vm-label">Known bodies</span>
                <span className="vm-detail">{bodiesDetail}</span>
            </button>
        </div>
    )
}
