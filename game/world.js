import { CHUNK_SIZE, RENDER_DISTANCE, SEA_LEVEL } from './constants.js';
import { createChunkQueue } from '../generation/chunk-queue.js';
import { REBUILD_DISTANCE, selectChunks } from './chunk-selection.js';
import { collisionSolidAt } from '../generation/collision-data.js';

export const createWorld = (renderer, onError, options = {}) => {
    const chunks = new Map();
    const collisionChunks = new Map();
    const renderDistance = options.renderDistance ?? RENDER_DISTANCE;
    const workerCount = options.workerCount ?? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    const workers = [];
    try {
        for (let i = 0; i < workerCount; i++) {
            workers.push(new Worker(new URL('../generation/chunk-worker.js', import.meta.url), { type: 'module' }));
        }
    } catch (error) {
        workers.forEach((worker) => worker.terminate());
        onError(`Could not start chunk workers: ${error.message}`);
        return { update: () => 0, isSolid: () => null, isBlock: () => null,
            stats: () => ({ loaded: 0, pending: 0, inFlight: 0, terrainTime: 0, meshTime: 0, samples: 0 }) };
    }
    const queue = createChunkQueue(workers, onError, options);
    let wanted = new Map();
    let anchor = null;
    let terrainTime = 0;
    let meshTime = 0;
    let samples = 0;

    const update = (position) => {
        const timing = options.onTiming ? { wantedMs: 0, queueMs: 0, uploadMs: 0, rebuilt: false } : null;
        let started = timing ? performance.now() : 0;
        if (!anchor || Math.hypot(position.x - anchor.x, position.z - anchor.z) >= REBUILD_DISTANCE) {
            if (timing) timing.rebuilt = true;
            anchor = { x: position.x, z: position.z };
            wanted = selectChunks(anchor, renderDistance);
            for (const [key, meshes] of chunks) {
                if (!wanted.has(key)) {
                    renderer.removeChunk(meshes);
                    chunks.delete(key);
                    collisionChunks.delete(key);
                }
            }
        }

        if (timing) {
            timing.wantedMs = performance.now() - started;
            started = performance.now();
        }
        const results = queue.update(wanted, chunks);
        if (timing) {
            timing.queueMs = performance.now() - started;
            started = performance.now();
        }
        for (const { key, cx, cz, buffers, collisionData, terrainTime: terrain, meshTime: mesh } of results) {
            if (options.collision && !collisionData) throw new Error(`Missing collision data for chunk ${key}`);
            const meshes = renderer.addChunk(cx * CHUNK_SIZE, cz * CHUNK_SIZE, buffers);
            chunks.set(key, meshes);
            if (collisionData) collisionChunks.set(key, collisionData);
            terrainTime += terrain;
            meshTime += mesh;
            samples++;
        }
        if (timing) {
            timing.uploadMs = performance.now() - started;
            options.onTiming(timing);
        }
        return results.length;
    };

    const stats = () => {
        const result = { loaded: chunks.size, ...queue.stats(), terrainTime, meshTime, samples };
        terrainTime = 0;
        meshTime = 0;
        samples = 0;
        return result;
    };

    const isSolid = (x, y, z) => {
        const cx = Math.floor(x / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);
        const data = collisionChunks.get(`${cx},${cz}`);
        if (!data) return null;
        return collisionSolidAt(data, x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
    };

    const isBlock = (x, y, z) => {
        const solid = isSolid(x, y, z);
        if (solid === null) return null;
        return solid || (y >= 0 && y <= SEA_LEVEL);
    };

    return { update, stats, isSolid, isBlock };
};
