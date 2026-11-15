// Image post-processing: a stack of layers applied in order to the viewport image (on the
// GPU, see renderer/pipeline.ts). Shared by the properties panel UI and the renderer.
// Images reach the renderer already stretched into 0..1 (see stretchForDisplay), so every
// layer works on display values in that range.

export type LayerType =
    | 'levels' | 'brightness' | 'stretch' | 'background' | 'smooth' | 'sharpen'
    | 'median' | 'edges' | 'highlight' | 'invert' | 'colormap'

export type NumberParam = { key: string, label: string, min: number, max: number, step: number, default: number }
export type ChoiceParam = { key: string, label: string, options: { value: string, label: string }[], default: string }
export type ParamDef = NumberParam | ChoiceParam

export type LayerTypeDef = { type: LayerType, label: string, description: string, params: ParamDef[] }

export type Layer = {
    id:      string
    type:    LayerType
    enabled: boolean
    opacity: number                            // 0..1: blend of this layer's result over its input
    params:  Record<string, number | string>
}

export const COLORMAPS: Record<string, { label: string, stops: string[] }> = {
    inferno: { label: 'Inferno', stops: ['#000004', '#320a5e', '#781c6d', '#bc3754', '#ed6925', '#fbb61a', '#fcffa4'] },
    magma:   { label: 'Magma',   stops: ['#000004', '#2c115f', '#721f81', '#b73779', '#f1605d', '#feb078', '#fcfdbf'] },
    viridis: { label: 'Viridis', stops: ['#440154', '#443983', '#31688e', '#21918c', '#35b779', '#90d743', '#fde725'] },
    plasma:  { label: 'Plasma',  stops: ['#0d0887', '#5c01a6', '#9c179e', '#cc4778', '#ed7953', '#fdb42f', '#f0f921'] },
    heat:    { label: 'Heat',    stops: ['#000000', '#5a0000', '#b41e00', '#ff6400', '#ffc800', '#ffffff'] },
    ice:     { label: 'Ice',     stops: ['#000000', '#001a4d', '#0050a0', '#00a0d0', '#80e0ff', '#ffffff'] },
}

export const HIGHLIGHT_COLORS: Record<string, { label: string, rgb: [number, number, number] }> = {
    amber: { label: 'Amber', rgb: [1.0, 0.72, 0.1] },
    red:   { label: 'Red',   rgb: [1.0, 0.25, 0.25] },
    cyan:  { label: 'Cyan',  rgb: [0.2, 0.9, 1.0] },
    green: { label: 'Green', rgb: [0.3, 1.0, 0.45] },
}

const choices = (record: Record<string, { label: string }>) =>
    Object.entries(record).map(([value, { label }]) => ({ value, label }))

export const LAYER_TYPES: LayerTypeDef[] = [
    {
        type: 'levels', label: 'Levels',
        description: 'Set the black and white points and the midtone gamma.',
        params: [
            { key: 'black', label: 'Black point', min: 0, max: 1, step: 0.01, default: 0 },
            { key: 'white', label: 'White point', min: 0, max: 1, step: 0.01, default: 1 },
            { key: 'gamma', label: 'Gamma', min: 0.2, max: 5, step: 0.05, default: 1 },
        ],
    },
    {
        type: 'brightness', label: 'Brightness & contrast',
        description: 'Shift and scale every pixel around mid-grey.',
        params: [
            { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01, default: 0 },
            { key: 'contrast', label: 'Contrast', min: 0, max: 3, step: 0.05, default: 1 },
        ],
    },
    {
        type: 'stretch', label: 'Stretch curve',
        description: 'Brighten faint pixels more than bright ones (asinh / log), or the reverse (square).',
        params: [
            { key: 'mode', label: 'Curve', default: 'asinh', options: [
                { value: 'asinh', label: 'Asinh' }, { value: 'log', label: 'Log' },
                { value: 'sqrt', label: 'Square root' }, { value: 'square', label: 'Square' },
            ] },
            { key: 'strength', label: 'Strength', min: 1, max: 100, step: 1, default: 10 },
        ],
    },
    {
        type: 'background', label: 'Remove background',
        description: 'Subtract the smooth glow (zodiacal light, gradients), leaving stars and small objects.',
        params: [
            { key: 'radius', label: 'Scale (px)', min: 2, max: 40, step: 1, default: 12 },
            { key: 'pedestal', label: 'Sky level', min: 0, max: 0.5, step: 0.01, default: 0.05 },
        ],
    },
    {
        type: 'smooth', label: 'Smooth',
        description: 'Gaussian blur: lowers noise so faint, fuzzy objects stand out.',
        params: [{ key: 'sigma', label: 'Radius (px)', min: 0.3, max: 6, step: 0.1, default: 1 }],
    },
    {
        type: 'sharpen', label: 'Sharpen',
        description: 'Unsharp mask: boosts fine detail and point sources.',
        params: [
            { key: 'sigma', label: 'Radius (px)', min: 0.5, max: 6, step: 0.1, default: 1.5 },
            { key: 'amount', label: 'Amount', min: 0, max: 5, step: 0.1, default: 1.5 },
        ],
    },
    {
        type: 'median', label: 'Remove hot pixels',
        description: '3×3 median filter: removes single-pixel spikes (cosmic rays, hot pixels) and keeps edges.',
        params: [],
    },
    {
        type: 'edges', label: 'Edge detect',
        description: 'Sobel edges: outlines sources and makes streaks from fast movers easier to see.',
        params: [{ key: 'strength', label: 'Strength', min: 0.5, max: 10, step: 0.1, default: 3 }],
    },
    {
        type: 'highlight', label: 'Highlight bright pixels',
        description: 'Paint everything above a level in a colour, to pick out sources.',
        params: [
            { key: 'threshold', label: 'Level', min: 0, max: 1, step: 0.01, default: 0.8 },
            { key: 'color', label: 'Colour', options: choices(HIGHLIGHT_COLORS), default: 'amber' },
        ],
    },
    { type: 'invert', label: 'Invert', description: 'Dark objects on a light sky, like a photographic negative.', params: [] },
    {
        type: 'colormap', label: 'Colour map',
        description: 'False colour by brightness: small differences are easier to see in colour than in grey.',
        params: [{ key: 'map', label: 'Map', options: choices(COLORMAPS), default: 'inferno' }],
    },
]

export const layerType = (type: LayerType) => LAYER_TYPES.find((t) => t.type === type)!

let nextId = 0

export function createLayer(type: LayerType, params: Record<string, number | string> = {}): Layer
{
    const defaults = Object.fromEntries(layerType(type).params.map((p) => [p.key, p.default]))
    return { id: `${type}-${++nextId}`, type, enabled: true, opacity: 1, params: { ...defaults, ...params } }
}

/** Ready-made stacks; picking one replaces the current stack. */
export const PRESETS: { label: string, description: string, layers: () => Layer[] }[] = [
    {
        label: 'Reveal faint objects',
        description: 'Remove the background and hot pixels, stretch hard, then smooth the noise.',
        layers: () => [createLayer('median'), createLayer('background', { radius: 16 }),
                       createLayer('stretch', { strength: 20 }), createLayer('smooth', { sigma: 0.8 })],
    },
    {
        label: 'False colour',
        description: 'A gentle stretch with the Inferno colour map.',
        layers: () => [createLayer('stretch', { strength: 5 }), createLayer('colormap')],
    },
    {
        label: 'Spot bright sources',
        description: 'Darken the sky and paint the brightest pixels.',
        layers: () => [createLayer('levels', { black: 0.2 }), createLayer('highlight', { threshold: 0.85 })],
    },
]
