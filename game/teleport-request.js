export const requestTeleportTarget = (origin, direction, distance, onResult, onError) => {
    const worker = new Worker(new URL('../generation/teleport-worker.js', import.meta.url), { type: 'module' });
    const cancel = () => worker.terminate();
    worker.addEventListener('message', ({ data }) => {
        cancel();
        onResult(data);
    });
    const fail = (event) => {
        cancel();
        onError(event.message || 'Teleport worker failed to send its result.');
    };
    worker.addEventListener('error', fail);
    worker.addEventListener('messageerror', fail);
    try {
        worker.postMessage({ origin, direction, distance });
    } catch (error) {
        cancel();
        throw error;
    }
    return cancel;
};
