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
    /** Browser fetch priority: the viewport's own image goes 'high', background preloads 'low'. */
    priority?:   RequestPriority;
}

export interface CutoutImage extends Image
{
    mjd: number | null;
}

/** An image for the viewport; survey images say their pixel size (SPHEREx frames are 6.15″). */
export interface SkyImage extends Image
{
    pixelScaleArcsec?: number;
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

    const res = await fetch(url, { signal: options.signal, priority: options.priority });
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
    /** Quality: every flag the file defines, with how many cutout pixels have it set. */
    flags:
    {
        total_pixels:   number;
        flagged_pixels: number;
        planes: { name: string, bit: number, description: string | null, pixels: number }[];
    };
    /** Every keyword of every extension (HDU) in the cutout file, in file order. */
    headers: { index: number, name: string,
               cards: { key: string, value: string | number | boolean | null, comment: string | null }[] }[];
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

    const res = await fetch(url, { signal: options.signal, priority: options.priority });
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
    meta?: ImageMeta;   // fetched after the pixels (loadFrameMeta), so the image can be drawn first
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
const metaLoading   = new Map<string, Promise<ImageMeta>>();

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
 * Download one frame's pixels for a target, stretched for display. Results are cached
 * in memory and concurrent requests for the same frame are shared, so playback,
 * scrubbing and prefetching never download a frame twice. The metadata is fetched
 * separately (loadFrameMeta), so the image never waits for it.
 */
export function loadFrame(imageUrl: string, target: ViewTarget, priority: RequestPriority = 'auto'): Promise<LoadedFrame>
{
    const key = frameKey(imageUrl, target);

    const cached = getCachedFrame(imageUrl, target);
    if (cached)
        return Promise.resolve(cached);

    const pending = framesLoading.get(key);
    if (pending)
        return pending;

    const request = (async () =>
    {
        const cutout = await fetchCutout(imageUrl, target.ra, target.dec, { sizeArcsec: target.fovArcsec, priority });

        const frame: LoadedFrame = { image: stretchForDisplay(cutout) };
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

/**
 * A frame's metadata (header, flags, stats). Kept on the cached frame once it arrives;
 * concurrent requests are shared. Quick once the pixels are in: the backend has the file.
 */
export function loadFrameMeta(imageUrl: string, target: ViewTarget, priority: RequestPriority = 'auto'): Promise<ImageMeta>
{
    const key = frameKey(imageUrl, target);
    const known = frameCache.get(key)?.meta;
    if (known)
        return Promise.resolve(known);

    const pending = metaLoading.get(key);
    if (pending)
        return pending;

    const request = fetchImageMeta(imageUrl, target.ra, target.dec, { sizeArcsec: target.fovArcsec, priority })
        .then((meta) =>
        {
            const frame = frameCache.get(key);
            if (frame)
                frame.meta = meta;
            return meta;
        });
    metaLoading.set(key, request);
    request.catch(() => undefined).finally(() => metaLoading.delete(key));
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
        // Low priority, so the browser serves the viewport's own image first. The metadata
        // comes along too, so the sidebar is ready when playback reaches this frame.
        loadFrame(next.imageUrl, next.target, 'low')
            .then(() =>
            {
                recordFrameTime(performance.now() - started);
                return loadFrameMeta(next.imageUrl, next.target, 'low');
            })
            .catch(() => undefined)   // shown later if the user lands on this frame
            .finally(() =>
            {
                preloadActive--;
                pumpPreloads();
            });
    }
}

/**
 * Load the frame the user is looking at. Same as loadFrame, but at high priority, and
 * new background downloads wait until it arrives, so it isn't stuck behind them.
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
        const frame = await loadFrame(imageUrl, target, 'high');
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

// -- View modes: SPHEREx, difference against a reference frame, or another telescope --

export interface SurveyInfo
{
    id:         string;
    label:      string;
    wavelength: string;
}

/** Other telescopes the backend can show for comparison (see /api/survey/list). */
export const SURVEYS: SurveyInfo[] = [
    { id: 'dss',     label: 'DSS',     wavelength: '0.65 µm optical' },
    { id: '2mass_k', label: '2MASS K', wavelength: '2.2 µm' },
    { id: 'wise_w1', label: 'WISE W1', wavelength: '3.4 µm' },
    { id: 'wise_w2', label: 'WISE W2', wavelength: '4.6 µm' },
];

export type ViewMode = 'spherex' | 'diff' | `survey:${string}`;

// Difference images are significance maps (signal / noise). Show ±this many sigma as
// black..white, with mid-grey meaning "no change".
export const DIFF_DISPLAY_SIGMA = 5;

const AUX_CACHE_LIMIT = 32;
const auxCache   = new Map<string, Image>();            // least recently used first
const auxLoading = new Map<string, Promise<Image>>();

function rememberAux(key: string, image: Image): void
{
    auxCache.set(key, image);
    if (auxCache.size > AUX_CACHE_LIMIT)
        auxCache.delete(auxCache.keys().next().value as string);
}

/** Shared download + cache for difference and survey images. */
function loadAux(key: string, url: string, toDisplay: (raw: Image) => Image): Promise<Image>
{
    const cached = auxCache.get(key);
    if (cached)
    {
        auxCache.delete(key);
        auxCache.set(key, cached);
        return Promise.resolve(cached);
    }
    const pending = auxLoading.get(key);
    if (pending)
        return pending;

    const request = (async () =>
    {
        const res = await fetch(url, { priority: 'high' });   // only ever requested to be shown in the viewport
        await checkResponse(res, 'Image');
        const width  = Number(res.headers.get('X-Width'));
        const height = Number(res.headers.get('X-Height'));
        const scale  = Number(res.headers.get('X-Pixel-Scale'));
        const pixels = new Float32Array(await res.arrayBuffer());
        const image: SkyImage = { ...toDisplay({ width, height, pixels }), pixelScaleArcsec: scale > 0 ? scale : undefined };
        rememberAux(key, image);
        return image;
    })();

    auxLoading.set(key, request);
    request.catch(() => undefined).finally(() => auxLoading.delete(key));
    return request;
}

function diffKey(imageUrl: string, refUrl: string, t: ViewTarget): string
{
    return `diff|${imageUrl}|${refUrl}|${t.ra}|${t.dec}|${t.fovArcsec}`;
}

function surveyKey(survey: string, t: ViewTarget, image?: string | null): string
{
    return `survey|${survey}|${image ?? ''}|${t.ra}|${t.dec}|${t.fovArcsec}`;
}

/** One image a survey has of the target (see /api/survey/images). */
export interface SurveyImage
{
    id:         string;          // pass to /api/survey/data as `image`
    label:      string;
    obs_id:     string | null;
    mjd_start:  number | null;
    mjd_end:    number | null;
    time_start: string | null;   // ISO; null when the archive doesn't say (DSS via SkyView)
    time_end:   string | null;
    note:       string;
}

const surveyListCache = new Map<string, Promise<SurveyImage[]>>();

/** The images a survey has of a position (usually one), oldest first. */
export function fetchSurveyImages(survey: string, ra: number, dec: number): Promise<SurveyImage[]>
{
    const key = `${survey}|${ra}|${dec}`;
    let request = surveyListCache.get(key);
    if (!request)
    {
        request = (async () =>
        {
            const res = await fetch(`${API_URL}/api/survey/images` + qs({ survey, ra, dec }));
            await checkResponse(res, 'Survey image search');
            return (await res.json()).images as SurveyImage[];
        })();
        surveyListCache.set(key, request);
        request.catch(() => surveyListCache.delete(key));   // allow a retry after a failure
    }
    return request;
}

export function getCachedDiff(imageUrl: string, refUrl: string, t: ViewTarget): Image | undefined
{
    return auxCache.get(diffKey(imageUrl, refUrl, t));
}

export function getCachedSurvey(survey: string, t: ViewTarget, image?: string | null): Image | undefined
{
    return auxCache.get(surveyKey(survey, t, image));
}

/**
 * Difference of two SPHEREx frames (image − reference) as a significance map, ready to
 * draw: mid-grey = no change, white = brighter in `imageUrl`, black = fainter.
 */
export function loadDiffImage(imageUrl: string, refUrl: string, t: ViewTarget): Promise<Image>
{
    const url = `${API_URL}/api/spherex/diff/data` + qs({
        url: imageUrl, ref_url: refUrl, ra: t.ra, dec: t.dec, size_arcsec: t.fovArcsec, mode: 'snr',
    });
    return loadAux(diffKey(imageUrl, refUrl, t), url, (raw) =>
    {
        const out = new Float32Array(raw.pixels.length);
        for (let i = 0; i < out.length; i++)
        {
            const snr = raw.pixels[i];
            out[i] = Number.isFinite(snr)
                ? 0.5 + Math.min(Math.max(snr / DIFF_DISPLAY_SIGMA, -1), 1) * 0.5
                : 0.5;   // masked / no data: same grey as "no change"
        }
        return { width: raw.width, height: raw.height, pixels: out };
    });
}

/** Another telescope's image of the same field (north up / east left), stretched for display. */
export function loadSurveyImage(survey: string, t: ViewTarget, image?: string | null): Promise<Image>
{
    const url = `${API_URL}/api/survey/data`
        + qs({ survey, ra: t.ra, dec: t.dec, size_arcsec: t.fovArcsec, image: image ?? undefined });
    return loadAux(surveyKey(survey, t, image), url, (raw) => stretchForDisplay(raw));
}


// -- Known solar-system bodies (SkyBoT) --

export interface SolarSystemBody
{
    name:   string;
    number: number | null;
    type:   string | null;        // e.g. "MB>Outer" (main belt), "NEA>Apollo", "Comet", "Planet"
    ra:     number;
    dec:    number;
    v_mag:  number | null;        // predicted visual brightness (bigger = fainter)
    ra_rate:  number | null;      // arcsec / hour, includes cos(dec)
    dec_rate: number | null;      // arcsec / hour
    position_uncertainty_arcsec: number | null;
    earth_distance_au: number | null;
    sun_distance_au:   number | null;
    link: string | null;
}

const bodiesCache   = new Map<string, SolarSystemBody[]>();
const bodiesLoading = new Map<string, Promise<SolarSystemBody[]>>();

/**
 * Known asteroids, comets and planets within `radiusArcsec` of a position at a time
 * (MJD). Cached, and concurrent requests for the same frame are shared.
 */
export function fetchSolarSystemBodies(ra: number, dec: number, mjd: number, radiusArcsec: number): Promise<SolarSystemBody[]>
{
    const key = `${ra}|${dec}|${mjd.toFixed(4)}|${Math.round(radiusArcsec)}`;
    const cached = bodiesCache.get(key);
    if (cached)
        return Promise.resolve(cached);
    const pending = bodiesLoading.get(key);
    if (pending)
        return pending;

    const request = (async () =>
    {
        const res = await fetch(`${API_URL}/api/solar-system/bodies` + qs({ ra, dec, mjd, radius_arcsec: Math.round(radiusArcsec) }));
        await checkResponse(res, 'Solar-system search');
        const bodies = (await res.json()).bodies as SolarSystemBody[];
        bodiesCache.set(key, bodies);
        return bodies;
    })();
    bodiesLoading.set(key, request);
    request.catch(() => undefined).finally(() => bodiesLoading.delete(key));
    return request;
}


// -- Object names (CDS Sesame: SIMBAD, NED, VizieR) --

export interface ResolvedObject
{
    name: string;
    ra:   number;   // degrees, ICRS
    dec:  number;
}

const nameCache = new Map<string, Promise<ResolvedObject>>();

/** Sky position of a named star, galaxy, nebula, etc. ("M31", "Vega"). Cached; failures aren't. */
export function resolveName(name: string): Promise<ResolvedObject>
{
    const key = name.trim().replace(/\s+/g, ' ').toLowerCase();
    const cached = nameCache.get(key);
    if (cached)
        return cached;

    const request = (async () =>
    {
        const res = await fetch(`${API_URL}/api/resolve` + qs({ name }));
        await checkResponse(res, `Looking up "${name.trim()}"`);
        return await res.json() as ResolvedObject;
    })();
    nameCache.set(key, request);
    request.catch(() => nameCache.delete(key));
    return request;
}
