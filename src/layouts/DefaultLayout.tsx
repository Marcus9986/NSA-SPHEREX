import './Layout.css'
import './DefaultLayout.css'

import { Group, Panel, Separator } from 'react-resizable-panels'

import type { ToolDefinition } from '../App'
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
    return (
        <>
            <Group orientation="horizontal" className="workspace">
                <Panel defaultSize="300px" minSize="250px" className="panel sidebar-panel">
                    <Sidebar />
                </Panel>

                <Separator className="resize-handle" />

                <Panel defaultSize="60%" minSize="20%" className="panel main-panel">
                    <Group orientation="vertical">
                        <Panel className="panel viewport-panel">
                            <Viewport />
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