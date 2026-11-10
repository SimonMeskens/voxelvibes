import { createBuffer, createDevice } from '../graphics/device.js';
import { createGpuTiming } from '../graphics/gpu-timing.js';
import { boxVisible, cameraBasis, frustumPlanes } from '../graphics/view.js';
import { RENDER_DISTANCE, SEA_LEVEL } from '../game/constants.js';
import { BLOCK_TEXTURE_FILTER, blockSamplerDescriptor, loadBlockTextures } from './textures.js';
import { generateMipmaps } from './mipmaps.js';
import { createFxaa, FXAA_SETTINGS } from './fxaa.js';
import { terrainShader } from './shader.js';

export const createRenderer = async (canvas, onError, options = {}) => {
    const renderDistance = options.renderDistance ?? RENDER_DISTANCE;
    const device = await createDevice(onError);
    const gpuTiming = createGpuTiming(device, onError);
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not create a WebGPU canvas context.');
    const format = navigator.gpu.getPreferredCanvasFormat();
    const colorFormat = `${format}-srgb`;
    context.configure({ device, format, viewFormats: [colorFormat], alphaMode: 'opaque' });

    const shader = device.createShaderModule({ code: terrainShader });
    const compilation = await shader.getCompilationInfo();
    const shaderErrors = compilation.messages.filter((message) => message.type === 'error');
    if (shaderErrors.length) throw new Error(shaderErrors.map((message) => message.message).join('\n'));

    const pipeline = await device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: {
            module: shader,
            entryPoint: 'vertexMain',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
                { arrayStride: 4, attributes: [{ shaderLocation: 2, offset: 0, format: 'uint32' }] },
                { arrayStride: 8, attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x2' }] },
            ],
        },
        fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{ format: colorFormat }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
        multisample: { count: 4 },
    });
    const skyPipeline = await device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: shader, entryPoint: 'skyVertex' },
        fragment: { module: shader, entryPoint: 'skyFragment', targets: [{ format: colorFormat }] },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
        multisample: { count: 4 },
    });

    const viewBuffer = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const viewGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: viewBuffer } }],
    });
    const skyGroup = device.createBindGroup({
        layout: skyPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: viewBuffer } }],
    });
    const sampler = device.createSampler(blockSamplerDescriptor(options.textureFilter ?? BLOCK_TEXTURE_FILTER));
    const images = await loadBlockTextures();
    const first = images.values().next().value;
    if (!first || !first.naturalWidth || !first.naturalHeight) throw new Error('Block textures are empty.');
    const mipLevelCount = Math.floor(Math.log2(Math.max(first.naturalWidth, first.naturalHeight))) + 1;
    const texture = device.createTexture({
        size: [first.naturalWidth, first.naturalHeight, images.size],
        mipLevelCount,
        format: 'rgba8unorm-srgb',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    for (const [type, image] of images) {
        if (type < 1 || type > images.size || image.naturalWidth !== first.naturalWidth || image.naturalHeight !== first.naturalHeight) {
            throw new Error(`Block texture ${type} has an invalid layer or dimensions.`);
        }
        device.queue.copyExternalImageToTexture(
            { source: image }, { texture, origin: [0, 0, type - 1] }, [image.naturalWidth, image.naturalHeight],
        );
    }
    await generateMipmaps(device, texture, mipLevelCount, images.size);
    const fxaa = FXAA_SETTINGS.enabled ? await createFxaa(device, colorFormat) : null;
    const textureGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(1),
        entries: [
            { binding: 0, resource: texture.createView({ dimension: '2d-array' }) },
            { binding: 1, resource: sampler },
        ],
    });

    const chunks = new Set();
    let geometryBytes = 0;
    let renderStats = { drawCalls: 0, triangles: 0 };
    let depthTexture;
    let colorTexture;
    let sceneTexture;
    let fxaaGroup;
    let width = 0;
    let height = 0;

    const resize = () => {
        const ratio = window.devicePixelRatio || 1;
        const limit = device.limits.maxTextureDimension2D;
        const newWidth = Math.max(1, Math.min(limit, Math.floor(canvas.clientWidth * ratio)));
        const newHeight = Math.max(1, Math.min(limit, Math.floor(canvas.clientHeight * ratio)));
        if (width === newWidth && height === newHeight) return;
        width = newWidth;
        height = newHeight;
        canvas.width = width;
        canvas.height = height;
        if (depthTexture) depthTexture.destroy();
        if (colorTexture) colorTexture.destroy();
        if (sceneTexture) sceneTexture.destroy();
        depthTexture = device.createTexture({
            size: [width, height],
            format: 'depth24plus',
            sampleCount: 4,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        colorTexture = device.createTexture({
            size: [width, height],
            format: colorFormat,
            sampleCount: 4,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        if (fxaa) {
            sceneTexture = device.createTexture({
                size: [width, height], format: colorFormat,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            });
            fxaaGroup = fxaa.bind(sceneTexture);
        }
    };

    const addChunk = (x, z, buffers) => {
        if (!buffers.indices.length) return null;
        const origin = createBuffer(device, new Float32Array([x, 0, z, 0]), GPUBufferUsage.UNIFORM);
        const group = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(2),
            entries: [{ binding: 0, resource: { buffer: origin } }],
        });
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let chunkBytes = 16;
        const { positions, uvs, materials, occlusion, indices } = buffers;
        for (const data of [positions, uvs, materials, occlusion, indices]) {
            chunkBytes += Math.max(4, Math.ceil(data.byteLength / 4) * 4);
        }
        for (let i = 0; i < positions.length; i += 3) {
            minX = Math.min(minX, positions[i]);
            minY = Math.min(minY, positions[i + 1]);
            minZ = Math.min(minZ, positions[i + 2]);
            maxX = Math.max(maxX, positions[i]);
            maxY = Math.max(maxY, positions[i + 1]);
            maxZ = Math.max(maxZ, positions[i + 2]);
        }
        const vertices = [
            createBuffer(device, positions, GPUBufferUsage.VERTEX),
            createBuffer(device, uvs, GPUBufferUsage.VERTEX),
            createBuffer(device, materials, GPUBufferUsage.VERTEX),
            createBuffer(device, occlusion, GPUBufferUsage.VERTEX),
        ];
        const originX = Math.fround(x);
        const originZ = Math.fround(z);
        const center = [(minX + maxX) / 2 + originX, (minY + maxY) / 2, (minZ + maxZ) / 2 + originZ];
        // The shader adds local positions to float32 chunk origins before culling can occur.
        const halfSize = [(maxX - minX) / 2 + (Math.abs(originX) + maxX) * 2 ** -23,
            (maxY - minY) / 2, (maxZ - minZ) / 2 + (Math.abs(originZ) + maxZ) * 2 ** -23];
        const chunk = { origin, group, vertices, indices: createBuffer(device, indices, GPUBufferUsage.INDEX),
            indexFormat: indices instanceof Uint32Array ? 'uint32' : 'uint16',
            indexCount: indices.length, center, halfSize, bytes: chunkBytes };
        chunks.add(chunk);
        geometryBytes += chunk.bytes;
        return chunk;
    };

    const removeChunk = (chunk) => {
        if (!chunk) return;
        if (chunks.delete(chunk)) geometryBytes -= chunk.bytes;
        chunk.origin.destroy();
        chunk.vertices.forEach((buffer) => buffer.destroy());
        chunk.indices.destroy();
    };

    const render = (camera, measureGpu = false) => {
        resize();
        const aspect = width / height;
        const basis = cameraBasis(camera.yaw, camera.pitch);
        const cullingPosition = {
            x: Math.fround(camera.position.x), y: Math.fround(camera.position.y), z: Math.fround(camera.position.z),
        };
        const heightOffset = Math.max(0, camera.position.y - SEA_LEVEL);
        const far = renderDistance * 1.2 + heightOffset;
        const planes = frustumPlanes(camera, basis, aspect, far);
        const f = 1 / Math.tan(camera.fov / 2);
        device.queue.writeBuffer(viewBuffer, 0, new Float32Array([
            ...basis.right, 0, ...basis.up, 0, ...basis.forward, 0,
            camera.position.x, camera.position.y, camera.position.z, 0,
            f / aspect, f, camera.near, far,
            0, SEA_LEVEL, FXAA_SETTINGS.start, FXAA_SETTINGS.end,
        ]));
        const encoder = device.createCommandEncoder();
        const timestamps = gpuTiming.begin(measureGpu, performance.now());
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: colorTexture.createView(),
                resolveTarget: fxaa ? sceneTexture.createView() : context.getCurrentTexture().createView({ format: colorFormat }),
                clearValue: { r: 0.242, g: 0.617, b: 0.831, a: 0 },
                loadOp: 'clear', storeOp: 'discard',
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(), depthClearValue: 1,
                depthLoadOp: 'clear', depthStoreOp: 'store',
            },
            ...(timestamps ? { timestampWrites: timestamps } : {}),
        });
        pass.setPipeline(skyPipeline);
        pass.setBindGroup(0, skyGroup);
        pass.draw(3);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, viewGroup);
        pass.setBindGroup(1, textureGroup);
        let renderedChunks = 0;
        let drawCalls = 0;
        let triangles = 0;
        for (const chunk of chunks) {
            if (!boxVisible(planes, cullingPosition, chunk.center, chunk.halfSize)) continue;
            renderedChunks++;
            pass.setBindGroup(2, chunk.group);
            drawCalls++;
            triangles += chunk.indexCount / 3;
            chunk.vertices.forEach((buffer, index) => pass.setVertexBuffer(index, buffer));
            pass.setIndexBuffer(chunk.indices, chunk.indexFormat);
            pass.drawIndexed(chunk.indexCount);
        }
        pass.end();
        gpuTiming.end(encoder, timestamps);
        if (fxaa) fxaa.render(encoder, fxaaGroup, context.getCurrentTexture().createView({ format: colorFormat }));
        device.queue.submit([encoder.finish()]);
        gpuTiming.read(timestamps);
        renderStats = { drawCalls, triangles };
        return renderedChunks;
    };

    const stats = () => ({ ...renderStats, geometryBytes, gpuTime: gpuTiming.value(), gpuTimeMs: gpuTiming.valueMs() });
    const waitForGpu = () => device.queue.onSubmittedWorkDone();
    return { addChunk, removeChunk, render, stats, waitForGpu };
};
