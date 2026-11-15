export interface Image
{
    width:  number
    height: number
    pixels: Float32Array
}

export function defaultImage(): Image
{
    const width = 300, height = 200;
    const pixels = new Float32Array(width * height);

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            const index = y * width + x;
            pixels[index] = x / width;
        }
    }

    return { width, height, pixels };
}