import './Sidebar.css'

import type { ReactNode } from 'react'

import type { ViewportImageInfo, ViewTarget } from '../api/spherex'
import TargetForm from './TargetForm'

type SidebarProps = {
    info:           ViewportImageInfo | null
    target:         ViewTarget
    onTargetChange: (target: ViewTarget) => void
}

type Value = string | number | boolean | null | undefined

function fmt(value: Value, digits = 4): string
{
    if (value === null || value === undefined || value === '')
        return '—'
    if (typeof value === 'number')
        return Number.isInteger(value) ? String(value) : value.toFixed(digits)
    return String(value)
}

function fmtDate(iso: string | null | undefined): string
{
    if (!iso)
        return '—'
    const date = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z')
    return Number.isNaN(date.getTime())
        ? iso
        : date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

function Row({ label, value, unit }: { label: string, value: ReactNode, unit?: string })
{
    return (
        <div className="info-row">
            <dt>{label}</dt>
            <dd>
                {value}
                {unit && <span className="info-unit"> {unit}</span>}
            </dd>
        </div>
    )
}

function Section({ title, children, collapsed = false }: { title: string, children: ReactNode, collapsed?: boolean })
{
    return (
        <details className="info-section" open={!collapsed}>
            <summary>{title}</summary>
            <dl>{children}</dl>
        </details>
    )
}

function KeyValues({ entries }: { entries: Record<string, Value> })
{
    const keys = Object.keys(entries)
    if (keys.length === 0)
        return <Row label="—" value="none" />
    return <>{keys.map((key) => <Row key={key} label={key} value={fmt(entries[key], 6)} />)}</>
}

export default function Sidebar({ info, target, onTargetChange }: SidebarProps)
{
    const form = (
        <TargetForm target={target} loading={info?.status === 'loading'} onChange={onTargetChange} />
    )

    if (!info)
        return <div className="sidebar">{form}<p className="info-status">No image loaded.</p></div>

    const { image, meta } = info
    const observation = meta?.observation
    const stats = meta?.stats

    return (
        <div className="sidebar">
            {form}

            <div className="sidebar-header">
                <h2>Image Info</h2>
                <span className={`info-badge info-badge-${info.status}`}>{info.status}</span>
            </div>

            {info.status === 'error' && <p className="info-error">{info.error}</p>}
            {info.status === 'loading' && (
                <p className="info-status">
                    {image ? 'Loading cutout…' : 'Searching images (first search can take ~20 s)…'}
                </p>
            )}

            <Section title="Position">
                <Row label="RA"  value={fmt(info.ra, 6)}  unit="deg" />
                <Row label="Dec" value={fmt(info.dec, 6)} unit="deg" />
                <Row label="FOV" value={fmt(info.sizeArcsec)} unit="arcsec" />
                {info.totalImages !== undefined && (
                    <Row label="Image" value={`${(info.index ?? 0) + 1} of ${info.totalImages}`} />
                )}
            </Section>

            {image && (
                <Section title="Observation">
                    <Row label="Obs ID"     value={fmt(image.obs_id)} />
                    <Row label="Collection" value={fmt(image.collection)} />
                    <Row label="Detector"   value={fmt(image.detector)} />
                    <Row label="Band"       value={fmt(image.band)} />
                    <Row label="Start"      value={fmtDate(image.time_start)} />
                    <Row label="End"        value={fmtDate(image.time_end)} />
                    <Row label="Mid"        value={fmtDate(observation?.date_mid)} />
                    <Row label="MJD (mid)"  value={fmt(observation?.mjd_mid ?? image.mjd_mid, 5)} />
                    <Row label="Exposure"   value={fmt(observation?.exposure_s ?? image.exposure_s, 1)} unit="s" />
                    {image.epoch !== undefined && <Row label="Epoch" value={fmt(image.epoch)} />}
                </Section>
            )}

            {image && (
                <Section title="Wavelength">
                    <Row label="At target"  value={fmt(meta?.wavelength_um ?? image.wavelength_um)} unit="µm" />
                    <Row label="Bandwidth"  value={fmt(meta?.bandwidth_um)} unit="µm" />
                    <Row label="Detector range"
                         value={`${fmt(image.wavelength_min_um, 3)} – ${fmt(image.wavelength_max_um, 3)}`}
                         unit="µm" />
                </Section>
            )}

            {meta && (
                <Section title="Image">
                    <Row label="Size"        value={`${meta.width} × ${meta.height}`} unit="px" />
                    <Row label="Extension"   value={meta.extension} />
                    <Row label="Aligned"     value={meta.aligned ? 'yes (north up)' : 'no (detector frame)'} />
                    <Row label="Pixel scale" value={fmt(meta.pixel_scale_arcsec, 2)} unit="arcsec/px" />
                    <Row label="Units"       value={fmt(meta.header.BUNIT)} />
                </Section>
            )}

            {stats && (
                <Section title="Pixel Statistics">
                    <Row label="Min" value={fmt(stats.min)} unit="MJy/sr" />
                    <Row label="Max" value={fmt(stats.max)} unit="MJy/sr" />
                    {Object.entries(stats.percentiles).map(([p, v]) => (
                        <Row key={p} label={`${p}th pct`} value={fmt(v)} unit="MJy/sr" />
                    ))}
                </Section>
            )}

            {meta && (
                <Section title="FITS Header" collapsed>
                    <KeyValues entries={meta.header} />
                </Section>
            )}

            {meta && (
                <Section title="WCS" collapsed>
                    <KeyValues entries={meta.wcs} />
                </Section>
            )}

            {image && (
                <Section title="Source" collapsed>
                    <Row label="Access URL"
                         value={<a href={image.access_url} target="_blank" rel="noreferrer">{image.access_url}</a>} />
                </Section>
            )}
        </div>
    )
}
