// Distances are measured from the camera in blocks.
export const FXAA_SETTINGS = { enabled: true, start: 64, end: 160 };

export const fxaaShader = /* wgsl */ `
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
    let positions = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    let position = positions[index];
    var output: VertexOutput;
    output.position = vec4f(position, 0, 1);
    output.uv = position * vec2f(0.5, -0.5) + vec2f(0.5);
    return output;
}

fn luminance(color: vec3f) -> f32 {
    return dot(color, vec3f(0.299, 0.587, 0.114));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let pixel = 1.0 / vec2f(textureDimensions(scene));
    let center = textureSampleLevel(scene, sceneSampler, input.uv, 0);
    if (center.a <= 0.0) {
        return vec4f(center.rgb, 1);
    }

    let nw = textureSampleLevel(scene, sceneSampler, input.uv + pixel * vec2f(-1, -1), 0).rgb;
    let ne = textureSampleLevel(scene, sceneSampler, input.uv + pixel * vec2f(1, -1), 0).rgb;
    let sw = textureSampleLevel(scene, sceneSampler, input.uv + pixel * vec2f(-1, 1), 0).rgb;
    let se = textureSampleLevel(scene, sceneSampler, input.uv + pixel * vec2f(1, 1), 0).rgb;
    let lumaNW = luminance(nw);
    let lumaNE = luminance(ne);
    let lumaSW = luminance(sw);
    let lumaSE = luminance(se);
    let lumaCenter = luminance(center.rgb);
    let minimum = min(lumaCenter, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    let maximum = max(lumaCenter, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
    if (maximum - minimum < max(0.0312, maximum * 0.125)) {
        return vec4f(center.rgb, 1);
    }

    var direction = vec2f(-((lumaNW + lumaNE) - (lumaSW + lumaSE)),
                          (lumaNW + lumaSW) - (lumaNE + lumaSE));
    let reduction = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.03125, 0.0078125);
    direction = clamp(direction / (min(abs(direction.x), abs(direction.y)) + reduction),
                      vec2f(-8), vec2f(8)) * pixel;
    let a = 0.5 * (textureSampleLevel(scene, sceneSampler, input.uv - direction / 6.0, 0).rgb +
                   textureSampleLevel(scene, sceneSampler, input.uv + direction / 6.0, 0).rgb);
    let b = a * 0.5 + 0.25 * (textureSampleLevel(scene, sceneSampler, input.uv - direction * 0.5, 0).rgb +
                                textureSampleLevel(scene, sceneSampler, input.uv + direction * 0.5, 0).rgb);
    let lumaB = luminance(b);
    let filtered = select(b, a, lumaB < minimum || lumaB > maximum);
    return vec4f(mix(center.rgb, filtered, center.a), 1);
}
`;

export const createFxaa = async (device, format) => {
    if (!Number.isFinite(FXAA_SETTINGS.start) || !Number.isFinite(FXAA_SETTINGS.end) ||
        FXAA_SETTINGS.start < 0 || FXAA_SETTINGS.end <= FXAA_SETTINGS.start) {
        throw new Error('FXAA distances must be finite, nonnegative, and increasing.');
    }
    const shader = device.createShaderModule({ code: fxaaShader });
    const pipeline = await device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: shader, entryPoint: 'vertexMain' },
        fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{ format }] },
    });
    const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const bind = (texture) => device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: sampler }],
    });
    const render = (encoder, group, target) => {
        const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store' }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
    };
    return { bind, render };
};
