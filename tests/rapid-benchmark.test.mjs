import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments } from '../benchmarks/arguments.mjs';
import { previousCompatible } from '../benchmarks/history.mjs';
import { rapidOutcome, rapidWorkload } from '../benchmarks/rapid-config.js';
import { createCamera, createMapToggle } from '../game/camera.js';

test('rapid benchmark defaults to uncapped 512 and validates distances', () => {
    assert.deepEqual(parseArguments(['rapid']), { suite: 'rapid', note: undefined, uncapped: true, distance: 512 });
    assert.deepEqual(parseArguments(['rapid', '--distance', '1024']), { suite: 'rapid', note: undefined, uncapped: true, distance: 1024 });
    assert.deepEqual(parseArguments(['--uncapped', 'rapid', '--distance', '768']),
        { suite: 'rapid', note: undefined, uncapped: true, distance: 768 });
    assert.deepEqual(parseArguments(['rapid', '--lod']), { suite: 'rapid', note: undefined, uncapped: true, distance: 512, lod: true });
    assert.throws(() => parseArguments(['browser', '--lod']));
    for (const distance of ['0', '511', '513', '4097', '1e3', 'abc']) {
        assert.throws(() => parseArguments(['rapid', '--distance', distance]));
    }
    assert.throws(() => parseArguments(['browser', '--distance', '512']));
});

test('rapid workload uses the real map camera configuration', () => {
    const camera = createCamera(rapidWorkload.viewport[0] / rapidWorkload.viewport[1]);
    const mapHeight = camera.position.y;
    camera.position = { x: 0.5, y: 200, z: 0.5 };
    camera.pitch = 0;
    assert.equal(createMapToggle(camera, mapHeight)(), true);
    assert.equal(camera.position.y, mapHeight);
    assert.equal(camera.pitch, -Math.PI / 2);
    assert.deepEqual([camera.position.x, camera.position.z], rapidWorkload.position);
});

test('distance increases only on settled throughput strictly above 60 FPS', () => {
    assert.deepEqual(rapidOutcome({ settled: true }, { framesPerSecond: 60 }), { settled: true, exceedsThreshold: false });
    assert.deepEqual(rapidOutcome({ settled: true }, { framesPerSecond: 60.01 }), { settled: true, exceedsThreshold: true });
    assert.deepEqual(rapidOutcome({ settled: false }, null), { settled: false, exceedsThreshold: null });
});

test('rapid baseline comparisons reject partial runs and differing render distances', () => {
    const base = { schema: 1, suite: 'rapid', configuration: { renderDistance: 512 }, environment: {} };
    assert.equal(previousCompatible([base], { ...base, comparable: false }), null);
    assert.equal(previousCompatible([{ ...base, comparable: false }], base), null);
    assert.equal(previousCompatible([base], { ...base, configuration: { renderDistance: 1024 } }), null);
    assert.equal(previousCompatible([base], { ...base, configuration: { renderDistance: 512, lod: {} } }), null);
    assert.equal(previousCompatible([base], base), base);
});
