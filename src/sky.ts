// Sky <-> image <-> screen mapping for overlays on the viewport image, and angles between sky positions.
// The image is a north-up / east-left TAN projection centred on the target (matches the backend).

import type { ViewState } from './renderer/types'

// SPHEREx detector pixel size on the sky.
export const PIXEL_SCALE_ARCSEC = 6.15

export type SkyPoint = { ra: number, dec: number }   // degrees

const DEG = Math.PI / 180

/** Gnomonic (TAN) offsets of a sky position from the field centre, in arcsec: east (xi) and north (eta). */
export function standardCoordinates(ra: number, dec: number, ra0: number, dec0: number)
{
    const a = ra * DEG, d = dec * DEG, a0 = ra0 * DEG, d0 = dec0 * DEG
    const cosC = Math.sin(d) * Math.sin(d0) + Math.cos(d) * Math.cos(d0) * Math.cos(a - a0)
    const xi  = (Math.cos(d) * Math.sin(a - a0)) / cosC
    const eta = (Math.sin(d) * Math.cos(d0) - Math.cos(d) * Math.sin(d0) * Math.cos(a - a0)) / cosC
    return { xi: (xi / DEG) * 3600, eta: (eta / DEG) * 3600, front: cosC > 0, cosC }
}

const toVector = ({ ra, dec }: SkyPoint) =>
    [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)]

/** The point a fraction t (0..1) of the way from a to b along the great circle (shortest path). */
export function greatCirclePoint(a: SkyPoint, b: SkyPoint, t: number): SkyPoint
{
    const p = toVector(a), q = toVector(b)
    const omega = Math.acos(Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])))
    // Nearly the same point: straight interpolation is exact enough and avoids 0 / 0.
    const [wa, wb] = omega < 1e-9 ? [1 - t, t] : [Math.sin((1 - t) * omega) / Math.sin(omega), Math.sin(t * omega) / Math.sin(omega)]
    const [x, y, z] = [0, 1, 2].map((i) => wa * p[i] + wb * q[i])
    const ra = Math.atan2(y, x) / DEG
    return { ra: (ra + 360) % 360, dec: Math.atan2(z, Math.hypot(x, y)) / DEG }
}

/** Inverse of standardCoordinates: TAN offsets (arcsec) back to RA / Dec (degrees). */
export function skyFromStandard(xiArcsec: number, etaArcsec: number, ra0: number, dec0: number): SkyPoint
{
    const xi = (xiArcsec / 3600) * DEG, eta = (etaArcsec / 3600) * DEG, d0 = dec0 * DEG
    const den = Math.cos(d0) - eta * Math.sin(d0)
    const ra  = ra0 + Math.atan2(xi, den) / DEG
    const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den)) / DEG
    return { ra: ((ra % 360) + 360) % 360, dec }
}

/** Where a sky position falls on the viewport, in CSS pixels, or null if it's 90°+ from the field centre. */
export function skyToScreen(point: SkyPoint, target: SkyPoint, view: ViewState, pixelScaleArcsec: number)
{
    const p = standardCoordinates(point.ra, point.dec, target.ra, target.dec)
    if (!p.front)
        return null
    return imageToScreen(view, 0.5 - p.xi / (view.imageWidth * pixelScaleArcsec), 0.5 + p.eta / (view.imageHeight * pixelScaleArcsec))
}

/**
 * Image texture coordinates (u right, v up, 0..1) -> CSS pixels on the canvas.
 * Mirrors shaders/vpImage.ts: a quad of height 1 in clip space, scaled by zoom and moved by pan.
 */
export function imageToScreen(view: ViewState, u: number, v: number)
{
    const { cssWidth: W, cssHeight: H, imageWidth, imageHeight, zoom, panX, panY } = view
    const aspect = (H / W) * (imageWidth / imageHeight)
    const clipX = (u - 0.5) * aspect * zoom + panX
    const clipY = (v - 0.5) * zoom + panY
    return { x: ((clipX + 1) / 2) * W, y: ((1 - clipY) / 2) * H }
}

/** Inverse of imageToScreen. */
export function screenToImage(view: ViewState, x: number, y: number)
{
    const { cssWidth: W, cssHeight: H, imageWidth, imageHeight, zoom, panX, panY } = view
    const aspect = (H / W) * (imageWidth / imageHeight)
    return {
        u: ((x / W) * 2 - 1 - panX) / (aspect * zoom) + 0.5,
        v: (1 - (y / H) * 2 - panY) / zoom + 0.5,
    }
}

/** Angular separation (arcsec) and position angle of b from a (degrees east of north, 0..360). */
export function separation(a: SkyPoint, b: SkyPoint)
{
    const d1 = a.dec * DEG, d2 = b.dec * DEG, dRa = (b.ra - a.ra) * DEG
    const east  = Math.cos(d2) * Math.sin(dRa)
    const north = Math.cos(d1) * Math.sin(d2) - Math.sin(d1) * Math.cos(d2) * Math.cos(dRa)
    const along = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dRa)
    // Vincenty form: stays accurate for the arcsec-scale separations measured here.
    const sepArcsec = (Math.atan2(Math.hypot(east, north), along) / DEG) * 3600
    const paDeg = ((Math.atan2(east, north) / DEG) + 360) % 360
    return { sepArcsec, paDeg }
}

/** Degrees as "<a>:<b>:<c>" sexagesimal parts, rounding up through 60 cleanly. */
function sexagesimal(value: number, decimals: number): [number, number, string]
{
    const scale = 10 ** decimals
    const total = Math.round(Math.abs(value) * 3600 * scale)
    const whole = Math.floor(total / (3600 * scale))
    const min   = Math.floor(total / (60 * scale)) % 60
    const sec   = (total % (60 * scale)) / scale
    return [whole, min, sec.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0')]
}

/** RA in hours: 20h 18m 46.44s */
export function formatRa(raDeg: number): string
{
    const [h, m, s] = sexagesimal((((raDeg % 360) + 360) % 360) / 15, 2)
    return `${String(h % 24).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s}s`
}

/** Dec: +42° 26′ 37.3″ */
export function formatDec(decDeg: number): string
{
    const [d, m, s] = sexagesimal(decDeg, 1)
    return `${decDeg < 0 ? '−' : '+'}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${s}″`
}

/** 12.3″, 4.56′ or 1.234°, whichever reads best. */
export function formatAngle(arcsec: number): string
{
    return arcsec < 60 ? `${arcsec.toFixed(1)}″`
         : arcsec < 3600 ? `${(arcsec / 60).toFixed(2)}′`
         : `${(arcsec / 3600).toFixed(3)}°`
}
