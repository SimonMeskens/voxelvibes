import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from '../renderer/renderer.js';
import { createFxaa, FXAA_SETTINGS } from '../renderer/fxaa.js';
import { BLOCK, SEA_LEVEL } from '../game/constants.js';
import { AO_FADE, AO_STRENGTH, GRASS_TINT, terrainShader } from '../renderer/shader.js';
import { RAYLEIGH_SETTINGS } from '../renderer/atmosphere.js';

test('Rayleigh scattering uses wavelength-dependent attenuation without distance fog', () => {
    const { scattering, heightFalloff, skyHorizonCurve, skyHorizonBias } = RAYLEIGH_SETTINGS;
    assert.ok(scattering[0] > 0 && scattering[0] < scattering[1] && scattering[1] < scattering[2]);
    assert.ok(heightFalloff > 0 && skyHorizonCurve > 0 && skyHorizonBias > 0);
    assert.ok(1 - Math.exp(-scattering[2] * 512) < 0.1);
    const zenithAirMass = 1 / (heightFalloff * (Math.sqrt(1 + skyHorizonCurve) + skyHorizonBias));
    const zenith = scattering.map((coefficient) => 1 - Math.exp(-coefficient * zenithAirMass));
    assert.ok(zenith[2] > zenith[1] * 1.8 && zenith[1] > zenith[0] * 1.8);
    assert.ok(zenith[2] < 0.5);
    assert.match(terrainShader, /rayleighOpticalDepth\(distance, view\.position\.y, view\.position\.y \+ input\.relative\.y, view\.fog\.y\)/);
    assert.match(terrainShader, /color \* transmission \+ scattered/);
    assert.match(terrainShader, /rayleighPhase\(direction\)/);
    assert.doesNotMatch(terrainShader, /edgeFade|view\.fog\.x/);
    assert.match(terrainShader, /return vec4f\(aerialColor, fxaaAmount\)/);
});

test('grass material alone uses a green linear-color multiplier', () => {
    assert.ok(GRASS_TINT[1] > GRASS_TINT[0] && GRASS_TINT[1] > GRASS_TINT[2]);
    assert.match(terrainShader, new RegExp(`if \\(input\\.material == ${BLOCK.GRASS - 1}u\\)`));
    assert.match(terrainShader, /color \*= vec3f\(0\.35, 0\.8, 0\.18\)/);
});

test('terrain uses ambient occlusion without directional lighting', () => {
    assert.ok(AO_STRENGTH >= 0 && AO_STRENGTH <= 1);
    assert.deepEqual(AO_FADE, { start: 64, end: 160 });
    assert.match(terrainShader, /let blend = smoothstep\(f32\(64\), f32\(160\), distance\)/);
    assert.match(terrainShader, /@interpolate\(perspective, centroid\) occlusion: f32/);
    assert.match(terrainShader, /clamp\(mix\(occlusion, averageOcclusion, blend\), 0\.0, 1\.0\)/);
    assert.ok(terrainShader.includes(`return 1.0 - ${AO_STRENGTH} * (1.0 - boundedOcclusion)`));
    assert.match(terrainShader, /color \*= aoMultiplier\(input\.occlusion, input\.averageOcclusion, distance\)/);
    assert.match(terrainShader, /@interpolate\(flat\) averageOcclusion: f32/);
    assert.match(terrainShader, /let fxaaAmount = smoothstep\(view\.fog\.z, view\.fog\.w, distance\)/);
    assert.doesNotMatch(terrainShader, /dot\(input\.normal, sunDirection\(\)\)/);
    assert.match(terrainShader, /return vec4f\(aerialColor, fxaaAmount\)/);
});

test('invalid FXAA fade distances are rejected', async () => {
    const previous = FXAA_SETTINGS.end;
    try {
        FXAA_SETTINGS.end = FXAA_SETTINGS.start;
        await assert.rejects(createFxaa({}, 'rgba8unorm'), /FXAA distances/);
    } finally {
        FXAA_SETTINGS.end = previous;
    }
});

test('one visible chunk uses one draw, array layers, and releases its buffers', async (t) => {
    const saved = new Map();
    const setGlobal = (name, value) => {
        saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    };
    t.after(() => {
        for (const [name, descriptor] of saved) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    });

    const createdBuffers = [];
    const textureCopies = [];
    const drawCalls = [];
    const mipDrawCalls = [];
    const textures = [];
    const samplers = [];
    const mipPasses = [];
    const bindGroups = [];
    const writes = [];
    const renderEvents = [];
    const pass = {
        setPipeline: (pipeline) => renderEvents.push(pipeline.entryPoint),
        setBindGroup() {}, setVertexBuffer() {}, setIndexBuffer() {}, end() {},
        drawIndexed: (count) => { renderEvents.push('chunk'); drawCalls.push(count); },
        draw: (count) => { renderEvents.push('draw'); mipDrawCalls.push(count); },
    };
    const device = {
        features: new Set(), limits: { maxTextureDimension2D: 4096 },
        lost: new Promise(() => {}), addEventListener() {},
        createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
        createRenderPipelineAsync: async (descriptor) => ({
            entryPoint: descriptor.vertex.entryPoint, getBindGroupLayout: () => ({}),
        }),
        createBuffer: ({ size }) => {
            const buffer = { data: new ArrayBuffer(size), destroyed: false,
                getMappedRange() { return this.data; }, unmap() {}, destroy() { this.destroyed = true; } };
            createdBuffers.push(buffer);
            return buffer;
        },
        createBindGroup: (descriptor) => { bindGroups.push(descriptor); return {}; },
        createSampler: (descriptor) => { samplers.push(descriptor); return {}; },
        createTexture: (descriptor) => {
            const texture = { descriptor, destroyed: false, createView: (options) => ({ texture, options }),
                destroy() { this.destroyed = true; } };
            textures.push(texture);
            return texture;
        },
        createCommandEncoder: () => ({
            beginRenderPass: (descriptor) => { mipPasses.push(descriptor); return pass; }, finish: () => ({}),
        }),
        queue: {
            copyExternalImageToTexture: (source, destination) => textureCopies.push({ source, destination }),
            writeBuffer: (buffer, offset, data) => writes.push(Array.from(data)),
            submit() {}, onSubmittedWorkDone: async () => 'completed',
        },
    };
    setGlobal('navigator', { gpu: {
        requestAdapter: async () => ({ features: new Set(), requestDevice: async () => device }),
        getPreferredCanvasFormat: () => 'bgra8unorm',
    } });
    setGlobal('window', { devicePixelRatio: 1 });
    setGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, VERTEX: 4, INDEX: 8 });
    setGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
    setGlobal('Image', class {
        naturalWidth = 16;
        naturalHeight = 16;
        set src(url) { this.url = url; queueMicrotask(() => this.onload()); }
    });
    const context = { configure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) };
    const canvas = { clientWidth: 800, clientHeight: 600, getContext: () => context };
    const renderer = await createRenderer(canvas, assert.fail);
    assert.equal(textures[0].descriptor.mipLevelCount, 5);
    assert.equal(samplers[0].magFilter, 'nearest');
    assert.equal(samplers[0].minFilter, 'nearest');
    assert.equal(samplers[0].mipmapFilter, 'linear');
    assert.deepEqual(mipDrawCalls, Array(16).fill(3));
    assert.deepEqual(mipPasses.map((descriptor) => [
        descriptor.colorAttachments[0].view.options.baseArrayLayer,
        descriptor.colorAttachments[0].view.options.baseMipLevel,
    ]), Array.from({ length: 16 }, (_, index) => [Math.floor(index / 4), index % 4 + 1]));
    assert.deepEqual(bindGroups.slice(2, 18).map((group) => [
        group.entries[0].resource.options.baseArrayLayer,
        group.entries[0].resource.options.baseMipLevel,
    ]), Array.from({ length: 16 }, (_, index) => [Math.floor(index / 4), index % 4]));
    assert.deepEqual(textureCopies.map(({ destination }) => destination.origin[2]), [0, 1, 2, 3]);
    assert.deepEqual(textureCopies.map(({ source }) => source.source.url.split('/').at(-1)),
        ['grass.png', 'dirt.png', 'stone.png', 'water.png']);

    const buffers = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
        uvs: new Float32Array(8),
        occlusion: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]),
        materials: new Uint32Array([0, 0, 0, 0]), indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    };
    const chunk = renderer.addChunk(0, 0, buffers);
    const camera = { position: { x: 0, y: 10, z: 0 }, yaw: 0, pitch: -Math.PI / 2, fov: Math.PI / 2, near: 0.1 };
    renderEvents.length = 0;
    assert.equal(renderer.render(camera), 1);
    assert.deepEqual(renderEvents, ['skyVertex', 'draw', 'vertexMain', 'chunk', 'vertexMain', 'draw']);
    assert.deepEqual(writes.at(-1).slice(-2), [FXAA_SETTINGS.start, FXAA_SETTINGS.end]);
    assert.equal(writes.at(-1)[20], 0);
    assert.equal(writes.at(-1)[21], SEA_LEVEL);
    assert.equal(mipPasses.at(-2).colorAttachments[0].resolveTarget.texture, textures[3]);
    assert.equal(mipPasses.at(-1).colorAttachments[0].loadOp, 'clear');
    assert.equal(mipDrawCalls.length, 18);
    assert.equal(textures[3].descriptor.usage, GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
    assert.deepEqual(drawCalls, [6]);
    assert.equal(renderer.stats().drawCalls, 1);
    assert.equal(renderer.stats().triangles, 2);
    assert.equal(await renderer.waitForGpu(), 'completed');
    assert.equal(renderer.stats().geometryBytes, 16 + 48 + 32 + 16 + 32 + 12);
    camera.position.x = 10000;
    assert.equal(renderer.render(camera), 0);
    assert.deepEqual(drawCalls, [6]);
    canvas.clientWidth = 640;
    assert.equal(renderer.render(camera), 0);
    assert.ok(textures.slice(1, 4).every((texture) => texture.destroyed));
    renderer.removeChunk(chunk);
    assert.equal(renderer.stats().geometryBytes, 0);
    assert.ok(createdBuffers.slice(1).every((buffer) => buffer.destroyed));
    assert.equal(renderer.render(camera), 0);
});
