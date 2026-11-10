import { BLOCK } from '../game/constants.js';
import { atmosphereShader } from './atmosphere.js';

// Linear RGB multiplier for the grayscale grass texture.
export const GRASS_TINT = [0.35, 0.8, 0.18];
export const AO_STRENGTH = 0.7;
// Distances from the camera, in blocks.
export const AO_FADE = { start: 64, end: 160 };

if (!Number.isFinite(AO_STRENGTH) || AO_STRENGTH < 0 || AO_STRENGTH > 1) {
    throw new Error('AO strength must be between 0 and 1.');
}

if (!Number.isFinite(AO_FADE.start) || !Number.isFinite(AO_FADE.end) ||
    AO_FADE.start < 0 || AO_FADE.end <= AO_FADE.start) {
    throw new Error('AO fade distances must be finite, nonnegative, and increasing.');
}

export const terrainShader = /* wgsl */ `
${atmosphereShader}
struct View {
    right: vec4f,
    up: vec4f,
    forward: vec4f,
    position: vec4f,
    projection: vec4f,
    fog: vec4f,
};
struct Chunk { origin: vec4f };
@group(0) @binding(0) var<uniform> view: View;
@group(1) @binding(0) var blockTexture: texture_2d_array<f32>;
@group(1) @binding(1) var blockSampler: sampler;
@group(2) @binding(0) var<uniform> chunk: Chunk;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) @interpolate(perspective, centroid) occlusion: f32,
    @location(2) relative: vec3f,
    @location(3) @interpolate(flat) material: u32,
    @location(4) @interpolate(flat) averageOcclusion: f32,
};

struct SkyOutput {
    @builtin(position) position: vec4f,
    @location(0) screen: vec2f,
};

fn aoMultiplier(occlusion: f32, averageOcclusion: f32, distance: f32) -> f32 {
    let blend = smoothstep(f32(${AO_FADE.start}), f32(${AO_FADE.end}), distance);
    let boundedOcclusion = clamp(mix(occlusion, averageOcclusion, blend), 0.0, 1.0);
    return 1.0 - ${AO_STRENGTH} * (1.0 - boundedOcclusion);
}

@vertex
fn skyVertex(@builtin(vertex_index) index: u32) -> SkyOutput {
    let positions = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    var output: SkyOutput;
    output.position = vec4f(positions[index], 1, 1);
    output.screen = positions[index];
    return output;
}

@fragment
fn skyFragment(input: SkyOutput) -> @location(0) vec4f {
    let direction = normalize(view.forward.xyz
        + view.right.xyz * input.screen.x / view.projection.x
        + view.up.xyz * input.screen.y / view.projection.y);
    return vec4f(skyColor(direction, view.position.y, view.fog.y), 0);
}

@vertex
fn vertexMain(@location(0) position: vec3f, @location(1) uv: vec2f,
              @location(2) material: u32, @location(3) occlusion: vec2f) -> VertexOutput {
    let relative = position + chunk.origin.xyz - view.position.xyz;
    let depth = dot(relative, view.forward.xyz);
    let near = view.projection.z;
    let far = view.projection.w;
    var output: VertexOutput;
    output.position = vec4f(dot(relative, view.right.xyz) * view.projection.x,
                            dot(relative, view.up.xyz) * view.projection.y,
                            far / (far - near) * (depth - near), depth);
    output.uv = uv;
    output.occlusion = occlusion.x;
    output.averageOcclusion = occlusion.y;
    output.relative = relative;
    output.material = material;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    var color = textureSample(blockTexture, blockSampler, input.uv, i32(input.material)).rgb;
    if (input.material == ${BLOCK.GRASS - 1}u) {
        color *= vec3f(${GRASS_TINT.join(', ')});
    }
    let distance = length(input.relative);
    color *= aoMultiplier(input.occlusion, input.averageOcclusion, distance);
    let direction = input.relative / max(distance, 0.0001);
    let opticalDepth = rayleighOpticalDepth(distance, view.position.y, view.position.y + input.relative.y, view.fog.y);
    let transmission = exp(-opticalDepth);
    let scattered = (vec3f(1.0) - transmission) * rayleighPhase(direction);
    let aerialColor = color * transmission + scattered;
    let fxaaAmount = smoothstep(view.fog.z, view.fog.w, distance);
    return vec4f(aerialColor, fxaaAmount);
}
`;
