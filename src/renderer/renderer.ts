import type { PointerPosition, RendererHandle } from './Types';

import { type Texture, createTexture, deleteTexture,
         bufferTexture, bindTexture                  } from './Texture';
import { type Shader, createShader, deleteShader, bindShader,
        setShaderUniform1f, setShaderUniform1i       } from './Shader';
import { type Image, defaultImage } from './Image';

import { vpImageShaderVS, vpImageShaderFS } from './shaders/vpImage';

export class WebGLRenderer implements RendererHandle
{
    private readonly gl: WebGL2RenderingContext;

    private vpImage: Image;
    
    private vpImageTexture: Texture;
    private vpImageShader: Shader;

    private vao: WebGLVertexArrayObject;
    private vbo: WebGLBuffer;
    private ebo: WebGLBuffer;

    public constructor(canvas: HTMLCanvasElement)
    {
        /* Initialize WebGL2 context. */

        const gl = canvas.getContext("webgl2", {
            antialias: false
        });

        if (!gl)
        {
            throw new Error("Failed to initialize WebGL2");
        }
        this.gl = gl;

        /* Create a default image and corresponding texture. */

        this.vpImage        = defaultImage(1920, 1080);
        this.vpImageTexture = createTexture(this.gl, this.vpImage.width, this.vpImage.height);
        bufferTexture(this.gl, this.vpImageTexture, this.vpImage);

        /* Create shaders and initialize uniforms */

        const viewportAspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
        const imageAspectRatio    = this.vpImage.width /this.vpImage.height;

        this.vpImageShader = createShader(this.gl, vpImageShaderVS, vpImageShaderFS);
        setShaderUniform1f(gl, this.vpImageShader, "uViewportAspectRatio", viewportAspectRatio);
        setShaderUniform1f(gl, this.vpImageShader, "uImageAspectRatio"   , imageAspectRatio);
        setShaderUniform1i(gl, this.vpImageShader, "uImage"              , this.vpImageTexture.slot);

        /* Set up a textured quad for rendering the image to the viewport. */

        const vertices = new Float32Array([
            -0.5, -0.5, 0.0, 0.0,
             0.5, -0.5, 1.0, 0.0,
            -0.5,  0.5, 0.0, 1.0,
             0.5,  0.5, 1.0, 1.0,
        ]);

        const indices = new Uint16Array([
            0, 1, 2,
            2, 1, 3,
        ]);

        this.vao = gl.createVertexArray();
        this.vbo = gl.createBuffer();
        this.ebo = gl.createBuffer();

        if (!this.vao || !this.vbo || !this.ebo)
        {
            throw new Error("Failed to create WebGL buffers");
        }

        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        const posLoc = 0;
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 4 * Float32Array.BYTES_PER_ELEMENT, 0);
        
        const texCoordLoc = 1;
        gl.enableVertexAttribArray(texCoordLoc);
        gl.vertexAttribPointer(texCoordLoc , 2, gl.FLOAT, false, 4 * Float32Array.BYTES_PER_ELEMENT, 2 * Float32Array.BYTES_PER_ELEMENT);

        gl.bindVertexArray(null);

        /* Set up the viewport. */

        this.resize();
    }

    public render(): void
    {
        const gl = this.gl;
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        bindTexture(this.gl, this.vpImageTexture);
        bindShader(this.gl, this.vpImageShader);

        gl.bindVertexArray(this.vao);

        gl.drawElements(gl.TRIANGLES,
                        6,
                        gl.UNSIGNED_SHORT,
                        0);

        gl.bindVertexArray(null);
    }

    public setViewportImage(image: Image): void
    {
        this.vpImage = image;
        
        const gl = this.gl;
        const imageAspectRatio = this.vpImage.width / this.vpImage.height;
        
        bufferTexture(gl, this.vpImageTexture, image);
        setShaderUniform1f(gl, this.vpImageShader , "uImageAspectRatio", imageAspectRatio);

        this.render();
    }

    public terminate(): void
    {
        const gl = this.gl;

        deleteShader(gl, this.vpImageShader);
        deleteTexture(gl, this.vpImageTexture);

        gl.deleteVertexArray(this.vao);
        gl.deleteBuffer(this.vbo);
        gl.deleteBuffer(this.ebo);
    }

    public resize(): void
    {
        const gl     = this.gl;
        const canvas = gl.canvas as HTMLCanvasElement;

        const dpr    = window.devicePixelRatio || 1;
        const width  = Math.max(1, Math.round(canvas.clientWidth  * dpr));
        const height = Math.max(1, Math.round(canvas.clientHeight * dpr));

        if ((canvas.width !== width) || (canvas.height !== height))
        {
            canvas.width  = width;
            canvas.height = height;
        }

        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

        const viewportAspectRatio =  gl.drawingBufferHeight / gl.drawingBufferWidth;
        setShaderUniform1f(gl, this.vpImageShader, "uViewportAspectRatio", viewportAspectRatio);

        this.render();
    }
}

export function createRenderer(canvas: HTMLCanvasElement): RendererHandle
{
    return new WebGLRenderer(canvas);
}
