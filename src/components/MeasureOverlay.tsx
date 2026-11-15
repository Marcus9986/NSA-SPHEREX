import './MeasureOverlay.css'

import { useId } from 'react'

import type { ViewTarget } from '../api/spherex'
import type { ViewState } from '../renderer/index'
import { formatAngle, greatCirclePoint, imageToScreen, separation, skyToScreen, standardCoordinates, type SkyPoint } from '../sky'

/** A ruler between two sky positions; kept in RA / Dec so it stays put through pan, zoom and re-targeting. */
export type Measurement = { a: SkyPoint, b: SkyPoint, aName?: string, bName?: string }

type MeasureOverlayProps = {
    measurement:      Measurement
    target:           ViewTarget
    view:             ViewState
    pixelScaleArcsec: number
}

// Great-circle samples for drawing; parts within this of 90° from the field centre are
// skipped (the TAN projection sends them off to infinity, far outside any view).
const SAMPLES = 64
const MIN_COS = 0.05

type Pt = { x: number, y: number }

/** The part of segment p0-p1 inside the rectangle (Liang–Barsky), or null if none. */
function clipSegment(p0: Pt, p1: Pt, w: number, h: number): [Pt, Pt] | null
{
    const dx = p1.x - p0.x, dy = p1.y - p0.y
    let t0 = 0, t1 = 1
    for (const [p, q] of [[-dx, p0.x], [dx, w - p0.x], [-dy, p0.y], [dy, h - p0.y]])
    {
        if (p === 0)
        {
            if (q < 0)
                return null
            continue
        }
        const r = q / p
        if (p < 0) t0 = Math.max(t0, r)
        else       t1 = Math.min(t1, r)
        if (t0 > t1)
            return null
    }
    return [{ x: p0.x + t0 * dx, y: p0.y + t0 * dy }, { x: p0.x + t1 * dx, y: p0.y + t1 * dy }]
}

/**
 * The ruler over the viewport, along the great circle between its ends (a straight line
 * in this projection), cut to the screen. An end that's off screen, even on the far side
 * of the sky, becomes an arrow at the edge pointing its way, labelled with its name.
 */
export default function MeasureOverlay({ measurement, target, view, pixelScaleArcsec }: MeasureOverlayProps)
{
    const arrowId = useId()
    const { cssWidth: W, cssHeight: H, imageWidth, imageHeight } = view
    if (W === 0 || H === 0 || imageWidth === 0 || imageHeight === 0)
        return null

    const { a, b, aName, bName } = measurement
    const project = (p: SkyPoint): Pt | null =>
    {
        const s = standardCoordinates(p.ra, p.dec, target.ra, target.dec)
        return s.cosC < MIN_COS ? null
            : imageToScreen(view, 0.5 - s.xi / (imageWidth * pixelScaleArcsec), 0.5 + s.eta / (imageHeight * pixelScaleArcsec))
    }

    // Ends of the drawable stretch of the great circle (one contiguous arc, so its first and last samples).
    const samples = Array.from({ length: SAMPLES + 1 }, (_, i) => project(greatCirclePoint(a, b, i / SAMPLES)))
    const first = samples.findIndex(Boolean)
    const last  = samples.length - 1 - [...samples].reverse().findIndex(Boolean)
    if (first < 0 || first === last)
        return null
    const visible = clipSegment(samples[first]!, samples[last]!, W, H)
    if (!visible)
        return null
    const [p, q] = visible

    const inside = (pt: Pt | null) => !!pt && pt.x >= 0 && pt.x <= W && pt.y >= 0 && pt.y <= H
    const aShown = first === 0 && inside(samples[0])
    const bShown = last === SAMPLES && inside(samples[SAMPLES])
    const { sepArcsec } = separation(a, b)

    // Along the visible line (p -> q) and across it.
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
    const ux = (q.x - p.x) / len, uy = (q.y - p.y) / len
    const flip = ux > 0 ? 1 : -1            // keep labels above the line
    const nx = uy * flip, ny = -ux * flip

    // Name of an off-screen end: just inside the edge where the line leaves, beside the arrow.
    const edgeName = (name: string, at: Pt, inward: number) =>
    {
        const x = Math.min(W - 6, Math.max(6, at.x + ux * inward * 18 + nx * 12))
        const y = Math.min(H - 6, Math.max(12, at.y + uy * inward * 18 + ny * 12))
        return <text x={x} y={y} className="measure-name" textAnchor={x < W / 2 ? 'start' : 'end'}>{name} (off screen)</text>
    }

    return (
        <svg className="measure-overlay" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            <defs>
                <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9"
                        orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                    <path d="M0,0 L10,5 L0,10 z" className="measure-arrow" />
                </marker>
            </defs>
            <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="measure-line"
                  markerStart={aShown ? undefined : `url(#${arrowId})`}
                  markerEnd={bShown ? undefined : `url(#${arrowId})`} />
            {aShown && <circle cx={p.x} cy={p.y} r={3.5} className="measure-end" />}
            {bShown && <circle cx={q.x} cy={q.y} r={3.5} className="measure-end" />}
            {aName && (aShown ? <text x={p.x + 7} y={p.y - 7} className="measure-name">{aName}</text> : edgeName(aName, p, 1))}
            {bName && (bShown ? <text x={q.x + 7} y={q.y - 7} className="measure-name">{bName}</text> : edgeName(bName, q, -1))}
            <text x={(p.x + q.x) / 2 + nx * 14} y={(p.y + q.y) / 2 + ny * 14}
                  className="measure-label" textAnchor="middle" dominantBaseline="middle">
                {formatAngle(sepArcsec)}
            </text>
        </svg>
    )
}

/** Reticle and name over an object found with the header search. */
export function ObjectMarker({ name, point, target, view, pixelScaleArcsec }:
    { name: string, point: SkyPoint, target: ViewTarget, view: ViewState, pixelScaleArcsec: number })
{
    const { cssWidth: W, cssHeight: H, imageWidth, imageHeight } = view
    const p = W && H && imageWidth && imageHeight ? skyToScreen(point, target, view, pixelScaleArcsec) : null
    if (!p || p.x < -50 || p.y < -50 || p.x > W + 50 || p.y > H + 50)
        return null

    return (
        <svg className="measure-overlay" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            <g transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`} className="object-marker">
                <circle r={11} />
                <path d="M0,-19 V-14 M0,14 V19 M-19,0 H-14 M14,0 H19" />
                <text x={16} y={-14} className="object-marker-name">{name}</text>
            </g>
        </svg>
    )
}

function Row({ label, value }: { label: string, value: string })
{
    return (
        <div className="info-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
        </div>
    )
}

/** The measurement's numbers, for the properties panel. */
export function MeasureReadout({ measurement, pixelScaleArcsec, onClear, onWideView }:
    { measurement: Measurement | null, pixelScaleArcsec: number, onClear: () => void, onWideView?: () => void })
{
    if (!measurement)
        return <p className="measure-hint">Drag on the image with the left mouse button to measure. Click to clear.</p>

    const { sepArcsec, paDeg } = separation(measurement.a, measurement.b)
    const point = (p: SkyPoint) => `${p.ra.toFixed(5)}°, ${p.dec >= 0 ? '+' : ''}${p.dec.toFixed(5)}°`

    return (
        <section className="info-section measure-readout">
            <div className="measure-readout-head">
                <span className="measure-distance">{formatAngle(sepArcsec)}</span>
                <span className="measure-actions">
                    {onWideView && (
                        <button type="button" className="measure-clear" onClick={onWideView}
                                title="Show the whole line on SPHEREx's all-sky map, to scroll along it or zoom out">
                            Wide view
                        </button>
                    )}
                    <button type="button" className="measure-clear" onClick={onClear}>Clear</button>
                </span>
            </div>
            <dl>
                <Row label="Arcseconds" value={sepArcsec.toFixed(2)} />
                <Row label="SPHEREx pixels" value={(sepArcsec / pixelScaleArcsec).toFixed(2)} />
                <Row label="Position angle" value={`${paDeg.toFixed(1)}° E of N`} />
                <Row label={measurement.aName ?? 'From (RA, Dec)'} value={point(measurement.a)} />
                <Row label={measurement.bName ?? 'To (RA, Dec)'} value={point(measurement.b)} />
            </dl>
        </section>
    )
}
