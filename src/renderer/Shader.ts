export interface Shader
{
    handle: WebGLProgram;
    attributes: { [name: string]: number               };
    uniforms:   { [name: string]: WebGLUniformLocation };
}

export function createShader(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): Shader
{
    const vertexShader   = compileShader(gl, gl.VERTEX_SHADER  , vertexSource  );
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    if (!program)
    {
        throw new Error("Failed to create WebGL program");
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    {
        const infoLog = gl.getProgramInfoLog(program);
        throw new Error(`Failed to link WebGL program: ${infoLog}`);
    }

    const attributes: { [name: string]: number } = {};
    const attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < attributeCount; i++)
    {
        const info = gl.getActiveAttrib(program, i);

        if (info)
        {
            const location = gl.getAttribLocation(program, info.name);
            attributes[info.name] = location;
        }
    }

    const uniforms: { [name: string]: WebGLUniformLocation } = {};
    const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniformCount; i++)
    {
        const info = gl.getActiveUniform(program, i);

        if (info)
        {
            const location = gl.getUniformLocation(program, info.name);
            if (location)
            {
                uniforms[info.name] = location;
            }
        }
    }

    return { handle: program, attributes, uniforms };
}

export function deleteShader(gl: WebGL2RenderingContext, shader: Shader): void
{
    gl.deleteProgram(shader.handle);
}

export function bindShader(gl: WebGL2RenderingContext, shader: Shader): void
{
    gl.useProgram(shader.handle);
}

export function unbindShader(gl: WebGL2RenderingContext): void
{
    gl.useProgram(null);
}

export function setShaderUniform1f(gl: WebGL2RenderingContext, shader: Shader, name: string, value: number): void
{
    bindShader(gl, shader);

    const location = shader.uniforms[name];
    if (location)
    {
        gl.uniform1f(location, value);
    }

    unbindShader(gl);
}

export function setShaderUniform1i(gl: WebGL2RenderingContext, shader: Shader, name: string, value: number): void
{
    bindShader(gl, shader);

    const location = shader.uniforms[name];
    if (location)
    {
        gl.uniform1i(location, value);
    }

    unbindShader(gl);
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader
{
    const shader = gl.createShader(type);
    if (!shader)
    {
        throw new Error("Failed to create WebGL shader");
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    {
        const infoLog = gl.getShaderInfoLog(shader);
        throw new Error(`Failed to compile WebGL shader: ${infoLog}`);
    }

    return shader;
}