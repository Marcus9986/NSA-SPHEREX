import { useEffect, useRef } from 'react';

import { WebGLRenderer } from '../renderer/Index';

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

        try
        {
            const renderer = new WebGLRenderer(canvas);
            const observer = new ResizeObserver(() =>
                {
                    renderer.resize();
                });
            
            observer.observe(canvas);
            renderer.render();

            return () =>
            {
                observer.disconnect();
                renderer.terminate();
            };
        }
        catch (error)
        {
            console.error(error);
            return undefined;
        }
    }, []);

    return (
        <div className="viewport-root">
            <canvas ref={canvasRef} className="viewport-canvas" />
        </div>
    );
}