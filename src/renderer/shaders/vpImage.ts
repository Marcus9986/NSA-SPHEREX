export const vpImageShaderVS = `#version 300 es
    precision highp float;

    layout(location = 0) in vec2 aPosition;
    layout(location = 1) in vec2 aTexCoord;

    out vec2 uTexCoord;

    uniform float uViewportAspectRatio;
    uniform float uImageAspectRatio;
    uniform float uZoom;   // 1 = default size
    uniform vec2  uPan;    // offset of the image centre, in clip space (-1..1)

    void main()
    {
        uTexCoord = aTexCoord;

        float aspectRatio = uViewportAspectRatio * uImageAspectRatio;
        vec2 position = vec2(aPosition.x * aspectRatio, aPosition.y) * uZoom + uPan;

        gl_Position = vec4(position, 0.0, 1.0);
    }`;

export const vpImageShaderFS = `#version 300 es
    precision highp float;

    in vec2 uTexCoord;
    
    out vec4 outColor;
    
    uniform sampler2D uImage;   // the source image, or the post-processing result
    uniform bool uGrey;         // single-channel source: show red as grey

    void main()
    {
        vec4 s = texture(uImage, uTexCoord);
        outColor = vec4(uGrey ? vec3(s.r) : clamp(s.rgb, 0.0, 1.0), 1.0);
    }`;