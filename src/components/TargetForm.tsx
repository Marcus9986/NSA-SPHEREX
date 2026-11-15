import { useEffect, useState, type FormEvent } from 'react'

import { MAX_FOV_ARCSEC, MIN_FOV_ARCSEC, parseCoordinate, type ViewTarget } from '../api/spherex'

type TargetFormProps = {
    target:   ViewTarget
    loading:  boolean
    onChange: (target: ViewTarget) => void
}

const FOV_PRESETS = [60, 300, 900, 1800, 3600]

function clampFov(value: number): number
{
    return Math.round(Math.min(MAX_FOV_ARCSEC, Math.max(MIN_FOV_ARCSEC, value)))
}

/** Human-readable FOV: "30 arcsec", "5 arcmin", "1 deg". */
function fovLabel(arcsec: number): string
{
    if (arcsec >= 3600)
        return `${+(arcsec / 3600).toFixed(2)} deg`
    if (arcsec >= 60)
        return `${+(arcsec / 60).toFixed(1)} arcmin`
    return `${arcsec} arcsec`
}

/** FOV in degrees, for the hint under the slider. */
function fovDegrees(arcsec: number): string
{
    return `${+(arcsec / 3600).toFixed(4)}°`
}

// The three text parts of a sexagesimal coordinate: hours/degrees, minutes, seconds.
type Parts = [string, string, string]

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Split a value into whole units, minutes and seconds (seconds rounded to 3 places). */
function splitSexagesimal(value: number): [number, number, number]
{
    const totalMs = Math.round(Math.abs(value) * 3600 * 1000)
    const whole   = Math.floor(totalMs / 3_600_000)
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
    const seconds = (totalMs % 60_000) / 1000
    return [whole, minutes, seconds]
}

function raToParts(raDeg: number): Parts
{
    const [h, m, s] = splitSexagesimal(raDeg / 15)
    return [pad2(h % 24), pad2(m), s.toFixed(3)]
}

function decToParts(decDeg: number): Parts
{
    const [d, m, s] = splitSexagesimal(decDeg)
    return [(decDeg < 0 ? '-' : '') + pad2(d), pad2(m), s.toFixed(3)]
}

/** Parse the parts back into degrees, or null if any part is out of range. */
function partsToDegrees(parts: Parts, kind: 'ra' | 'dec'): number | null
{
    const [first, min, sec] = parts.map((p) => p.trim())
    if (!/^[+-]?\d+$/.test(first) || !/^\d+$/.test(min || '0') || !/^\d+(\.\d*)?$/.test(sec || '0'))
        return null

    const whole = Math.abs(Number(first))
    const m = Number(min || 0)
    const s = Number(sec || 0)
    if (m >= 60 || s >= 60)
        return null

    if (kind === 'ra')
    {
        if (first.startsWith('-') || whole >= 24)
            return null
        return (whole + m / 60 + s / 3600) * 15
    }

    // Read the sign from the text so "-00 30 00" stays negative.
    const value = (first.startsWith('-') ? -1 : 1) * (whole + m / 60 + s / 3600)
    return Math.abs(value) <= 90 ? value : null
}

type SexagesimalInputProps = {
    parts:    Parts
    units:    [string, string, string]
    kind:     'ra' | 'dec'
    invalid:  boolean
    label:    string
    onChange: (parts: Parts) => void
}

function SexagesimalInput({ parts, units, kind, invalid, label, onChange }: SexagesimalInputProps)
{
    const widths = ['3ch', '2.5ch', '6ch']

    const setPart = (index: number, text: string) =>
    {
        const next = [...parts] as Parts
        next[index] = text
        onChange(next)
    }

    // Pasting a whole coordinate ("20 18 46.4", "20h18m46s", "304.69") fills every box.
    const onPaste = (event: React.ClipboardEvent<HTMLInputElement>) =>
    {
        const text = event.clipboardData.getData('text')
        if (!/[\s:hdms°]/i.test(text.trim()) && !/^[+-]?\d+\.\d+$/.test(text.trim()))
            return
        const degrees = parseCoordinate(text, kind)
        if (degrees === null)
            return
        event.preventDefault()
        onChange(kind === 'ra' ? raToParts(degrees) : decToParts(degrees))
    }

    return (
        <div className="sexagesimal" aria-invalid={invalid} role="group" aria-label={label}>
            {parts.map((value, i) => (
                <label key={i} className="sexagesimal-part">
                    <input
                        type="text"
                        inputMode="decimal"
                        value={value}
                        style={{ width: widths[i] }}
                        onChange={(e) => setPart(i, e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onPaste={onPaste}
                        aria-label={`${label} ${['hours', 'minutes', 'seconds'][i]}`}
                        spellCheck={false}
                    />
                    <span className="sexagesimal-unit">{units[i]}</span>
                </label>
            ))}
        </div>
    )
}

export default function TargetForm({ target, loading, onChange }: TargetFormProps)
{
    const [raParts,  setRaParts]  = useState<Parts>(() => raToParts(target.ra))
    const [decParts, setDecParts] = useState<Parts>(() => decToParts(target.dec))
    const [fov,      setFov]      = useState(target.fovArcsec)

    // Keep the inputs in sync if the target is changed from elsewhere.
    useEffect(() =>
    {
        setRaParts(raToParts(target.ra))
        setDecParts(decToParts(target.dec))
        setFov(target.fovArcsec)
    }, [target])

    const ra  = partsToDegrees(raParts, 'ra')
    const dec = partsToDegrees(decParts, 'dec')
    const valid = ra !== null && dec !== null

    const apply = (nextFov = fov) =>
    {
        if (ra === null || dec === null)
            return
        const next = { ra, dec, fovArcsec: clampFov(nextFov) }
        // The boxes round seconds to 3 decimals, so treat sub-milliarcsecond
        // differences as "unchanged" instead of reloading the same spot.
        const moved = Math.abs(next.ra - target.ra) > 1e-6 || Math.abs(next.dec - target.dec) > 1e-6
        if (moved)
            onChange(next)
        else if (next.fovArcsec !== target.fovArcsec)
            onChange({ ...target, fovArcsec: next.fovArcsec })
    }

    const onSubmit = (event: FormEvent) =>
    {
        event.preventDefault()
        apply()
    }

    // FOV changes only need a new cutout, so apply them right away
    // when a preset is picked or the slider is released.
    const applyFov = (value: number) =>
    {
        const clamped = clampFov(value)
        setFov(clamped)
        apply(clamped)
    }

    return (
        <form className="target-form info-section" onSubmit={onSubmit}>
            <div className="target-form-title">Target</div>

            <div className="target-field">
                <span>Right Ascension</span>
                <SexagesimalInput
                    parts={raParts}
                    units={['h', 'm', 's']}
                    kind="ra"
                    invalid={ra === null}
                    label="Right ascension"
                    onChange={setRaParts}
                />
            </div>

            <div className="target-field">
                <span>Declination</span>
                <SexagesimalInput
                    parts={decParts}
                    units={['d', 'm', 's']}
                    kind="dec"
                    invalid={dec === null}
                    label="Declination"
                    onChange={setDecParts}
                />
            </div>

            <div className="target-field">
                <span>Field of View</span>
                <div className="target-fov-row">
                    <input
                        type="range"
                        min={MIN_FOV_ARCSEC}
                        max={MAX_FOV_ARCSEC}
                        step={10}
                        value={fov}
                        onChange={(e) => setFov(Number(e.target.value))}
                        onPointerUp={(e) => applyFov(Number(e.currentTarget.value))}
                        onKeyUp={(e) => applyFov(Number(e.currentTarget.value))}
                        aria-label="Field of view in arcseconds"
                    />
                    <input
                        type="number"
                        className="target-fov-number"
                        min={MIN_FOV_ARCSEC}
                        max={MAX_FOV_ARCSEC}
                        step={10}
                        value={fov}
                        onChange={(e) => setFov(Number(e.target.value))}
                        onBlur={(e) => setFov(clampFov(Number(e.target.value)))}
                        aria-label="Field of view in arcseconds"
                    />
                    <span className="info-unit">arcsec</span>
                </div>
                <span className="target-hint">
                    = {fovLabel(fov)} ({fovDegrees(fov)}) · ~{Math.round(fov / 6.15)} px across
                </span>
            </div>

            <div className="target-presets">
                {FOV_PRESETS.map((preset) => (
                    <button
                        key={preset}
                        type="button"
                        className={preset === target.fovArcsec ? 'target-preset target-preset-active' : 'target-preset'}
                        onClick={() => applyFov(preset)}
                        disabled={!valid}
                        title={`${preset} arcsec = ${fovDegrees(preset)}`}
                    >
                        {fovLabel(preset)}
                    </button>
                ))}
            </div>

            <button type="submit" className="target-submit" disabled={!valid}>
                {loading ? 'Loading…' : 'Load'}
            </button>
        </form>
    )
}
