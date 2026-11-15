import type { Layer } from "../processing";
import type { Image } from "./Image";

export type PointerPosition = {
    x: number
    y: number
}

/** Where the image is on screen: enough for overlays to map image pixels to CSS pixels. */
export type ViewState = {
    hasImage:    boolean
    zoom:        number
    panX:        number   // image centre, clip space (-1..1)
    panY:        number
    imageWidth:  number   // pixels
    imageHeight: number
    cssWidth:    number   // canvas size in CSS pixels
    cssHeight:   number
}

export type RendererHandle = {
    render:           () => void;
    terminate:        () => void;
    setViewportImage: (image: Image) => void;
    panBy:            (dxPixels: number, dyPixels: number) => void;
    zoomAt:           (clientX: number, clientY: number, factor: number) => void;
    resetView:        () => void;
    setLayers:        (layers: Layer[]) => void;
}