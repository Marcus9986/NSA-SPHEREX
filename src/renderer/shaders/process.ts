// One image-space pass of the post-processing stack (see ../pipeline.ts): reads the
// previous result at image resolution and writes the next. uOp picks the operation.

export const OP = {
    levels: 0, brightness: 1, stretch: 2, invert: 3, colormap: 4,
    blur: 5,                                   // one direction of a separable Gaussian
    smooth: 6, sharpen: 7, background: 8,      // combine the input with its blur (uAux)
    median: 9, edges: 10, highlight: 11,
} as const

export const MAX_STOPS = 8

export const processShaderVS = `#version 300 es
    precision highp float;
    layout(location = 0) in vec2 aPosition;   // the shared -0.5..0.5 quad
    void main() { gl_Position = vec4(aPosition * 2.0, 0.0, 1.0); }`;

export const processShaderFS = `#version 300 es
    precision highp float;

    out vec4 outColor;

    uniform sampler2D uImage;   // this layer's input
    uniform sampler2D uAux;     // its blur, for the combine ops
    uniform bool  uGrey;        // uImage is the raw single-channel source
    uniform int   uOp;
    uniform vec4  uP;           // op parameters
    uniform vec2  uDir;         // blur direction, in pixels
    uniform float uMix;         // layer opacity
    uniform vec3  uColor;
    uniform vec3  uStops[${MAX_STOPS}];
    uniform int   uStopCount;

    ivec2 size;

    vec3 at(ivec2 p)
    {
        vec4 s = texelFetch(uImage, clamp(p, ivec2(0), size - 1), 0);
        return uGrey ? vec3(s.r) : s.rgb;
    }

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    // Sort two values per channel (for the median's sorting network).
    void sort2(inout vec3 a, inout vec3 b) { vec3 lo = min(a, b); b = max(a, b); a = lo; }

    void main()
    {
        size = textureSize(uImage, 0);
        ivec2 px = ivec2(gl_FragCoord.xy);
        vec3 src = at(px);
        vec3 c = src;

        if (uOp == ${OP.levels})        // levels: black, white, gamma
        {
            c = clamp((c - uP.x) / max(uP.y - uP.x, 1e-4), 0.0, 1.0);
            c = pow(c, vec3(1.0 / uP.z));
        }
        else if (uOp == ${OP.brightness})   // brightness, contrast
            c = (c - 0.5) * uP.y + 0.5 + uP.x;
        else if (uOp == ${OP.stretch})   // stretch: mode (0 asinh, 1 log, 2 sqrt, 3 square), strength
        {
            c = max(c, 0.0);
            float k = uP.y;
            if (uP.x < 0.5)      c = asinh(c * k) / asinh(k);
            else if (uP.x < 1.5) c = log(1.0 + c * k) / log(1.0 + k);
            else if (uP.x < 2.5) c = sqrt(c);
            else                 c = c * c;
        }
        else if (uOp == ${OP.invert})   // invert
            c = 1.0 - c;
        else if (uOp == ${OP.colormap})   // colour map by brightness
        {
            float t = clamp(luma(c), 0.0, 1.0) * float(uStopCount - 1);
            int i = min(int(t), uStopCount - 2);
            c = mix(uStops[i], uStops[i + 1], t - float(i));
        }
        else if (uOp == ${OP.blur})   // one pass of a Gaussian blur, sigma uP.x along uDir
        {
            float sigma = max(uP.x, 0.1);
            int radius = min(int(ceil(3.0 * sigma)), 120);
            vec3 sum = vec3(0.0);
            float total = 0.0;
            for (int i = -radius; i <= radius; i++)
            {
                float w = exp(-float(i * i) / (2.0 * sigma * sigma));
                sum += w * at(px + ivec2(uDir * float(i)));
                total += w;
            }
            c = sum / total;
        }
        else if (uOp == ${OP.smooth})   // smooth: the blur itself
            c = texelFetch(uAux, px, 0).rgb;
        else if (uOp == ${OP.sharpen})   // sharpen (unsharp mask): amount uP.x
            c = src + uP.x * (src - texelFetch(uAux, px, 0).rgb);
        else if (uOp == ${OP.background})   // remove background: minus the large-scale blur, plus a sky level uP.x
            c = src - texelFetch(uAux, px, 0).rgb + uP.x;
        else if (uOp == ${OP.median})   // 3x3 median, per channel (sorting network)
        {
            vec3 v0 = at(px + ivec2(-1, -1)), v1 = at(px + ivec2(0, -1)), v2 = at(px + ivec2(1, -1));
            vec3 v3 = at(px + ivec2(-1,  0)), v4 = src,                   v5 = at(px + ivec2(1,  0));
            vec3 v6 = at(px + ivec2(-1,  1)), v7 = at(px + ivec2(0,  1)), v8 = at(px + ivec2(1,  1));
            sort2(v1, v2); sort2(v4, v5); sort2(v7, v8); sort2(v0, v1); sort2(v3, v4); sort2(v6, v7);
            sort2(v1, v2); sort2(v4, v5); sort2(v7, v8); sort2(v0, v3); sort2(v5, v8); sort2(v4, v7);
            sort2(v3, v6); sort2(v1, v4); sort2(v2, v5); sort2(v4, v7); sort2(v4, v2); sort2(v6, v4);
            sort2(v4, v2);
            c = v4;
        }
        else if (uOp == ${OP.edges})  // Sobel edge magnitude, times strength uP.x
        {
            vec3 tl = at(px + ivec2(-1, 1)), t = at(px + ivec2(0, 1)), tr = at(px + ivec2(1, 1));
            vec3 l  = at(px + ivec2(-1, 0)),                           r  = at(px + ivec2(1, 0));
            vec3 bl = at(px + ivec2(-1,-1)), b = at(px + ivec2(0,-1)), br = at(px + ivec2(1,-1));
            vec3 gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
            vec3 gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
            c = sqrt(gx * gx + gy * gy) * uP.x * 0.25;
        }
        else if (uOp == ${OP.highlight})  // highlight: at or above level uP.x, painted uColor
        {
            float y = luma(c);
            if (y >= uP.x)
                c = uColor * (0.55 + 0.45 * y);
        }

        // The blur pass is internal to a layer, so opacity applies at its combine step.
        outColor = vec4(uOp == ${OP.blur} ? c : mix(src, c, uMix), 1.0);
    }`;
