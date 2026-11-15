import type { Image } from '../renderer/Image';

// Base URL of the FastAPI backend (src/backend). Override with VITE_API_URL in .env if needed.
// 127.0.0.1 rather than "localhost": the dev server only listens on IPv4, and on Windows
// "localhost" tries IPv6 first, which costs up to ~2 s per new connection.
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

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
    epochs: Epoch[];
    images: SpherexImage[];
}

/** A run of observations with no long gap between them (a "season" of visits). */
export interface Epoch
{
    index:       number;
    time_start:  string | null;
    time_end:    string | null;
    mjd_start:   number | null;
    mjd_end:     number | null;
    image_count: number;
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
    const { pixels } = image;
    const out = new Float32Array(pixels.length);

    // Copy the finite pixels once, then find the two percentiles with quickselect,
    // which is linear time instead of sorting everything.
    const finite = new Float32Array(pixels.length);
    let n = 0;
    for (let i = 0; i < pixels.length; i++)
    {
        const v = pixels[i];
        if (Number.isFinite(v))
            finite[n++] = v;
    }
    if (n === 0)
        return { width: image.width, height: image.height, pixels: out };

    const rank   = (p: number) => Math.min(n - 1, Math.floor((p / 100) * n));
    const hiRank = rank(hiPercentile);
    const hi     = selectKth(finite, hiRank, 0, n - 1);
    // After selecting hi, everything before hiRank is <= hi, so search only that part for lo.
    const lo     = selectKth(finite, rank(loPercentile), 0, hiRank);
    const range  = Math.max(hi - lo, 1e-12);
    const scale  = 1 / (range * softening);
    const norm   = 1 / Math.asinh(1 / softening);
    const max    = 1 / softening;

    for (let i = 0; i < pixels.length; i++)
    {
        const v = pixels[i];
        if (!Number.isFinite(v))
            continue;
        const t = Math.min(Math.max((v - lo) * scale, 0), max);
        out[i] = Math.asinh(t) * norm;
    }

    return { width: image.width, height: image.height, pixels: out };
}

/**
 * Return the k-th smallest value of values[left..right] (inclusive), partially
 * reordering that slice in place (Hoare quickselect with a median-of-three pivot).
 */
function selectKth(values: Float32Array, k: number, left: number, right: number): number
{
    while (right > left)
    {
        const mid = (left + right) >> 1;
        const a = values[left], b = values[mid], c = values[right];
        const pivot = a < b ? (b < c ? b : a < c ? c : a) : (a < c ? a : b < c ? c : b);

        let i = left, j = right;
        while (i <= j)
        {
            while (values[i] < pivot) i++;
            while (values[j] > pivot) j--;
            if (i <= j)
            {
                const t = values[i]; values[i] = values[j]; values[j] = t;
                i++; j--;
            }
        }
        if (k <= j)      right = j;
        else if (k >= i) left = i;
        else             return values[k];
    }
    return values[k];
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

/** A frame ready to draw: display-stretched pixels plus its metadata. */
export interface LoadedFrame
{
    image: Image;
    meta:  ImageMeta;
}

// Keep downloaded frames up to this many bytes of pixels (least recently used go first).
// Scaled to the device: navigator.deviceMemory (Chromium only) reports RAM in GB, rounded
// and capped at 8. 32 MB per GB gives 64 MB on a 2 GB device up to 256 MB on 8 GB+;
// browsers that don't report it get a middle-of-the-road 192 MB.
const FRAME_CACHE_BUDGET_BYTES = (() =>
{
    const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const mb = memoryGb ? Math.min(Math.max(memoryGb * 32, 64), 256) : 192;
    return mb * 1024 * 1024;
})();

const frameCache    = new Map<string, LoadedFrame>();            // finished frames, least recently used first
let   frameCacheBytes = 0;
const cacheListeners = new Set<() => void>();
const framesLoading = new Map<string, Promise<LoadedFrame>>();   // requests in flight

function frameKey(imageUrl: string, target: ViewTarget): string
{
    return `${imageUrl}|${target.ra}|${target.dec}|${target.fovArcsec}`;
}

/** A frame that has already been downloaded, or undefined. */
export function getCachedFrame(imageUrl: string, target: ViewTarget): LoadedFrame | undefined
{
    const key   = frameKey(imageUrl, target);
    const frame = frameCache.get(key);
    if (frame)
    {
        // Mark as recently used so it's the last to be evicted.
        frameCache.delete(key);
        frameCache.set(key, frame);
    }
    return frame;
}

/** True if the frame is downloaded, without marking it as recently used. */
export function isFrameCached(imageUrl: string, target: ViewTarget): boolean
{
    return frameCache.has(frameKey(imageUrl, target));
}

/** Call `listener` whenever a frame is added to or evicted from the cache. Returns an unsubscribe function. */
export function subscribeFrameCache(listener: () => void): () => void
{
    cacheListeners.add(listener);
    return () => { cacheListeners.delete(listener); };
}

/** Rough number of pixel bytes one frame takes for a field of view (float32, 6.15" pixels). */
export function estimateFrameBytes(fovArcsec: number): number
{
    const side = Math.ceil(fovArcsec / 6.15) | 1;
    return side * side * 4;
}

/** How many frames of this field of view fit in the cache. */
export function frameCacheCapacity(fovArcsec: number): number
{
    return Math.floor(FRAME_CACHE_BUDGET_BYTES / estimateFrameBytes(fovArcsec));
}

/**
 * Download one frame (pixels + metadata) for a target, stretched for display.
 * Results are cached in memory and concurrent requests for the same frame are shared,
 * so playback, scrubbing and prefetching never download a frame twice.
 */
export function loadFrame(imageUrl: string, target: ViewTarget): Promise<LoadedFrame>
{
    const key = frameKey(imageUrl, target);

    const cached = getCachedFrame(imageUrl, target);
    if (cached)
        return Promise.resolve(cached);

    const pending = framesLoading.get(key);
    if (pending)
        return pending;

    const options = { sizeArcsec: target.fovArcsec };
    const request = (async () =>
    {
        const cutout = await fetchCutout(imageUrl, target.ra, target.dec, options);
        // The FITS file is cached on the server after the cutout, so this is quick.
        const meta = await fetchImageMeta(imageUrl, target.ra, target.dec, options);

        const frame = { image: stretchForDisplay(cutout), meta };
        frameCache.set(key, frame);
        frameCacheBytes += frame.image.pixels.byteLength;
        while (frameCacheBytes > FRAME_CACHE_BUDGET_BYTES && frameCache.size > 1)
        {
            const [oldestKey, oldest] = frameCache.entries().next().value as [string, LoadedFrame];
            frameCache.delete(oldestKey);
            frameCacheBytes -= oldest.image.pixels.byteLength;
        }
        cacheListeners.forEach((listener) => listener());
        return frame;
    })();

    framesLoading.set(key, request);
    request.catch(() => undefined).finally(() => framesLoading.delete(key));
    return request;
}

/** Direct IRSA link to the FITS cutout of an image around the target. */
export function fitsCutoutUrl(imageUrl: string, target: ViewTarget): string
{
    return `${imageUrl}?center=${target.ra},${target.dec}&size=${target.fovArcsec}arcsec`;
}

// -- Background preloading --

export interface FrameRequest
{
    imageUrl: string;
    target:   ViewTarget;
}

// How many background downloads run at once adapts to how fast frames arrive:
//  - Browsers open at most 6 connections to one server, so the ceiling is 5, leaving one
//    for the frame the user is looking at.
//  - When downloads are slow (e.g. a slow network between the backend and IRSA), more at
//    once doesn't raise throughput, it only delays the frame the user wants, so drop to 2.
//  - Data saver mode (navigator.connection.saveData) caps it at 1.
const PRELOAD_MAX_CONCURRENCY = 5;
const PRELOAD_MIN_CONCURRENCY = 2;
const FAST_FRAME_MS = 6_000;    // average download time at or below this: use the maximum
const SLOW_FRAME_MS = 12_000;   // at or above this: back off to the minimum

let preloadQueue: FrameRequest[] = [];
let preloadActive = 0;
let foregroundLoads = 0;
let averageFrameMs: number | null = null;

function saveDataEnabled(): boolean
{
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    return connection?.saveData === true;
}

/** Current number of background downloads allowed at once. */
export function preloadConcurrency(): number
{
    if (saveDataEnabled())
        return 1;
    if (averageFrameMs === null || averageFrameMs <= FAST_FRAME_MS)
        return PRELOAD_MAX_CONCURRENCY;
    if (averageFrameMs >= SLOW_FRAME_MS)
        return PRELOAD_MIN_CONCURRENCY;
    const t = (averageFrameMs - FAST_FRAME_MS) / (SLOW_FRAME_MS - FAST_FRAME_MS);
    return Math.round(PRELOAD_MAX_CONCURRENCY - t * (PRELOAD_MAX_CONCURRENCY - PRELOAD_MIN_CONCURRENCY));
}

function recordFrameTime(ms: number): void
{
    // Moving average, so one slow frame doesn't swing it.
    averageFrameMs = averageFrameMs === null ? ms : averageFrameMs * 0.7 + ms * 0.3;
}

function pumpPreloads(): void
{
    // Hold new background downloads while the user waits on a frame, so it isn't
    // queued behind them on a slow connection.
    while (foregroundLoads === 0 && preloadActive < preloadConcurrency() && preloadQueue.length > 0)
    {
        const next = preloadQueue.shift()!;
        if (isFrameCached(next.imageUrl, next.target))
            continue;

        preloadActive++;
        const started = performance.now();
        loadFrame(next.imageUrl, next.target)
            .then(() => recordFrameTime(performance.now() - started))
            .catch(() => undefined)   // shown later if the user lands on this frame
            .finally(() =>
            {
                preloadActive--;
                pumpPreloads();
            });
    }
}

/**
 * Load the frame the user is looking at. Same as loadFrame, but new background
 * downloads wait until it arrives, so it isn't stuck behind them.
 */
export async function loadFrameNow(imageUrl: string, target: ViewTarget): Promise<LoadedFrame>
{
    const cached = getCachedFrame(imageUrl, target);
    if (cached)
        return cached;

    foregroundLoads++;
    const started = performance.now();
    try
    {
        const frame = await loadFrame(imageUrl, target);
        recordFrameTime(performance.now() - started);
        return frame;
    }
    finally
    {
        foregroundLoads--;
        pumpPreloads();
    }
}

/**
 * Replace the background download list (highest priority first). Frames not yet
 * started are dropped; at most preloadConcurrency() downloads run at once, so
 * calling this on every frame change never piles up requests.
 */
export function setPreloadQueue(requests: FrameRequest[]): void
{
    preloadQueue = requests.filter((r) => !isFrameCached(r.imageUrl, r.target));
    pumpPreloads();
}

/** Unload every cached frame except these. */
export function retainFrames(requests: FrameRequest[]): void
{
    const keep = new Set(requests.map((r) => frameKey(r.imageUrl, r.target)));
    let changed = false;
    for (const [key, frame] of frameCache)
    {
        if (!keep.has(key))
        {
            frameCache.delete(key);
            frameCacheBytes -= frame.image.pixels.byteLength;
            changed = true;
        }
    }
    if (changed)
        cacheListeners.forEach((listener) => listener());
}
