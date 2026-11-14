import { useMemo, useRef, useState } from 'react'

const TOTAL_FRAMES = 240

export default function PlaybackPanel()
{
    const [currentFrame, setCurrentFrame] = useState(118)
    const [startFrame, setStartFrame] = useState(48)
    const [endFrame, setEndFrame] = useState(186)
    const [isPlaying, setIsPlaying] = useState(false)
    const [loopEnabled, setLoopEnabled] = useState(true)
    const [speed, setSpeed] = useState(1)
    const timelineRef = useRef<HTMLDivElement | null>(null)

    const timelinePercent = useMemo(
        () => Math.min(Math.max((currentFrame / TOTAL_FRAMES) * 100, 0), 100),
        [currentFrame],
    )

    const clampFrame = (frame: number) => Math.min(Math.max(Math.round(frame), 0), TOTAL_FRAMES)

    const updateFrameFromClientX = (clientX: number) =>
    {
        if (!timelineRef.current)
        {
            return
        }

        const rect = timelineRef.current.getBoundingClientRect()
        const ratio = (clientX - rect.left) / rect.width
        const nextFrame = ratio * TOTAL_FRAMES

        setCurrentFrame(clampFrame(nextFrame))
    }

    const handleTimelinePointerDown = (event: React.PointerEvent<HTMLDivElement>) =>
    {
        event.preventDefault()
        updateFrameFromClientX(event.clientX)

        const handlePointerMove = (moveEvent: PointerEvent) => updateFrameFromClientX(moveEvent.clientX)
        const handlePointerUp = () =>
        {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
        }

        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)
    }

    const adjustFrame = (delta: number) =>
    {
        setCurrentFrame((previousFrame) =>
        {
            const nextFrame = previousFrame + delta
            return Math.min(Math.max(nextFrame, 0), TOTAL_FRAMES)
        })
    }

    return (
        <div className="playback-panel-shell">
            <div className="playback-timeline">
                <div
                    ref={timelineRef}
                    className="timeline-track"
                    aria-label="Playback timeline"
                    onPointerDown={handleTimelinePointerDown}
                >
                    <div className="timeline-fill" style={{ width: `${timelinePercent}%` }} />
                    <div className="timeline-markers">
                        <span />
                        <span />
                        <span />
                    </div>
                    <div className="timeline-playhead" style={{ left: `${timelinePercent}%` }}>
                        <span className="timeline-knob" />
                    </div>
                </div>
            </div>

            <div className="playback-controls">
                <div className="playback-section playback-section-left">
                    <label className="control-field">
                        <span>Current frame</span>
                        <input
                            type="number"
                            value={currentFrame}
                            min={0}
                            max={TOTAL_FRAMES}
                            onChange={(event) =>
                            {
                                const nextValue = Number(event.target.value)
                                if (!Number.isNaN(nextValue))
                                {
                                    setCurrentFrame(Math.min(Math.max(nextValue, 0), TOTAL_FRAMES))
                                }
                            }}
                        />
                    </label>

                    <div className="slice-field">
                        <label className="control-field control-field-small">
                            <span>Start</span>
                            <input
                                type="number"
                                value={startFrame}
                                min={0}
                                max={TOTAL_FRAMES}
                                onChange={(event) =>
                                {
                                    const nextValue = Number(event.target.value)
                                    if (!Number.isNaN(nextValue))
                                    {
                                        setStartFrame(Math.min(Math.max(nextValue, 0), endFrame))
                                    }
                                }}
                            />
                        </label>

                        <label className="control-field control-field-small">
                            <span>End</span>
                            <input
                                type="number"
                                value={endFrame}
                                min={0}
                                max={TOTAL_FRAMES}
                                onChange={(event) =>
                                {
                                    const nextValue = Number(event.target.value)
                                    if (!Number.isNaN(nextValue))
                                    {
                                        setEndFrame(Math.max(Math.min(nextValue, TOTAL_FRAMES), startFrame))
                                    }
                                }}
                            />
                        </label>
                    </div>
                </div>

                <div className="playback-section playback-section-middle">
                    <div className="transport-row">
                        <button
                            type="button"
                            className="transport-button transport-button-primary"
                            aria-label={isPlaying ? 'Pause playback' : 'Play playback'}
                            onClick={() => setIsPlaying((previousValue) => !previousValue)}
                        >
                            {isPlaying ? '❚❚' : '▶'}
                        </button>

                        <button
                            type="button"
                            className="transport-button"
                            aria-label="Step backward one frame"
                            onClick={() => adjustFrame(-1)}
                        >
                            ⏮
                        </button>

                        <button
                            type="button"
                            className="transport-button"
                            aria-label="Step forward one frame"
                            onClick={() => adjustFrame(1)}
                        >
                            ⏭
                        </button>
                    </div>

                    <button
                        type="button"
                        className={`loop-toggle ${loopEnabled ? 'loop-toggle-active' : ''}`}
                        aria-label={loopEnabled ? 'Disable loop playback' : 'Enable loop playback'}
                        onClick={() => setLoopEnabled((previousValue) => !previousValue)}
                    >
                        ↻
                    </button>
                </div>

                <div className="playback-section playback-section-right">
                    <label className="speed-control">
                        <span>Playback speed</span>
                        <div className="speed-row">
                            <input
                                type="number"
                                min="0.5"
                                max="3"
                                step="0.5"
                                value={speed}
                                onChange={(event) =>
                                {
                                    const nextValue = Number(event.target.value)
                                    if (!Number.isNaN(nextValue))
                                    {
                                        setSpeed(Math.min(Math.max(nextValue, 0.5), 3))
                                    }
                                }}
                            />
                            <span className="speed-unit">fps</span>
                        </div>
                    </label>

                    <button type="button" className="save-button">
                        Save clip
                    </button>
                </div>
            </div>
        </div>
    )
}