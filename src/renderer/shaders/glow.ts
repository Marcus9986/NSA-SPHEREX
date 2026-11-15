// Soft halo drawn behind the viewport image, so its edges stand out a little from the
// background. Uses the same quad and view uniforms as the image shader, scaled up by
// uGlowScale; the fragment shader fades the glow out with distance from the image edge.

export const glowShaderVS = `#version 300 es
    precision highp float;

    layout(location = 0) in vec2 aPosition;

    out vec2 vLocal;   // position in image units: the image itself spans -0.5..0.5

    uniform float uViewportAspectRatio;
    uniform float uImageAspectRatio;
    uniform float uZoom;
    uniform vec2  uPan;
    uniform float uGlowScale;

    void main()
    {
        vec2 local = aPosition * uGlowScale;
        vLocal = local;

        float aspectRatio = uViewportAspectRatio * uImageAspectRatio;
        vec2 position = vec2(local.x * aspectRatio, local.y) * uZoom + uPan;

        gl_Position = vec4(position, 0.0, 1.0);
    }`;

export const glowShaderFS = `#version 300 es
    precision highp float;

    in vec2 vLocal;

    out vec4 outColor;

    uniform float uImageAspectRatio;
    uniform float uGlowRadius;     // falloff distance, in units of the image height
    uniform float uGlowStrength;   // opacity right at the image edge
    uniform vec3  uGlowColor;

    void main()
    {
        // Distance outside the image rectangle, measured in image heights in both
        // directions so the glow is equally wide on every side.
        vec2 outside = max(abs(vLocal) - 0.5, 0.0) * vec2(uImageAspectRatio, 1.0);
        float alpha = uGlowStrength * exp(-length(outside) / uGlowRadius);

        // The canvas uses premultiplied alpha.
        outColor = vec4(uGlowColor * alpha, alpha);
    }`;
