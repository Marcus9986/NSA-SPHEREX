export const vpImageShaderVS = `#version 300 es
    precision highp float;

    layout(location = 0) in vec2 aPosition;
    layout(location = 1) in vec2 aTexCoord;

    out vec2 uTexCoord;

    uniform float uViewportAspectRatio;
    uniform float uImageAspectRatio;

    void main()
    {
        uTexCoord = aTexCoord;

        float aspectRatio = uViewportAspectRatio * uImageAspectRatio;
        vec2 position = vec2(aPosition.x * aspectRatio, aPosition.y);

        gl_Position = vec4(position, 0.0, 1.0);
    }`;

export const vpImageShaderFS = `#version 300 es
    precision highp float;

    in vec2 uTexCoord;
    
    out vec4 outColor;
    
    uniform sampler2D uImage;

    void main()
    {
        float brightness = texture(uImage, uTexCoord).r;
        outColor = vec4(vec3(brightness), 1.0);
    }`;