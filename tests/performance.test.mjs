import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPerformanceMeter } from '../game/performance.js';

test('reports actual frame and chunk throughput, then returns to zero when idle', () => {
    const fps = { textContent: '--' };
    const low = { textContent: '--' };
    const chunks = { textContent: '--' };
    const rendered = { textContent: '--' };
    const distance = { textContent: '--' };
    const meter = createPerformanceMeter(fps, low, chunks, rendered, distance, 512, 100);
    assert.equal(distance.textContent, '512');

    meter.recordFrame(600, 2, 1);
    assert.equal(fps.textContent, '--');
    meter.recordFrame(1300, 4, 5);
    assert.equal(fps.textContent, '1.7');
    assert.equal(low.textContent, '1.4');
    assert.equal(chunks.textContent, '5.0');
    assert.equal(rendered.textContent, '5');

    meter.recordFrame(2300, 0, 0);
    assert.equal(fps.textContent, '1.0');
    assert.equal(low.textContent, '1.0');
    assert.equal(chunks.textContent, '0.0');
    assert.equal(rendered.textContent, '0');
});

test('expanded diagnostics show interval timings and current rendering statistics', () => {
    const text = () => ({ textContent: '--' });
    const details = {
        isOpen: () => true, position: text(), frameTimes: text(), workerTimes: text(), queueSize: text(),
        loadedChunks: text(), drawCalls: text(), triangles: text(), bufferMemory: text(), gpuTime: text(),
    };
    const meter = createPerformanceMeter(text(), text(), text(), text(), text(), 128, 0, details);
    const stats = () => ({
        world: { samples: 2, terrainTime: 6, meshTime: 10, pending: 3, inFlight: 2, loaded: 10 },
        renderer: { drawCalls: 7, triangles: 1234, geometryBytes: 2 * 1024 * 1024, gpuTime: '1.25 ms' },
        position: { x: -607.23, y: 60, z: 819.89 },
    });

    meter.recordFrame(100, 1, 4, stats);
    meter.recordFrame(300, 1, 4, stats);
    meter.recordFrame(1000, 0, 5, stats);
    assert.equal(details.frameTimes.textContent, '333.3 / 700.0 ms');
    assert.equal(details.position.textContent, '-607.2 / 60.0 / 819.9');
    assert.equal(details.workerTimes.textContent, '3.0 / 5.0 ms');
    assert.equal(details.queueSize.textContent, '3 / 2');
    assert.equal(details.loadedChunks.textContent, '10');
    assert.equal(details.drawCalls.textContent, '7');
    assert.equal(details.triangles.textContent, (1234).toLocaleString());
    assert.equal(details.bufferMemory.textContent, '2.0 MiB');
    assert.equal(details.gpuTime.textContent, '1.25 ms');
});

test('1% low uses the average duration of the slowest 1% of frames', () => {
    const text = () => ({ textContent: '--' });
    const low = text();
    const meter = createPerformanceMeter(text(), low, text(), text(), text(), 128, 0);
    let time = 0;
    for (let i = 0; i < 198; i++) {
        time += 4;
        meter.recordFrame(time, 0, 0);
    }
    time += 80;
    meter.recordFrame(time, 0, 0);
    time += 160;
    meter.recordFrame(time, 0, 0);
    assert.equal(low.textContent, '8.3');
});
