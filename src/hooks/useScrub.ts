import { useEffect, useRef, type RefObject } from 'react'

// Mouse travel (px) per step while dragging.
const DRAG_STEP_PX = 14
// After the last wheel tick, how long to wait before calling onEnd (ms).
const WHEEL_END_MS = 400

type ScrubOptions = {
    disabled?:     boolean
    draggingClass: string                                    // added to the element while dragging
    onStep:        (direction: 1 | -1, shift: boolean) => void   // +1: right / up / wheel up
    onEnd?:        () => void                                // drag released, or wheel stopped
}

/**
 * Makes the element around a text input scrubbable: drag it (right / up = +) or scroll
 * over it to step the value; click it to type. While dragging, the mouse is locked and
 * hidden (Pointer Lock), so the drag never runs into the edge of the screen.
 */
export function useScrub(ref: RefObject<HTMLElement | null>, { disabled = false, draggingClass, onStep, onEnd }: ScrubOptions)
{
    // Native listeners: React's onWheel is passive (can't stop the page scrolling), and
    // locked-pointer moves need movementX/Y. The latest callbacks are kept in a ref.
    const callbacks = useRef({ onStep, onEnd })
    useEffect(() => { callbacks.current = { onStep, onEnd } })

    useEffect(() =>
    {
        const element = ref.current
        const input = element?.querySelector('input')
        if (!element || !input || disabled)
            return

        let wheelTimer: number | undefined
        const onWheel = (event: WheelEvent) =>
        {
            if (event.deltaY === 0)
                return
            event.preventDefault()
            callbacks.current.onStep(event.deltaY < 0 ? 1 : -1, event.shiftKey)
            window.clearTimeout(wheelTimer)
            wheelTimer = window.setTimeout(() => callbacks.current.onEnd?.(), WHEEL_END_MS)
        }

        let dragId: number | null = null
        let travel = 0   // towards the next step; +: up
        let moved  = 0   // total, to tell a click from a drag

        const onPointerDown = (event: PointerEvent) =>
        {
            if (event.button !== 0 || document.activeElement === input)
                return   // already typing: let the click place the caret
            event.preventDefault()   // no focus / text selection yet: this may be a drag
            dragId = event.pointerId
            travel = 0
            moved  = 0
            element.setPointerCapture(event.pointerId)
            element.classList.add(draggingClass)
            // Unbounded movement with the cursor hidden; if refused (e.g. right after an
            // Esc), the capture above still makes the drag work, just limited by the screen.
            if (event.pointerType === 'mouse')
                Promise.resolve(element.requestPointerLock()).catch(() => undefined)
        }

        const onPointerMove = (event: PointerEvent) =>
        {
            if (event.pointerId !== dragId)
                return
            moved  += Math.abs(event.movementX) + Math.abs(event.movementY)
            travel += event.movementX - event.movementY
            // One step per event: onStep may read the value from the last render.
            if (Math.abs(travel) >= DRAG_STEP_PX)
            {
                const direction = travel > 0 ? 1 : -1
                travel = 0
                callbacks.current.onStep(direction, event.shiftKey)
            }
        }

        const endDrag = () =>
        {
            if (dragId === null)
                return
            if (element.hasPointerCapture(dragId))
                element.releasePointerCapture(dragId)
            dragId = null
            element.classList.remove(draggingClass)
            if (document.pointerLockElement === element)
                document.exitPointerLock()
        }

        const onPointerUp = (event: PointerEvent) =>
        {
            if (event.pointerId !== dragId)
                return
            const click = moved < 3
            endDrag()
            if (click)
            {
                input.focus()
                input.select()
            }
            else
                callbacks.current.onEnd?.()
        }

        // Esc (or anything else) ending the lock ends the drag too.
        const onLockChange = () =>
        {
            if (dragId !== null && document.pointerLockElement !== element)
            {
                endDrag()
                callbacks.current.onEnd?.()
            }
        }

        element.addEventListener('wheel', onWheel, { passive: false })
        element.addEventListener('pointerdown', onPointerDown)
        element.addEventListener('pointermove', onPointerMove)
        element.addEventListener('pointerup', onPointerUp)
        element.addEventListener('pointercancel', endDrag)
        document.addEventListener('pointerlockchange', onLockChange)
        return () =>
        {
            endDrag()
            window.clearTimeout(wheelTimer)
            element.removeEventListener('wheel', onWheel)
            element.removeEventListener('pointerdown', onPointerDown)
            element.removeEventListener('pointermove', onPointerMove)
            element.removeEventListener('pointerup', onPointerUp)
            element.removeEventListener('pointercancel', endDrag)
            document.removeEventListener('pointerlockchange', onLockChange)
        }
    }, [ref, disabled, draggingClass])
}
