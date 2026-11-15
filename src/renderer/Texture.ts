import type { Image } from "./Image";

let currTextureSlot = 0;

export interface Texture
{
    width:  number;
    height: number;
    slot:   number;
    handle: WebGLTexture;
}

export function createTexture(gl:     WebGL2RenderingContext,
                              width:  number,
                              height: number
                             ): Texture
{
    if (!Number.isSafeInteger(width)  || width  <= 0 ||
        !Number.isSafeInteger(height) || height <= 0)
    {
        throw new Error("Invalid texture dimensions");
    }

    if (currTextureSlot >= gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS))
    {
        throw new Error("Exceeded maximum number of texture slots");
    }

    const handle = gl.createTexture();
    if (!handle)
    {
        throw new Error("Failed to create WebGL texture");
    }

    gl.activeTexture(gl.TEXTURE0 + currTextureSlot);
    gl.bindTexture(gl.TEXTURE_2D, handle);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S    , gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T    , gl.CLAMP_TO_EDGE);

    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,
        width,
        height,
        0,
        gl.RED,
        gl.FLOAT,
        null
    );

    gl.bindTexture(gl.TEXTURE_2D, null);

    return { width, height, slot: currTextureSlot++, handle };
}

export function deleteTexture(gl: WebGL2RenderingContext, texture: Texture): void
{
    gl.deleteTexture(texture.handle);
}

export function bufferTexture(gl: WebGL2RenderingContext,
                              texture: Texture,
                              image: Image
                             ): void
{

    bindTexture(gl, texture);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    if ((image.width !== texture.width) || (image.height !== texture.height))
    {
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.R32F,
            image.width,
            image.height,
            0,
            gl.RED,
            gl.FLOAT,
            image.pixels
        );

        texture.width  = image.width;
        texture.height = image.height;
    }
    else
    {
        gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            image.width,
            image.height,
            gl.RED,
            gl.FLOAT,
            image.pixels
        );
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
}

export function bindTexture(gl: WebGL2RenderingContext, texture: Texture): void
{
    gl.activeTexture(gl.TEXTURE0 + texture.slot);
    gl.bindTexture(gl.TEXTURE_2D, texture.handle);
}

export function unbindTexture(gl: WebGL2RenderingContext): void
{
    gl.bindTexture(gl.TEXTURE_2D, null);
}