import type { ToolDefinition } from '../App'

type PropertiesPanelProps = {
    tool: ToolDefinition
    onPropertyChange: (propertyKey: string, nextValue: string | number | boolean) => void
}

export default function PropertiesPanel({ tool, onPropertyChange }: PropertiesPanelProps)
{
    return (
        <div className="properties-panel-content">
            <div className="properties-header">
                <img className="properties-icon" src={tool.icon} alt={tool.label} />
                <h3>{tool.label}</h3>
            </div>

            <p className="properties-description">{tool.description}</p>

            <div className="properties-list">
                {tool.properties.map((property) => (
                    <label key={property.key} className="property-row">
                        <span>{property.label}</span>

                        {property.type === 'toggle' ? (
                            <input
                                type="checkbox"
                                checked={Boolean(property.value)}
                                onChange={(event) => onPropertyChange(property.key, event.target.checked)}
                            />
                        ) : property.type === 'slider' ? (
                            <div className="slider-row">
                                <input
                                    type="range"
                                    min={property.min ?? 0}
                                    max={property.max ?? 100}
                                    step={property.step ?? 1}
                                    value={Number(property.value) || 0}
                                    onChange={(event) =>
                                        onPropertyChange(property.key, Number(event.target.value))
                                    }
                                />
                                <input
                                    type="number"
                                    className="slider-number"
                                    min={property.min ?? 0}
                                    max={property.max ?? 100}
                                    step={property.step ?? 1}
                                    value={Number(property.value) || 0}
                                    onChange={(event) => {
                                        const nextValue = Number(event.target.value)

                                        if (Number.isNaN(nextValue))
                                        {
                                            return
                                        }

                                        onPropertyChange(property.key, nextValue)
                                    }}
                                />
                            </div>
                        ) : (
                            <input
                                type={property.type}
                                value={String(property.value)}
                                onChange={(event) => onPropertyChange(property.key, event.target.value)}
                            />
                        )}
                    </label>
                ))}
            </div>
        </div>
    )
}