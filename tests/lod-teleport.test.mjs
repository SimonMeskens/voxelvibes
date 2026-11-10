import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, CHUNK_SIZE } from '../game/constants.js';
import { findTeleportTarget } from '../generation/teleport-target.js';
import { collisionSolidAt } from '../generation/collision-data.js';
import { createChunkData, terrainHeightAt } from '../generation/world-gen.js';
import { requestTeleportTarget } from '../game/teleport-request.js';
import { createControls } from '../game/controls.js';
import { PLAYER } from '../game/player.js';

test('distant target follows full voxel terrain including water and negative chunks', () => {
    const calls = [];
    const makeChunk = (cx, cz) => {
        calls.push([cx, cz]);
        return {
            hasCarvers: false,
            getHeight: () => 0,
            getBlock: (x, y, z) => x === -35 && y === 10 && z === -1 ? BLOCK.WATER : BLOCK.AIR,
        };
    };
    const hit = findTeleportTarget({ x: 0.5, y: 10.5, z: -0.5 }, [-1, 0, 0], 100, makeChunk);
    assert.deepEqual([hit.status, hit.x, hit.y, hit.z, hit.cx, hit.cz], ['hit', -35, 10, -1, -3, -1]);
    assert.deepEqual(calls, [[0, -1], [-1, -1], [-2, -1], [-3, -1]]);
    assert.equal(collisionSolidAt(hit.collisionData, 13, 10, 15), false);
    assert.equal(findTeleportTarget({ x: 0.5, y: 500, z: 0.5 }, [1, 0, 0], 10, makeChunk).status, 'miss');
});

test('real terrain target and collision match full-resolution chunk data', () => {
    const x = -37, z = -42;
    const height = terrainHeightAt(x, z);
    const hit = findTeleportTarget({ x: x + 0.5, y: height + 40, z: z + 0.5 }, [0, -1, 0], 100);
    assert.equal(hit.status, 'hit');
    const chunk = createChunkData(hit.cx, hit.cz);
    assert.notEqual(chunk.getBlock(hit.x, hit.y, hit.z), BLOCK.AIR);
    for (let y = Math.max(0, hit.y - 5); y <= hit.y + 2; y++) {
        const block = chunk.getBlock(x, y, z);
        assert.equal(collisionSolidAt(hit.collisionData, x - hit.cx * CHUNK_SIZE, y, z - hit.cz * CHUNK_SIZE),
            block !== BLOCK.AIR && block !== BLOCK.WATER);
    }
});

test('teleport worker forwards results and reports errors, and can be cancelled', (t) => {
    const original = globalThis.Worker;
    const workers = [];
    globalThis.Worker = class {
        constructor() { this.listeners = new Map(); this.terminated = false; workers.push(this); }
        addEventListener(type, cb) { this.listeners.set(type, cb); }
        postMessage(job) { this.job = job; }
        terminate() { this.terminated = true; }
    };
    t.after(() => { globalThis.Worker = original; });
    const results = [], errors = [];
    const request = () => requestTeleportTarget({ x: 0, y: 1, z: 2 }, [1, 0, 0], 512,
        (value) => results.push(value), (error) => errors.push(error));
    request();
    assert.equal(workers[0].job.distance, 512);
    workers[0].listeners.get('message')({ data: { status: 'miss' } });
    assert.ok(workers[0].terminated);
    assert.deepEqual(results, [{ status: 'miss' }]);
    request();
    workers[1].listeners.get('error')({ message: 'failed' });
    assert.deepEqual(errors, ['failed']);
    assert.ok(workers[1].terminated);
    const cancel = request();
    cancel();
    assert.ok(workers[2].terminated);
});

test('LOD teleport waits for collision, handles failure and cancels stale views', (t) => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const windowEvents = new EventTarget(), documentEvents = new EventTarget(), canvas = new EventTarget();
    const hint = { textContent: 'Controls' };
    documentEvents.querySelector = (selector) => selector === '#hint' ? hint : { hidden: false };
    documentEvents.pointerLockElement = canvas;
    globalThis.window = windowEvents;
    globalThis.document = documentEvents;
    t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; });
    const camera = { position: { x: 0.5, y: 10.5, z: 0.5 }, yaw: 0, pitch: 0 };
    const requests = [], errors = [];
    let collision = null;
    const teleport = {
        request: (origin, direction, distance, done, fail) => {
            const request = { origin, direction, distance, done, fail, cancelled: false };
            requests.push(request);
            return () => { request.cancelled = true; };
        },
        setCollision: (value) => { collision = value; },
        onError: (message) => errors.push(message),
    };
    const isSolid = (x, y, z) => collision && x === collision.x && z === collision.z ? y <= collision.y : null;
    const controls = createControls(camera, canvas, isSolid, 1000, () => null, teleport);
    const click = () => { const event = new Event('mousedown', { cancelable: true }); event.button = 2; canvas.dispatchEvent(event); };
    click();
    assert.match(hint.textContent, /Loading/);
    requests[0].done({ status: 'hit', x: -33, y: 7, z: -200, cx: -3, cz: -13, collisionData: {} });
    assert.deepEqual(camera.position, { x: -32.5, y: 8 + PLAYER.eyeHeight, z: -199.5 });
    assert.ok(collision);
    click();
    const mouse = new Event('mousemove');
    mouse.movementX = 1; mouse.movementY = 0;
    documentEvents.dispatchEvent(mouse);
    assert.equal(requests[1].cancelled, true);
    const saved = { ...camera.position };
    requests[1].done({ status: 'hit', x: 0, y: 0, z: 0 });
    assert.deepEqual(camera.position, saved);
    click();
    requests[2].fail('worker failed');
    assert.deepEqual(errors, ['worker failed']);
    assert.match(hint.textContent, /failed/);
    click();
    const key = new Event('keydown'); key.code = 'KeyM'; windowEvents.dispatchEvent(key);
    assert.equal(requests[3].cancelled, true);
    controls.update(0.1);
});

test('LOD teleport reports a miss or blocked destination without moving', (t) => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const windowEvents = new EventTarget(), documentEvents = new EventTarget(), canvas = new EventTarget();
    const hint = { textContent: 'Controls' };
    documentEvents.querySelector = (selector) => selector === '#hint' ? hint : { hidden: false };
    globalThis.window = windowEvents;
    globalThis.document = documentEvents;
    t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; });
    const camera = { position: { x: 0.5, y: 10.5, z: 0.5 }, yaw: 0, pitch: 0 };
    const saved = { ...camera.position };
    let done, collision;
    createControls(camera, canvas, () => true, 1000, () => null, {
        request: (origin, direction, distance, callback) => { done = callback; return () => {}; },
        setCollision: (value) => { collision = value; },
        onError: assert.fail,
    });
    const click = () => { const event = new Event('mousedown'); event.button = 2; canvas.dispatchEvent(event); };
    click();
    done({ status: 'miss' });
    assert.match(hint.textContent, /no block/);
    click();
    done({ status: 'hit', x: -1, y: 5, z: -1, cx: -1, cz: -1, collisionData: {} });
    assert.match(hint.textContent, /not enough loaded space/);
    assert.equal(collision, null);
    assert.deepEqual(camera.position, saved);
});
