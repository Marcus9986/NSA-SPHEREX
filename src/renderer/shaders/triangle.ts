import type { ShaderSources } from '../types'

export const triangleShaders: ShaderSources = {
    vertex: `#version 300 es
        precision highp float;
        in vec2 aPosition;
        uniform vec2 uAspect;

        void main() {
            vec2 scaledPosition = aPosition * uAspect;
            gl_Position = vec4(scaledPosition, 0.0, 1.0);
        }
    `,
    fragment: `#version 300 es
        precision highp float;
        out vec4 outColor;

        void main() {
            outColor = vec4(0.20, 0.70, 1.0, 1.0);
        }
    `,
}
