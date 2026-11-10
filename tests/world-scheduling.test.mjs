import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_SIZE } from '../game/constants.js';
import { REBUILD_DISTANCE, selectChunks } from '../game/chunk-selection.js';
import { createWorld } from '../game/world.js';

const distanceToChunk = (position, cx, cz) => {
    const x = Math.max(cx * CHUNK_SIZE, Math.min(position.x, (cx + 1) * CHUNK_SIZE));
    const z = Math.max(cz * CHUNK_SIZE, Math.min(position.z, (cz + 1) * CHUNK_SIZE));
    return Math.hypot(position.x - x, position.z - z);
};

test('anchored selection covers the full render radius in all movement directions', () => {
    const radius = 128;
    for (const anchor of [{ x: -0.01, z: -16.01 }, { x: 127.9, z: -49.4 }]) {
        const wanted = selectChunks(anchor, radius);
        for (let angle = 0; angle < 360; angle += 15) {
            const radians = angle * Math.PI / 180;
            const position = {
                x: anchor.x + (REBUILD_DISTANCE - 0.001) * Math.cos(radians),
                z: anchor.z + (REBUILD_DISTANCE - 0.001) * Math.sin(radians),
            };
            const minX = Math.floor((position.x - radius) / CHUNK_SIZE);
            const maxX = Math.floor((position.x + radius) / CHUNK_SIZE);
            const minZ = Math.floor((position.z - radius) / CHUNK_SIZE);
            const maxZ = Math.floor((position.z + radius) / CHUNK_SIZE);
            for (let cx = minX; cx <= maxX; cx++) {
                for (let cz = minZ; cz <= maxZ; cz++) {
                    if (distanceToChunk(position, cx, cz) <= radius) {
                        assert.ok(wanted.has(`${cx},${cz}`), `Missing ${cx},${cz} at ${angle} degrees`);
                    }
                }
            }
        }
    }
});

test('collision data follows chunk loading, negative coordinates and eviction', (t) => {
    const originalWorker = globalThis.Worker;
    const workers = [];
    globalThis.Worker = class {
        constructor() { this.listeners = new Map(); this.jobs = []; workers.push(this); }
        addEventListener(type, listener) { this.listeners.set(type, listener); }
        postMessage(job) { this.jobs.push(job); }
        terminate() {}
        complete(job) {
            const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE).fill(5);
            this.listeners.get('message')({ data: { ...job, collisionData: { heights, holes: null },
                buffers: [], terrainTime: 1, meshTime: 1 } });
        }
    };
    t.after(() => { globalThis.Worker = originalWorker; });
    const renderer = { addChunk: () => ({}), removeChunk: () => {} };
    const world = createWorld(renderer, assert.fail, { renderDistance: 16, workerCount: 1, collision: true });
    const position = { x: -0.5, z: -0.5 };
    assert.equal(world.isSolid(-1, 5, -1), null);
    world.update(position);
    const job = workers[0].jobs[0];
    assert.deepEqual(job, { cx: -1, cz: -1, collision: true });
    workers[0].complete(job);
    world.update(position);
    assert.equal(world.isSolid(-1, 5, -1), true);
    assert.equal(world.isSolid(-1, 6, -1), false);
    assert.equal(world.isBlock(-1, 6, -1), true);
    assert.equal(world.isBlock(-1, 28, -1), false);
    world.update({ x: 1000, z: 1000 });
    assert.equal(world.isSolid(-1, 5, -1), null);
    assert.equal(world.isBlock(-1, 5, -1), null);
});

test('world retains nearby chunks, unloads on jumps, and rejects stale worker results', (t) => {
    const originalWorker = globalThis.Worker;
    const workers = [];
    globalThis.Worker = class {
        constructor() { this.listeners = new Map(); this.jobs = []; workers.push(this); }
        addEventListener(type, listener) { this.listeners.set(type, listener); }
        postMessage(job) { this.jobs.push(job); }
        terminate() {}
        complete(job) { this.listeners.get('message')({ data: { ...job, buffers: [], terrainTime: 1, meshTime: 1 } }); }
    };
    t.after(() => { globalThis.Worker = originalWorker; });
    const added = [];
    const removed = [];
    const timings = [];
    const renderer = {
        addChunk: (x, z) => { const chunk = { x, z }; added.push(chunk); return chunk; },
        removeChunk: (chunk) => removed.push(chunk),
    };
    const world = createWorld(renderer, assert.fail, { renderDistance: 16, workerCount: 2, onTiming: (value) => timings.push(value) });
    world.update({ x: -0.1, z: -0.1 });
    workers[0].complete(workers[0].jobs[0]);
    assert.equal(world.update({ x: -0.1, z: -0.1 }), 1);
    assert.equal(world.update({ x: -3.9, z: -0.1 }), 0);
    assert.equal(removed.length, 0);
    const stale = workers[1].jobs[0];
    workers[1].complete(stale);
    assert.equal(world.update({ x: 1000, z: -1000 }), 0);
    assert.deepEqual(removed, added);
    assert.ok(workers[1].jobs.at(-1).cx > 50);
    assert.equal(timings.length, 4);
    assert.deepEqual(timings.map(({ rebuilt }) => rebuilt), [true, false, false, true]);
});
