import type { Image } from '../renderer/Image';

// Base URL of the FastAPI backend (src/backend). Override with VITE_API_URL in .env if needed.
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export interface SpherexImage
{
    access_url:       string;
    obs_id:           string;
    collection:       string;
    band:             number | null;
    detector:         number | null;
    wavelength_min_um: number | null;
    wavelength_max_um: number | null;
    wavelength_um?:   number | null;
    mjd_start:        number | null;
    mjd_mid:          number | null;
    time_start:       string | null;
    time_end:         string | null;
    exposure_s:       number | null;
    epoch?:           number;
}

export interface SearchResult
{
    total:  number;
    offset: number;
    limit:  number;
    epochs: unknown[];
    images: SpherexImage[];
}

export interface SearchOptions
{
    radiusArcsec?: number;
    limit?:        number;
    offset?:       number;
    signal?:       AbortSignal;
}

export interface CutoutOptions
{
    sizeArcsec?: number;
    bin?:        number;
    align?:      boolean;
    signal?:     AbortSignal;
}

export interface CutoutImage extends Image
{
    mjd: number | null;
}

type QueryValue = string | number | boolean | undefined;

function qs(params: Record<string, QueryValue>): string
{
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params))
    {
        if (value !== undefined)
            search.append(key, String(value));
    }
    return '?' + search.toString();
}

async function checkResponse(res: Response, what: string): Promise<void>
{
    if (!res.ok)
    {
        let detail = await res.text();
        try { detail = JSON.parse(detail).detail ?? detail; } catch { /* plain text */ }
        throw new Error(`${what} failed (${res.status}): ${detail}`);
    }
}

/** Find every SPHEREx image that covers a sky position (degrees). */
export async function searchImages(ra: number, dec: number, options: SearchOptions = {}): Promise<SearchResult>
{
    const url = `${API_URL}/api/spherex/images` + qs({
        ra,
        dec,
        radius_arcsec: options.radiusArcsec,
        limit:         options.limit ?? 100,
        offset:        options.offset,
    });

    const res = await fetch(url, { signal: options.signal });
    await checkResponse(res, 'Image search');
    return res.json();
}

/** Fetch a cutout of one image around (ra, dec) as raw float32 pixels in MJy/sr. NaN = no data. */
export async function fetchCutout(imageUrl: string, ra: number, dec: number, options: CutoutOptions = {}): Promise<CutoutImage>
{
    const url = `${API_URL}/api/spherex/image/data` + qs({
        url:         imageUrl,
        ra,
        dec,
        size_arcsec: options.sizeArcsec ?? 300,
        bin:         options.bin,
        align:       options.align,
    });

    const res = await fetch(url, { signal: options.signal });
    await checkResponse(res, 'Cutout');

    const width  = Number(res.headers.get('X-Width'));
    const height = Number(res.headers.get('X-Height'));
    const mjd    = res.headers.get('X-Mjd');
    const pixels = new Float32Array(await res.arrayBuffer());

    if (pixels.length !== width * height)
        throw new Error(`Cutout size mismatch: got ${pixels.length} pixels for ${width}x${height}`);

    return { width, height, pixels, mjd: mjd ? Number(mjd) : null };
}

/**
 * Map MJy/sr values into 0..1 for display: clip to the [lo, hi] percentiles, then apply an
 * asinh stretch so faint structure and bright stars are both visible. NaN becomes 0 (black).
 */
export function stretchForDisplay(image: Image, loPercentile = 1, hiPercentile = 99.5, softening = 0.1): Image
{
    const finite = image.pixels.filter(Number.isFinite).sort();
    const out    = new Float32Array(image.pixels.length);

    if (finite.length === 0)
        return { width: image.width, height: image.height, pixels: out };

    const pick  = (p: number) => finite[Math.min(finite.length - 1, Math.floor((p / 100) * finite.length))];
    const lo    = pick(loPercentile);
    const range = Math.max(pick(hiPercentile) - lo, 1e-12);
    const norm  = Math.asinh(1 / softening);

    for (let i = 0; i < out.length; i++)
    {
        const v = image.pixels[i];
        if (!Number.isFinite(v))
            continue;
        const t = Math.min(Math.max((v - lo) / range, 0), 1);
        out[i] = Math.asinh(t / softening) / norm;
    }

    return { width: image.width, height: image.height, pixels: out };
}

export interface ImageMeta
{
    width:              number;
    height:             number;
    extension:          string;
    aligned:            boolean;
    pixel_scale_arcsec: number;
    observation:
    {
        date_mid:   string | null;
        mjd_mid:    number | null;
        exposure_s: number | null;
    };
    wavelength_um: number | null;
    bandwidth_um:  number | null;
    header:        Record<string, string | number | boolean | null>;
    wcs:           Record<string, string | number | boolean | null>;
    stats:
    {
        min:         number;
        max:         number;
        percentiles: Record<string, number>;
    } | null;
}

/** Cutout metadata: size, observation time, wavelength at the target, header, WCS and pixel stats. */
export async function fetchImageMeta(imageUrl: string, ra: number, dec: number, options: CutoutOptions = {}): Promise<ImageMeta>
{
    const url = `${API_URL}/api/spherex/image/meta` + qs({
        url:         imageUrl,
        ra,
        dec,
        size_arcsec: options.sizeArcsec ?? 300,
        align:       options.align,
    });

    const res = await fetch(url, { signal: options.signal });
    await checkResponse(res, 'Image metadata');
    return res.json();
}

/** Everything known about the image currently shown in the viewport. */
export interface ViewportImageInfo
{
    status:      'loading' | 'loaded' | 'error';
    error?:      string;
    ra:          number;
    dec:         number;
    sizeArcsec:  number;
    index?:      number;          // position in the search results
    totalImages?: number;
    image?:      SpherexImage;    // record from /api/spherex/images
    meta?:       ImageMeta;       // from /api/spherex/image/meta
}

/** What the viewport should show: a sky position (degrees) and field of view (arcsec). */
export interface ViewTarget
{
    ra:        number;
    dec:       number;
    fovArcsec: number;
}

// Backend limits for size_arcsec (one SPHEREx pixel is 6.15").
export const MIN_FOV_ARCSEC = 30;
export const MAX_FOV_ARCSEC = 3600;

/**
 * Parse a coordinate typed by the user. Accepts decimal degrees ("304.6935") or
 * sexagesimal ("20 18 46.4", "20:18:46.4", "20h18m46.4s", "+42d26m37s").
 * Sexagesimal RA is in hours and is converted to degrees. Returns null if invalid.
 */
export function parseCoordinate(text: string, kind: 'ra' | 'dec'): number | null
{
    const s = text.trim();
    if (s === '')
        return null;

    let value: number;
    if (/^[+-]?\d+(\.\d+)?$/.test(s))
    {
        value = Number(s);
    }
    else
    {
        const match = s.match(/^([+-])?\s*(\d+(?:\.\d+)?)\s*([hd°:\s])\s*(\d+(?:\.\d+)?)?\s*[m':\s]?\s*(\d+(?:\.\d+)?)?\s*[s"]?$/i);
        if (!match)
            return null;
        const sign = match[1] === '-' ? -1 : 1;
        const [a, b, c] = [match[2], match[4], match[5]].map((x) => (x ? Number(x) : 0));
        if (b >= 60 || c >= 60)
            return null;
        value = sign * (a + b / 60 + c / 3600);
        // RA written as "20h18m" or "20 18 46" is in hours; "304d41m" / "304.69°" is degrees.
        const inDegrees = /[d°]/i.test(match[3]);
        if (kind === 'ra' && !inDegrees)
            value *= 15;   // hours -> degrees
    }

    if (kind === 'ra')
        return value >= 0 && value < 360 ? value : null;
    return value >= -90 && value <= 90 ? value : null;
}
