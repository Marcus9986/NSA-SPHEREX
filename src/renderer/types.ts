export type PointerPosition = {
    x: number
    y: number
}

export type RendererHandle = {
    render:    () => void;
    terminate: () => void;
    setImage:  (pixels: Float32Array, width: number, height: number) => void;
}