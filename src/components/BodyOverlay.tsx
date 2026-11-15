import './BodyOverlay.css'

import type { SolarSystemBody, ViewTarget } from '../api/spherex'
import type { ViewState } from '../renderer/index'
import { imageToScreen, standardCoordinates } from '../sky'

type BodyOverlayProps = {
    bodies:           SolarSystemBody[]
    target:           ViewTarget        // the image is centred here, north up / east left
    view:             ViewState
    pixelScaleArcsec: number            // arcsec per image pixel
}

// SPHEREx can't see much fainter than about V 20 in a single frame, so fainter bodies
// get a small dashed ring and no label (hover shows it). Labels are also capped, brightest
// first, so a crowded field near the ecliptic stays readable.
export const VISIBLE_V_MAG = 20
const MAX_LABELS = 12

/**
 * Where a body falls in the image, as texture coordinates (u right, v up, 0..1), or
 * null if it's outside. The image is a north-up / east-left square centred on target.
 */
export function fieldPosition(body: SolarSystemBody, target: ViewTarget, widthArcsec: number, heightArcsec: number)
{
    const p = standardCoordinates(body.ra, body.dec, target.ra, target.dec)
    const u = 0.5 - p.xi / widthArcsec   // east (positive xi) is to the left
    const v = 0.5 + p.eta / heightArcsec
    return p.front && u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { u, v } : null
}

/** Bright enough for SPHEREx to plausibly see (unknown brightness counts as visible). */
export function isLikelyVisible(body: SolarSystemBody): boolean
{
    return body.v_mag == null || body.v_mag <= VISIBLE_V_MAG
}

function kind(type: string | null): { label: string, className: string }
{
    const t = (type ?? '').toLowerCase()
    if (t.includes('comet'))  return { label: 'comet',  className: 'body-comet' }
    if (t.includes('planet') && !t.includes('dwarf')) return { label: 'planet', className: 'body-planet' }
    if (t.startsWith('nea'))  return { label: 'near-Earth asteroid', className: 'body-nea' }
    if (t.startsWith('kbo') || t.includes('centaur') || t.includes('trojan'))
        return { label: 'distant body', className: 'body-distant' }
    return { label: 'asteroid', className: 'body-asteroid' }
}

function describeType(type: string | null): string
{
    if (!type)
        return 'unknown type'
    const parts: Record<string, string> = {
        MB: 'main belt', NEA: 'near-Earth', KBO: 'Kuiper belt', Trojan: 'Trojan',
        Inner: 'inner', Middle: 'middle', Outer: 'outer', Hungaria: 'Hungaria', Cybele: 'Cybele', Hilda: 'Hilda',
    }
    return type.split('>').map((p) => parts[p] ?? p).join(' › ')
}

/**
 * Tags for known solar-system bodies over the viewport image: a ring at each body's
 * predicted position, its name, and an arrow showing which way it's moving. Follows
 * pan and zoom. Hover a tag for details.
 */
export default function BodyOverlay({ bodies, target, view, pixelScaleArcsec }: BodyOverlayProps)
{
    const { cssWidth: W, cssHeight: H, imageWidth, imageHeight, zoom } = view
    if (W === 0 || H === 0 || imageWidth === 0 || imageHeight === 0)
        return null

    const widthArcsec  = imageWidth  * pixelScaleArcsec
    const heightArcsec = imageHeight * pixelScaleArcsec
    const toScreen = (u: number, v: number) => imageToScreen(view, u, v)

    // Screen pixels per arcsec (same horizontally and vertically for square pixels).
    const pxPerArcsec = (zoom * H) / 2 / heightArcsec

    // Bodies arrive brightest first, so the first MAX_LABELS visible ones get labels.
    let labelled = 0
    const tags = bodies.flatMap((body, index) =>
    {
        const pos = fieldPosition(body, target, widthArcsec, heightArcsec)
        if (!pos)
            return []
        const visible = isLikelyVisible(body)
        const label = visible && labelled < MAX_LABELS
        if (label)
            labelled++
        return [{ body, index, visible, label, ...toScreen(pos.u, pos.v) }]
    })

    // Draw faint ones first so bright tags sit on top.
    tags.sort((a, b) => Number(a.visible) - Number(b.visible))

    if (tags.length === 0)
        return null

    return (
        <svg className="body-overlay" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            {tags.map(({ body, index, visible, label, x, y }) =>
            {
                const k = kind(body.type)
                // Direction of motion: RA rate east (left on screen), Dec rate north (up).
                const ra  = body.ra_rate ?? 0, dec = body.dec_rate ?? 0
                const rate = Math.hypot(ra, dec)
                const len = visible ? 22 : 12
                const dx = rate > 0 ? (-ra / rate) * len : 0
                const dy = rate > 0 ? (-dec / rate) * len : 0
                const ring = visible
                    ? Math.max(7, Math.min(14, 2.5 * pixelScaleArcsec * pxPerArcsec))
                    : 6
                const perHourPx = rate * pxPerArcsec

                return (
                    <g
                        key={`${body.name}-${index}`}
                        className={`body-tag ${k.className}${visible ? '' : ' body-faint'}${label ? ' body-labelled' : ''}`}
                        transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
                        <title>
                            {[
                                `${body.number ? `(${body.number}) ` : ''}${body.name}: ${k.label}`,
                                `Type: ${describeType(body.type)}`,
                                body.v_mag != null
                                    ? `Predicted brightness: V ${body.v_mag.toFixed(1)}${visible ? '' : ` (likely too faint for SPHEREx, which reaches about V ${VISIBLE_V_MAG})`}`
                                    : null,
                                rate > 0 ? `Moving ${rate.toFixed(1)}″/hour (${(rate / pixelScaleArcsec).toFixed(1)} SPHEREx pixels/hour; ${perHourPx.toFixed(0)} px/hour at this zoom)` : null,
                                body.earth_distance_au != null ? `Distance from Earth: ${body.earth_distance_au.toFixed(2)} AU` : null,
                                body.sun_distance_au != null ? `Distance from Sun: ${body.sun_distance_au.toFixed(2)} AU` : null,
                                body.position_uncertainty_arcsec != null ? `Position uncertainty: ${body.position_uncertainty_arcsec.toFixed(2)}″` : null,
                                'Position predicted for this frame\'s time by IMCCE SkyBoT.',
                            ].filter(Boolean).join('\n')}
                        </title>
                        {rate > 0 && (
                            <>
                                <line x1={0} y1={0} x2={dx} y2={dy} className="body-motion" />
                                <path
                                    d={`M${dx},${dy} l${(-dx * 0.3 - dy * 0.2).toFixed(1)},${(-dy * 0.3 + dx * 0.2).toFixed(1)} M${dx},${dy} l${(-dx * 0.3 + dy * 0.2).toFixed(1)},${(-dy * 0.3 - dx * 0.2).toFixed(1)}`}
                                    className="body-motion"
                                />
                            </>
                        )}
                        <circle r={ring} className="body-ring" />
                        <circle r={ring + 6} className="body-hit" />
                        <text x={ring + 4} y={-ring + 2} className="body-name">{body.name}</text>
                        {body.v_mag != null && (
                            <text x={ring + 4} y={-ring + 12} className="body-detail">V {body.v_mag.toFixed(1)}</text>
                        )}
                    </g>
                )
            })}
        </svg>
    )
}
