import { useEffect, useRef } from 'react';

import { WebGLRenderer } from '../renderer/Index';
import { type Image, defaultImage } from '../renderer/Image';
import { searchImages, fetchCutout, fetchImageMeta, stretchForDisplay,
         type ViewportImageInfo, type ViewTarget } from '../api/spherex';

const imageIndex = 0;   // which search result to show

type ViewportProps = {
    target:       ViewTarget
    onImageInfo?: (info: ViewportImageInfo) => void
}

export default function Viewport({ target, onImageInfo }: ViewportProps)
{
    const canvasRef   = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<WebGLRenderer | null>(null);

    // Keep the latest callback in a ref so the effects below don't re-run
    // when the parent re-renders.
    const onImageInfoRef = useRef(onImageInfo);
    useEffect(() => { onImageInfoRef.current = onImageInfo; }, [onImageInfo]);

    const { ra: rightAscension, dec: declination, fovArcsec: sizeArcsec } = target;

    // Load a SPHEREx cutout whenever the target or field of view changes. Fetching
    // is async, so the image is set on the renderer once the pixels arrive.
    useEffect(() =>
    {
        const controller = new AbortController();
        const report = (info: ViewportImageInfo) => onImageInfoRef.current?.(info);

        (async () =>
        {
            try
            {
                const base = { ra: rightAscension, dec: declination, sizeArcsec };
                report({ ...base, status: 'loading' });

                const { images, total } = await searchImages(rightAscension, declination, { signal: controller.signal });
                if (images.length === 0)
                {
                    report({ ...base, status: 'error', error: 'No SPHEREx images cover this position' });
                    return;
                }

                const index = Math.min(imageIndex, images.length - 1);
                const record = images[index];
                const info = { ...base, index, totalImages: total, image: record };
                report({ ...info, status: 'loading' });

                const cutout = await fetchCutout(record.access_url, rightAscension, declination,
                                                 { sizeArcsec, signal: controller.signal });

                const image: Image = stretchForDisplay(cutout);
                rendererRef.current?.setViewportImage(image);

                // The FITS file is cached on the server now, so this is quick.
                const meta = await fetchImageMeta(record.access_url, rightAscension, declination,
                                                  { sizeArcsec, signal: controller.signal });
                report({ ...info, status: 'loaded', meta });
            }
            catch (error)
            {
                if (controller.signal.aborted)
                    return;
                console.error(error);
                report({ ra: rightAscension, dec: declination, sizeArcsec, status: 'error',
                         error: error instanceof Error ? error.message : String(error) });
            }
        })();

        // Cancel the in-flight request if the target changes or we unmount.
        return () => controller.abort();

    }, [rightAscension, declination, sizeArcsec]);

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
        </div>
    );
}