import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { frameCacheCapacity, isFrameCached, retainFrames, searchImages, setPreloadQueue, subscribeFrameCache,
         type Epoch, type SpherexImage, type ViewportImageInfo, type ViewTarget } from '../api/spherex'

export const WAVELENGTH_TOLERANCES_UM = [0.01, 0.02, 0.05, 0.1]
export const PLAYBACK_SPEEDS_FPS      = [0.5, 1, 2, 4]

// The most frames to preload, and the share of a sliding preload window kept
// behind the current frame (the rest is ahead, in playback order).
const PRELOAD_MAX         = 60
const PRELOAD_BEHIND_SHARE = 0.1
// While scrubbing or scrolling through wavelengths, wait this long for the input to
// settle before changing what is preloaded.
const WINDOW_SETTLE_MS    = 200
const PAGE_SIZE      = 1000
const MAX_IMAGES     = 10000

type SearchState = {
    key:     string            // which position this result belongs to
    images:  SpherexImage[]    // every image covering the position, oldest first
    epochs:  Epoch[]
    error?:  string
}

type Range = {
    frames: SpherexImage[]     // the frame list this range was set on
    start:  number
    end:    number
}

export type Frames = ReturnType<typeof useFrames>

/**
 * Everything the playback bar and viewport share: the images found for a sky
 * position, the list of frames to step through (optionally only those near one
 * wavelength, so frames differ in time rather than colour), and playback state.
 */
export function useFrames(target: ViewTarget)
{
    const { ra, dec, fovArcsec } = target
    const searchKey = `${ra}|${dec}`

    // -- Search: all images covering the position (re-run only when it moves) --

    const [search, setSearch] = useState<SearchState | null>(null)

    useEffect(() =>
    {
        const controller = new AbortController()

        // The backend returns at most 1000 images per request, so fetch every page.
        const searchAll = async () =>
        {
            const first = await searchImages(ra, dec, { limit: PAGE_SIZE, signal: controller.signal })
            const images = [...first.images]
            while (images.length < Math.min(first.total, MAX_IMAGES))
            {
                const page = await searchImages(ra, dec, { limit: PAGE_SIZE, offset: images.length,
                                                           signal: controller.signal })
                if (page.images.length === 0)
                    break
                images.push(...page.images)
            }
            return { images, epochs: first.epochs }
        }

        searchAll()
            .then((result) =>
            {
                const images = result.images.sort((a, b) => (a.mjd_start ?? 0) - (b.mjd_start ?? 0))
                setSearch({ key: searchKey, images, epochs: result.epochs })
            })
            .catch((error) =>
            {
                if (controller.signal.aborted)
                    return
                console.error(error)
                setSearch({ key: searchKey, images: [], epochs: [],
                            error: error instanceof Error ? error.message : String(error) })
            })

        return () => controller.abort()

    }, [ra, dec, searchKey])

    const current = search?.key === searchKey ? search : null
    const status: 'loading' | 'ready' | 'error' = !current ? 'loading' : current.error ? 'error' : 'ready'
    const allImages = useMemo(() => current?.images ?? [], [current])
    const epochs    = current?.epochs ?? []

    // -- Frame list: all images, optionally only one detector, and optionally only
    //    those near the reference wavelength --

    // The user's detector choice: a detector number, 'all', or null = not chosen yet,
    // which means the lowest-numbered detector at this position (normally D1).
    const [detectorChoice, setDetectorChoice] = useState<number | 'all' | null>(null)
    const [matchWavelength, setMatchWavelength] = useState(true)
    const [chosenWavelength, setChosenWavelength] = useState<number | null>(null)
    const [toleranceUm, setToleranceUm] = useState(0.02)

    // The six SPHEREx detectors each cover one slice of the spectrum. Summarise what
    // this position has for each: image count and wavelength coverage.
    const detectors = useMemo(() =>
    {
        const byDetector = new Map<number, { detector: number, count: number, minUm: number, maxUm: number }>()
        for (const image of allImages)
        {
            if (image.detector == null)
                continue
            const lo = image.wavelength_um ?? image.wavelength_min_um ?? Infinity
            const hi = image.wavelength_um ?? image.wavelength_max_um ?? -Infinity
            const entry = byDetector.get(image.detector)
            if (entry)
            {
                entry.count++
                entry.minUm = Math.min(entry.minUm, lo)
                entry.maxUm = Math.max(entry.maxUm, hi)
            }
            else
            {
                byDetector.set(image.detector, { detector: image.detector, count: 1, minUm: lo, maxUm: hi })
            }
        }
        return [...byDetector.values()].sort((a, b) => a.detector - b.detector)
    }, [allImages])

    const detector: number | null = detectorChoice === 'all'
        ? null
        : detectorChoice ?? detectors[0]?.detector ?? null

    const detectorImages = useMemo(
        () => (detector === null ? allImages : allImages.filter((image) => image.detector === detector)),
        [allImages, detector],
    )

    // Until a wavelength is picked, start at the shortest one on the current detector.
    const lowestWavelength = useMemo(() =>
    {
        let lowest: number | null = null
        for (const image of detectorImages)
        {
            if (image.wavelength_um != null && (lowest === null || image.wavelength_um < lowest))
                lowest = image.wavelength_um
        }
        return lowest === null ? null : Math.round(lowest * 10_000) / 10_000
    }, [detectorImages])

    const refWavelength = chosenWavelength ?? lowestWavelength

    const frames = useMemo(() =>
    {
        if (!matchWavelength || refWavelength === null)
            return detectorImages
        return detectorImages.filter((image) =>
            image.wavelength_um != null && Math.abs(image.wavelength_um - refWavelength) <= toleranceUm + 1e-9)
    }, [detectorImages, matchWavelength, refWavelength, toleranceUm])

    /**
     * Show only one detector's images (null = all). Picking a detector also turns on
     * wavelength matching at the shortest wavelength any of its images was taken at.
     */
    const setDetector = useCallback((next: number | null) =>
    {
        setDetectorChoice(next ?? 'all')
        if (next === null)
            return
        const lowest = allImages
            .filter((image) => image.detector === next && image.wavelength_um != null)
            .reduce<number | null>((min, image) => (min === null || image.wavelength_um! < min ? image.wavelength_um! : min), null)
        if (lowest !== null)
        {
            setChosenWavelength(Math.round(lowest * 10_000) / 10_000)
            setMatchWavelength(true)
        }
    }, [allImages])

    // Every distinct wavelength an image was taken at (on the chosen detector), ascending.
    const wavelengths = useMemo(() =>
    {
        const values = detectorImages
            .map((image) => image.wavelength_um)
            .filter((w): w is number => w != null)
            .map((w) => Math.round(w * 10_000) / 10_000)
        return [...new Set(values)].sort((a, b) => a - b)
    }, [detectorImages])

    /**
     * Move the matched wavelength to the next (+1) or previous (-1) wavelength used by
     * an image. With `jump`, skip past everything inside the current tolerance, so the
     * frame list switches to an entirely new set of images.
     */
    const stepWavelength = useCallback((direction: 1 | -1, jump = false) =>
    {
        if (wavelengths.length === 0)
            return
        const from = refWavelength ?? wavelengths[0]
        const gap  = (jump ? toleranceUm : 0) + 1e-6
        const next = direction > 0
            ? wavelengths.find((w) => w > from + gap)
            : [...wavelengths].reverse().find((w) => w < from - gap)
        if (next !== undefined)
            setChosenWavelength(next)
    }, [wavelengths, refWavelength, toleranceUm])

    // -- Current frame: remembered as an image, so it survives filter changes --

    const [selected, setSelected] = useState<SpherexImage | null>(null)

    const frameIndex = useMemo(() =>
    {
        if (frames.length === 0)
            return -1
        if (!selected)
            return 0
        const exact = frames.findIndex((f) => f.access_url === selected.access_url)
        if (exact >= 0)
            return exact
        // Not in this list (filter or position changed): use the closest in time.
        let best = 0
        for (let i = 1; i < frames.length; i++)
        {
            const d    = Math.abs((frames[i].mjd_start ?? 0) - (selected.mjd_start ?? 0))
            const dMin = Math.abs((frames[best].mjd_start ?? 0) - (selected.mjd_start ?? 0))
            if (d < dMin)
                best = i
        }
        return best
    }, [frames, selected])

    const frame = frameIndex >= 0 ? frames[frameIndex] : null

    // -- Loop range (frame indices, inclusive); resets when the frame list changes --

    const [range, setRange] = useState<Range | null>(null)
    const lastIndex  = Math.max(frames.length - 1, 0)
    const rangeStart = range?.frames === frames ? Math.min(range.start, lastIndex) : 0
    const rangeEnd   = range?.frames === frames ? Math.min(range.end, lastIndex)   : lastIndex

    const setFrameIndex = useCallback((index: number) =>
    {
        if (frames.length === 0)
            return
        setSelected(frames[Math.min(Math.max(Math.round(index), 0), frames.length - 1)])
    }, [frames])

    const setRangeStart = (index: number) =>
        setRange({ frames, start: Math.min(Math.max(Math.round(index), 0), rangeEnd), end: rangeEnd })

    const setRangeEnd = (index: number) =>
        setRange({ frames, start: rangeStart, end: Math.max(Math.min(Math.round(index), lastIndex), rangeStart) })

    // -- Playback --

    const [playing, setPlaying] = useState(false)
    const [loop, setLoop]       = useState(true)
    const [speedFps, setSpeedFps] = useState(1)

    /** Step one frame, staying inside the loop range (wraps around when looping). */
    const step = useCallback((delta: 1 | -1) =>
    {
        if (frames.length === 0)
            return
        let next = frameIndex + delta
        if (next > rangeEnd)
            next = loop ? rangeStart : rangeEnd
        if (next < rangeStart)
            next = loop ? rangeEnd : rangeStart
        setFrameIndex(next)
    }, [frames, frameIndex, rangeStart, rangeEnd, loop, setFrameIndex])

    const togglePlaying = () =>
    {
        if (!playing && (frameIndex < rangeStart || frameIndex >= rangeEnd))
            setFrameIndex(rangeStart)   // start from the beginning of the range
        setPlaying(!playing)
    }

    // What the viewport is showing right now (it reports back as frames load).
    const [imageInfo, setImageInfo] = useState<ViewportImageInfo | null>(null)

    const shownIsCurrent = !!frame && !!imageInfo
        && imageInfo.image?.access_url === frame.access_url
        && imageInfo.ra === ra && imageInfo.dec === dec && imageInfo.sizeArcsec === fovArcsec
    const frameSettled = shownIsCurrent && imageInfo?.status !== 'loading'

    // Advance only after the current frame is on screen, so slow downloads
    // slow playback down instead of skipping frames.
    useEffect(() =>
    {
        if (!playing || !frameSettled)
            return

        const timer = setTimeout(() =>
        {
            if (frameIndex >= rangeEnd && !loop)
                setPlaying(false)
            else
                step(1)
        }, 1000 / speedFps)

        return () => clearTimeout(timer)

    }, [playing, frameSettled, frameIndex, rangeEnd, loop, speedFps, step])

    // -- Preloading: download the timeline's frames in the background --

    const view = useMemo(() => ({ ra, dec, fovArcsec }), [ra, dec, fovArcsec])

    // Re-render when frames finish downloading, so the timeline can show progress.
    const [cacheVersion, setCacheVersion] = useState(0)
    useEffect(() => subscribeFrameCache(() => setCacheVersion((v) => v + 1)), [])

    const cached = useMemo(
        () => frames.map((image) => isFrameCached(image.access_url, view)),
        // cacheVersion changes whenever the cache does.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [frames, view, cacheVersion],
    )

    // Read the current frame through a ref so stepping doesn't restart the preloader.
    const frameIndexRef = useRef(frameIndex)
    useEffect(() => { frameIndexRef.current = frameIndex }, [frameIndex])

    // Which frames to preload, highest priority first. Capped so they fit in the
    // browser cache without evicting each other.
    //  - Matching a wavelength (a short list): the loop range in playback order from
    //    the current frame, then frames outside the range, nearest first.
    //  - All images (a long list), or any list while playing: a window that follows
    //    the current frame, about 10% behind it and the rest ahead. While playing, the
    //    window moves one frame per frame shown, so a frame is unloaded behind for
    //    every frame viewed.
    const windowAnchor = matchWavelength && !playing ? null : frameIndex

    const preloadOrder = useMemo(() =>
    {
        const count = frames.length
        if (count === 0)
            return []

        const limit = Math.max(1, Math.min(PRELOAD_MAX, Math.floor(frameCacheCapacity(fovArcsec) * 0.8)))

        if (windowAnchor !== null)
            return slidingWindow(count, windowAnchor, rangeStart, rangeEnd, loop, limit, !playing)

        const start = Math.min(Math.max(frameIndexRef.current, rangeStart), rangeEnd)
        const order: number[] = []
        for (let i = start; i <= rangeEnd; i++) order.push(i)
        for (let i = rangeStart; i < start; i++) order.push(i)

        const outside: number[] = []
        for (let i = 0; i < count; i++)
        {
            if (i < rangeStart || i > rangeEnd)
                outside.push(i)
        }
        const distance = (i: number) => (i < rangeStart ? rangeStart - i : i - rangeEnd)
        outside.sort((x, y) => distance(x) - distance(y))

        return [...order, ...outside].slice(0, limit)
    }, [frames, windowAnchor, rangeStart, rangeEnd, loop, fovArcsec, playing])

    // Queue the downloads and unload frames that are no longer wanted. When scrubbing or
    // stepping through wavelengths, wait for the input to settle first; when playing,
    // update on every frame.
    useEffect(() =>
    {
        if (preloadOrder.length === 0)
        {
            setPreloadQueue([])
            return
        }

        const timer = setTimeout(() =>
        {
            const requests = preloadOrder.map((i) => ({ imageUrl: frames[i].access_url, target: view }))
            retainFrames(requests)
            setPreloadQueue(requests)
        }, playing ? 0 : WINDOW_SETTLE_MS)

        return () => clearTimeout(timer)

    }, [preloadOrder, frames, view, windowAnchor, playing])

    // Stop background downloads when the app unmounts.
    useEffect(() => () => setPreloadQueue([]), [])

    const preloadedCount = preloadOrder.filter((i) => cached[i]).length

    // -- What the sidebar should show --

    const base = { ra, dec, sizeArcsec: fovArcsec }
    let info: ViewportImageInfo
    if (status === 'loading')
        info = { ...base, status: 'loading' }
    else if (status === 'error')
        info = { ...base, status: 'error', error: current?.error }
    else if (allImages.length === 0)
        info = { ...base, status: 'error', error: 'No SPHEREx images cover this position' }
    else if (!frame)
        info = { ...base, status: 'error', error: 'No images match the detector / wavelength filter' }
    else if (shownIsCurrent && imageInfo)
        info = imageInfo
    else
        info = { ...base, status: 'loading', image: frame, index: frameIndex, totalImages: frames.length }

    return {
        status,
        error: current?.error,
        allImages,
        epochs,

        frames,
        frame,
        frameIndex,
        setFrameIndex,

        matchWavelength,
        setMatchWavelength,
        refWavelength,
        setRefWavelength: setChosenWavelength,
        wavelengths,
        stepWavelength,
        detector,
        setDetector,
        detectors,
        toleranceUm,
        setToleranceUm,

        rangeStart,
        rangeEnd,
        setRangeStart,
        setRangeEnd,

        playing,
        togglePlaying,
        step,
        loop,
        setLoop,
        speedFps,
        setSpeedFps,

        frameLoading: !!frame && !frameSettled,
        cached,
        preloadedCount,
        preloadTotal: preloadOrder.length,
        info,
        onImageInfo: setImageInfo,
    }
}

/**
 * Frames to preload around `current`: about PRELOAD_BEHIND_SHARE of the window behind
 * it and the rest ahead in playback order (wrapping inside the loop range when looping).
 * If frames ahead run out and `fillBehind` is set, the spare slots go behind instead;
 * playback passes false so frames it has moved past are unloaded rather than kept.
 * Returned in priority order: the current frame, then mostly ahead with one behind
 * every ~10.
 */
function slidingWindow(count: number, current: number, rangeStart: number, rangeEnd: number,
                       loop: boolean, limit: number, fillBehind = true): number[]
{
    const inRange = current >= rangeStart && current <= rangeEnd
    const low  = inRange ? rangeStart : 0
    const high = inRange ? rangeEnd   : count - 1
    const taken = new Set<number>([current])

    const collectBehind = (max: number, into: number[]) =>
    {
        for (let i = current - 1 - into.length; i >= low && into.length < max; i--)
        {
            if (taken.has(i))
                break
            taken.add(i)
            into.push(i)
        }
    }

    const collectAhead = (max: number, into: number[]) =>
    {
        let i = into.length ? into[into.length - 1] : current
        while (into.length < max)
        {
            i++
            if (i > high)
            {
                if (!(inRange && loop))
                    break
                i = low
            }
            if (taken.has(i))
                break
            taken.add(i)
            into.push(i)
        }
    }

    // Size the behind share from the frames actually available, so short lists
    // still unload frames that playback has moved past.
    const slots  = Math.min(limit, high - low + 1) - 1
    const behind: number[] = []
    const ahead:  number[] = []
    collectBehind(Math.max(1, Math.round(slots * PRELOAD_BEHIND_SHARE)), behind)
    collectAhead(slots - behind.length, ahead)
    if (fillBehind)
        collectBehind(slots - ahead.length, behind)   // ahead ran out: use the spare slots behind

    const order = [current]
    let a = 0, b = 0
    while (a < ahead.length || b < behind.length)
    {
        const behindTurn = order.length % 10 === 0
        if ((behindTurn && b < behind.length) || a >= ahead.length)
            order.push(behind[b++])
        else
            order.push(ahead[a++])
    }
    return order
}
