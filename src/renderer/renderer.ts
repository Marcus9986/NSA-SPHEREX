import { triangleShaders } from './shaders/triangle'
import type { RendererHandle, ShaderSources } from './types'

const compileShader = (gl: WebGL2RenderingContext, type: number, source: string) =>
{
    const shader = gl.createShader(type)
    if (!shader)
    {
        throw new Error('Unable to create shader.')
    }

    gl.shaderSource(shader, source)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    {
        const log = gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        throw new Error(log ?? 'Shader compilation failed.')
    }

    return shader
}

const createProgram = (gl: WebGL2RenderingContext, shaders: ShaderSources) =>
{
    const program = gl.createProgram()
    if (!program)
    {
        throw new Error('Unable to create WebGL program.')
    }

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, shaders.vertex)
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, shaders.fragment)

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    {
        const log = gl.getProgramInfoLog(program)
        gl.deleteProgram(program)
        throw new Error(log ?? 'Program linking failed.')
    }

    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)

    return program
}

export function createRenderer(canvas: HTMLCanvasElement): RendererHandle
{
    const gl = canvas.getContext('webgl2')
    if (!gl)
    {
        throw new Error('WebGL2 is not supported in this browser.')
    }

    const program = createProgram(gl, triangleShaders)
    const triangleVertices = new Float32Array([
        -0.5, -0.5,
        0.5, -0.5,
        0.0, 0.75,
    ])

    const buffer = gl.createBuffer()
    if (!buffer)
    {
        throw new Error('Unable to create buffer.')
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, triangleVertices, gl.STATIC_DRAW)

    const positionLocation = gl.getAttribLocation(program, 'aPosition')
    const aspectLocation = gl.getUniformLocation(program, 'uAspect')
    gl.useProgram(program)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    const resize = () =>
    {
        const ratio = window.devicePixelRatio || 1
        const rect = canvas.getBoundingClientRect()
        const width = Math.max(1, Math.floor(rect.width * ratio))
        const height = Math.max(1, Math.floor(rect.height * ratio))

        if (canvas.width !== width || canvas.height !== height)
        {
            canvas.width = width
            canvas.height = height
        }

        gl.viewport(0, 0, canvas.width, canvas.height)
        render()
    }

    const render = () =>
    {
        const aspectX = canvas.width / Math.max(canvas.height, 1)
        gl.useProgram(program)
        if (aspectLocation)
        {
            gl.uniform2f(aspectLocation, aspectX, 1.0)
        }

        gl.clearColor(0.06, 0.08, 0.12, 1.0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const observer = new ResizeObserver(() => resize())
    observer.observe(canvas)

    resize()

    return {
        render,
        resize,
        destroy: () =>
        {
            observer.disconnect()
            gl.deleteBuffer(buffer)
            gl.deleteProgram(program)
        },
    }
}
