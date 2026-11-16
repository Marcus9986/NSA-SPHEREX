import './App.css'

import { useEffect, useState } from 'react'

import imagePostProcessingIcon from './assets/icons/img-post-processing.svg'
import measureIcon from './assets/icons/measure.svg'
import type { ResolvedObject, ViewTarget } from './api/spherex'
import Header from './components/Header'
import DefaultLayout from './layouts/DefaultLayout'
import { readUrlState, writeUrlParams } from './urlState'

export type ToolProperty = {
    key: string
    label: string
    type: 'text' | 'number' | 'toggle' | 'slider'
    value: string | number | boolean
    min?: number
    max?: number
    step?: number
}

export type ToolDefinition = {
    id: string
    label: string
    icon: string
    description: string
    properties: ToolProperty[]
}

const TOOL_LIBRARY: ToolDefinition[] = [
    {
        id: 'img-post-processing',
        label: 'Image Post Processing',
        icon: imagePostProcessingIcon,
        description: 'Stack image-processing layers on the viewport image to bring out faint or moving objects.',
        properties: [],
    },
    {
        id: 'measure',
        label: 'Measure',
        icon: measureIcon,
        description: 'Measure the angular distance and direction between two points on the sky.',
        properties: [],
    },
]

export default function App()
{
    const [tools, setTools] = useState<ToolDefinition[]>(TOOL_LIBRARY)
    const [selectedToolId, setSelectedToolId] = useState(TOOL_LIBRARY[0].id)

    // View given in the page URL (?ra=&dec=&fov=&wavelength=), read once at start-up.
    const [fromUrl] = useState(() => readUrlState())

    // Sky position and field of view the viewport loads; edited in the sidebar, the gizmo and the header search.
    const [target, setTarget] = useState<ViewTarget>(() => ({
        ra:        fromUrl.ra ?? 304.6935088,
        dec:       fromUrl.dec ?? 42.4436872991,
        fovArcsec: fromUrl.fovArcsec ?? 300,
    }))

    // Keep the URL showing the current view, so it can be copied, shared or embedded.
    useEffect(() =>
    {
        writeUrlParams({ ra: String(+target.ra.toFixed(6)), dec: String(+target.dec.toFixed(6)),
                         fov: String(target.fovArcsec) })
    }, [target])

    // The last object found with the header search; marked on the image.
    const [located, setLocated] = useState<ResolvedObject | null>(null)

    const selectedTool =
        tools.find((tool) => tool.id === selectedToolId) ?? tools[0]

    const updateToolProperty = (propertyKey: string, nextValue: string | number | boolean) =>
    {
        setTools((previousTools) =>
            previousTools.map((tool) => {
                if (tool.id !== selectedToolId)
                {
                    return tool
                }

                return {
                    ...tool,
                    properties: tool.properties.map((property) =>
                        property.key === propertyKey
                            ? { ...property, value: nextValue }
                            : property,
                    ),
                }
            }),
        )
    }

    return (
        <>
            <div className="app">
                {/* Embedded on another site (?embed=1): just the viewport, no app chrome. */}
                {!fromUrl.embed && (
                    <Header
                        onLocate={(object) => { setLocated(object); setTarget((t) => ({ ...t, ra: object.ra, dec: object.dec })) }}
                        onClear={() => setLocated(null)}
                    />
                )}
                <DefaultLayout
                    target={target}
                    setTarget={setTarget}
                    initialView={fromUrl}
                    located={located}
                    tools={tools}
                    selectedToolId={selectedToolId}
                    onSelectTool={setSelectedToolId}
                    selectedTool={selectedTool}
                    onPropertyChange={updateToolProperty}
                />
            </div>
        </>
    )
}
