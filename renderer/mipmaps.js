const mipmapShader = /* wgsl */ `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

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

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    return textureSampleLevel(source, sourceSampler, input.uv, 0);
}
`;

export const generateMipmaps = async (device, texture, mipLevelCount, layerCount) => {
    if (mipLevelCount === 1) return;

    const shader = device.createShaderModule({ code: mipmapShader });
    const pipeline = await device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: shader, entryPoint: 'vertexMain' },
        fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm-srgb' }] },
    });
    const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const encoder = device.createCommandEncoder();
    for (let layer = 0; layer < layerCount; layer++) {
        for (let level = 1; level < mipLevelCount; level++) {
            const view = (mip) => texture.createView({
                dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1,
                baseMipLevel: mip, mipLevelCount: 1,
            });
            const group = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: view(level - 1) }, { binding: 1, resource: sampler }],
            });
            const pass = encoder.beginRenderPass({
                colorAttachments: [{ view: view(level), loadOp: 'clear', storeOp: 'store' }],
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, group);
            pass.draw(3);
            pass.end();
        }
    }
    device.queue.submit([encoder.finish()]);
};
