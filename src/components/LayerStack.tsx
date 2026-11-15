import './LayerStack.css'

import { useState } from 'react'

import { LAYER_TYPES, PRESETS, createLayer, layerType, type Layer, type LayerType, type ParamDef } from '../processing'

type LayerStackProps = {
    layers:   Layer[]
    onChange: (layers: Layer[]) => void
}

const OPACITY: ParamDef = { key: 'opacity', label: 'Opacity %', min: 0, max: 100, step: 1, default: 100 }

/** One setting on one line: label, slider (or menu), value. */
function Param({ def, value, onChange }: { def: ParamDef, value: number | string, onChange: (value: number | string) => void })
{
    if ('options' in def)
    {
        return (
            <label className="layer-param">
                <span className="layer-param-label">{def.label}</span>
                <select className="layer-select layer-param-wide" value={String(value)} onChange={(e) => onChange(e.target.value)}>
                    {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </label>
        )
    }
    const n = Number(value)
    return (
        <label className="layer-param">
            <span className="layer-param-label">{def.label}</span>
            <input type="range" min={def.min} max={def.max} step={def.step} value={n}
                   onChange={(e) => onChange(Number(e.target.value))} />
            <input type="number" className="layer-param-number" min={def.min} max={def.max} step={def.step} value={n}
                   aria-label={def.label}
                   onChange={(e) =>
                   {
                       const next = Number(e.target.value)
                       if (e.target.value !== '' && Number.isFinite(next))
                           onChange(Math.min(def.max, Math.max(def.min, next)))
                   }} />
        </label>
    )
}

/** Settings in a few characters, for a collapsed layer: "Radius 1 · 50%". */
function summary(layer: Layer): string
{
    const parts = layerType(layer.type).params.map((p) =>
        'options' in p ? (p.options.find((o) => o.value === layer.params[p.key])?.label ?? '') : `${p.label.replace(/ \(.*\)$/, '')} ${+Number(layer.params[p.key]).toFixed(2)}`)
    if (layer.opacity < 1)
        parts.push(`${Math.round(layer.opacity * 100)}%`)
    return parts.join(' · ')
}

/**
 * The post-processing stack, drawn as a pipeline: the source image flows down through each
 * layer in turn (each one works on the previous one's result) and the last result is shown.
 */
export default function LayerStack({ layers, onChange }: LayerStackProps)
{
    // Open cards; a layer added from the menu opens so it can be tuned, preset layers start closed.
    const [open, setOpen] = useState<Set<string>>(new Set())
    const toggle = (id: string) => setOpen((s) => { const next = new Set(s); if (!next.delete(id)) next.add(id); return next })

    const update = (id: string, patch: Partial<Layer>) => onChange(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    const move = (index: number, by: -1 | 1) =>
    {
        const next = [...layers]
        const [layer] = next.splice(index, 1)
        next.splice(index + by, 0, layer)
        onChange(next)
    }
    const add = (type: LayerType) =>
    {
        const layer = createLayer(type)
        setOpen((s) => new Set(s).add(layer.id))
        onChange([...layers, layer])
    }

    return (
        <div className="layer-stack">
            <div className="layer-toolbar">
                <select className="layer-select layer-add" value="" aria-label="Add a layer at the end"
                        onChange={(e) => { if (e.target.value) add(e.target.value as LayerType) }}>
                    <option value="">+ Add layer…</option>
                    {LAYER_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
                <select className="layer-select" value="" aria-label="Load a preset (replaces the layers)"
                        title="Load a ready-made stack. Replaces the current layers."
                        onChange={(e) => { const p = PRESETS[Number(e.target.value)]; if (p) { setOpen(new Set()); onChange(p.layers()) } }}>
                    <option value="">Presets…</option>
                    {PRESETS.map((p, i) => <option key={p.label} value={i} title={p.description}>{p.label}</option>)}
                </select>
                <button type="button" className="layer-chip" onClick={() => onChange([])} disabled={layers.length === 0}
                        title={layers.length ? 'Remove every layer' : 'No layers to clear'}>
                    Clear
                </button>
            </div>

            <ol className="layer-flow" aria-label="Processing order: each step works on the result of the step above">
                <li className="layer-node">Source image</li>

                {layers.map((layer, index) =>
                {
                    const def = layerType(layer.type)
                    const expanded = open.has(layer.id)
                    return (
                        <li key={layer.id} className="layer-step">
                            <span className="layer-arrow" aria-hidden="true">↓ then</span>
                            <div className={layer.enabled ? 'layer-card' : 'layer-card layer-off'}>
                                <div className="layer-head">
                                    <input type="checkbox" checked={layer.enabled} aria-label={`Apply ${def.label}`}
                                           title={layer.enabled ? 'Skip this step' : 'Apply this step'}
                                           onChange={(e) => update(layer.id, { enabled: e.target.checked })} />
                                    <button type="button" className="layer-title" aria-expanded={expanded}
                                            title={def.description} onClick={() => toggle(layer.id)}>
                                        <span className="layer-index">{index + 1}</span>
                                        <span className="layer-name">{def.label}</span>
                                        {!expanded && <span className="layer-summary">{summary(layer)}</span>}
                                        <span className="layer-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                                    </button>
                                    <button type="button" className="layer-icon" disabled={index === 0}
                                            aria-label={`Move ${def.label} earlier`} title="Apply earlier"
                                            onClick={() => move(index, -1)}>↑</button>
                                    <button type="button" className="layer-icon" disabled={index === layers.length - 1}
                                            aria-label={`Move ${def.label} later`} title="Apply later"
                                            onClick={() => move(index, 1)}>↓</button>
                                    <button type="button" className="layer-icon" aria-label={`Remove ${def.label}`} title="Remove"
                                            onClick={() => onChange(layers.filter((l) => l.id !== layer.id))}>✕</button>
                                </div>
                                {expanded && (
                                    <div className="layer-body">
                                        <p className="layer-description">{def.description}</p>
                                        {def.params.map((param) => (
                                            <Param key={param.key} def={param} value={layer.params[param.key]}
                                                   onChange={(value) => update(layer.id, { params: { ...layer.params, [param.key]: value } })} />
                                        ))}
                                        <Param def={OPACITY} value={Math.round(layer.opacity * 100)}
                                               onChange={(value) => update(layer.id, { opacity: Number(value) / 100 })} />
                                    </div>
                                )}
                            </div>
                        </li>
                    )
                })}

                <li className="layer-step">
                    <span className="layer-arrow" aria-hidden="true">↓</span>
                    <span className="layer-node layer-node-end">
                        {layers.some((l) => l.enabled) ? 'Shown in the viewport' : 'Shown in the viewport, unchanged'}
                    </span>
                </li>
            </ol>
        </div>
    )
}
