import './Layout.css'
import './DefaultLayout.css'

import { useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'

import type { ToolDefinition } from '../App'
import type { ViewportImageInfo, ViewTarget } from '../api/spherex'
import Sidebar from '../components/Sidebar'
import Viewport from '../components/Viewport'
import Toolbar from '../components/Toolbar'
import PlaybackPanel from '../components/PlaybackPanel'
import PropertiesPanel from '../components/PropertiesPanel'

type DefaultLayoutProps = {
    tools: ToolDefinition[]
    selectedToolId: string
    onSelectTool: (toolId: string) => void
    selectedTool: ToolDefinition
    onPropertyChange: (propertyKey: string, nextValue: string | number | boolean) => void
}

export default function DefaultLayout({
    tools,
    selectedToolId,
    onSelectTool,
    selectedTool,
    onPropertyChange,
}: DefaultLayoutProps)
{
    // Info about the image in the viewport, shown in the sidebar.
    const [imageInfo, setImageInfo] = useState<ViewportImageInfo | null>(null)

    // Sky position and field of view the viewport loads; edited in the sidebar.
    const [target, setTarget] = useState<ViewTarget>({
        ra:        304.6935088,
        dec:       42.4436872991,
        fovArcsec: 300,
    })

    return (
        <>
            <Group orientation="horizontal" className="workspace">
                <Panel defaultSize="300px" minSize="250px" className="panel sidebar-panel">
                    <Sidebar info={imageInfo} target={target} onTargetChange={setTarget} />
                </Panel>

                <Separator className="resize-handle" />

                <Panel defaultSize="60%" minSize="20%" className="panel main-panel">
                    <Group orientation="vertical">
                        <Panel className="panel viewport-panel">
                            <Viewport target={target} onImageInfo={setImageInfo} />
                        </Panel>

                        <Separator className="resize-handle" />

                        <Panel disabled defaultSize="120px" minSize="120px" maxSize="120px" className="panel playback-panel">
                            <PlaybackPanel />
                        </Panel>
                    </Group>
                </Panel>

                <Separator className="resize-handle" />

                <Panel defaultSize="350px" minSize="300px" className="panel right-panel">
                    <div className="right-panel-group">
                        <div className="toolbar-panel">
                            <Toolbar
                                tools={tools}
                                selectedToolId={selectedToolId}
                                onSelectTool={onSelectTool}
                            />
                        </div>

                        <div className="properties-panel">
                            <PropertiesPanel tool={selectedTool} onPropertyChange={onPropertyChange} />
                        </div>
                    </div>
                </Panel>
            </Group>
        </>
    )
}