import { useEffect, useRef, useState } from 'react';

import { WebGLRenderer } from '../renderer/Index';
import { getCachedFrame, loadFrameNow,
         type SpherexImage, type ViewportImageInfo, type ViewTarget } from '../api/spherex';

// Wait this long before downloading a frame that isn't cached, so dragging the
// playhead across many frames only downloads the one it stops on.
const LOAD_DELAY_MS = 150;

type ViewportProps = {
    target:       ViewTarget
    frame:        SpherexImage | null   // the image to show, chosen in the playback bar
    frameIndex:   number
    frameCount:   number
    searching?:   boolean               // the image search for the target is still running
    onImageInfo?: (info: ViewportImageInfo) => void
}

export default function Viewport({ target, frame, frameIndex, frameCount, searching = false, onImageInfo }: ViewportProps)
{
    // True while the current frame is downloading; shows the spinner.
    const [frameLoading, setFrameLoading] = useState(false);

    const canvasRef   = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<WebGLRenderer | null>(null);

    // Keep the latest callback in a ref so the effects below don't re-run
    // when the parent re-renders.
    const onImageInfoRef = useRef(onImageInfo);
    useEffect(() => { onImageInfoRef.current = onImageInfo; }, [onImageInfo]);

    const { ra: rightAscension, dec: declination, fovArcsec: sizeArcsec } = target;

    // Show the current frame whenever it, the target or the field of view changes.
    // The previous image stays on screen until the new one is ready.
    useEffect(() =>
    {
        if (!frame)
        {
            setFrameLoading(false);
            return;
        }

        let cancelled = false;
        const report = (info: ViewportImageInfo) => onImageInfoRef.current?.(info);

        const view = { ra: rightAscension, dec: declination, fovArcsec: sizeArcsec };
        const info = { ra: rightAscension, dec: declination, sizeArcsec,
                       index: frameIndex, totalImages: frameCount, image: frame };

        const cached = getCachedFrame(frame.access_url, view);
        if (cached)
        {
            rendererRef.current?.setViewportImage(cached.image);
            report({ ...info, status: 'loaded', meta: cached.meta });
            setFrameLoading(false);
            return;
        }

        report({ ...info, status: 'loading' });
        setFrameLoading(true);

        const timer = setTimeout(async () =>
        {
            try
            {
                const loaded = await loadFrameNow(frame.access_url, view);
                if (cancelled)
                    return;
                rendererRef.current?.setViewportImage(loaded.image);
                report({ ...info, status: 'loaded', meta: loaded.meta });
                setFrameLoading(false);
            }
            catch (error)
            {
                if (cancelled)
                    return;
                console.error(error);
                report({ ...info, status: 'error',
                         error: error instanceof Error ? error.message : String(error) });
                setFrameLoading(false);
            }
        }, LOAD_DELAY_MS);

        return () =>
        {
            cancelled = true;
            clearTimeout(timer);
        };

    }, [frame, frameIndex, frameCount, rightAscension, declination, sizeArcsec]);

    useEffect(() =>
    {
        const canvas = canvasRef.current;
        if (!canvas)
        {
            return;
        }

        const renderer = new WebGLRenderer(canvas);
        rendererRef.current = renderer;

        let activePointerId: number | null = null;
        let lastX = 0;
        let lastY = 0;

        const onPointerDown = (event: PointerEvent) =>
            {
                if (event.button !== 0 || activePointerId !== null)
                    return;

                canvas.setPointerCapture(event.pointerId);
            };

        const onPointerMove = (event: PointerEvent) =>
            {
                if (event.pointerId !== activePointerId)
                    return;

                const dx = event.clientX - lastX;
                const dy = event.clientY - lastY;

                lastX = event.clientX;
                lastY = event.clientY;

                // renderer.panBy(dx, dy);
            };

        const onPointerUp = (event: PointerEvent) =>
            {
                if (event.pointerId !== activePointerId)
                {
                    return;
                }

                activePointerId = null;

                if (canvas.hasPointerCapture(event.pointerId))
                {
                    canvas.releasePointerCapture(event.pointerId);
                }
            };

        const onLostPointerCapture = () =>
            {
                activePointerId = null;
            };

        canvas.addEventListener("pointerdown"       , onPointerDown);
        canvas.addEventListener("pointermove"       , onPointerMove);
        canvas.addEventListener("pointerup"         , onPointerUp);
        canvas.addEventListener("pointercancel"     , onPointerUp);
        canvas.addEventListener("lostpointercapture", onLostPointerCapture);

        const observer = new ResizeObserver(() => renderer.resize());
        observer.observe(canvas);

        return () =>
        {
            observer.disconnect();

            canvas.removeEventListener("pointerdown"       , onPointerDown);
            canvas.removeEventListener("pointermove"       , onPointerMove);
            canvas.removeEventListener("pointerup"         , onPointerUp);
            canvas.removeEventListener("pointercancel"     , onPointerUp);
            canvas.removeEventListener("lostpointercapture", onLostPointerCapture);

            rendererRef.current = null;
            renderer.terminate();
        };
        
    }, []);

    return (
        <div className="viewport-root">
            <canvas ref={canvasRef} className="viewport-canvas" />

            {(searching || frameLoading) && (
                <div className="viewport-loading" role="status" aria-live="polite">
                    <div className="viewport-spinner" aria-hidden="true" />
                    <span>
                        {searching
                            ? 'Searching for images…'
                            : `Loading frame ${frameIndex + 1} of ${frameCount}…`}
                    </span>
                </div>
            )}
        </div>
    );
}