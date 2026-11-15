import './Layout.css'
import './DefaultLayout.css'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'

import type { ToolDefinition } from '../App'
import type { ResolvedObject, ViewTarget } from '../api/spherex'
import { useFrames } from '../hooks/useFrames'
import Sidebar from '../components/Sidebar'
import Viewport from '../components/Viewport'
import { PIXEL_SCALE_ARCSEC, greatCirclePoint, separation } from '../sky'
import { MeasureReadout, type Measurement } from '../components/MeasureOverlay'
import { ObjectDistance } from '../components/ObjectSearch'
import LayerStack from '../components/LayerStack'
import type { Layer } from '../processing'
import Toolbar from '../components/Toolbar'
import PlaybackPanel from '../components/PlaybackPanel'
import PropertiesPanel from '../components/PropertiesPanel'

type DefaultLayoutProps = {
    tools: ToolDefinition[]
    selectedToolId: string
    onSelectTool: (toolId: string) => void
    selectedTool: ToolDefinition
    onPropertyChange: (propertyKey: string, nextValue: string | number | boolean) => void
    target: ViewTarget   // sky position and field of view the viewport loads (owned by App: the header search moves it too)
    setTarget: Dispatch<SetStateAction<ViewTarget>>
    located: ResolvedObject | null   // object found with the header search, marked in the viewport
}

export default function DefaultLayout({
    tools,
    selectedToolId,
    onSelectTool,
    selectedTool,
    onPropertyChange,
    target,
    setTarget,
    located,
}: DefaultLayoutProps)
{

    // Images found at the target, the frame being shown and playback state,
    // shared by the viewport, the playback bar and the sidebar.
    const frames = useFrames(target)

    // The measure tool's ruler, drawn in the viewport and read out in the properties panel.
    const [measurement, setMeasurement] = useState<Measurement | null>(null)
    // The measurement over SPHEREx's all-sky map, for lines longer than one image.
    const [wideView, setWideView] = useState(false)

    // Post-processing layers applied to the viewport image, in order.
    const [layers, setLayers] = useState<Layer[]>([])

    return (
        <>
            <Group orientation="horizontal" className="workspace">
                <Panel defaultSize="380px" minSize="320px" className="panel sidebar-panel">
                    <Sidebar info={frames.info} target={target} onTargetChange={setTarget} />
                </Panel>

                <Separator className="resize-handle" />

                <Panel defaultSize="60%" minSize="20%" className="panel main-panel">
                    <Group orientation="vertical">
                        <Panel className="panel viewport-panel">
                            <Viewport
                                target={target}
                                frame={frames.frame}
                                frameIndex={frames.frameIndex}
                                frameCount={frames.frames.length}
                                searching={frames.status === 'loading'}
                                viewMode={frames.viewMode}
                                onViewModeChange={frames.setViewMode}
                                onTargetChange={(ra, dec) => setTarget((t) => ({ ...t, ra, dec }))}
                                surveyImageId={frames.survey?.image?.id ?? null}
                                refFrame={frames.refFrame}
                                refIndex={frames.refIndex}
                                onImageInfo={frames.onImageInfo}
                                measuring={selectedToolId === 'measure'}
                                measurement={measurement}
                                onMeasurementChange={setMeasurement}
                                wideView={wideView}
                                onCloseWideView={() => setWideView(false)}
                                located={located}
                                layers={layers}
                            />
                        </Panel>

                        <Separator className="resize-handle" />

                        <Panel disabled defaultSize="120px" minSize="120px" maxSize="120px" className="panel playback-panel">
                            <PlaybackPanel frames={frames} target={target} />
                        </Panel>
                    </Group>
                </Panel>

                <Separator className="resize-handle" />

                <Panel defaultSize="380px" minSize="320px" className="panel right-panel">
                    <div className="right-panel-group">
                        <div className="toolbar-panel">
                            <Toolbar
                                tools={tools}
                                selectedToolId={selectedToolId}
                                onSelectTool={onSelectTool}
                            />
                        </div>

                        <div className="properties-panel">
                            <PropertiesPanel tool={selectedTool} onPropertyChange={onPropertyChange}>
                                {selectedTool.id === 'img-post-processing' && (
                                    <LayerStack layers={layers} onChange={setLayers} />
                                )}
                                {selectedTool.id === 'measure' && (
                                    <>
                                        <MeasureReadout
                                            measurement={measurement}
                                            pixelScaleArcsec={PIXEL_SCALE_ARCSEC}
                                            onClear={() => { setMeasurement(null); setWideView(false) }}
                                            onWideView={() => setWideView(true)}
                                        />
                                        <ObjectDistance onMeasure={(m) =>
                                        {
                                            setMeasurement(m)
                                            // Centre on the midway point, so the line crosses the view however far apart they are.
                                            const { ra, dec } = greatCirclePoint(m.a, m.b, 0.5)
                                            setTarget((t) => ({ ...t, ra, dec }))
                                            // Longer than the image: show the whole line on the all-sky map.
                                            if (separation(m.a, m.b).sepArcsec > target.fovArcsec)
                                                setWideView(true)
                                        }} />
                                    </>
                                )}
                            </PropertiesPanel>
                        </div>
                    </div>
                </Panel>
            </Group>
        </>
    )
}