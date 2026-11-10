// Rates include the whole elapsed interval, including time spent rendering.
export const createPerformanceMeter = (fpsElement, lowFpsElement, chunkRateElement, renderedChunksElement, distanceElement, renderDistance, startTime, details = null) => {
    distanceElement.textContent = renderDistance.toString();
    let intervalStart = startTime;
    let frames = 0;
    let chunks = 0;
    let previousFrame = startTime;
    let frameTimes = [];

    const recordFrame = (time, chunksBuilt, renderedChunks, getStats) => {
        frames++;
        chunks += chunksBuilt;
        frameTimes.push(time - previousFrame);
        previousFrame = time;

        const elapsed = (time - intervalStart) / 1000;
        if (elapsed < 1) return;

        frameTimes.sort((a, b) => a - b);
        const slowestCount = Math.ceil(frameTimes.length * 0.01);
        const slowestTime = frameTimes.slice(-slowestCount).reduce((sum, value) => sum + value, 0);
        fpsElement.textContent = (frames / elapsed).toFixed(1);
        lowFpsElement.textContent = (slowestCount * 1000 / slowestTime).toFixed(1);
        chunkRateElement.textContent = (chunks / elapsed).toFixed(1);
        renderedChunksElement.textContent = renderedChunks.toString();
        if (details && getStats) {
            const { world, renderer, position } = getStats();
            if (details.isOpen()) {
                const average = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
                const p95 = frameTimes[Math.ceil(frameTimes.length * 0.95) - 1];
                details.position.textContent = `${position.x.toFixed(1)} / ${position.y.toFixed(1)} / ${position.z.toFixed(1)}`;
                details.frameTimes.textContent = `${average.toFixed(1)} / ${p95.toFixed(1)} ms`;
                details.workerTimes.textContent = world.samples
                    ? `${(world.terrainTime / world.samples).toFixed(1)} / ${(world.meshTime / world.samples).toFixed(1)} ms`
                    : '-- (idle)';
                details.queueSize.textContent = `${world.pending} / ${world.inFlight}`;
                details.loadedChunks.textContent = world.loaded.toString();
                details.drawCalls.textContent = renderer.drawCalls.toLocaleString();
                details.triangles.textContent = renderer.triangles.toLocaleString();
                details.bufferMemory.textContent = `${(renderer.geometryBytes / (1024 * 1024)).toFixed(1)} MiB`;
                details.gpuTime.textContent = renderer.gpuTime;
            }
        }
        intervalStart = time;
        frames = 0;
        chunks = 0;
        frameTimes = [];
    };

    return { recordFrame };
};
