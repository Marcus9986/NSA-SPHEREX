import './ObjectInput.css'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
         type CSSProperties, type InputHTMLAttributes, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

import type { CatalogObject } from '../data/objects'
import { searchObjects } from '../data/search'

type ObjectInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
    value:    string
    onChange: (text: string) => void
    onPick:   (object: CatalogObject) => void   // a suggestion was chosen (click, or arrows + Enter)
}

const LIST_MAX_PX = 280
const LIST_MIN_WIDTH_PX = 220
const EDGE_PX = 8    // keep this far from the window edges
const GAP_PX  = 4    // between the box and the list

/**
 * Where the suggestion list goes so all of it is on screen: under the box, or above it when
 * there's more room there; never past the window edges; no taller than the space it has.
 */
function listPlacement(box: { left: number, top: number, bottom: number, width: number },
                              viewport: { width: number, height: number }): CSSProperties
{
    const width = Math.min(Math.max(box.width, LIST_MIN_WIDTH_PX), viewport.width - 2 * EDGE_PX)
    const left  = Math.min(Math.max(box.left, EDGE_PX), viewport.width - EDGE_PX - width)
    const below = viewport.height - box.bottom - GAP_PX - EDGE_PX
    const above = box.top - GAP_PX - EDGE_PX
    const down  = below >= Math.min(LIST_MAX_PX, 160) || below >= above
    const maxHeight = Math.max(0, Math.min(LIST_MAX_PX, down ? below : above))
    return down
        ? { left, width, maxHeight, top: box.bottom + GAP_PX }
        : { left, width, maxHeight, bottom: viewport.height - box.top + GAP_PX }
}

/**
 * Text box with fuzzy-matched suggestions from the built-in catalogue of well-known objects.
 * Arrow keys move through them, Enter picks, Esc closes. Plain Enter (nothing highlighted)
 * submits the surrounding form as usual, so names outside the catalogue still work.
 */
export default function ObjectInput({ value, onChange, onPick, onKeyDown, onFocus, onBlur, className, ...rest }: ObjectInputProps)
{
    const listId = useId()
    const [open, setOpen]     = useState(false)
    const [active, setActive] = useState(-1)
    // Up to 50: the list shows ~10 at a time and scrolls for the rest.
    const suggestions = useMemo(() => searchObjects(value, 50), [value])
    const showList = open && suggestions.length > 0

    // The list is drawn in a portal with fixed position, so panels that scroll or clip
    // (like the properties panel) can't cut it off; it follows the box on scroll / resize.
    const inputRef = useRef<HTMLInputElement | null>(null)
    const listRef  = useRef<HTMLUListElement | null>(null)
    const [placement, setPlacement] = useState<CSSProperties | null>(null)
    useLayoutEffect(() =>
    {
        if (!showList)
            return
        const place = () =>
        {
            const box = inputRef.current?.getBoundingClientRect()
            if (box)
                setPlacement(listPlacement(box, { width: window.innerWidth, height: window.innerHeight }))
        }
        place()
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)   // capture: any scrolling ancestor
        return () =>
        {
            window.removeEventListener('resize', place)
            window.removeEventListener('scroll', place, true)
        }
    }, [showList])

    // Keep the highlighted option in view when the arrows move past the list's scroll.
    useEffect(() =>
    {
        if (showList && active >= 0)
            listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
    }, [showList, active])

    const pick = (object: CatalogObject) =>
    {
        onChange(object.name)
        onPick(object)
        setOpen(false)
        setActive(-1)
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) =>
    {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        {
            if (suggestions.length === 0)
                return
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            setOpen(true)
            // Cycle none -> first … last -> none, where "none" leaves the typed text alone.
            setActive((i) =>
            {
                const n = suggestions.length
                const next = ((i < 0 ? n : i) + step + n + 1) % (n + 1)
                return next === n ? -1 : next
            })
            return
        }
        if (event.key === 'Enter' && showList && active >= 0 && active < suggestions.length)
        {
            event.preventDefault()
            pick(suggestions[active])
            return
        }
        if (event.key === 'Escape' && showList)
        {
            setOpen(false)
            setActive(-1)
            return
        }
        onKeyDown?.(event)
    }

    return (
        <div className="object-input">
            <input
                {...rest}
                ref={inputRef}
                className={className}
                value={value}
                role="combobox"
                aria-expanded={showList}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1) }}
                onKeyDown={handleKeyDown}
                onFocus={(event) => { setOpen(true); onFocus?.(event) }}
                onBlur={(event) => { setOpen(false); setActive(-1); onBlur?.(event) }}
            />
            {showList && placement && createPortal(
                <ul ref={listRef} className="object-input-list" id={listId} role="listbox" style={placement}>
                    {suggestions.map((object, i) => (
                        <li
                            key={object.id}
                            id={`${listId}-${i}`}
                            role="option"
                            aria-selected={i === active}
                            className={i === active ? 'object-input-option object-input-active' : 'object-input-option'}
                            // mousedown, not click: picks before the input's blur closes the list
                            onMouseDown={(event) => { event.preventDefault(); pick(object) }}
                            onMouseEnter={() => setActive(i)}
                        >
                            <span className="object-input-name">{object.name}</span>
                            <span className="object-input-detail">
                                {object.id !== object.name ? `${object.id} · ` : ''}{object.type}
                            </span>
                        </li>
                    ))}
                </ul>,
                document.body,
            )}
        </div>
    )
}
