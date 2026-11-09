import './App.css'

import { useState } from 'react'

import imagePostProcessingIcon from './assets/icons/img-post-processing.svg'
import measureIcon from './assets/icons/measure.svg'
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
        description: 'Applying post-processing effects to viewport image.',
        properties: [
            { key: 'brightness', label: 'Brightness', type: 'slider', value: 100, min: 0, max: 200, step: 1 },
            { key: 'contrast', label: 'Contrast', type: 'slider', value: 50, min: 0, max: 100, step: 1 },
            { key: 'saturation', label: 'Saturation', type: 'slider', value: 50, min: 0, max: 100, step: 1 },
        ],
    },
    {
        id: 'measure',
        label: 'Measure',
        icon: measureIcon,
        description: 'Measure the distance between objects in the viewport.',
        properties: [],
    },
]

export default function App()
{
    const [tools, setTools] = useState<ToolDefinition[]>(TOOL_LIBRARY)
    const [selectedToolId, setSelectedToolId] = useState(TOOL_LIBRARY[0].id)

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
                <Header />
                <DefaultLayout
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
