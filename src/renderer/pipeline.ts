// Runs the post-processing stack (../processing.ts) on the GPU: each layer is one or more
// passes at image resolution into offscreen textures, in order. The result is kept, so
// pan / zoom only redraw it; the stack re-runs when the image or the layers change.

import { COLORMAPS, HIGHLIGHT_COLORS, type Layer } from '../processing'
import { createShader, deleteShader, type Shader } from './Shader'
import { MAX_STOPS, OP, processShaderFS, processShaderVS } from './shaders/process'

type Target = { texture: WebGLTexture, framebuffer: WebGLFramebuffer }
export type Processed = { texture: WebGLTexture, grey: boolean }   // grey: single-channel source, unprocessed

const STRETCH_MODES = ['asinh', 'log', 'sqrt', 'square']

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)

export class Pipeline
{
    private readonly shader: Shader
    private targets: Target[] = []
    private width = 0
    private height = 0
    // Half-float targets keep negative / fine values between passes; plain 8-bit otherwise.
    private readonly floatTargets: boolean

    private readonly gl: WebGL2RenderingContext

    constructor(gl: WebGL2RenderingContext)
    {
        this.gl = gl
        this.shader = createShader(gl, processShaderVS, processShaderFS)
        this.floatTargets = !!gl.getExtension('EXT_color_buffer_float')
    }

    /** Apply the enabled layers to `source` (an R32F texture); `vao` draws the shared quad. */
    process(source: WebGLTexture, width: number, height: number, layers: Layer[], vao: WebGLVertexArrayObject): Processed
    {
        const active = layers.filter((l) => l.enabled && l.opacity > 0)
        if (active.length === 0)
            return { texture: source, grey: true }

        const gl = this.gl
        this.ensureTargets(width, height)
        gl.useProgram(this.shader.handle)
        gl.bindVertexArray(vao)
        gl.viewport(0, 0, width, height)
        gl.disable(gl.BLEND)

        let current: Processed = { texture: source, grey: true }
        // Any target that isn't holding one of the given textures.
        const free = (...busy: WebGLTexture[]) => this.targets.find((t) => !busy.includes(t.texture))!

        const pass = (op: number, input: Processed, out: Target, set: (u: (name: string) => WebGLUniformLocation | null) => void,
                      mix = 1, aux?: WebGLTexture) =>
        {
            const u = (name: string) => this.shader.uniforms[name] ?? null
            gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, input.texture)
            gl.activeTexture(gl.TEXTURE1)
            gl.bindTexture(gl.TEXTURE_2D, aux ?? null)
            gl.uniform1i(u('uImage'), 0)
            gl.uniform1i(u('uAux'), 1)
            gl.uniform1i(u('uGrey'), input.grey ? 1 : 0)
            gl.uniform1i(u('uOp'), op)
            gl.uniform1f(u('uMix'), mix)
            gl.uniform4f(u('uP'), 0, 0, 0, 0)
            set(u)
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
            return { texture: out.texture, grey: false }
        }

        // A blur-based layer: blur the input (two separable passes), then combine with it.
        const blurred = (input: Processed, sigma: number, op: number, mix: number, set: Parameters<typeof pass>[3] = () => {}) =>
        {
            const h = pass(OP.blur, input, free(input.texture), (u) => { gl.uniform4f(u('uP'), sigma, 0, 0, 0); gl.uniform2f(u('uDir'), 1, 0) })
            const v = pass(OP.blur, h, free(input.texture, h.texture), (u) => { gl.uniform4f(u('uP'), sigma, 0, 0, 0); gl.uniform2f(u('uDir'), 0, 1) })
            return pass(op, input, free(input.texture, v.texture), set, mix, v.texture)
        }

        for (const layer of active)
        {
            const p = layer.params
            const n = (key: string) => Number(p[key])
            const out = () => free(current.texture)
            const mix = layer.opacity
            switch (layer.type)
            {
                case 'levels':
                    current = pass(OP.levels, current, out(), (u) => gl.uniform4f(u('uP'), n('black'), n('white'), n('gamma'), 0), mix)
                    break
                case 'brightness':
                    current = pass(OP.brightness, current, out(), (u) => gl.uniform4f(u('uP'), n('brightness'), n('contrast'), 0, 0), mix)
                    break
                case 'stretch':
                    current = pass(OP.stretch, current, out(), (u) =>
                        gl.uniform4f(u('uP'), Math.max(0, STRETCH_MODES.indexOf(String(p.mode))), n('strength'), 0, 0), mix)
                    break
                case 'invert':
                    current = pass(OP.invert, current, out(), () => {}, mix)
                    break
                case 'median':
                    current = pass(OP.median, current, out(), () => {}, mix)
                    break
                case 'edges':
                    current = pass(OP.edges, current, out(), (u) => gl.uniform4f(u('uP'), n('strength'), 0, 0, 0), mix)
                    break
                case 'highlight':
                    current = pass(OP.highlight, current, out(), (u) =>
                    {
                        gl.uniform4f(u('uP'), n('threshold'), 0, 0, 0)
                        gl.uniform3f(u('uColor'), ...(HIGHLIGHT_COLORS[String(p.color)] ?? HIGHLIGHT_COLORS.amber).rgb)
                    }, mix)
                    break
                case 'colormap':
                    current = pass(OP.colormap, current, out(), (u) =>
                    {
                        const stops = (COLORMAPS[String(p.map)] ?? COLORMAPS.inferno).stops.slice(0, MAX_STOPS)
                        gl.uniform3fv(u('uStops[0]'), stops.flatMap(hexToRgb))
                        gl.uniform1i(u('uStopCount'), stops.length)
                    }, mix)
                    break
                case 'smooth':
                    current = blurred(current, n('sigma'), OP.smooth, mix)
                    break
                case 'sharpen':
                    current = blurred(current, n('sigma'), OP.sharpen, mix, (u) => gl.uniform4f(u('uP'), n('amount'), 0, 0, 0))
                    break
                case 'background':
                    current = blurred(current, n('radius'), OP.background, mix, (u) => gl.uniform4f(u('uP'), n('pedestal'), 0, 0, 0))
                    break
            }
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.bindVertexArray(null)
        gl.enable(gl.BLEND)
        gl.useProgram(null)
        return current
    }

    /** Three image-sized targets: enough for a blur (two passes) plus its combine, never overwriting an input. */
    private ensureTargets(width: number, height: number)
    {
        if (width === this.width && height === this.height && this.targets.length)
            return
        this.deleteTargets()
        const gl = this.gl
        for (let i = 0; i < 3; i++)
        {
            const texture = gl.createTexture()
            const framebuffer = gl.createFramebuffer()
            if (!texture || !framebuffer)
                throw new Error('Failed to create a post-processing buffer')
            gl.bindTexture(gl.TEXTURE_2D, texture)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            if (this.floatTargets)
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null)
            else
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
            this.targets.push({ texture, framebuffer })
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.bindTexture(gl.TEXTURE_2D, null)
        this.width = width
        this.height = height
    }

    private deleteTargets()
    {
        for (const t of this.targets)
        {
            this.gl.deleteTexture(t.texture)
            this.gl.deleteFramebuffer(t.framebuffer)
        }
        this.targets = []
    }

    dispose()
    {
        this.deleteTargets()
        deleteShader(this.gl, this.shader)
    }
}
