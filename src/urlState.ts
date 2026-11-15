import { MAX_FOV_ARCSEC, MIN_FOV_ARCSEC, parseCoordinate } from './api/spherex'

/**
 * View state in the page URL, e.g. ?ra=304.6935&dec=42.4437&fov=300&wavelength=1.25, so a
 * link (or an <iframe> on another site) opens straight onto that view.
 *   ra, dec     degrees, or sexagesimal ("20h18m46s", "+42 26 37")
 *   fov         field of view in arcseconds
 *   wavelength  micrometres; snapped to the nearest one an image was taken at
 *   frame       observation ID of the frame shown (e.g. 2025W18_1B_0179_2)
 *   embed=1     show only the viewport and its image (for <iframe> embeds)
 *   autoplay=1  start playing the timeline straight away
 * Missing or invalid values are ignored, so the app's defaults apply.
 */
export type UrlState = { ra?: number, dec?: number, fovArcsec?: number, wavelengthUm?: number, frameId?: string,
                         embed?: boolean, autoplay?: boolean }

export function readUrlState(search = window.location.search): UrlState
{
    const params = new URLSearchParams(search)
    const number = (key: string) =>
    {
        const text = params.get(key)
        const value = text === null || text.trim() === '' ? NaN : Number(text)
        return Number.isFinite(value) ? value : undefined
    }
    const state: UrlState = {}

    const ra  = params.get('ra')  !== null ? parseCoordinate(params.get('ra')!, 'ra') : null
    const dec = params.get('dec') !== null ? parseCoordinate(params.get('dec')!, 'dec') : null
    if (ra !== null)  state.ra = ra
    if (dec !== null) state.dec = dec

    const fov = number('fov')
    if (fov !== undefined && fov > 0)
        state.fovArcsec = Math.round(Math.min(MAX_FOV_ARCSEC, Math.max(MIN_FOV_ARCSEC, fov)))

    const wavelength = number('wavelength')
    if (wavelength !== undefined && wavelength > 0)
        state.wavelengthUm = wavelength

    const frame = params.get('frame')?.trim()
    if (frame)
        state.frameId = frame

    // Flags: "1" or "true" turns them on.
    const flag = (key: string) => ['1', 'true'].includes(params.get(key)?.trim().toLowerCase() ?? '')
    if (flag('embed'))
        state.embed = true
    if (flag('autoplay'))
        state.autoplay = true

    return state
}

/** Set (or, with null, remove) URL parameters without reloading or adding history entries. */
export function writeUrlParams(values: Record<string, string | null>)
{
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries(values))
    {
        if (value === null)
            url.searchParams.delete(key)
        else
            url.searchParams.set(key, value)
    }
    if (url.href !== window.location.href)
        window.history.replaceState(window.history.state, '', url)
}
