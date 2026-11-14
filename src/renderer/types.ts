export type RendererHandle = {
    render: () => void
    resize: () => void
    destroy: () => void
}

export type ShaderSources = {
    vertex: string
    fragment: string
}
