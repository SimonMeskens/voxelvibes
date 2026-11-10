import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLodRoots, LOD_SETTINGS } from '../game/lod-selection.js';
import { createLodWorld } from '../game/lod-world.js';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../game/constants.js';

test('quadtree roots have complete non-overlapping coverage and full resolution nearby', () => {
    for (const position of [{ x: 0.5, z: 0.5 }, { x: -47.5, z: -129.2 }]) {
        const roots = selectLodRoots(position, 512);
        for (const [root, leaves] of roots) {
            const [rx, rz] = root.split(',').map(Number);
            const cells = new Set();
            for (const leaf of leaves.values()) {
                const width = 2 ** leaf.level;
                for (let x = 0; x < width; x++) for (let z = 0; z < width; z++) {
                    const cx = leaf.tx * width + x, cz = leaf.tz * width + z;
                    assert.equal(Math.floor(cx / 4), rx);
                    assert.equal(Math.floor(cz / 4), rz);
                    const key = `${cx},${cz}`;
                    assert.ok(!cells.has(key));
                    cells.add(key);
                }
                if (leaf.distance < LOD_SETTINGS.nearRadius) assert.equal(leaf.level, 0);
            }
            assert.equal(cells.size, 16);
        }
    }
});

test('split hysteresis retains refinement near a boundary', () => {
    const root = '5,0';
    const initial = selectLodRoots({ x: 70, z: 1 }, 512);
    assert.ok(initial.get(root).size > 1);
    const retained = selectLodRoots({ x: 55, z: 1 }, 512, initial);
    assert.ok(retained.get(root).size > 1);
    const fresh = selectLodRoots({ x: 55, z: 1 }, 512);
    assert.equal(fresh.get(root).size, 1);
});

test('workers receive level-specific jobs and stale results are discarded after jumps', (t) => {
    const original = globalThis.Worker;
    const workers = [];
    globalThis.Worker = class {
        constructor() { this.listeners = new Map(); this.jobs = []; workers.push(this); }
        addEventListener(type, cb) { this.listeners.set(type, cb); }
        postMessage(job) { this.jobs.push(job); }
        terminate() {}
        complete(job) { this.listeners.get('message')({ data: { ...job, buffers: {}, terrainTime: 1, meshTime: 1, generationTime: 1 } }); }
    };
    t.after(() => { globalThis.Worker = original; });
    const added = [];
    const removed = [];
    const world = createLodWorld({ addChunk: (x, z) => { const item = { x, z }; added.push(item); return item; },
        removeChunk: (item) => removed.push(item) }, assert.fail, { renderDistance: 300, workerCount: 1 });
    world.update({ x: 0, z: 0 });
    const old = workers[0].jobs[0];
    assert.ok('cx' in old);
    workers[0].complete(old);
    world.update({ x: 2000, z: 2000 });
    assert.equal(world.stats().loaded, 0);
    assert.equal(added.length, 0);
    assert.equal(removed.length, 0);
    assert.ok(workers[0].jobs.at(-1).cx > 100);
});

test('coarse parents remain visible until all replacements are ready, in both directions', (t) => {
    const original = globalThis.Worker;
    const workers = [];
    globalThis.Worker = class {
        constructor() { this.listeners = new Map(); this.jobs = []; this.completed = 0; workers.push(this); }
        addEventListener(type, cb) { this.listeners.set(type, cb); }
        postMessage(job) { this.jobs.push(job); }
        terminate() {}
        finish() {
            const job = this.jobs[this.completed++];
            this.listeners.get('message')({ data: { ...job, buffers: { spacing: job.spacing ?? 1 },
                terrainTime: 1, meshTime: 1, generationTime: 1 } });
        }
    };
    t.after(() => { globalThis.Worker = original; });
    const visible = new Set();
    const renderer = {
        addChunk: (x, z, buffers) => { const item = { x, z, size: CHUNK_SIZE * buffers.spacing };
            visible.add(item); return item; },
        removeChunk: (item) => { assert.ok(visible.delete(item)); },
    };
    const world = createLodWorld(renderer, assert.fail, { renderDistance: 350, workerCount: 4 });
    const rootCoveredExactlyOnce = () => {
        for (let x = 320; x < 384; x += CHUNK_SIZE) for (let z = 0; z < 64; z += CHUNK_SIZE) {
            assert.equal([...visible].filter((item) => x >= item.x && x < item.x + item.size &&
                z >= item.z && z < item.z + item.size).length, 1, `Coverage at ${x},${z}`);
        }
    };
    const finishAll = (position, check = () => {}) => {
        for (let i = 0; i < 5000; i++) {
            for (const worker of workers) if (worker.completed < worker.jobs.length) worker.finish();
            world.update(position);
            check();
            const s = world.stats();
            if (!s.pending && !s.inFlight) return;
        }
        assert.fail('workers did not settle');
    };
    const far = { x: 0, z: 0 };
    world.update(far);
    finishAll(far);
    assert.ok(workers.some((worker) => worker.jobs.some((job) =>
        job.type === 'coarse' && job.spacing === 4 && job.seamless === true)));
    assert.ok(workers.some((worker) => worker.jobs.some((job) =>
        job.spacing === 2 && Object.values(job.edges).some(Boolean))),
    'same-level siblings should receive coarse edge settings');
    assert.ok(workers.some((worker) => worker.jobs.some((job) =>
        job.spacing === 4 && Object.values(job.edges).some(Boolean))),
    'same-level neighboring roots should receive coarse edge settings');
    const parent = [...visible].find((item) => item.x === 320 && item.z === 0);
    assert.ok(parent);
    const near = { x: 200, z: 0 };
    world.update(near);
    assert.ok(visible.has(parent));
    rootCoveredExactlyOnce();
    for (const worker of workers) if (worker.completed < worker.jobs.length) worker.finish();
    world.update(near);
    assert.ok(visible.has(parent));
    rootCoveredExactlyOnce();
    finishAll(near, rootCoveredExactlyOnce);
    assert.ok(!visible.has(parent));
    assert.ok([...visible].some((item) => item.x === 320 && item.z === 0));
    const fine = [...visible].filter((item) => item.x >= 320 && item.x < 384 && item.z >= 0 && item.z < 64);
    assert.ok(fine.length > 1);
    world.update(far);
    assert.ok(fine.every((item) => visible.has(item)));
    rootCoveredExactlyOnce();
    finishAll(far, rootCoveredExactlyOnce);
    assert.ok(fine.every((item) => !visible.has(item)));
    assert.ok([...visible].some((item) => item.x === 320 && item.z === 0));
});

test('moving continuously publishes ready regions without waiting for the entire wanted area', (t) => {
    const original = globalThis.Worker;
    const workers = [];
    globalThis.Worker = class {
        constructor() { this.listeners = new Map(); this.jobs = []; this.completed = 0; workers.push(this); }
        addEventListener(type, cb) { this.listeners.set(type, cb); }
        postMessage(job) { this.jobs.push(job); }
        terminate() {}
        finish() {
            const job = this.jobs[this.completed++];
            this.listeners.get('message')({ data: { ...job, buffers: {}, terrainTime: 1, meshTime: 1, generationTime: 1 } });
        }
    };
    t.after(() => { globalThis.Worker = original; });
    const world = createLodWorld({ addChunk: () => ({}), removeChunk: () => {} }, assert.fail,
        { renderDistance: 350, workerCount: 4 });
    world.update({ x: 0, z: 0 });
    let additionsWhilePending = 0;
    for (let i = 0; i < 250; i++) {
        for (const worker of workers) if (worker.completed < worker.jobs.length) worker.finish();
        const added = world.update({ x: i * 2, z: 0 });
        const state = world.stats();
        if (state.pending || state.inFlight) additionsWhilePending += added;
    }
    assert.ok(additionsWhilePending > 0, 'ready regions must appear while the wanted set keeps changing');
});

test('collision uses only displayed full-resolution chunks and is evicted on jumps', (t) => {
    const original = globalThis.Worker;
    const workers = [];
    globalThis.Worker = class {
        constructor() { this.listeners = new Map(); this.jobs = []; this.completed = 0; workers.push(this); }
        addEventListener(type, cb) { this.listeners.set(type, cb); }
        postMessage(job) { this.jobs.push(job); }
        terminate() {}
        finish() {
            const job = this.jobs[this.completed++];
            const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE).fill(5);
            const holes = new Uint8Array(Math.ceil(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT / 8));
            const index = (15 * CHUNK_SIZE + 15) * WORLD_HEIGHT + 4;
            holes[index >> 3] |= 1 << (index & 7);
            const collisionData = job.collision ? { heights, holes } : null;
            this.listeners.get('message')({ data: { ...job, collisionData, buffers: {}, terrainTime: 1, meshTime: 1 } });
        }
    };
    t.after(() => { globalThis.Worker = original; });
    const world = createLodWorld({ addChunk: () => ({}), removeChunk: () => {} }, assert.fail,
        { renderDistance: 16, workerCount: 4, collision: true });
    const position = { x: -0.5, z: -0.5 };
    world.update(position);
    assert.equal(world.isSolid(-1, 5, -1), null);
    for (let i = 0; i < 1000 && world.isSolid(-1, 5, -1) === null; i++) {
        for (const worker of workers) if (worker.completed < worker.jobs.length) worker.finish();
        world.update(position);
    }
    assert.equal(world.isSolid(-1, 5, -1), true);
    assert.equal(world.isSolid(-1, 4, -1), false);
    assert.equal(world.isSolid(-1, 6, -1), false);
    assert.equal(world.isBlock(-1, 6, -1), true);
    world.update({ x: 1000, z: 1000 });
    assert.equal(world.isSolid(-1, 5, -1), null);
});

test('worker errors stop the queue and reach the caller', (t) => {
    const original = globalThis.Worker;
    const workers = [];
    globalThis.Worker = class {
        constructor() { this.listeners = new Map(); this.terminated = false; workers.push(this); }
        addEventListener(type, cb) { this.listeners.set(type, cb); }
        postMessage() {}
        terminate() { this.terminated = true; }
    };
    t.after(() => { globalThis.Worker = original; });
    const errors = [];
    const world = createLodWorld({ addChunk: () => ({}), removeChunk: () => {} }, (error) => errors.push(error),
        { renderDistance: 16, workerCount: 2 });
    world.update({ x: 0, z: 0 });
    workers[0].listeners.get('error')({ message: 'worker failed' });
    assert.deepEqual(errors, ['worker failed']);
    assert.ok(workers.every((worker) => worker.terminated));
    assert.equal(world.stats().inFlight, 0);
});

test('teleport collision bridges the destination until its full chunk is displayed', (t) => {
    const original = globalThis.Worker;
    const workers = [];
    globalThis.Worker = class {
        constructor() { this.listeners = new Map(); this.jobs = []; this.completed = 0; workers.push(this); }
        addEventListener(type, cb) { this.listeners.set(type, cb); }
        postMessage(job) { this.jobs.push(job); }
        terminate() {}
        finish() {
            const job = this.jobs[this.completed++];
            const collisionData = job.collision ? { heights: new Int16Array(CHUNK_SIZE * CHUNK_SIZE).fill(5), holes: null } : null;
            this.listeners.get('message')({ data: { ...job, collisionData, buffers: {}, terrainTime: 1, meshTime: 1 } });
        }
    };
    t.after(() => { globalThis.Worker = original; });
    const world = createLodWorld({ addChunk: () => ({}), removeChunk: () => {} }, assert.fail,
        { renderDistance: 16, workerCount: 4, collision: true });
    const position = { x: -32.5, z: -16.5 };
    const collisionData = { heights: new Int16Array(CHUNK_SIZE * CHUNK_SIZE).fill(5), holes: null };
    world.setTeleportCollision({ cx: -3, cz: -2, collisionData });
    assert.equal(world.isSolid(-33, 5, -17), true);
    world.update(position);
    assert.equal(world.isSolid(-33, 5, -17), true);
    for (let i = 0; i < 1000; i++) {
        for (const worker of workers) if (worker.completed < worker.jobs.length) worker.finish();
        world.update(position);
        const stats = world.stats();
        if (!stats.pending && !stats.inFlight) break;
    }
    world.setTeleportCollision(null);
    assert.equal(world.isSolid(-33, 5, -17), true);
    world.update({ x: 1000, z: 1000 });
    assert.equal(world.isSolid(-33, 5, -17), null);
});
