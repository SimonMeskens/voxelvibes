// Sample one render pass at a time; never wait for the GPU on the render loop.
export const createGpuTiming = (device, onError) => {
    if (!device.features.has('timestamp-query')) {
        return { begin: () => null, end: () => {}, read: () => {}, value: () => 'Unavailable', valueMs: () => null };
    }

    const querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
    const resolveBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    const readBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    let pending = false;
    let lastSample = -Infinity;
    let milliseconds = null;
    let failed = false;

    const begin = (enabled, time) => {
        if (!enabled || pending || failed || time - lastSample < 1000) return null;
        pending = true;
        lastSample = time;
        return { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
    };

    const end = (encoder, timestamps) => {
        if (!timestamps) return;
        encoder.resolveQuerySet(querySet, 0, 2, resolveBuffer, 0);
        encoder.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, 16);
    };

    const read = (timestamps) => {
        if (!timestamps) return;
        readBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const values = new BigUint64Array(readBuffer.getMappedRange());
            milliseconds = Number(values[1] - values[0]) / 1e6;
            readBuffer.unmap();
            pending = false;
        }).catch((error) => {
            failed = true;
            pending = false;
            onError(`GPU timing failed: ${error.message}`);
        });
    };

    const value = () => failed ? 'Failed' : milliseconds === null ? 'Waiting for sample' : `${milliseconds.toFixed(2)} ms`;
    const valueMs = () => failed ? null : milliseconds;
    return { begin, end, read, value, valueMs };
};
