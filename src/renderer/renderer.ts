import type { RendererHandle, ViewState } from './types';

import { type Texture, createTexture, deleteTexture,
         bufferTexture                               } from './Texture';
import { type Shader, createShader, deleteShader, bindShader,
        setShaderUniform1f, setShaderUniform1i,
        setShaderUniform2f, setShaderUniform3f       } from './Shader';
import { type Image } from './Image';
import type { Layer } from '../processing';
import { Pipeline, type Processed } from './pipeline';

import { vpImageShaderVS, vpImageShaderFS } from './shaders/vpImage';
import { glowShaderVS, glowShaderFS } from './shaders/glow';

// Zoom limits: from a quarter of the default size up to 64x (individual pixels are big).
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 64;

// Halo behind the image: very faint, cool white, fading out over ~4.5% of the image height.
const GLOW_COLOR: [number, number, number] = [0.62, 0.72, 0.92];
const GLOW_STRENGTH = 0.08;
const GLOW_RADIUS   = 0.045;
const GLOW_SCALE    = 1.8;   // quad size relative to the image; the glow has faded out by its edge

export class WebGLRenderer implements RendererHandle
{
    // View transform: the image is scaled by `zoom`, then its centre is moved to `pan`
    // (clip space, -1..1 across the canvas).
    private zoom = 1;
    private hasImage = false;   // false until setViewportImage is first called
    private viewListeners = new Set<() => void>();
    private panX = 0;
    private panY = 0;

    private readonly gl: WebGL2RenderingContext;

    private vpImage: Image;
    
    private vpImageTexture: Texture;
    private vpImageShader: Shader;
    private glowShader: Shader;

    // Post-processing: the layer stack and its latest result (what's drawn on screen).
    private pipeline: Pipeline;
    private layers: Layer[] = [];
    private processed: Processed;

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

        // Nothing is drawn until the first real image arrives (the viewport shows a
        // loading animation meanwhile); this 1x1 image just sizes the initial texture.
        this.vpImage        = { width: 1, height: 1, pixels: new Float32Array(1) };
        this.vpImageTexture = createTexture(this.gl, this.vpImage.width, this.vpImage.height);
        bufferTexture(this.gl, this.vpImageTexture, this.vpImage);

        /* Create shaders and initialize uniforms */

        const viewportAspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
        const imageAspectRatio    = this.vpImage.width /this.vpImage.height;

        this.vpImageShader = createShader(this.gl, vpImageShaderVS, vpImageShaderFS);
        this.glowShader    = createShader(this.gl, glowShaderVS, glowShaderFS);

        setShaderUniform1f(gl, this.glowShader, "uGlowScale"   , GLOW_SCALE);
        setShaderUniform1f(gl, this.glowShader, "uGlowRadius"  , GLOW_RADIUS);
        setShaderUniform1f(gl, this.glowShader, "uGlowStrength", GLOW_STRENGTH);
        setShaderUniform3f(gl, this.glowShader, "uGlowColor"   , ...GLOW_COLOR);

        // The glow is translucent and drawn first; the opaque image goes on top.
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this.setViewUniform("uViewportAspectRatio", viewportAspectRatio);
        this.setViewUniform("uImageAspectRatio", imageAspectRatio);
        // The drawn texture is bound to unit 0 at draw time (the source or the processed result).
        setShaderUniform1i(gl, this.vpImageShader, "uImage"              , 0);
        this.pipeline  = new Pipeline(gl);
        this.processed = { texture: this.vpImageTexture.handle, grey: true };
        this.setViewUniform("uZoom", this.zoom);
        this.setViewUniform("uPan", this.panX, this.panY);

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
        // Transparent around the image, so the viewport's CSS background shows through.
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (!this.hasImage)
            return;

        gl.bindVertexArray(this.vao);

        // Glow first (behind), then the image.
        bindShader(this.gl, this.glowShader);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

        setShaderUniform1i(gl, this.vpImageShader, "uGrey", this.processed.grey ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.processed.texture);
        bindShader(this.gl, this.vpImageShader);

        gl.drawElements(gl.TRIANGLES,
                        6,
                        gl.UNSIGNED_SHORT,
                        0);

        gl.bindVertexArray(null);
    }

    public setViewportImage(image: Image): void
    {
        this.vpImage = image;
        this.hasImage = true;
        
        const gl = this.gl;
        const imageAspectRatio = this.vpImage.width / this.vpImage.height;
        
        bufferTexture(gl, this.vpImageTexture, image);
        this.setViewUniform("uImageAspectRatio", imageAspectRatio);
        this.reprocess();

        this.render();
        this.notifyView();
    }

    /** Set the post-processing layer stack (applied in order) and redraw. */
    public setLayers(layers: Layer[]): void
    {
        this.layers = layers;
        this.reprocess();
        this.render();
    }

    /** Re-run the layer stack on the current image; pan / zoom reuse the result. */
    private reprocess(): void
    {
        if (!this.hasImage)
            return;
        const gl = this.gl;
        this.processed = this.pipeline.process(this.vpImageTexture.handle, this.vpImage.width, this.vpImage.height,
                                               this.layers, this.vao);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);   // the passes drew at image size
    }

    /** Move the image by a distance in CSS pixels (e.g. a mouse drag). */
    public panBy(dxPixels: number, dyPixels: number): void
    {
        const canvas = this.gl.canvas as HTMLCanvasElement;
        if (canvas.clientWidth === 0 || canvas.clientHeight === 0)
            return;

        // Clip space spans 2 units across the canvas; screen y points down.
        this.panX += (2 * dxPixels) / canvas.clientWidth;
        this.panY -= (2 * dyPixels) / canvas.clientHeight;
        this.applyView();
    }

    /**
     * Zoom by `factor` (> 1 zooms in) keeping the point under the cursor fixed,
     * so the spot you're pointing at stays under the mouse.
     */
    public zoomAt(clientX: number, clientY: number, factor: number): void
    {
        const canvas = this.gl.canvas as HTMLCanvasElement;
        const rect   = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0)
            return;

        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
        const applied = newZoom / this.zoom;
        if (applied === 1)
            return;

        // Cursor in clip space.
        const cx = ((clientX - rect.left) / rect.width) * 2 - 1;
        const cy = 1 - ((clientY - rect.top) / rect.height) * 2;

        this.panX = cx - (cx - this.panX) * applied;
        this.panY = cy - (cy - this.panY) * applied;
        this.zoom = newZoom;
        this.applyView();
    }

    /** Back to the default: image centred at its normal size. */
    public resetView(): void
    {
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.applyView();
    }

    private applyView(): void
    {
        // Keep at least part of the image on screen so it can't be lost.
        const gl = this.gl;
        const aspect = (gl.drawingBufferHeight / gl.drawingBufferWidth) * (this.vpImage.width / this.vpImage.height);
        const halfW = 0.5 * aspect * this.zoom;
        const halfH = 0.5 * this.zoom;
        const limitX = halfW + 0.9;
        const limitY = halfH + 0.9;
        this.panX = Math.min(limitX, Math.max(-limitX, this.panX));
        this.panY = Math.min(limitY, Math.max(-limitY, this.panY));

        this.setViewUniform("uZoom", this.zoom);
        this.setViewUniform("uPan", this.panX, this.panY);
        this.render();
        this.notifyView();
    }

    /** Set a view uniform (aspect ratios, zoom, pan) on both the image and glow shaders. */
    private setViewUniform(name: string, x: number, y?: number): void
    {
        for (const shader of [this.vpImageShader, this.glowShader])
        {
            if (y === undefined)
                setShaderUniform1f(this.gl, shader, name, x);
            else
                setShaderUniform2f(this.gl, shader, name, x, y);
        }
    }

    /** Current placement of the image on screen. */
    public getView(): ViewState
    {
        const canvas = this.gl.canvas as HTMLCanvasElement;
        return {
            hasImage:    this.hasImage,
            zoom:        this.zoom,
            panX:        this.panX,
            panY:        this.panY,
            imageWidth:  this.vpImage.width,
            imageHeight: this.vpImage.height,
            cssWidth:    canvas.clientWidth,
            cssHeight:   canvas.clientHeight,
        };
    }

    /** Call `listener` whenever the image moves, zooms, changes size or the canvas resizes. */
    public onViewChange(listener: () => void): () => void
    {
        this.viewListeners.add(listener);
        return () => { this.viewListeners.delete(listener); };
    }

    private notifyView(): void
    {
        this.viewListeners.forEach((listener) => listener());
    }

    public terminate(): void
    {
        const gl = this.gl;

        deleteShader(gl, this.vpImageShader);
        deleteShader(gl, this.glowShader);
        this.pipeline.dispose();
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
        this.setViewUniform("uViewportAspectRatio", viewportAspectRatio);

        this.render();
        this.notifyView();
    }
}

export function createRenderer(canvas: HTMLCanvasElement): RendererHandle
{
    return new WebGLRenderer(canvas);
}
