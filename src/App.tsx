import './App.css'

import { useState } from 'react'

import imagePostProcessingIcon from './assets/icons/img-post-processing.svg'
import measureIcon from './assets/icons/measure.svg'
import type { ResolvedObject, ViewTarget } from './api/spherex'
import Header from './components/Header'
import DefaultLayout from './layouts/DefaultLayout'

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

    // Sky position and field of view the viewport loads; edited in the sidebar, the gizmo and the header search.
    const [target, setTarget] = useState<ViewTarget>({
        ra:        304.6935088,
        dec:       42.4436872991,
        fovArcsec: 300,
    })

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
                <Header
                    onLocate={(object) => { setLocated(object); setTarget((t) => ({ ...t, ra: object.ra, dec: object.dec })) }}
                    onClear={() => setLocated(null)}
                />
                <DefaultLayout
                    target={target}
                    setTarget={setTarget}
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
