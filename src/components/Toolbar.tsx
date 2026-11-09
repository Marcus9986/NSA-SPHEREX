import type { ToolDefinition } from '../App'

type ToolbarProps = {
    tools: ToolDefinition[]
    selectedToolId: string
    onSelectTool: (toolId: string) => void
}

export default function Toolbar({ tools, selectedToolId, onSelectTool }: ToolbarProps)
{
    return (
        <div className="toolbar">
            {tools.map((tool) => (
                <button
                    key={tool.id}
                    type="button"
                    className={
                        `tool-button ${tool.id === selectedToolId ? 'tool-button-selected' : ''}`.trim()
                    }
                    onClick={() => onSelectTool(tool.id)}
                    title={tool.description}
                    aria-label={tool.label}
                >
                    <img className="tool-icon" src={tool.icon} alt={tool.label} />
                </button>
            ))}
        </div>
    )
}