import './PlaybackPanel.css'

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { fitsCutoutUrl, type SpherexImage, type ViewTarget } from '../api/spherex'
import { PLAYBACK_SPEEDS_FPS, WAVELENGTH_TOLERANCES_UM, type Frames } from '../hooks/useFrames'
import { useScrub } from '../hooks/useScrub'

type PlaybackPanelProps = {
    frames: Frames
    target: ViewTarget
}

type DragKind = 'playhead' | 'start' | 'end' | 'ref'

const EPOCH_COLORS = ['#60a5fa', '#fbbf24', '#34d399', '#f472b6', '#a78bfa']

function Icon({ children }: { children: ReactNode })
{
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            {children}
        </svg>
    )
}

const icons = {
    previous: <Icon><path d="M6 5h2.5v14H6zM20 5v14L9.5 12z" /></Icon>,
    next:     <Icon><path d="M15.5 5H18v14h-2.5zM4 5l10.5 7L4 19z" /></Icon>,
    play:     <Icon><path d="M7 4.5v15l12.5-7.5z" /></Icon>,
    pause:    <Icon><path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z" /></Icon>,
    loop: (
        <Icon>
            <path d="M17 3l4 4-4 4V8H7a2 2 0 0 0-2 2v2H3v-2a4 4 0 0 1 4-4h10zM7 21l-4-4 4-4v3h10a2 2 0 0 0 2-2v-2h2v2a4 4 0 0 1-4 4H7z" />
        </Icon>
    ),
    // Embed: </> code brackets.
    embed: <Icon><path d="M8.6 16.6 4 12l4.6-4.6L7.2 6l-6 6 6 6zm6.8 0L20 12l-4.6-4.6L16.8 6l6 6-6 6z" /></Icon>,
}

const IS_LOCAL_HOST = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * Export: an <iframe> of this exact view for other websites (the page URL always
 * describes what's on screen), plus the current frame as a FITS file from IRSA.
 * The panel is portalled to <body>, since the playback bar clips what overflows it.
 */
function ExportButton({ frame, target }: { frame: SpherexImage | null, target: ViewTarget })
{
    const buttonRef = useRef<HTMLButtonElement | null>(null)
    const panelRef = useRef<HTMLDivElement | null>(null)
    const [place, setPlace] = useState<{ right: number, bottom: number } | null>(null)
    const [snippet, setSnippet] = useState('')
    const [copied, setCopied] = useState(false)

    const open = () =>
    {
        const rect = buttonRef.current!.getBoundingClientRect()
        const sign = target.dec >= 0 ? '+' : ''
        const title = `Planet X and SPHEREx: SPHEREx images of RA ${target.ra.toFixed(4)}°, Dec ${sign}${target.dec.toFixed(4)}°`
        // The current view (the page URL always describes it), as just the image, playing.
        const url = new URL(window.location.href)
        url.searchParams.set('embed', '1')
        url.searchParams.set('autoplay', '1')
        setSnippet(`<iframe src="${escapeAttr(url.href)}" title="${escapeAttr(title)}" `
            + 'width="960" height="640" style="border:0" loading="lazy" allowfullscreen></iframe>')
        setCopied(false)
        setPlace({ right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.top + 8 })
    }
    const close = () => setPlace(null)

    // Close on Escape, a click elsewhere, or a resize (the position would be stale).
    useEffect(() =>
    {
        if (!place)
            return
        const onKey = (event: globalThis.KeyboardEvent) =>
        {
            if (event.key === 'Escape')
            {
                close()
                buttonRef.current?.focus()
            }
        }
        const onDown = (event: PointerEvent) =>
        {
            const node = event.target as Node
            if (!panelRef.current?.contains(node) && !buttonRef.current?.contains(node))
                close()
        }
        window.addEventListener('keydown', onKey)
        window.addEventListener('pointerdown', onDown)
        window.addEventListener('resize', close)
        return () =>
        {
            window.removeEventListener('keydown', onKey)
            window.removeEventListener('pointerdown', onDown)
            window.removeEventListener('resize', close)
        }
    }, [place])

    const copy = async () =>
    {
        try
        {
            await navigator.clipboard.writeText(snippet)
            setCopied(true)
        }
        catch
        {
            // Clipboard blocked (e.g. not a secure context): select the code so Ctrl+C works.
            panelRef.current?.querySelector('textarea')?.select()
        }
    }

    return (
        <>
            <button ref={buttonRef} type="button" className={place ? 'pb-button pb-button-on' : 'pb-button'}
                    onClick={() => (place ? close() : open())}
                    aria-haspopup="dialog" aria-expanded={!!place}
                    aria-label="Export: embed this view on another website" title="Export / embed this view">
                {icons.embed}
            </button>
            {place && createPortal(
                <div ref={panelRef} className="pb-export" role="dialog" aria-label="Export this view" style={place}>
                    <div className="pb-export-title">Embed this view</div>
                    <p className="pb-export-hint">
                        Paste this into any web page to show this view's image, playing through the timeline: same
                        position, field of view, wavelength and starting frame.
                    </p>
                    <textarea className="pb-export-code" readOnly value={snippet} rows={4} spellCheck={false}
                              onFocus={(event) => event.target.select()} aria-label="Embed code" />
                    {IS_LOCAL_HOST && (
                        <p className="pb-export-warning">
                            This address is on your own computer, so the embed will only work on other sites
                            once the app is hosted publicly.
                        </p>
                    )}
                    <div className="pb-export-actions">
                        {frame ? (
                            <a className="pb-export-link" href={fitsCutoutUrl(frame.access_url, target)} target="_blank" rel="noreferrer">
                                Download this frame (FITS)
                            </a>
                        ) : <span />}
                        <button type="button" className="pb-export-copy" onClick={copy}>{copied ? 'Copied ✓' : 'Copy code'}</button>
                    </div>
                </div>,
                document.body,
            )}
        </>
    )
}

// Range limits are shown to 2 decimals, rounded outward (lower limit down, upper limit
// up) so the displayed range always contains every wavelength in it. Plain rounding
// could show e.g. "1.63 ≤ 1.6286" for a value that is exactly the lowest.
// The small epsilon stops float noise (1.1 stored as 1.1000000001) rounding outward.
const floor2 = (um: number) => (Math.floor(um * 100 + 1e-6) / 100).toFixed(2)
const ceil2  = (um: number) => (Math.ceil(um * 100 - 1e-6) / 100).toFixed(2)

function formatDate(image: SpherexImage): string
{
    if (!image.time_start)
        return 'unknown date'
    return image.time_start.slice(0, 16).replace('T', ' ') + ' UTC'
}

/** Spacing between numbered ticks so at most ~12 labels are drawn. */
function labelStep(count: number): number
{
    for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500])
    {
        if (count / step <= 12)
            return step
    }
    return 1000
}

/**
 * The matched wavelength. Drag it (right / up = longer) or scroll over it to step to the
 * next wavelength any image was taken at; click it to type one. Hold Shift to jump past
 * the current tolerance to an entirely new set of images. While dragging, the mouse is
 * locked and hidden (Pointer Lock), so the drag never runs into the edge of the screen.
 */
function WavelengthStepper({ f }: { f: Frames })
{
    const ref = useRef<HTMLDivElement | null>(null)
    const disabled = !f.matchWavelength || f.refWavelength === null

    // The text being typed (null when not typing), so the box can be emptied or hold
    // half-typed values like "1." while the matched wavelength stays the last valid one.
    const [draft, setDraft] = useState<string | null>(null)

    useScrub(ref, { disabled, draggingClass: 'pb-stepper-dragging',
                    onStep: (direction, shift) => { setDraft(null); f.stepWavelength(direction, shift) } })

    // Once typing is done (Enter / leaving the box), move a typed wavelength to the nearest
    // one an image was taken at, so the box always names a real image's wavelength.
    // Not on every keystroke: "1." on the way to "1.25" would snap mid-typing.
    const snapToValid = () =>
    {
        const typed = f.refWavelength
        if (typed === null || f.wavelengths.length === 0)
            return
        f.setRefWavelength(f.wavelengths.reduce((best, w) => (Math.abs(w - typed) < Math.abs(best - typed) ? w : best)))
    }
    const finishTyping = () =>
    {
        setDraft(null)
        snapToValid()
    }

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) =>
    {
        if (event.key === 'Enter')
            finishTyping()
        else if (event.key === 'ArrowUp' || event.key === 'ArrowDown')
        {
            event.preventDefault()
            setDraft(null)
            f.stepWavelength(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey)
        }
    }

    return (
        <div
            ref={ref}
            className="pb-stepper"
            title="Drag or scroll to step to the next wavelength used by an image; click to type one (hold Shift to jump to a new set of images)"
        >
            <input
                type="number"
                className="pb-wavelength"
                min={0.7}
                max={5.1}
                step={0.01}
                value={draft ?? f.refWavelength ?? ''}
                disabled={disabled}
                onChange={(e) =>
                {
                    setDraft(e.target.value)
                    const value = Number(e.target.value)
                    if (e.target.value !== '' && Number.isFinite(value))
                        f.setRefWavelength(value)
                }}
                onKeyDown={onKeyDown}
                onBlur={finishTyping}
                aria-label="Wavelength to match, in micrometres"
            />
        </div>
    )
}

function shortDate(iso: string | null): string
{
    return iso ? iso.slice(0, 10) : 'date unknown'
}

/**
 * Timeline for another telescope's images. These are archival survey products, not a
 * time series, so there's usually exactly one: the timeline says so instead of showing
 * SPHEREx's frames, which aren't what's on screen.
 */
function SurveyTimeline({ survey }: { survey: NonNullable<Frames['survey']> })
{
    const { images, index, status } = survey
    const count = images.length
    const label = survey.info?.label ?? survey.id
    const position = (i: number) => (count > 1 ? (i / (count - 1)) * 100 : 50)
    const current = images[index] ?? null

    const dateRange = (im: (typeof images)[number]) =>
        im.time_start && im.time_end && im.time_end.slice(0, 10) !== im.time_start.slice(0, 10)
            ? `${shortDate(im.time_start)} → ${shortDate(im.time_end)}`
            : shortDate(im.time_start)

    let message: string | null = null
    if (status === 'loading')
        message = `Looking up ${label} images of this position…`
    else if (status === 'error')
        message = survey.error ?? `${label} image search failed`
    else if (count === 0)
        message = `${label} has no images of this position`

    return (
        <div className="pb pb-survey">
            <div className="pb-timeline pb-timeline-static">
                <div className="pb-track">
                    {message && <div className="pb-message">{message}</div>}
                    {images.map((im, i) => (
                        <div key={im.id} className="pb-tick pb-tick-labelled" style={{ left: `${position(i)}%` }}>
                            <span>{i + 1}</span>
                        </div>
                    ))}
                    {current && (
                        <div className="pb-playhead pb-playhead-survey" style={{ left: `${position(index)}%` }}>
                            <span className="pb-playhead-label">{index + 1}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="pb-controls">
                <div className="pb-box" title={`${label} images of this position`}>
                    <span className="pb-box-static">{count ? index + 1 : 0}</span>
                    <span className="pb-box-suffix">/ {count}</span>
                </div>

                <div className="pb-transport">
                    <button type="button" className="pb-button" onClick={() => survey.setIndex(index - 1)}
                            disabled={index <= 0} aria-label="Previous image" title="Previous image">
                        {icons.previous}
                    </button>
                    <button type="button" className="pb-button" onClick={() => survey.setIndex(index + 1)}
                            disabled={index >= count - 1} aria-label="Next image" title="Next image">
                        {icons.next}
                    </button>
                </div>

                <div className="pb-survey-note">
                    {count === 1
                        ? `${label} has 1 image of this position. Survey images are archival, not a time series; switch back to SPHEREx to step through dates.`
                        : count > 1
                            ? `${label} has ${count} overlapping images of this position.`
                            : ''}
                </div>
            </div>

            <div className="pb-status">
                <div className="pb-frame-info">
                    {current ? (
                        <>
                            <strong>{label}</strong>
                            <span>{dateRange(current)}</span>
                            {current.obs_id && <span className="pb-dim-text">{current.obs_id}</span>}
                            <span className="pb-dim-text">{current.note}</span>
                        </>
                    ) : <span>&nbsp;</span>}
                </div>
                <div className="pb-filter">
                    <span className="pb-count">{survey.info?.wavelength}</span>
                </div>
            </div>
        </div>
    )
}

export default function PlaybackPanel({ frames: f, target }: PlaybackPanelProps)
{
    const trackRef = useRef<HTMLDivElement | null>(null)
    const [dragging, setDragging] = useState<DragKind | null>(null)

    // Another telescope is on screen: show its images, not SPHEREx's frames.
    if (f.survey)
        return <SurveyTimeline survey={f.survey} />

    const count = f.frames.length
    const last  = Math.max(count - 1, 0)

    // Where frame i sits along the track, in percent.
    const position = (index: number) => (count > 1 ? (index / last) * 100 : 50)

    const indexFromClientX = (clientX: number) =>
    {
        const rect = trackRef.current?.getBoundingClientRect()
        if (!rect || rect.width === 0)
            return 0
        return Math.round(Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * last)
    }

    const startDrag = (kind: DragKind) => (event: ReactPointerEvent) =>
    {
        if (count === 0 || event.button !== 0)
            return
        event.preventDefault()
        event.stopPropagation()

        const update = (clientX: number) =>
        {
            const index = indexFromClientX(clientX)
            if (kind === 'playhead') f.setFrameIndex(index)
            if (kind === 'start')    f.setRangeStart(index)
            if (kind === 'end')      f.setRangeEnd(index)
            if (kind === 'ref')      f.setRefIndex(index)
        }
        update(event.clientX)
        setDragging(kind)

        const onMove = (moveEvent: PointerEvent) => update(moveEvent.clientX)
        const onUp = () =>
        {
            setDragging(null)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    }

    const onKeyDown = (event: KeyboardEvent) =>
    {
        if (event.key === 'ArrowLeft')  { event.preventDefault(); f.step(-1) }
        if (event.key === 'ArrowRight') { event.preventDefault(); f.step(1) }
        if (event.key === ' ')          { event.preventDefault(); f.togglePlaying() }
        // [ and ] set the loop range to start / end at the current frame.
        if (event.key === '[')          { event.preventDefault(); f.setRangeStart(f.frameIndex) }
        if (event.key === ']')          { event.preventDefault(); f.setRangeEnd(f.frameIndex) }
    }

    // -- Timeline decorations --

    const step = labelStep(count)
    const ticks = f.frames.map((_, i) =>
    {
        const number = i + 1
        const labelled = number === 1 || number % step === 0
            || (i === last && (count % step) >= step / 2)
        return { i, number, labelled }
    }).filter((tick) => tick.labelled || count <= 80)

    // Coloured bands marking which frames belong to the same season of visits.
    const half = count > 1 ? 50 / last : 50
    const bands: { epoch: number, from: number, to: number }[] = []
    f.frames.forEach((image, i) =>
    {
        const epoch = image.epoch ?? 0
        const band = bands[bands.length - 1]
        if (band && band.epoch === epoch)
            band.to = i
        else
            bands.push({ epoch, from: i, to: i })
    })

    // -- Status line --

    const frame = f.frame
    const rangeFirst = f.frames[f.rangeStart]
    const daysFromStart = frame && rangeFirst && frame.mjd_start != null && rangeFirst.mjd_start != null
        ? frame.mjd_start - rangeFirst.mjd_start
        : null

    let message: string | null = null
    if (f.status === 'loading')
        message = 'Searching for images at this position (first search can take ~20 s)…'
    else if (f.status === 'error')
        message = f.error ?? 'Image search failed'
    else if (f.allImages.length === 0)
        message = 'No SPHEREx images cover this position'
    else if (count === 0)
        message = f.detector !== null && !f.matchWavelength
            ? `No images from detector ${f.detector} at this position`
            : 'No images match this wavelength — widen the tolerance, pick another detector, or turn matching off'

    return (
        <div className="pb">
            <div
                className="pb-timeline"
                tabIndex={0}
                role="slider"
                aria-label="Frame"
                aria-valuemin={1}
                aria-valuemax={Math.max(count, 1)}
                aria-valuenow={f.frameIndex + 1}
                aria-valuetext={frame ? `Frame ${f.frameIndex + 1} of ${count}, ${formatDate(frame)}` : undefined}
                onKeyDown={onKeyDown}
                onPointerDown={startDrag('playhead')}
            >
                <div className="pb-track" ref={trackRef}>
                    {message && <div className="pb-message">{message}</div>}

                    {bands.map((band) => (
                        <div
                            key={`${band.epoch}-${band.from}`}
                            className="pb-band"
                            style={{
                                left:  `${Math.max(position(band.from) - half, 0)}%`,
                                right: `${Math.max(100 - position(band.to) - half, 0)}%`,
                                background: EPOCH_COLORS[band.epoch % EPOCH_COLORS.length],
                            }}
                            title={`Season ${band.epoch + 1}: ${formatDate(f.frames[band.from])} → ${formatDate(f.frames[band.to])}`}
                        />
                    ))}

                    {/* Downloaded frames: a bright strip along the bottom, like a video buffer bar,
                        over a dark track showing frames that aren't downloaded yet. */}
                    {count > 0 && <div className="pb-buffer-track" title="Download progress" />}
                    {f.cached.map((isCached, i) => isCached && (
                        <div
                            key={`cached-${i}`}
                            className="pb-cached"
                            style={{
                                left:  `${Math.max(position(i) - half, 0)}%`,
                                right: `${Math.max(100 - position(i) - half, 0)}%`,
                            }}
                        />
                    ))}

                    {ticks.map((tick) => (
                        <div
                            key={tick.i}
                            className={tick.labelled ? 'pb-tick pb-tick-labelled' : 'pb-tick'}
                            style={{ left: `${position(tick.i)}%` }}
                        >
                            {tick.labelled && <span>{tick.number}</span>}
                        </div>
                    ))}

                    {count > 1 && (
                        <>
                            {f.rangeStart > 0 && (
                                <div className="pb-dim" style={{ left: '-40px', width: `calc(${position(f.rangeStart)}% + 29px)` }} />
                            )}
                            {f.rangeEnd < last && (
                                <div className="pb-dim" style={{ right: '-40px', width: `calc(${100 - position(f.rangeEnd)}% + 29px)` }} />
                            )}

                            <div
                                className={dragging === 'start' ? 'pb-handle pb-handle-start pb-handle-dragging' : 'pb-handle pb-handle-start'}
                                style={{ left: `${position(f.rangeStart)}%` }}
                                onPointerDown={startDrag('start')}
                                title="Drag to set the first frame of the loop ([ sets it to the current frame)"
                            />
                            <div
                                className={dragging === 'end' ? 'pb-handle pb-handle-end pb-handle-dragging' : 'pb-handle pb-handle-end'}
                                style={{ left: `${position(f.rangeEnd)}%` }}
                                onPointerDown={startDrag('end')}
                                title="Drag to set the last frame of the loop (] sets it to the current frame)"
                            />
                        </>
                    )}

                    {/* Reference frame for the difference view: only shown in that mode. */}
                    {f.viewMode === 'diff' && count > 1 && (
                        <div
                            className={dragging === 'ref' ? 'pb-ref pb-ref-dragging' : 'pb-ref'}
                            style={{ left: `${position(f.refIndex)}%` }}
                        >
                            <span
                                className="pb-ref-label"
                                onPointerDown={startDrag('ref')}
                                title={`Reference frame ${f.refIndex + 1}${f.refFrame ? ` (${formatDate(f.refFrame)})` : ''}: `
                                    + 'the difference view subtracts it from the current frame. Drag to change; it skips over the current frame.'}
                            >
                                REF
                            </span>
                        </div>
                    )}

                    {count > 0 && (
                        <>
                            <div
                                className={dragging === 'playhead' ? 'pb-playhead pb-playhead-dragging' : 'pb-playhead'}
                                style={{ left: `${position(f.frameIndex)}%` }}
                            >
                                <span className={f.frameLoading ? 'pb-playhead-label pb-playhead-loading' : 'pb-playhead-label'}>
                                    {f.frameIndex + 1}
                                </span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className="pb-controls">
                <label className="pb-box" title="Current frame">
                    <input
                        type="number"
                        min={1}
                        max={Math.max(count, 1)}
                        value={count ? f.frameIndex + 1 : 0}
                        disabled={count === 0}
                        onChange={(e) => f.setFrameIndex(Number(e.target.value) - 1)}
                        aria-label="Current frame"
                    />
                    <span className="pb-box-suffix">/ {count}</span>
                </label>

                <div className="pb-box pb-range" title="Loop range (first and last frame)">
                    <input
                        type="number"
                        min={1}
                        max={f.rangeEnd + 1}
                        value={count ? f.rangeStart + 1 : 0}
                        disabled={count === 0}
                        onChange={(e) => f.setRangeStart(Number(e.target.value) - 1)}
                        aria-label="First frame of loop range"
                    />
                    <span className="pb-box-label">Range</span>
                    <input
                        type="number"
                        min={f.rangeStart + 1}
                        max={Math.max(count, 1)}
                        value={count ? f.rangeEnd + 1 : 0}
                        disabled={count === 0}
                        onChange={(e) => f.setRangeEnd(Number(e.target.value) - 1)}
                        aria-label="Last frame of loop range"
                    />
                </div>

                <div className="pb-transport">
                    <button type="button" className="pb-button" onClick={() => f.step(-1)} disabled={count < 2}
                            aria-label="Previous frame" title="Previous frame (←)">
                        {icons.previous}
                    </button>
                    <button type="button" className="pb-button pb-button-play" onClick={f.togglePlaying} disabled={count < 2}
                            aria-label={f.playing ? 'Pause' : 'Play'} title={f.playing ? 'Pause (space)' : 'Play (space)'}>
                        {f.playing ? icons.pause : icons.play}
                    </button>
                    <button type="button" className="pb-button" onClick={() => f.step(1)} disabled={count < 2}
                            aria-label="Next frame" title="Next frame (→)">
                        {icons.next}
                    </button>
                    <button type="button" className={f.loop ? 'pb-button pb-button-on' : 'pb-button'}
                            onClick={() => f.setLoop(!f.loop)} aria-pressed={f.loop}
                            aria-label="Loop playback" title={f.loop ? 'Looping: on' : 'Looping: off'}>
                        {icons.loop}
                    </button>
                </div>

                <label className="pb-box pb-speed" title="Frames shown per second while playing">
                    <span className="pb-box-label">Playback Speed</span>
                    <select value={f.speedFps} onChange={(e) => f.setSpeedFps(Number(e.target.value))}>
                        {PLAYBACK_SPEEDS_FPS.map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
                    </select>
                </label>

                <div
                    className={f.matchWavelength ? 'pb-box pb-match pb-match-on' : 'pb-box pb-match'}
                    title="Only step through images taken at nearly the same wavelength, so frames differ in time instead of colour"
                >
                    <button
                        type="button"
                        className="pb-match-toggle"
                        aria-pressed={f.matchWavelength}
                        disabled={f.allImages.length === 0}
                        onClick={() =>
                        {
                            // Turning matching on locks onto the frame being viewed.
                            if (!f.matchWavelength && frame?.wavelength_um != null)
                                f.setRefWavelength(frame.wavelength_um)
                            f.setMatchWavelength(!f.matchWavelength)
                        }}
                    >
                        <span className="pb-match-light" aria-hidden="true" />
                        Match Wavelength
                    </button>
                    {/* A native select shows the selected option's text, so the selected one is
                        just its name ("D1"); the others keep their range and image count. */}
                    <select
                        className="pb-detector"
                        value={f.detector ?? ''}
                        disabled={f.detectors.length === 0}
                        onChange={(e) => f.setDetector(e.target.value === '' ? null : Number(e.target.value))}
                        aria-label="Detector"
                        title="Detector: each SPHEREx detector covers one slice of the spectrum. Picking one jumps to its shortest wavelength."
                    >
                        <option value="">{f.detector === null ? 'All' : 'All · every detector'}</option>
                        {f.detectors.map((d) => (
                            <option key={d.detector} value={d.detector}>
                                {d.detector === f.detector
                                    ? `D${d.detector}`
                                    : `D${d.detector} · ${floor2(d.minUm)}–${ceil2(d.maxUm)} µm (${d.count})`}
                            </option>
                        ))}
                    </select>
                    {/* The selected wavelength sits between the ends of the range it can step through. */}
                    <span className="pb-bound" title="Shortest wavelength available on this detector">
                        {f.wavelengths.length ? floor2(f.wavelengths[0]) : '–'}
                    </span>
                    {/* Reads as "min ≤ selected ≤ max". */}
                    <span className="pb-ineq" aria-hidden="true">≤</span>
                    <WavelengthStepper f={f} />
                    <span className="pb-ineq" aria-hidden="true">≤</span>
                    <span className="pb-bound" title="Longest wavelength available on this detector">
                        {f.wavelengths.length ? ceil2(f.wavelengths[f.wavelengths.length - 1]) : '–'}
                    </span>
                    <span className="pb-box-unit">µm ±</span>
                    <select
                        className="pb-tolerance"
                        value={f.toleranceUm}
                        disabled={!f.matchWavelength}
                        onChange={(e) => f.setToleranceUm(Number(e.target.value))}
                        aria-label="Wavelength tolerance in micrometres"
                    >
                        {WAVELENGTH_TOLERANCES_UM.map((tol) => <option key={tol} value={tol}>{tol}</option>)}
                    </select>
                </div>

                <ExportButton frame={frame} target={target} />
            </div>

            <div className="pb-status">
                <div className="pb-frame-info">
                    {frame ? (
                        <>
                            <strong>{formatDate(frame)}</strong>
                            {daysFromStart !== null && (
                                <span title={`Time since frame ${f.rangeStart + 1}, the start of the range`}>
                                    {daysFromStart >= 0 ? '+' : '−'}{Math.abs(daysFromStart).toFixed(1)} days
                                </span>
                            )}
                            <span>
                                <i className="pb-dot" style={{ background: EPOCH_COLORS[(frame.epoch ?? 0) % EPOCH_COLORS.length] }} />
                                season {(frame.epoch ?? 0) + 1} of {Math.max(f.epochs.length, 1)}
                            </span>
                            {frame.wavelength_um != null && <span>{frame.wavelength_um.toFixed(3)} µm</span>}
                            {f.frameLoading && <span className="pb-loading">loading…</span>}
                        </>
                    ) : (
                        <span>&nbsp;</span>
                    )}
                </div>

                <div className="pb-filter">
                    <span className="pb-count" title={f.matchWavelength ? 'Images at the matched wavelength / all images at this position' : 'All images at this position'}>
                        {count} of {f.allImages.length} images
                    </span>
                    {f.preloadTotal > 0 && (
                        <span
                            className={f.preloadedCount < f.preloadTotal ? 'pb-preload pb-preload-busy' : 'pb-preload'}
                            title="Frames downloaded in the background so scrubbing and playback are instant"
                        >
                            {f.preloadedCount < f.preloadTotal
                                ? `preloading ${f.preloadedCount}/${f.preloadTotal}`
                                : `${f.preloadTotal} preloaded`}
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}
