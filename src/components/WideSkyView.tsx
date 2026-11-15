import './WideSkyView.css'

import { useEffect, useRef, useState } from 'react'
import type { Aladin, AladinCatalog, AladinOverlay } from 'aladin-lite'

import { formatAngle, greatCirclePoint, separation, standardCoordinates } from '../sky'
import type { Measurement } from './MeasureOverlay'

// SPHEREx all-sky maps (HiPS) published by CDS, one per detector; wavelength ranges from
// the HiPS registry. They're seamless mosaics of every SPHEREx frame, at every zoom level.
const BANDS = [
    { id: 'D1', range: '0.75–1.10 µm' }, { id: 'D2', range: '1.10–1.62 µm' }, { id: 'D3', range: '1.63–2.41 µm' },
    { id: 'D4', range: '2.42–3.82 µm' }, { id: 'D5', range: '3.83–4.41 µm' }, { id: 'D6', range: '4.42–5.00 µm' },
]
const hipsId = (band: string) => `CDS/P/SPHEREx/QR2/${band}`
// Where CDS serves each map (main site, then its mirror), to check it's reachable.
const HIPS_SERVERS = ['https://alasky.cds.unistra.fr', 'https://alaskybis.cds.unistra.fr']

/**
 * Field of view (degrees, across the map's width) that fits the whole line with a margin,
 * whether it runs across or up the map. Offsets are taken around the midpoint.
 */
function fitFov(m: Measurement, aspect: number): number
{
    const mid = greatCirclePoint(m.a, m.b, 0.5)
    const sepDeg = separation(m.a, m.b).sepArcsec / 3600
    const [pa, pb] = [m.a, m.b].map((p) => standardCoordinates(p.ra, p.dec, mid.ra, mid.dec))
    // Projected offsets stop meaning much for very long lines; fall back to the length.
    const across = sepDeg < 60 ? Math.abs(pa.xi - pb.xi) / 3600 : sepDeg
    const up     = sepDeg < 60 ? Math.abs(pa.eta - pb.eta) / 3600 : sepDeg
    return Math.min(180, Math.max(0.1, Math.max(across, up * aspect) * 1.3))
}

// Aladin draws a polyline segment by segment, restarting the dash pattern each time, so the
// dashes are drawn as separate pieces of the great circle: DASHES of them, with gaps between.
const DASHES = 45

type WideSkyViewProps = {
    measurement: Measurement
    onClose:     () => void
}

/**
 * The measurement over SPHEREx's all-sky map, for lines longer than one image: zoomed out
 * to fit, then free to scroll and zoom. Drawn by Aladin Lite (CDS), loaded on first use.
 */
export default function WideSkyView({ measurement, onClose }: WideSkyViewProps)
{
    const divRef = useRef<HTMLDivElement | null>(null)
    const [aladin, setAladin] = useState<Aladin | null>(null)
    const [band, setBand]     = useState('D1')
    const [error, setError]   = useState<string | null>(null)
    const [offline, setOffline] = useState(false)   // CDS's map server isn't answering
    const aspect = () => (divRef.current ? divRef.current.clientWidth / Math.max(1, divRef.current.clientHeight) : 1.5)

    // Start once, centred on the line's midpoint and zoomed out to fit it.
    const initial = useRef({ measurement, band })
    useEffect(() =>
    {
        let cancelled = false
        import('aladin-lite')
            .then(async ({ default: A }) =>
            {
                await A.init
                if (cancelled || !divRef.current)
                    return
                const { measurement: m, band: b } = initial.current
                const mid = greatCirclePoint(m.a, m.b, 0.5)
                setAladin(A.aladin(divRef.current, {
                    survey: hipsId(b), target: `${mid.ra} ${mid.dec}`, fov: fitFov(m, aspect()), cooFrame: 'ICRS',
                    projection: 'SIN', backgroundColor: 'rgb(5, 8, 15)',
                    showReticle: false, showLayersControl: false, showFullscreenControl: false,
                    showProjectionControl: false, showFrame: false, showContextMenu: false,
                }))
            })
            .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
        return () => { cancelled = true }
    }, [])

    useEffect(() => { aladin?.setImageSurvey(hipsId(band)) }, [aladin, band])

    // Aladin just shows "loading" forever if the map server is down, so check it ourselves.
    useEffect(() =>
    {
        let cancelled = false
        const reachable = (server: string) => fetch(`${server}/SPHEREx/${band}/properties`).then((r) => r.ok, () => false)
        Promise.all(HIPS_SERVERS.map(reachable)).then((ok) => { if (!cancelled) setOffline(!ok.some(Boolean)) })
        return () => { cancelled = true }
    }, [band])

    // The line (sampled along the great circle so it curves correctly) and its labelled ends.
    const layers = useRef<{ line: AladinOverlay, ends: AladinCatalog } | null>(null)
    useEffect(() =>
    {
        if (!aladin)
            return
        let cancelled = false
        import('aladin-lite').then(({ default: A }) =>
        {
            if (cancelled)
                return
            if (layers.current)
            {
                aladin.removeOverlay(layers.current.line)
                aladin.removeOverlay(layers.current.ends)
            }
            const { a, b, aName, bName } = measurement
            const line = A.graphicOverlay({ name: 'Measurement', color: '#34d399', lineWidth: 2 })
            aladin.addOverlay(line)
            for (let d = 0; d < DASHES; d++)
            {
                // Dash d covers 60% of its slot; a few points each so it follows the curve.
                const start = d / DASHES, length = 0.6 / DASHES
                line.add(A.polyline([0, 0.5, 1].map((f) =>
                {
                    const p = greatCirclePoint(a, b, start + f * length)
                    return [p.ra, p.dec] as [number, number]
                })))
            }
            const ends = A.catalog({ name: 'Ends', color: '#34d399', sourceSize: 12, shape: 'circle',
                                     displayLabel: true, labelColumn: 'name', labelColor: '#6ee7b7', labelFont: '12px sans-serif' })
            aladin.addCatalog(ends)
            ends.addSources([A.source(a.ra, a.dec, { name: aName ?? 'From' }), A.source(b.ra, b.dec, { name: bName ?? 'To' })])
            layers.current = { line, ends }
        })
        return () => { cancelled = true }
    }, [aladin, measurement])

    const fit = () =>
    {
        const mid = greatCirclePoint(measurement.a, measurement.b, 0.5)
        aladin?.gotoRaDec(mid.ra, mid.dec)
        aladin?.setFoV(fitFov(measurement, aspect()))
    }

    return (
        <div className="wide-sky" role="dialog" aria-label="Measurement on the SPHEREx all-sky map">
            <div className="wide-sky-bar">
                <span className="wide-sky-title">
                    {measurement.aName ?? 'From'} → {measurement.bName ?? 'To'}
                    <strong>{formatAngle(separation(measurement.a, measurement.b).sepArcsec)}</strong>
                </span>
                <label className="wide-sky-band">
                    <span>SPHEREx</span>
                    <select value={band} onChange={(e) => setBand(e.target.value)} aria-label="SPHEREx detector band">
                        {BANDS.map((b2) => <option key={b2.id} value={b2.id}>{b2.id} · {b2.range}</option>)}
                    </select>
                </label>
                <button type="button" onClick={fit} disabled={!aladin}>Fit line</button>
                <button type="button" onClick={onClose} className="wide-sky-close">Back to frame</button>
            </div>
            <div ref={divRef} className="wide-sky-map" />
            {!aladin && !error && <div className="wide-sky-status" role="status">Loading the SPHEREx sky map…</div>}
            {aladin && offline && (
                <div className="wide-sky-status wide-sky-error" role="alert">
                    CDS's sky-map server isn't responding right now, so the SPHEREx imagery can't load. The line and
                    labels are still shown; try again later.
                </div>
            )}
            {error && <div className="wide-sky-status wide-sky-error" role="alert">Couldn't load the sky map: {error}</div>}
        </div>
    )
}
