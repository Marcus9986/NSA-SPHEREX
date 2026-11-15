import { useEffect, useRef } from 'react';

import { WebGLRenderer } from '../renderer/Index';
import { defaultImage } from '../renderer/Image';

export default function Viewport()
{
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() =>
    {
        const canvas = canvasRef.current;
        if (!canvas)
        {
            return;
        }

        const renderer = new WebGLRenderer(canvas);

        let activePointerId: number | null = null;
        let lastX = 0;
        let lastY = 0;

        const onPointerDown = (event: PointerEvent) =>
            {
                if (event.button !== 0 || activePointerId !== null)
                    return;

                const rect = canvas.getBoundingClientRect();

                const width  = Math.max(1, Math.floor(event.clientX - rect.left));
                const height = Math.max(1, Math.floor(event.clientY - rect.top));

                const newImage = defaultImage(width, height);
                renderer.setViewportImage(newImage)

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

            renderer.terminate();
        };
        
    }, []);

    return (
        <div className="viewport-root">
            <canvas ref={canvasRef} className="viewport-canvas" />
        </div>
    );
}