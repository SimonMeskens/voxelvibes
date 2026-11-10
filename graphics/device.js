export const createDevice = async (onError) => {
    if (!navigator.gpu) {
        throw new Error('WebGPU is unavailable. Use a WebGPU-enabled browser in a secure context.');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No compatible WebGPU adapter was found.');
    const requiredFeatures = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
    const device = await adapter.requestDevice({ requiredFeatures });
    device.addEventListener('uncapturederror', (event) => {
        onError(`WebGPU error: ${event.error.message}`);
    });
    device.lost.then((info) => {
        if (info.reason !== 'destroyed') onError(`WebGPU device lost: ${info.message}`);
    });
    return device;
};

export const createBuffer = (device, data, usage) => {
    const buffer = device.createBuffer({
        size: Math.max(4, Math.ceil(data.byteLength / 4) * 4),
        usage,
        mappedAtCreation: true,
    });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    buffer.unmap();
    return buffer;
};
