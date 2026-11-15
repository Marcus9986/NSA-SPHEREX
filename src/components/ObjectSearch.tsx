import { useEffect, useRef, useState, type FormEvent } from 'react'

import { resolveName, type ResolvedObject } from '../api/spherex'
import { OBJECTS } from '../data/objects'
import { exactObject } from '../data/search'
import { formatDec, formatRa } from '../sky'
import type { Measurement } from './MeasureOverlay'
import ObjectInput from './ObjectInput'

// The "spin": each box flicks through random names, slowing down (delay grows with the
// square of the tick), and lands on its pick. From stops first (~0.5 s), To just after (~0.7 s).
const SPIN_TICKS = { from: 10, to: 12 }
const spinDelay = (tick: number) => 22 + 0.9 * tick * tick
const randomObject = () => OBJECTS[Math.floor(Math.random() * OBJECTS.length)]

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A name's position: from the built-in catalogue when it's there (instant, offline), else CDS Sesame. */
const findObject = (name: string): Promise<ResolvedObject> =>
{
    const known = exactObject(name)
    return known ? Promise.resolve(known) : resolveName(name)
}

/** Header search: look up a named star, galaxy, nebula… and centre the viewport on it. */
export function ObjectFinder({ onLocate, onClear }: { onLocate: (object: ResolvedObject) => void, onClear: () => void })
{
    const [name, setName]       = useState('')
    const [found, setFound]     = useState<ResolvedObject | null>(null)
    const [finding, setFinding] = useState(false)
    const [error, setError]     = useState<string | null>(null)

    const locate = async (lookup: Promise<ResolvedObject>) =>
    {
        setFinding(true)
        setError(null)
        setFound(null)
        try
        {
            const object = await lookup
            setFound(object)
            onLocate(object)
        }
        catch (err)
        {
            setError(message(err))
        }
        finally
        {
            setFinding(false)
        }
    }

    const onFind = (event: FormEvent) =>
    {
        event.preventDefault()
        void locate(findObject(name))
    }

    return (
        <form className="header-search" role="search" onSubmit={onFind}>
            <ObjectInput
                type="search"
                className="header-search-input"
                value={name}
                onChange={(text) =>
                {
                    setName(text)
                    setError(null)
                    setFound(null)
                    if (!text)
                        onClear()   // emptied (incl. the search box's own ✕): drop the marker too
                }}
                onPick={(object) => void locate(Promise.resolve(object))}
                onKeyDown={(event) => { if (event.key === 'Escape') { setError(null); setFound(null) } }}
                placeholder="Find object: M31, Vega, NGC 7000…"
                aria-label="Find object by name"
                maxLength={100}
            />
            <button type="submit" className="header-search-button" disabled={finding || !name.trim()}>
                {finding ? 'Searching…' : 'Locate'}
            </button>
            {(found || error) && (
                <div className={`header-search-status${error ? ' header-search-error' : ''}`} role="status">
                    <span>{error ?? `${found!.name}: ${formatRa(found!.ra)}, ${formatDec(found!.dec)}`}</span>
                    <button
                        type="button"
                        className="header-search-dismiss"
                        aria-label={found ? 'Remove the marker' : 'Dismiss'}
                        title={found ? 'Remove the marker' : 'Dismiss'}
                        onClick={() => { setError(null); setFound(null); setName(''); onClear() }}
                    >
                        ✕
                    </button>
                </div>
            )}
        </form>
    )
}

/** Measure tool: the angular distance between two named objects. */
export function ObjectDistance({ onMeasure }: { onMeasure: (measurement: Measurement) => void })
{
    const [fromName, setFromName] = useState('')
    const [toName, setToName]     = useState('')
    const [measuring, setMeasuring] = useState(false)
    const [error, setError]       = useState<string | null>(null)

    // Spin state per box: ticking (with a counter to restart the drop-in animation each
    // name) or just landed (a short flash).
    const [spin, setSpin] = useState({ from: -1, to: -1, landed: { from: false, to: false } })
    const spinning = spin.from >= 0 || spin.to >= 0
    const timers = useRef<number[]>([])
    const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
    useEffect(() => clearTimers, [])

    const randomPair = () =>
    {
        clearTimers()
        setError(null)
        const a = randomObject()
        let b = randomObject()
        while (b.id === a.id)
            b = randomObject()

        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
        {
            setFromName(a.name)
            setToName(b.name)
            return
        }

        for (const [box, final, setName] of [['from', a, setFromName], ['to', b, setToName]] as const)
        {
            let at = 0
            for (let tick = 0; tick < SPIN_TICKS[box]; tick++)
            {
                at += spinDelay(tick)
                const last = tick === SPIN_TICKS[box] - 1
                timers.current.push(window.setTimeout(() =>
                {
                    setName(last ? final.name : randomObject().name)
                    setSpin((s) => ({ ...s, [box]: last ? -1 : tick, landed: { ...s.landed, [box]: last } }))
                }, at))
            }
            timers.current.push(window.setTimeout(() =>
                setSpin((s) => ({ ...s, landed: { ...s.landed, [box]: false } })), at + 450))
        }
        setSpin({ from: 0, to: 0, landed: { from: false, to: false } })
    }

    const spinClass = (box: 'from' | 'to') =>
        'target-fov-number'
        + (spin[box] >= 0 ? ` object-spin object-spin-${spin[box] % 2 ? 'a' : 'b'}` : '')
        + (spin.landed[box] ? ' object-landed' : '')

    const onMeasureObjects = async (event: FormEvent) =>
    {
        event.preventDefault()
        setMeasuring(true)
        setError(null)
        try
        {
            const [a, b] = await Promise.all([findObject(fromName), findObject(toName)])
            onMeasure({ a, b, aName: a.name, bName: b.name })
        }
        catch (err)
        {
            setError(message(err))
        }
        finally
        {
            setMeasuring(false)
        }
    }

    return (
        <form className="info-section target-form object-distance" onSubmit={onMeasureObjects}>
            <div className="object-distance-head">
                <span className="target-form-title">Distance between objects</span>
                <span className="object-distance-actions">
                    <button type="button" className="target-submit object-distance-submit object-distance-random"
                            onClick={randomPair} disabled={spinning || measuring}
                            title="Pick two random objects from the catalogue">
                        Random
                    </button>
                    <button type="submit" className="target-submit object-distance-submit"
                            disabled={spinning || measuring || !fromName.trim() || !toName.trim()}>
                        {measuring ? 'Looking up…' : 'Measure'}
                    </button>
                </span>
            </div>
            <label className="target-field">
                <span>From</span>
                <ObjectInput
                    className={spinClass('from')}
                    value={fromName}
                    onChange={setFromName}
                    onPick={() => undefined}
                    placeholder="Betelgeuse"
                    maxLength={100}
                />
            </label>
            <label className="target-field">
                <span>To</span>
                <ObjectInput
                    className={spinClass('to')}
                    value={toName}
                    onChange={setToName}
                    onPick={() => undefined}
                    placeholder="Rigel"
                    maxLength={100}
                />
            </label>
            {error && <p className="info-error">{error}</p>}
        </form>
    )
}
