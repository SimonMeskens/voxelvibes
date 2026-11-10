import { CHUNK_SIZE, RENDER_DISTANCE, SEA_LEVEL } from './constants.js';
import { REBUILD_DISTANCE } from './chunk-selection.js';
import { selectLodRoots } from './lod-selection.js';
import { createChunkQueue } from '../generation/chunk-queue.js';
import { collisionSolidAt } from '../generation/collision-data.js';
import { readyLodRootGroups } from './lod-transitions.js';

export const createLodWorld = (renderer, onError, options = {}) => {
    const workers = [];
    try {
        for (let i = 0; i < (options.workerCount ?? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))); i++) {
            workers.push(new Worker(new URL('../generation/chunk-worker.js', import.meta.url), { type: 'module' }));
        }
    } catch (error) {
        workers.forEach((worker) => worker.terminate());
        throw new Error(`Could not start LOD workers: ${error.message}`, { cause: error });
    }
    const queue = createChunkQueue(workers, onError, { collision: options.collision });
    const resident = new Map();
    const displayed = new Map();
    const collision = new Map();
    let roots = new Map();
    let wanted = new Map();
    let anchor = null;
    let terrainTime = 0, meshTime = 0, samples = 0;
    let loaded = 0;
    let teleportCollision = null;

    const update = (position) => {
        if (teleportCollision && (collision.has(teleportCollision.key)
            || Math.abs(position.x - (teleportCollision.cx + 0.5) * CHUNK_SIZE) > CHUNK_SIZE * 2
            || Math.abs(position.z - (teleportCollision.cz + 0.5) * CHUNK_SIZE) > CHUNK_SIZE * 2)) {
            teleportCollision = null;
        }
        let rebuilt = false;
        if (!anchor || Math.hypot(position.x - anchor.x, position.z - anchor.z) >= REBUILD_DISTANCE) {
            rebuilt = true;
            anchor = { x: position.x, z: position.z };
            roots = selectLodRoots(anchor, options.renderDistance ?? RENDER_DISTANCE, roots);
            const selected = new Set();
            for (const leaves of roots.values()) for (const key of leaves.keys()) selected.add(key);
            for (const [root, leaves] of roots) {
                const updated = new Map();
                for (const [key, leaf] of leaves) {
                    if (leaf.level === 0) {
                        updated.set(key, leaf);
                        continue;
                    }
                    const neighbor = (dx, dz) => selected.has(`${leaf.level},${leaf.tx + dx},${leaf.tz + dz}`);
                    const edges = {
                        west: neighbor(-1, 0), east: neighbor(1, 0),
                        north: neighbor(0, -1), south: neighbor(0, 1),
                    };
                    const signature = Object.values(edges).map(Number).join('');
                    updated.set(`${key}:${signature}`, { ...leaf, edges });
                }
                roots.set(root, updated);
            }
            wanted = new Map();
            for (const leaves of roots.values()) for (const [key, leaf] of leaves) wanted.set(key, leaf);
            for (const [root, keys] of displayed) {
                if (roots.has(root)) continue;
                for (const key of keys) {
                    const item = resident.get(key);
                    renderer.removeChunk(item.mesh);
                    if (item.leaf.level === 0) collision.delete(`${item.leaf.tx},${item.leaf.tz}`);
                    item.mesh = undefined;
                    loaded--;
                }
                displayed.delete(root);
            }
        }
        const results = queue.update(wanted, resident);
        for (const result of results) {
            const leaf = wanted.get(result.key);
            if (leaf.level === 0 && options.collision && !result.collisionData) throw new Error(`Missing collision data for ${result.key}`);
            resident.set(result.key, { leaf, buffers: result.buffers, collisionData: result.collisionData,
                terrainTime: result.terrainTime ?? result.generationTime, meshTime: result.meshTime ?? 0 });
        }
        const retained = new Set([...displayed.values()].flatMap((keys) => [...keys]));
        for (const key of resident.keys()) if (!wanted.has(key) && !retained.has(key)) resident.delete(key);
        if (!rebuilt && results.length === 0) return 0;
        let added = 0;
        for (const group of readyLodRootGroups(roots, displayed, resident)) for (const root of group) {
            const leaves = roots.get(root);
            const old = displayed.get(root) ?? new Set();
            for (const key of old) {
                if (leaves.has(key)) continue;
                const item = resident.get(key);
                renderer.removeChunk(item.mesh);
                if (item.leaf.level === 0) collision.delete(`${item.leaf.tx},${item.leaf.tz}`);
                item.mesh = undefined;
                loaded--;
            }
            for (const [key, leaf] of leaves) {
                const item = resident.get(key);
                if (!old.has(key)) {
                    const size = CHUNK_SIZE * 2 ** leaf.level;
                    item.mesh = renderer.addChunk(leaf.tx * size, leaf.tz * size, item.buffers);
                    item.buffers = null;
                    if (leaf.level === 0 && item.collisionData) collision.set(`${leaf.tx},${leaf.tz}`, item.collisionData);
                    terrainTime += item.terrainTime;
                    meshTime += item.meshTime;
                    samples++;
                    loaded++;
                    added++;
                }
            }
            displayed.set(root, new Set(leaves.keys()));
        }
        const visible = new Set([...displayed.values()].flatMap((keys) => [...keys]));
        for (const key of resident.keys()) if (!wanted.has(key) && !visible.has(key)) resident.delete(key);
        return added;
    };
    const stats = () => {
        const result = { loaded, ...queue.stats(), terrainTime, meshTime, samples };
        terrainTime = 0; meshTime = 0; samples = 0;
        return result;
    };
    const isSolid = (x, y, z) => {
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
        const key = `${cx},${cz}`;
        const data = collision.get(key) ?? (teleportCollision?.key === key ? teleportCollision.data : null);
        return data ? collisionSolidAt(data, x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE) : null;
    };
    const isBlock = (x, y, z) => {
        const solid = isSolid(x, y, z);
        return solid === null ? null : solid || (y >= 0 && y <= SEA_LEVEL);
    };
    const setTeleportCollision = (target) => {
        teleportCollision = target ? { key: `${target.cx},${target.cz}`, cx: target.cx, cz: target.cz,
            data: target.collisionData } : null;
    };
    return { update, stats, isSolid, isBlock, setTeleportCollision };
};
