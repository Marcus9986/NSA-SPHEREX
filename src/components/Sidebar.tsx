import './Sidebar.css'

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import type { ImageMeta, ViewportImageInfo, ViewTarget } from '../api/spherex'
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

function Row({ label, value, unit, note, dim = false }:
    { label: string, value: ReactNode, unit?: string, note?: string | null, dim?: boolean })
{
    return (
        <div className={dim ? 'info-row info-row-dim' : 'info-row'}>
            <dt>{label}</dt>
            <dd>
                {value}
                {unit && <span className="info-unit"> {unit}</span>}
            </dd>
            {note && <div className="info-note">{note}</div>}
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

const percent = (n: number, total: number) => (total ? `${+((100 * n) / total).toFixed(2)}%` : '—')

/** Pixels in the cutout with each quality flag, described in SPHEREx's own words (from the file). */
function QualityFlags({ flags }: { flags: ImageMeta['flags'] })
{
    const { total_pixels: total, flagged_pixels: flagged, planes } = flags
    return (
        <Section title="Quality Flags">
            <Row label="Any flag" value={`${flagged} of ${total}`} unit={`px (${percent(flagged, total)})`} />
            {planes.map((p) => (
                <Row key={p.bit} label={p.name} value={p.pixels} unit={`px (${percent(p.pixels, total)})`}
                     note={`Bit ${p.bit}${p.description ? ` · ${p.description}` : ''}`} dim={p.pixels === 0} />
            ))}
        </Section>
    )
}

/**
 * Every keyword of every extension in the cutout file, in one collapsible section:
 * a search box (keywords, values and comments), then each extension under a subheading.
 */
function FitsHeaders({ headers }: { headers: ImageMeta['headers'] })
{
    const [query, setQuery] = useState('')
    const q = query.trim().toLowerCase()
    const matches = (c: ImageMeta['headers'][number]['cards'][number]) =>
        !q || `${c.key} ${c.value ?? ''} ${c.comment ?? ''}`.toLowerCase().includes(q)
    const total = headers.reduce((n, h) => n + h.cards.length, 0)
    const groups = headers.map((h) => ({ ...h, shown: h.cards.filter(matches) })).filter((h) => h.shown.length > 0)
    const shownCount = groups.reduce((n, h) => n + h.shown.length, 0)

    return (
        <Section title={`FITS Headers (${q ? `${shownCount} of ` : ''}${total})`} collapsed>
            <div className="info-search-row">
                <input
                    type="search"
                    className="info-search"
                    placeholder={`Search ${total} keywords in ${headers.length} extensions…`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search FITS header keywords, values and comments"
                />
            </div>
            {groups.map((h) => (
                <div key={h.index} className="info-group">
                    <div className="info-group-title">
                        {h.name} <span>{q ? `${h.shown.length} of ` : ''}{h.cards.length}</span>
                    </div>
                    {h.shown.map((c, i) => (
                        <Row key={`${c.key}-${i}`} label={c.key} value={fmt(c.value, 6)} note={c.comment} />
                    ))}
                </div>
            ))}
            {q && groups.length === 0 && <p className="info-status">No keyword matches “{query}”.</p>}
        </Section>
    )
}

// A section counts as on screen while this much of its title bar is visible (px).
const NAV_VISIBLE_PX = 12
// A button only shows when its section's title is at least this share of the sidebar's
// height beyond the visible part.
const NAV_FAR_SHARE = 0.25

/**
 * Up / down buttons over the sidebar that scroll to the previous / next section. Each
 * shows only while that section's title is well off screen (above / below the visible part).
 */
function SectionNav({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> })
{
    const [targets, setTargets] = useState<{ up: HTMLElement | null, down: HTMLElement | null }>({ up: null, down: null })

    useEffect(() =>
    {
        const scroller = scrollRef.current
        if (!scroller)
            return
        const update = () =>
        {
            const view = scroller.getBoundingClientRect()
            const sections = [...scroller.querySelectorAll<HTMLElement>('details.info-section')]
            const tops = sections.map((s) => s.getBoundingClientRect().top)
            // Up: the last section whose title is above the view; down: the first whose title is below it.
            let up = -1, down = -1
            tops.forEach((top, i) =>
            {
                if (top < view.top - 1) up = i
                else if (down < 0 && top > view.bottom - NAV_VISIBLE_PX) down = i
            })
            // Only worth a button when it's well off screen: a short scroll reaches it anyway.
            const far = view.height * NAV_FAR_SHARE
            setTargets({
                up:   up >= 0 && view.top - tops[up] >= far ? sections[up] : null,
                down: down >= 0 && tops[down] - view.bottom >= far ? sections[down] : null,
            })
        }
        update()
        // Scrolling, resizing, sections opening / closing and content arriving all move them.
        const resize = new ResizeObserver(update)
        resize.observe(scroller)
        const mutations = new MutationObserver(update)
        mutations.observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
        scroller.addEventListener('scroll', update, { passive: true })
        return () =>
        {
            resize.disconnect()
            mutations.disconnect()
            scroller.removeEventListener('scroll', update)
        }
    }, [scrollRef])

    const go = (section: HTMLElement | null) =>
    {
        const scroller = scrollRef.current
        if (!section || !scroller)
            return
        const offset = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        scroller.scrollBy({ top: offset - 8, behavior: 'smooth' })   // 8 px: a little space above it
    }
    const title = (s: HTMLElement | null) => s?.querySelector('summary')?.textContent ?? ''

    return (
        <>
            {targets.up && (
                <button type="button" className="section-nav section-nav-up" onClick={() => go(targets.up)}
                        aria-label={`Scroll up to ${title(targets.up)}`} title={title(targets.up)}>
                    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5" /></svg>
                    <span>{title(targets.up)}</span>
                </button>
            )}
            {targets.down && (
                <button type="button" className="section-nav section-nav-down" onClick={() => go(targets.down)}
                        aria-label={`Scroll down to ${title(targets.down)}`} title={title(targets.down)}>
                    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
                    <span>{title(targets.down)}</span>
                </button>
            )}
        </>
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
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const form = (
        <TargetForm target={target} loading={info?.status === 'loading'} onChange={onTargetChange} />
    )

    if (!info)
        return <div className="sidebar">{form}<p className="info-status">No image loaded.</p></div>

    const { image, meta } = info
    const observation = meta?.observation
    const stats = meta?.stats

    return (
        <div className="sidebar-wrap">
        <SectionNav scrollRef={scrollRef} />
        <div className="sidebar" ref={scrollRef}>
            {form}

            <div className="sidebar-header">
                <h2>Image Metadata</h2>
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

            {meta?.flags && <QualityFlags flags={meta.flags} />}

            {image && (
                <Section title="Archive Record" collapsed>
                    <KeyValues entries={image as unknown as Record<string, Value>} />
                </Section>
            )}

            {meta?.headers && <FitsHeaders headers={meta.headers} />}

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
        </div>
    )
}
