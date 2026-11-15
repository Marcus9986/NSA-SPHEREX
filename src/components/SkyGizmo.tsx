import './SkyGizmo.css'

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { LAND_RINGS } from '../data/land'
import { greatCirclePoint, type SkyPoint } from '../sky'

type SkyGizmoProps = {
    ra:  number   // degrees
    dec: number   // degrees
    fovArcsec: number   // width of the (square) field of view
    onTarget?: (ra: number, dec: number) => void   // clicked a point on the sphere
    measurement?: { a: SkyPoint, b: SkyPoint } | null   // the measure tool's ruler, drawn on the sphere too
}

type Vec3 = [number, number, number]

const DEG = Math.PI / 180

// SVG layout: the sphere is drawn in the middle, with room around it for labels.
const SIZE   = 190
const RADIUS = 64
const CX     = SIZE / 2
const CY     = SIZE / 2

const MAX_PITCH = 80 * DEG

// Size of the gizmo while hovered, relative to its normal size. The resize is eased in the CSS.
const ZOOMED_SCALE = 1.8

/** Unit vector on the celestial sphere for a sky position (degrees). */
function toVector(raDeg: number, decDeg: number): Vec3
{
    const a = raDeg * DEG, d = decDeg * DEG
    return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]
}

/**
 * Orthographic projection of a sphere point. `yaw` (radians) is the RA that faces the
 * viewer, `pitch` how far the view is tilted above the equator. The sphere is seen
 * from outside, like a celestial globe, so the coastlines on it read the right way
 * round; RA (east) therefore increases to the right, the mirror of the image, which is
 * drawn as seen from Earth (east left). Seen from inside, the land would be mirrored.
 */
function project(p: Vec3, yaw: number, pitch: number, scale = RADIUS)
{
    // Turn about the polar axis so the meridian at RA = yaw faces the viewer (+x).
    const cy = Math.cos(yaw), sy = Math.sin(yaw)
    const x1 = p[0] * cy + p[1] * sy
    const y1 = -p[0] * sy + p[1] * cy
    const z1 = p[2]
    // Tilt so we look down on the equator from `pitch` above it.
    const cp = Math.cos(pitch), sp = Math.sin(pitch)
    const depth = x1 * cp + z1 * sp      // > 0: on the hemisphere facing the viewer
    const up    = -x1 * sp + z1 * cp
    return { x: CX + y1 * scale, y: CY - up * scale, depth }
}

/**
 * SVG paths for a curve on the sphere, split into the part on the near side (front)
 * and the part on the far side (back). Where the curve crosses the limb, the new part
 * starts at the last point of the old one, so the two halves join without a gap.
 */
function curve(points: Vec3[], yaw: number, pitch: number): { front: string, back: string }
{
    const out = { front: '', back: '' }
    const pt = (p: { x: number, y: number }) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    let previous: ReturnType<typeof project> | null = null
    for (const point of points)
    {
        const p = project(point, yaw, pitch)
        const side = p.depth >= 0 ? 'front' : 'back'
        if (!previous)
            out[side] += `M${pt(p)}`
        else if ((previous.depth >= 0 ? 'front' : 'back') === side)
            out[side] += `L${pt(p)}`
        else
            out[side] += `M${pt(previous)}L${pt(p)}`
        previous = p
    }
    return out
}

function parallel(decDeg: number, fromRa = 0, toRa = 360, steps = 96): Vec3[]
{
    const points: Vec3[] = []
    for (let i = 0; i <= steps; i++)
        points.push(toVector(fromRa + ((toRa - fromRa) * i) / steps, decDeg))
    return points
}

function meridian(raDeg: number, fromDec = -90, toDec = 90, steps = 48): Vec3[]
{
    const points: Vec3[] = []
    for (let i = 0; i <= steps; i++)
        points.push(toVector(raDeg, fromDec + ((toDec - fromDec) * i) / steps))
    return points
}

function formatRa(raDeg: number): string
{
    const totalSeconds = Math.round((((raDeg % 360) + 360) % 360) / 15 * 3600)
    const h = Math.floor(totalSeconds / 3600) % 24
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

function formatFov(arcsec: number): string
{
    if (arcsec >= 3600)
        return `${+(arcsec / 3600).toFixed(2)}°`
    if (arcsec >= 60)
        return `${+(arcsec / 60).toFixed(1)}′`
    return `${Math.round(arcsec)}″`
}

/** Convex hull (monotone chain) of 2D points, as a closed SVG path. */
function hullPath(points: { x: number, y: number }[]): string
{
    const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
    const cross = (o: { x: number, y: number }, a: { x: number, y: number }, b: { x: number, y: number }) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    const lower: typeof p = [], upper: typeof p = []
    for (const q of p)
    {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
        lower.push(q)
    }
    for (const q of [...p].reverse())
    {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
        upper.push(q)
    }
    const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
    return hull.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join('') + 'Z'
}

// The real field of view (minutes of arc) would be invisible on a 50 px globe, so the
// pyramid is drawn at least this wide and marked as enlarged.
const MIN_DRAWN_FOV_DEG = 14

function formatDec(decDeg: number): string
{
    const totalSeconds = Math.round(Math.abs(decDeg) * 3600)
    const d = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60
    return `${decDeg < 0 ? '−' : '+'}${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`
}

/**
 * Greenwich mean sidereal time (degrees) at a moment (ms since 1970): how far Earth has
 * turned, i.e. the RA overhead at longitude 0. IAU 1982 formula, good to well under a
 * degree for centuries either side of 2000, far finer than the gizmo can show.
 */
export function siderealDeg(ms: number): number
{
    const daysSinceJ2000 = ms / 86_400_000 - 10_957.5   // J2000.0 = 2000-01-01 12:00 UTC
    return ((280.46061837 + 360.98564736629 * daysSinceJ2000) % 360 + 360) % 360
}

// How often the coastlines are turned to follow Earth's rotation (0.25° a minute).
const EARTH_TICK_MS = 60_000

// A press that moves less than this many pixels is a click (retarget), not a drag (rotate).
const CLICK_TOLERANCE_PX = 4

/**
 * Inverse of `project`: the sky position (degrees) under a point of the SVG, or null
 * if the point is off the sphere. Only the near hemisphere can be clicked.
 */
function unproject(x: number, y: number, yaw: number, pitch: number): { ra: number, dec: number } | null
{
    const y1 = (x - CX) / RADIUS
    const up = (CY - y) / RADIUS
    const r2 = y1 * y1 + up * up
    if (r2 > 1)
        return null
    const depth = Math.sqrt(1 - r2)       // on the hemisphere facing the viewer

    // Undo the tilt, then the turn about the polar axis.
    const cp = Math.cos(pitch), sp = Math.sin(pitch)
    const x1 = depth * cp - up * sp
    const z1 = depth * sp + up * cp
    const cy = Math.cos(yaw), sy = Math.sin(yaw)
    const px = x1 * cy - y1 * sy
    const py = x1 * sy + y1 * cy

    const ra  = ((Math.atan2(py, px) / DEG) % 360 + 360) % 360
    const dec = Math.asin(Math.max(-1, Math.min(1, z1))) / DEG
    return { ra, dec }
}

/** Default view: the target's meridian faces you, tilted toward the target's hemisphere. */
function defaultView(ra: number, dec: number)
{
    const tilt = Math.min(35, Math.max(15, Math.abs(dec) / 2))
    return { yaw: ra * DEG, pitch: (dec < 0 ? -tilt : tilt) * DEG }
}

/**
 * Small celestial-sphere gizmo: where the current target sits on the sky. Right
 * ascension is drawn as a blue arc along the equator from 0h, declination as an amber
 * arc up (or down) from the equator to the target. Drag to rotate, double-click to reset.
 */
export default function SkyGizmo({ ra, dec, fovArcsec, onTarget, measurement = null }: SkyGizmoProps)
{
    const [view, setView] = useState(() => defaultView(ra, dec))
    const [dragging, setDragging] = useState(false)
    const dragRef = useRef<{ x: number, y: number, yaw: number, pitch: number, moved: boolean } | null>(null)
    // Sky position under the pointer (for the "click to go here" preview).
    const [hover, setHover] = useState<{ x: number, y: number, ra: number, dec: number } | null>(null)

    /** Pointer position in the SVG's own coordinates. */
    const svgPoint = (event: ReactPointerEvent<SVGSVGElement>) =>
    {
        const rect = event.currentTarget.getBoundingClientRect()
        return {
            x: ((event.clientX - rect.left) / rect.width) * SIZE,
            y: ((event.clientY - rect.top) / rect.height) * SIZE,
        }
    }

    // Re-centre on the target when it's changed from elsewhere (typed coordinates, a new
    // search). A click on the globe itself keeps the current view, so only the RA / Dec
    // arcs, target and FOV move to the new spot.
    const keepViewRef = useRef(false)
    useEffect(() =>
    {
        if (keepViewRef.current)
        {
            keepViewRef.current = false
            return
        }
        setView(defaultView(ra, dec))
    }, [ra, dec])

    const { yaw, pitch } = view

    // Enlarged while the pointer is over it.
    const [zoomed, setZoomed] = useState(false)
    const zoom = zoomed ? ZOOMED_SCALE : 1

    // Earth's coastlines, each place drawn at the sky position directly overhead of it right
    // now (Dec = latitude, RA = longitude + sidereal time), so the target sits over the part
    // of Earth where it's straight up.
    const [now, setNow] = useState(() => Date.now())
    useEffect(() =>
    {
        const timer = setInterval(() => setNow(Date.now()), EARTH_TICK_MS)
        return () => clearInterval(timer)
    }, [])
    const landVectors = useMemo(() =>
    {
        const gst = siderealDeg(now)
        return LAND_RINGS.map((ring) =>
        {
            const points: Vec3[] = []
            for (let i = 0; i < ring.length; i += 2)
                points.push(toVector(ring[i] + gst, ring[i + 1]))
            return points
        })
    }, [now])

    const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) =>
    {
        if (event.button !== 0)
            return
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { x: event.clientX, y: event.clientY, yaw, pitch, moved: false }
    }

    const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) =>
    {
        const start = dragRef.current
        if (!start)
        {
            // Not pressed: preview where a click would go.
            const p = svgPoint(event)
            const sky = unproject(p.x, p.y, yaw, pitch)
            setHover(sky ? { ...p, ...sky } : null)
            return
        }
        if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < CLICK_TOLERANCE_PX)
            return
        if (!start.moved)
        {
            start.moved = true
            setDragging(true)
            setHover(null)
        }
        const k = 0.012 / zoom   // radians per screen pixel; slower when zoomed, so it tracks the bigger sphere
        setView({
            yaw:   start.yaw - (event.clientX - start.x) * k,   // the globe's surface follows the pointer
            pitch: Math.min(MAX_PITCH, Math.max(-MAX_PITCH, start.pitch + (event.clientY - start.y) * k)),
        })
    }

    const endDrag = () =>
    {
        dragRef.current = null
        setDragging(false)
    }

    // Released without dragging: go to the clicked sky position.
    const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) =>
    {
        const start = dragRef.current
        endDrag()
        if (!start || start.moved || !onTarget)
            return
        const p = svgPoint(event)
        const sky = unproject(p.x, p.y, yaw, pitch)
        if (!sky)
            return
        // A click on a 100 px globe is only good to about a degree, so don't pretend more.
        const nextRa = Math.round(sky.ra * 100) / 100
        const nextDec = Math.round(sky.dec * 100) / 100
        // Only flag it if the target really changes, or the flag would never be cleared.
        if (nextRa !== ra || nextDec !== dec)
            keepViewRef.current = true
        onTarget(nextRa, nextDec)
        setHover(null)
    }

    // -- Geometry --

    const grid: { front: string, back: string }[] = []
    for (const d of [-60, -30, 30, 60])
        grid.push(curve(parallel(d), yaw, pitch))
    for (let h = 0; h < 24; h += 3)
        grid.push(curve(meridian(h * 15), yaw, pitch))

    const equator = curve(parallel(0), yaw, pitch)
    const land = landVectors.map((ring) => curve(ring, yaw, pitch).front).join('')

    // RA: along the equator, eastward from 0h to the target's hour angle.
    const raNorm  = ((ra % 360) + 360) % 360
    const raArc   = curve(parallel(0, 0, raNorm, Math.max(2, Math.ceil(raNorm / 4))), yaw, pitch)
    // Dec: along the target's meridian, from the equator to the target.
    const decArc  = curve(meridian(raNorm, 0, dec, Math.max(2, Math.ceil(Math.abs(dec) / 3))), yaw, pitch)

    const target  = project(toVector(raNorm, dec), yaw, pitch)

    // -- Field of view: a square pyramid from Earth (the centre of the sphere) out to the
    //    patch of sky in the image, north and east as on the sky (seen from outside, so east is on the right). --
    const fovDeg    = fovArcsec / 3600
    const drawnDeg  = Math.max(fovDeg, MIN_DRAWN_FOV_DEG)
    const enlarged  = drawnDeg > fovDeg
    const half      = (drawnDeg / 2) * DEG
    const a = raNorm * DEG, d = dec * DEG
    const t: Vec3 = toVector(raNorm, dec)
    const eastDir:  Vec3 = [-Math.sin(a), Math.cos(a), 0]
    const northDir: Vec3 = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)]
    // Corner directions (on the unit sphere) of the square field: ±east, ±north.
    const corner = (ex: number, ny: number): Vec3 =>
    {
        const v: Vec3 = [
            t[0] + Math.tan(half) * (ex * eastDir[0] + ny * northDir[0]),
            t[1] + Math.tan(half) * (ex * eastDir[1] + ny * northDir[1]),
            t[2] + Math.tan(half) * (ex * eastDir[2] + ny * northDir[2]),
        ]
        const n = Math.hypot(v[0], v[1], v[2])
        return [v[0] / n, v[1] / n, v[2] / n]
    }
    const corners = [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)].map((c) => project(c, yaw, pitch))
    const apex = { x: CX, y: CY }
    const conePath = hullPath([apex, ...corners])
    const basePath = corners.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join('') + 'Z'
    const coneFront = target.depth >= 0
    // Sampled along the great circle so it bends round the sphere like the grid lines.
    const ruler = measurement && {
        path: curve(Array.from({ length: 65 }, (_, i) =>
        {
            const p = greatCirclePoint(measurement.a, measurement.b, i / 64)
            return toVector(p.ra, p.dec)
        }), yaw, pitch),
        ends: [measurement.a, measurement.b].map((p) => project(toVector(p.ra, p.dec), yaw, pitch)),
    }

    const origin  = project(toVector(0, 0), yaw, pitch)
    const north   = project([0, 0, 1], yaw, pitch)
    const south   = project([0, 0, -1], yaw, pitch)
    const northTip = project([0, 0, 1.28], yaw, pitch)
    const southTip = project([0, 0, -1.28], yaw, pitch)
    const northLabel = project([0, 0, 1.5], yaw, pitch)
    const southLabel = project([0, 0, -1.5], yaw, pitch)

    const hourLabels = [0, 6, 12, 18].map((h) =>
    {
        const p = project(toVector(h * 15, 0), yaw, pitch, RADIUS * 1.17)
        return { h, ...p }
    })

    // Where each angle ends: RA on the equator below the target, Dec at the target.
    const raEnd = project(toVector(raNorm, 0), yaw, pitch)

    // Keep labels inside the gizmo: grow toward the centre from whichever side they're on.
    const anchor = (x: number) => (x < CX ? 'start' : 'end')
    const nudge  = (x: number) => (x < CX ? -6 : 6)

    return (
        <div className="sky-gizmo" aria-label={`Sky position: right ascension ${formatRa(ra)}, declination ${formatDec(dec)}`}>
            <svg
                width={SIZE * zoom}
                height={SIZE * zoom}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                className={dragging ? 'sky-gizmo-svg sky-gizmo-dragging' : 'sky-gizmo-svg'}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={endDrag}
                onPointerEnter={() => setZoomed(true)}
                onPointerLeave={() => { setHover(null); setZoomed(false) }}
                onDoubleClick={() => setView(defaultView(ra, dec))}
                role="img"
            >
                <title>Celestial sphere seen from outside, like a celestial globe (so east is to the right, the mirror of the image), with the coastlines of the places each point is overhead of right now. Click a point to go there, drag to rotate, double-click to reset the view.</title>

                {/* Sphere body and limb */}
                <circle cx={CX} cy={CY} r={RADIUS} className="sg-body" />

                {/* Land under each point of the sky right now; near side only, the far side is clutter */}
                <path d={land} className="sg-land">
                    <title>Coastlines: each part of Earth is drawn under the point of the sky directly overhead it right now</title>
                </path>

                {/* Far side first, so the near side draws over it */}
                {grid.map((g, i) => <path key={`gb${i}`} d={g.back} className="sg-grid sg-back" />)}
                <path d={equator.back} className="sg-equator sg-back" />
                <path d={raArc.back}   className="sg-ra sg-back" />
                <path d={decArc.back}  className="sg-dec sg-back" />

                {/* Polar axis: hidden half dashed */}
                <line x1={CX} y1={CY} x2={northTip.x} y2={northTip.y} className={north.depth >= 0 ? 'sg-axis' : 'sg-axis sg-back'} />
                <line x1={CX} y1={CY} x2={southTip.x} y2={southTip.y} className={south.depth >= 0 ? 'sg-axis' : 'sg-axis sg-back'} />

                <circle cx={CX} cy={CY} r={RADIUS} className="sg-limb" />

                {/* Field of view: pyramid from Earth (centre) to the imaged patch of sky */}
                <g className={coneFront ? 'sg-fov' : 'sg-fov sg-fov-back'}>
                    <title>
                        {`Field of view: ${formatFov(fovArcsec)} square, seen from Earth at the centre of the sphere`
                            + (enlarged ? ` (drawn enlarged; the real field is ${formatFov(fovArcsec)} wide)` : '')}
                    </title>
                    <path d={conePath} className="sg-fov-cone" />
                    {corners.map((c, i) => (
                        <line key={i} x1={apex.x} y1={apex.y} x2={c.x} y2={c.y} className="sg-fov-edge" />
                    ))}
                    <path d={basePath} className={enlarged ? 'sg-fov-base sg-fov-enlarged' : 'sg-fov-base'} />
                </g>
                <circle cx={CX} cy={CY} r={1.8} className="sg-earth" />

                {grid.map((g, i) => <path key={`gf${i}`} d={g.front} className="sg-grid" />)}
                <path d={equator.front} className="sg-equator" />
                <path d={raArc.front}   className="sg-ra" />
                <path d={decArc.front}  className="sg-dec" />

                {/* 0h point (vernal equinox): where RA is measured from */}
                <circle cx={origin.x} cy={origin.y} r={2.2} className={origin.depth >= 0 ? 'sg-origin' : 'sg-origin sg-back-fill'} />

                {/* Hour labels around the equator */}
                {hourLabels.map((l) => (
                    <text key={l.h} x={l.x} y={l.y + 3} className={l.depth >= 0 ? 'sg-hour' : 'sg-hour sg-hour-back'}>
                        {l.h}h
                    </text>
                ))}

                {/* Values where each angle ends: RA under the end of the equator arc,
                    Dec beside the target at the end of the meridian arc. */}
                <text
                    x={raEnd.x + nudge(raEnd.x)}
                    y={raEnd.y + (dec >= 0 ? 12 : -7)}
                    textAnchor={anchor(raEnd.x)}
                    className={raEnd.depth >= 0 ? 'sg-value sg-ra-label' : 'sg-value sg-ra-label sg-value-back'}
                >
                    {formatRa(ra)}
                </text>
                <text
                    x={target.x + nudge(target.x)}
                    y={target.y + (dec >= 0 ? -7 : 12)}
                    textAnchor={anchor(target.x)}
                    className={target.depth >= 0 ? 'sg-value sg-dec-label' : 'sg-value sg-dec-label sg-value-back'}
                >
                    {formatDec(dec)}
                </text>

                {/* The measurement: its great circle, dashed where it passes behind the sphere */}
                {ruler && (
                    <g className="sg-measure">
                        <path d={ruler.path.back} className="sg-measure-line sg-back" />
                        <path d={ruler.path.front} className="sg-measure-line" />
                        {ruler.ends.map((p, i) => (
                            <circle key={i} cx={p.x} cy={p.y} r={2.4} className={p.depth >= 0 ? 'sg-measure-end' : 'sg-measure-end sg-back-fill'} />
                        ))}
                    </g>
                )}

                {/* Target */}
                <circle
                    cx={target.x}
                    cy={target.y}
                    r={4}
                    className={target.depth >= 0 ? 'sg-target' : 'sg-target sg-target-back'}
                />

                <text
                    x={CX + (target.x < CX ? 6 : -6)}
                    y={CY + (target.y < CY ? 11 : -6)}
                    textAnchor={target.x < CX ? 'start' : 'end'}
                    className="sg-fov-label"
                >
                    FOV {formatFov(fovArcsec)}
                </text>

                {/* Where a click would go */}
                {hover && !dragging && (
                    <>
                        <circle cx={hover.x} cy={hover.y} r={3.5} className="sg-hover" />
                        <text x={CX} y={SIZE + 11} className="sg-hover-label">
                            Go to {formatRa(hover.ra).replace(/ \d+s$/, '')}, {formatDec(hover.dec).replace(/ \d+″$/, '')}
                        </text>
                    </>
                )}

                {/* Celestial poles */}
                <text x={northLabel.x} y={northLabel.y + 4} className="sg-pole">N</text>
                <text x={southLabel.x} y={southLabel.y + 4} className="sg-pole">S</text>

                {/* East / west: east is the direction of increasing RA (right, seen from outside) */}
                <text x={CX - RADIUS - 11} y={CY + 4} className="sg-cardinal">W</text>
                <text x={CX + RADIUS + 11} y={CY + 4} className="sg-cardinal">E</text>
            </svg>

        </div>
    )
}
