import { useEffect, useRef, useState } from 'react';

import { WebGLRenderer } from '../renderer/index';
import SkyGizmo from './SkyGizmo';
import ViewModeBar from './ViewModeBar';
import BodyOverlay, { fieldPosition, isLikelyVisible } from './BodyOverlay';
import MeasureOverlay, { ObjectMarker, type Measurement } from './MeasureOverlay';
import type { Layer } from '../processing';
import { PIXEL_SCALE_ARCSEC, formatAngle, formatDec, formatRa, screenToImage, skyFromStandard, type SkyPoint } from '../sky';
import type { ViewState } from '../renderer/index';
import type { Image } from '../renderer/Image';
import { DIFF_DISPLAY_SIGMA, SURVEYS, fetchSolarSystemBodies, getCachedDiff, getCachedFrame, getCachedSurvey, loadDiffImage,
         loadFrameMeta, loadFrameNow, loadSurveyImage,
         type LoadedFrame, type ResolvedObject, type SkyImage, type SolarSystemBody, type SpherexImage, type ViewMode, type ViewportImageInfo, type ViewTarget } from '../api/spherex';

// Wait this long before downloading a frame that isn't cached, so dragging the
// playhead across many frames only downloads the one it stops on.
const LOAD_DELAY_MS = 150;


// A left click that moves less than this is a click (clears the ruler), not a measurement.
const CLICK_SLOP_PX = 3;

const NO_LAYERS: Layer[] = [];

type ViewportProps = {
    target:       ViewTarget
    frame:        SpherexImage | null   // the image to show, chosen in the playback bar
    frameIndex:   number
    frameCount:   number
    searching?:   boolean               // the image search for the target is still running
    viewMode:     ViewMode
    onViewModeChange: (mode: ViewMode) => void
    onTargetChange?: (ra: number, dec: number) => void   // e.g. clicked on the sky gizmo
    surveyImageId?: string | null   // which of the survey's images to show (survey views)
    refFrame:     SpherexImage | null   // reference for the difference view
    refIndex:     number
    onImageInfo?: (info: ViewportImageInfo) => void
    measuring?:   boolean               // the measure tool is selected: left-drag draws a ruler
    measurement?: Measurement | null
    onMeasurementChange?: (measurement: Measurement | null) => void
    embed?:       boolean                 // embedded on another site: the image only, no overlays or controls
    located?:     ResolvedObject | null   // object found with the header search
    layers?:      Layer[]                 // post-processing stack, applied in order
}

// Star positions for the loading animation: [x %, y %, twinkle delay s, size px].
const LOADING_STARS: [number, number, number, number][] = [
    [14, 22, 0.0, 3], [32, 68, 0.6, 2], [47, 31, 1.1, 4], [63, 79, 0.3, 2],
    [78, 18, 0.9, 3], [86, 55, 1.5, 2], [22, 86, 1.3, 2], [55, 52, 0.45, 3],
    [71, 40, 1.8, 2], [9, 48, 0.75, 2], [39, 12, 1.6, 2], [92, 88, 0.15, 3],
];

/** "2025-11-01" from an ISO timestamp, for captions. */
function shortDate(iso: string | null | undefined): string
{
    return iso ? iso.slice(0, 10) : 'unknown date';
}

/** "2025-11-01 08:38 UTC" from an ISO timestamp (the backend sends UTC). */
function dateTime(iso: string | null | undefined): string
{
    return iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'unknown';
}

export default function Viewport({ target, frame, frameIndex, frameCount, searching = false,
                                   viewMode, onViewModeChange, refFrame, refIndex, onImageInfo, onTargetChange,
                                   surveyImageId = null, measuring = false, measurement = null,
                                   onMeasurementChange, located = null, layers = NO_LAYERS, embed = false }: ViewportProps)
{
    // Why the difference / survey image couldn't be shown (the SPHEREx frame is shown instead).
    const [auxError, setAuxError] = useState<string | null>(null);

    // Where the image is on screen (for overlays that follow pan / zoom).
    const [view, setView] = useState<ViewState | null>(null);

    // Known solar-system bodies at the current frame's time.
    const [showBodies, setShowBodies] = useState(true);
    const [bodies, setBodies] = useState<{ key: string, list: SolarSystemBody[] | null, error?: string } | null>(null);

    // True while the current frame is downloading; shows the spinner.
    const [frameLoading, setFrameLoading] = useState(false);

    // Sky position under the mouse, or null when it's off the image.
    const [cursorSky, setCursorSky] = useState<SkyPoint | null>(null);

    const canvasRef   = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<WebGLRenderer | null>(null);

    // Keep the latest callback in a ref so the effects below don't re-run
    // when the parent re-renders.
    const onImageInfoRef = useRef(onImageInfo);
    useEffect(() => { onImageInfoRef.current = onImageInfo; }, [onImageInfo]);

    // Arcsec per pixel of the image on screen: 6.15 for SPHEREx frames, finer for survey images.
    const [imageScale, setImageScale] = useState(PIXEL_SCALE_ARCSEC);
    // The frame whose image is on screen: the previous image stays up while the next one
    // loads, so the embed's stamp follows this rather than `frame`.
    const [shownFrame, setShownFrame] = useState<SpherexImage | null>(null);

    // Same for what the pointer handlers read while measuring.
    const measureRef = useRef({ measuring, target, onMeasurementChange, imageScale });
    useEffect(() => { measureRef.current = { measuring, target, onMeasurementChange, imageScale }; },
              [measuring, target, onMeasurementChange, imageScale]);

    const { ra: rightAscension, dec: declination, fovArcsec: sizeArcsec } = target;

    const surveyId = viewMode.startsWith('survey:') ? viewMode.slice('survey:'.length) : null;
    const diffRef  = viewMode === 'diff' ? refFrame : null;

    // Show the current frame whenever it, the target, the field of view or the view
    // mode changes. The SPHEREx frame is always loaded (the sidebar and playback rely on
    // it); in difference / survey mode that image is drawn instead. The previous image
    // stays on screen until the new one is ready.
    useEffect(() =>
    {
        let cancelled = false;
        const report = (info: ViewportImageInfo) => onImageInfoRef.current?.(info);
        const draw   = (image: SkyImage) =>
        {
            rendererRef.current?.setViewportImage(image);
            setImageScale(image.pixelScaleArcsec ?? PIXEL_SCALE_ARCSEC);
            setShownFrame(frame);
        };
        const view   = { ra: rightAscension, dec: declination, fovArcsec: sizeArcsec };

        const needsAux = !!surveyId || (!!diffRef && !!frame);
        const cachedAux = (): Image | undefined =>
            surveyId ? getCachedSurvey(surveyId, view, surveyImageId)
            : diffRef && frame ? getCachedDiff(frame.access_url, diffRef.access_url, view)
            : undefined;
        const loadAux = (): Promise<Image> =>
            surveyId ? loadSurveyImage(surveyId, view, surveyImageId)
            : loadDiffImage(frame!.access_url, diffRef!.access_url, view);

        setAuxError(null);

        // No SPHEREx frame (still searching, or nothing here): a survey can still be shown.
        if (!frame && !surveyId)
        {
            setFrameLoading(false);
            return;
        }

        const info = frame
            ? { ra: rightAscension, dec: declination, sizeArcsec, index: frameIndex, totalImages: frameCount, image: frame }
            : null;

        // The image is drawn as soon as its pixels are in; the metadata follows. Until it
        // arrives the frame stays "loading", so the sidebar and playback wait for it.
        const reportLoaded = (loaded: LoadedFrame) =>
        {
            if (!info || !frame)
                return;
            if (loaded.meta)
            {
                report({ ...info, status: 'loaded', meta: loaded.meta });
                return;
            }
            report({ ...info, status: 'loading' });
            loadFrameMeta(frame.access_url, view)
                .then((meta) => { if (!cancelled) report({ ...info, status: 'loaded', meta }); })
                .catch((error) =>
                {
                    // The image is fine without it; the sidebar just has less to show.
                    console.error(error);
                    if (!cancelled)
                        report({ ...info, status: 'loaded' });
                });
        };

        // Everything already downloaded: draw straight away.
        const cachedFrame = frame ? getCachedFrame(frame.access_url, view) : undefined;
        const auxImage    = needsAux ? cachedAux() : undefined;
        if ((!frame || cachedFrame) && (!needsAux || auxImage))
        {
            const image = auxImage ?? cachedFrame?.image;
            if (image)
                draw(image);
            if (cachedFrame)
                reportLoaded(cachedFrame);
            setFrameLoading(false);
            return () => { cancelled = true; };
        }

        // Report "loading" until what's on screen matches, so playback waits for it.
        if (info)
            report({ ...info, status: 'loading', meta: cachedFrame?.meta });
        setFrameLoading(true);

        const timer = setTimeout(async () =>
        {
            // The frame and the difference / survey image download at the same time.
            // (Both are awaited below; the empty catches only stop a rejection being
            // reported as unhandled while the other one is still being waited for.)
            const framePromise = frame ? loadFrameNow(frame.access_url, view) : null;
            const auxPromise   = needsAux ? loadAux() : null;
            framePromise?.catch(() => undefined);
            auxPromise?.catch(() => undefined);

            let drawn = false;
            if (auxPromise)
            {
                try
                {
                    const image = await auxPromise;
                    if (cancelled)
                        return;
                    draw(image);
                    drawn = true;
                    setFrameLoading(false);
                }
                catch (error)
                {
                    // Fall back to the SPHEREx frame and say why.
                    if (cancelled)
                        return;
                    setAuxError(error instanceof Error ? error.message : String(error));
                }
            }

            try
            {
                const loaded = framePromise ? await framePromise : null;
                if (cancelled)
                    return;
                if (loaded && !drawn)
                    draw(loaded.image);
                setFrameLoading(false);
                if (loaded)
                    reportLoaded(loaded);
            }
            catch (error)
            {
                if (cancelled)
                    return;
                console.error(error);
                if (info)
                    report({ ...info, status: 'error', error: error instanceof Error ? error.message : String(error) });
                setFrameLoading(false);
            }
        }, LOAD_DELAY_MS);

        return () =>
        {
            cancelled = true;
            clearTimeout(timer);
        };

    }, [frame, frameIndex, frameCount, rightAscension, declination, sizeArcsec, surveyId, surveyImageId, diffRef]);

    // Solar-system bodies are tied to the SPHEREx frame's time, so they're shown for
    // SPHEREx frames and differences (at the current frame's time), not survey images.
    const bodiesActive = showBodies && (viewMode === 'spherex' || viewMode === 'diff') && !!frame?.mjd_mid;
    const bodiesKey = frame?.mjd_mid ? `${rightAscension}|${declination}|${sizeArcsec}|${frame.mjd_mid}` : '';

    useEffect(() =>
    {
        if (!bodiesActive || !frame?.mjd_mid)
            return;
        let cancelled = false;
        // Search out to the corners of the square field (half the diagonal), plus a margin.
        const radius = sizeArcsec * 0.75;
        fetchSolarSystemBodies(rightAscension, declination, frame.mjd_mid, radius)
            .then((list) => { if (!cancelled) setBodies({ key: bodiesKey, list }); })
            .catch((error) => { if (!cancelled) setBodies({ key: bodiesKey, list: null, error: String(error?.message ?? error) }); });
        return () => { cancelled = true; };
    }, [bodiesActive, bodiesKey, frame?.mjd_mid, rightAscension, declination, sizeArcsec]);

    const currentBodies = bodies?.key === bodiesKey ? bodies : null;

    // The search covers the field's corners and a margin; count only what's in the image.
    const fieldArcsec = view?.hasImage ? view.imageWidth * imageScale : sizeArcsec;
    const bodiesInField = (currentBodies?.list ?? []).filter((b) =>
        fieldPosition(b, target, fieldArcsec, view?.hasImage ? view.imageHeight * imageScale : sizeArcsec));
    const visibleBodies = bodiesInField.filter(isLikelyVisible).length;

    useEffect(() =>
    {
        const canvas = canvasRef.current;
        if (!canvas)
        {
            return;
        }

        const renderer = new WebGLRenderer(canvas);
        rendererRef.current = renderer;

        // Keep overlays in step with pan / zoom / resize, at most once per animation frame.
        let viewFrame = 0;
        const unsubscribeView = renderer.onViewChange(() =>
        {
            if (viewFrame)
                return;
            viewFrame = requestAnimationFrame(() =>
            {
                viewFrame = 0;
                setView(renderer.getView());
            });
        });

        // -- Pan with the right mouse button, zoom with the wheel --

        let activePointerId: number | null = null;
        let lastX = 0;
        let lastY = 0;

        const stopPanning = () =>
            {
                activePointerId = null;
                canvas.classList.remove("viewport-panning");
            };

        // -- Measure tool: drag with the left button --

        let measurePointerId: number | null = null;
        let measureStart: { x: number, y: number, sky: { ra: number, dec: number } } | null = null;

        // Sky position under a screen point, from the image on screen (north up, centred on the target).
        const skyAt = (clientX: number, clientY: number) =>
            {
                const rect = canvas.getBoundingClientRect();
                const view = renderer.getView();
                const { u, v } = screenToImage(view, clientX - rect.left, clientY - rect.top);
                const { target: { ra, dec }, imageScale: scale } = measureRef.current;
                const sky = skyFromStandard((0.5 - u) * view.imageWidth * scale,
                                            (v - 0.5) * view.imageHeight * scale, ra, dec);
                return { sky, onImage: view.hasImage && u >= 0 && u <= 1 && v >= 0 && v <= 1 };
            };

        // -- Coordinates under the mouse, once per animation frame; also re-read when the view moves --

        let hoverX = 0;
        let hoverY = 0;
        let hovering = false;
        let hoverFrame = 0;

        const updateHover = () =>
            {
                hoverFrame = 0;
                const at = hovering ? skyAt(hoverX, hoverY) : null;
                setCursorSky(at?.onImage ? at.sky : null);
            };

        const scheduleHover = () =>
            {
                if (!hoverFrame)
                    hoverFrame = requestAnimationFrame(updateHover);
            };

        const onPointerLeave = () =>
            {
                hovering = false;
                scheduleHover();
            };

        const unsubscribeHover = renderer.onViewChange(() => { if (hovering) scheduleHover(); });

        const onMeasureDown = (event: PointerEvent) =>
            {
                if (event.button !== 0 || !measureRef.current.measuring || !renderer.getView().hasImage
                    || measurePointerId !== null || activePointerId !== null)
                    return false;
                event.preventDefault();
                measurePointerId = event.pointerId;
                measureStart = { x: event.clientX, y: event.clientY, sky: skyAt(event.clientX, event.clientY).sky };
                canvas.setPointerCapture(event.pointerId);
                return true;
            };

        const onMeasureMove = (event: PointerEvent) =>
            {
                if (event.pointerId !== measurePointerId || !measureStart)
                    return false;
                if (Math.hypot(event.clientX - measureStart.x, event.clientY - measureStart.y) >= CLICK_SLOP_PX)
                    measureRef.current.onMeasurementChange?.({ a: measureStart.sky, b: skyAt(event.clientX, event.clientY).sky });
                return true;
            };

        const onMeasureUp = (event: PointerEvent) =>
            {
                if (event.pointerId !== measurePointerId || !measureStart)
                    return false;
                // A click without a drag clears the ruler.
                if (Math.hypot(event.clientX - measureStart.x, event.clientY - measureStart.y) < CLICK_SLOP_PX)
                    measureRef.current.onMeasurementChange?.(null);
                measurePointerId = null;
                measureStart = null;
                if (canvas.hasPointerCapture(event.pointerId))
                    canvas.releasePointerCapture(event.pointerId);
                return true;
            };

        const onPointerDown = (event: PointerEvent) =>
            {
                if (onMeasureDown(event))
                    return;
                if (event.button !== 2 || activePointerId !== null)
                    return;

                event.preventDefault();
                activePointerId = event.pointerId;
                lastX = event.clientX;
                lastY = event.clientY;
                canvas.setPointerCapture(event.pointerId);
                canvas.classList.add("viewport-panning");   // closed-hand cursor
            };

        const onPointerMove = (event: PointerEvent) =>
            {
                hoverX = event.clientX;
                hoverY = event.clientY;
                hovering = true;
                scheduleHover();
                if (onMeasureMove(event))
                    return;
                if (event.pointerId !== activePointerId)
                    return;

                const dx = event.clientX - lastX;
                const dy = event.clientY - lastY;

                lastX = event.clientX;
                lastY = event.clientY;

                renderer.panBy(dx, dy);
            };

        const onPointerUp = (event: PointerEvent) =>
            {
                if (onMeasureUp(event))
                    return;
                if (event.pointerId !== activePointerId)
                {
                    return;
                }

                stopPanning();

                if (canvas.hasPointerCapture(event.pointerId))
                {
                    canvas.releasePointerCapture(event.pointerId);
                }
            };

        const onLostPointerCapture = () =>
            {
                stopPanning();
                measurePointerId = null;
                measureStart = null;
            };

        // The right button pans, so don't open the browser's context menu.
        const onContextMenu = (event: MouseEvent) => event.preventDefault();

        const onWheel = (event: WheelEvent) =>
            {
                event.preventDefault();   // don't scroll the page
                // deltaMode 1 = lines (some mice / Firefox); treat a line as ~16 px.
                const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
                renderer.zoomAt(event.clientX, event.clientY, Math.exp(-delta * 0.0015));
            };

        // Double-click: back to the default view.
        const onDoubleClick = () => renderer.resetView();

        canvas.addEventListener("pointerdown"       , onPointerDown);
        canvas.addEventListener("pointermove"       , onPointerMove);
        canvas.addEventListener("pointerleave"      , onPointerLeave);
        canvas.addEventListener("pointerup"         , onPointerUp);
        canvas.addEventListener("pointercancel"     , onPointerUp);
        canvas.addEventListener("lostpointercapture", onLostPointerCapture);
        canvas.addEventListener("contextmenu"       , onContextMenu);
        canvas.addEventListener("wheel"             , onWheel, { passive: false });
        canvas.addEventListener("dblclick"          , onDoubleClick);

        const observer = new ResizeObserver(() => renderer.resize());
        observer.observe(canvas);

        return () =>
        {
            unsubscribeView();
            cancelAnimationFrame(viewFrame);
            unsubscribeHover();
            cancelAnimationFrame(hoverFrame);
            observer.disconnect();

            canvas.removeEventListener("pointerdown"       , onPointerDown);
            canvas.removeEventListener("pointermove"       , onPointerMove);
            canvas.removeEventListener("pointerleave"      , onPointerLeave);
            canvas.removeEventListener("pointerup"         , onPointerUp);
            canvas.removeEventListener("pointercancel"     , onPointerUp);
            canvas.removeEventListener("lostpointercapture", onLostPointerCapture);
            canvas.removeEventListener("contextmenu"       , onContextMenu);
            canvas.removeEventListener("wheel"             , onWheel);
            canvas.removeEventListener("dblclick"          , onDoubleClick);

            rendererRef.current = null;
            renderer.terminate();
        };
        
    }, []);

    // Declared after the effect that creates the renderer, so on mount it exists already.
    useEffect(() => { rendererRef.current?.setLayers(layers); }, [layers]);

    return (
        <div className="viewport-root">
            <canvas ref={canvasRef} className={`viewport-canvas${measuring ? ' viewport-measuring' : ''}`} />

            {bodiesActive && view?.hasImage && currentBodies?.list && (
                <BodyOverlay
                    bodies={currentBodies.list}
                    target={target}
                    view={view}
                    pixelScaleArcsec={imageScale}
                />
            )}

            {cursorSky && !embed && (
                <div className="viewport-cursor" aria-live="off">
                    <span><span className="viewport-cursor-key">RA</span>{formatRa(cursorSky.ra)}</span>
                    <span><span className="viewport-cursor-key">Dec</span>{formatDec(cursorSky.dec)}</span>
                    <span className="viewport-cursor-deg">
                        {cursorSky.ra.toFixed(5)}°, {cursorSky.dec >= 0 ? '+' : ''}{cursorSky.dec.toFixed(5)}°
                    </span>
                </div>
            )}

            {/* Embedded: what the image is, since none of the app's panels are there to say. */}
            {embed && shownFrame && (
                <div className="viewport-cursor viewport-stamp" aria-label="Image details">
                    <span><span className="viewport-cursor-key">RA</span>{formatRa(rightAscension)}</span>
                    <span><span className="viewport-cursor-key">Dec</span>{formatDec(declination)}</span>
                    <span><span className="viewport-cursor-key">FOV</span>{formatAngle(sizeArcsec)}</span>
                    {shownFrame.wavelength_um != null && (
                        <span><span className="viewport-cursor-key">λ</span>{shownFrame.wavelength_um.toFixed(3)} µm</span>
                    )}
                    <span><span className="viewport-cursor-key">Date</span>{dateTime(shownFrame.time_start)}</span>
                </div>
            )}

            {located && view?.hasImage && (
                <ObjectMarker
                    name={located.name}
                    point={located}
                    target={target}
                    view={view}
                    pixelScaleArcsec={imageScale}
                />
            )}

            {measurement && view?.hasImage && (
                <MeasureOverlay
                    measurement={measurement}
                    target={target}
                    view={view}
                    pixelScaleArcsec={imageScale}
                />
            )}

            {/* Not when embedded: there the image is shown on its own. */}
            {!embed && (
                <>
                    {/* Sky gizmo in the top-right corner... */}
                    <div className="viewport-gizmo">
                        <SkyGizmo ra={rightAscension} dec={declination} fovArcsec={sizeArcsec} onTarget={onTargetChange}
                                  measurement={measurement} />
                    </div>

                    {/* ...and the view-mode buttons stacked up from the bottom-right corner. */}
                    <div className="viewport-modes">
                        <ViewModeBar
                            mode={viewMode}
                            onChange={onViewModeChange}
                            diffAvailable={frameCount > 1}
                            showBodies={showBodies}
                            onToggleBodies={() => setShowBodies((v) => !v)}
                            bodiesStatus={
                                !(viewMode === 'spherex' || viewMode === 'diff') ? 'unavailable'
                                : !showBodies ? 'off'
                                : !currentBodies ? 'loading'
                                : currentBodies.error ? 'error'
                                : 'ready'
                            }
                            bodiesCount={bodiesInField.length}
                            bodiesVisible={visibleBodies}
                        />
                    </div>
                </>
            )}

            {viewMode !== 'spherex' && (
                <div className="viewport-caption" role="status">
                    {viewMode === 'diff' ? (
                        <>
                            <span>
                                <strong>Difference</strong> · frame {frameIndex + 1}
                                <span className="viewport-caption-dim"> ({shortDate(frame?.time_start)})</span>
                                {' − '}reference {refIndex + 1}
                                <span className="viewport-caption-dim"> ({shortDate(refFrame?.time_start)})</span>
                            </span>
                            <span className="viewport-caption-key">
                                <i className="key-white" /> brighter now
                                <i className="key-grey" /> no change
                                <i className="key-black" /> fainter now
                                <span className="viewport-caption-dim">· black-to-white spans ±{DIFF_DISPLAY_SIGMA}× the noise</span>
                            </span>
                            <span className="viewport-caption-dim">
                                Something that moved shows as a black + white pair (where it was / where it is now).
                            </span>
                        </>
                    ) : (
                        <span>
                            <strong>{SURVEYS.find((sv) => `survey:${sv.id}` === viewMode)?.label}</strong>
                            {' · '}{SURVEYS.find((sv) => `survey:${sv.id}` === viewMode)?.wavelength}
                            <span className="viewport-caption-dim"> · archival image of this field, not a SPHEREx frame</span>
                        </span>
                    )}
                    {auxError && <span className="viewport-caption-error">Couldn't load it: {auxError}. Showing SPHEREx instead.</span>}
                </div>
            )}

            {(searching || frameLoading) && (
                <div className="viewport-loading" role="status" aria-live="polite">
                    {/* Placeholder where the image will appear: faint stars twinkling in a
                        frame, with a light sweep across it. */}
                    <div className="loading-frame" aria-hidden="true">
                        {LOADING_STARS.map(([x, y, delay, size], i) => (
                            <span
                                key={i}
                                className="loading-star"
                                style={{ left: `${x}%`, top: `${y}%`, width: size, height: size, animationDelay: `${delay}s` }}
                            />
                        ))}
                    </div>
                    <div className="loading-label">
                        <div className="viewport-spinner" aria-hidden="true" />
                        <span>
                        {searching
                            ? 'Searching for images…'
                            : `Loading frame ${frameIndex + 1} of ${frameCount}…`}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}