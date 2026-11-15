import type { Image } from "./Image";

export type PointerPosition = {
    x: number
    y: number
}

export type RendererHandle = {
    render:           () => void;
    terminate:        () => void;
    setViewportImage: (image: Image) => void;
}