import { useEffect, useRef } from 'react'

import { createRenderer } from '../renderer'

export default function Viewport()
{
    const canvasRef = useRef<HTMLCanvasElement | null>(null)

    useEffect(() =>
    {
        const canvas = canvasRef.current
        if (!canvas)
        {
            return
        }

        try
        {
            const renderer = createRenderer(canvas)
            return () => renderer.destroy()
        }
        catch (error)
        {
            console.error(error)
            return undefined
        }
    }, [])

    return (
        <div className="viewport-root">
            <canvas ref={canvasRef} className="viewport-canvas" />
        </div>
    )
}