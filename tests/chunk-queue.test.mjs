import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChunkQueue } from '../generation/chunk-queue.js';

const fakeWorker = () => {
    const listeners = new Map();
    return {
        jobs: [],
        terminated: false,
        addEventListener: (type, listener) => listeners.set(type, listener),
        postMessage(job) { this.jobs.push(job); },
        terminate() { this.terminated = true; },
        emit(type, data) { listeners.get(type)(data); },
    };
};

const wanted = (...chunks) => new Map(chunks.map(([cx, distance]) =>
    [`${cx},0`, { cx, cz: 0, distance }]));

test('dispatches nearest first, accepts multiple results and discards stale chunks', () => {
    const workers = [fakeWorker(), fakeWorker()];
    const queue = createChunkQueue(workers, assert.fail);
    const loaded = new Map();
    const initial = wanted([2, 20], [0, 0], [1, 10]);
    assert.deepEqual(queue.update(initial, loaded), []);
    assert.deepEqual(workers.map((worker) => worker.jobs[0].cx), [0, 1]);
    assert.deepEqual(queue.stats(), { pending: 1, inFlight: 2 });
    queue.update(initial, loaded);
    assert.equal(workers[0].jobs.length, 1);

    workers[0].emit('message', { data: { cx: 0, cz: 0, buffers: [] } });
    workers[1].emit('message', { data: { cx: 1, cz: 0, buffers: [] } });
    assert.deepEqual(queue.stats(), { pending: 1, inFlight: 0 });
    const results = queue.update(initial, loaded);
    assert.deepEqual(results.map(({ key }) => key), ['0,0', '1,0']);
    results.forEach(({ key }) => loaded.set(key, []));
    assert.equal(workers[0].jobs[1].cx, 2);

    const moved = wanted([10, 0]);
    queue.update(moved, loaded);
    workers[0].emit('message', { data: { cx: 2, cz: 0, buffers: [] } });
    assert.deepEqual(queue.update(moved, loaded), []);
    assert.equal(workers[1].jobs.at(-1).cx, 10);
});

test('reports worker failure and stops all workers', () => {
    const workers = [fakeWorker(), fakeWorker()];
    const errors = [];
    const queue = createChunkQueue(workers, (message) => errors.push(message));
    const requested = wanted([0, 0]);
    queue.update(requested, new Map());
    workers[0].emit('error', { message: 'worker crashed' });
    assert.deepEqual(errors, ['worker crashed']);
    assert.ok(workers.every((worker) => worker.terminated));
    assert.deepEqual(queue.stats(), { pending: 0, inFlight: 0 });
    assert.deepEqual(queue.update(requested, new Map()), []);
});

test('reprioritizes pending chunks on movement without duplicating active jobs', () => {
    const workers = [fakeWorker(), fakeWorker()];
    const queue = createChunkQueue(workers, assert.fail);
    const loaded = new Map();
    const initial = wanted([0, 0], [1, 1], [2, 2], [3, 3]);
    queue.update(initial, loaded);
    const moved = wanted([3, 0], [1, 1], [2, 2], [4, 3]);
    queue.update(moved, loaded);
    workers[0].emit('message', { data: { cx: 0, cz: 0, buffers: [] } });
    assert.deepEqual(queue.update(moved, loaded), []);
    assert.equal(workers[0].jobs.at(-1).cx, 3);
    workers[1].emit('message', { data: { cx: 1, cz: 0, buffers: [] } });
    const results = queue.update(moved, loaded);
    assert.deepEqual(results.map(({ key }) => key), ['1,0']);
    results.forEach(({ key }) => loaded.set(key, []));
    assert.equal(workers[1].jobs.at(-1).cx, 2);
    assert.equal(queue.stats().pending, 1);
});

test('preserves stable nearest-first order through successive worker completions', () => {
    const worker = fakeWorker();
    const queue = createChunkQueue([worker], assert.fail);
    const loaded = new Map();
    const requested = wanted([5, 5], [2, 1], [3, 1], [4, 3]);
    queue.update(requested, loaded);
    for (const cx of [2, 3, 4, 5]) {
        assert.equal(worker.jobs.at(-1).cx, cx);
        worker.emit('message', { data: { cx, cz: 0, buffers: [] } });
        for (const result of queue.update(requested, loaded)) loaded.set(result.key, []);
    }
    assert.deepEqual(queue.stats(), { pending: 0, inFlight: 0 });
});
