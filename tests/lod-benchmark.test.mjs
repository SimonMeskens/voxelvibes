import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments } from '../benchmarks/arguments.mjs';
import { previousCompatible } from '../benchmarks/history.mjs';
import { lodScenes, lodWorkload } from '../benchmarks/lod-scenes.js';
import { settleWorld } from '../benchmarks/lod-settle.js';
import { terrainHeightAt } from '../generation/world-gen.js';
import { SEA_LEVEL } from '../game/constants.js';
import { featuresInBounds, prepareCarvers } from '../generation/features.js';
import { cameraBasis } from '../graphics/view.js';

test('LOD workload has stable, distinct views including a lake and negative coordinates', () => {
    assert.deepEqual(lodScenes.map(({ name }) => name), ['lake-meadow', 'medium-mountain', 'tall-mountain', 'cave-entrance']);
    assert.equal(new Set(lodScenes.map(({ name }) => name)).size, lodScenes.length);
    assert.ok(lodScenes.every(({ name, position, overhead, pitch }) =>
        /^[a-z-]+$/.test(name) && position.length === 3 && position.every(Number.isFinite)
        && overhead > position[1] && pitch < 0));
    const [x, , z] = lodScenes[0].position;
    assert.ok(terrainHeightAt(x, z) < SEA_LEVEL);
    const [mx, , mz] = lodScenes[1].position;
    assert.ok(terrainHeightAt(mx, mz) > 100 && terrainHeightAt(mx, mz) < 200);
    assert.ok(lodScenes.some(({ position }) => position[0] < 0 && position[2] < 0));
    assert.deepEqual(lodWorkload.viewport, [800, 600]);
});

test('LOD arguments validate the distance without changing existing defaults', () => {
    assert.deepEqual(parseArguments(['lod']), { suite: 'lod', note: undefined, uncapped: false, distance: 512 });
    assert.deepEqual(parseArguments(['lod', '--uncapped', '--distance', '1024']),
        { suite: 'lod', note: undefined, uncapped: true, distance: 1024 });
    for (const args of [['lod', '--distance'], ['lod', '--distance', '256'],
        ['lod', '--distance', '512', '--distance', '1024'], ['browser', '--distance', '512']]) {
        assert.throws(() => parseArguments(args));
    }
});

test('the cave view looks toward the dry entrance from outside the hillside', () => {
    const scene = lodScenes.find(({ name }) => name === 'cave-entrance');
    const cave = prepareCarvers(featuresInBounds(-876, 691, -876, 691), terrainHeightAt)
        .find((feature) => Math.hypot(feature.caveX + 876, feature.caveZ - 691) < 3);
    const [x, y, z] = scene.position;
    const along = (x - cave.caveX) * cave.caveUx + (z - cave.caveZ) * cave.caveUz;
    const forward = cameraBasis(scene.yaw, scene.pitch).forward;
    assert.ok(along < 0 && along > -40);
    assert.ok(y > terrainHeightAt(x, z));
    assert.ok(forward[0] * cave.caveUx + forward[2] * cave.caveUz > 0.95);
});

test('settling starts an update immediately, aggregates worker timings, and labels timeouts', async () => {
    let clock = 0;
    let calls = 0;
    const run = (finish) => settleWorld({
        now: () => clock, nextFrame: async () => { clock += 5; }, render: () => {},
        timeoutMs: 10,
        update: () => {
            calls++;
            return { state: { loaded: 1, pending: finish && calls >= 2 ? 0 : 1, inFlight: 0,
                terrainTime: 4, meshTime: 2, samples: 1 },
            timing: { wantedMs: 1, queueMs: 2, uploadMs: 3 } };
        },
    });
    const settled = await run(true);
    assert.equal(settled.settled, true);
    assert.equal(settled.elapsedMs, 5);
    assert.equal(settled.workerSamples, 2);
    assert.equal(settled.workerTerrainMs, 4);
    clock = 0;
    calls = 0;
    const partial = await run(false);
    assert.equal(partial.settled, false);
    assert.equal(partial.elapsedMs, 10);
    assert.equal(partial.pending, 1);
    assert.equal(partial.maxQueueDepth, 1);
});

test('partial LOD runs and different distances cannot share baselines', () => {
    const base = { schema: 1, suite: 'lod', configuration: { renderDistance: 512 }, environment: {} };
    const partial = { ...base, comparable: false };
    const long = { ...base, configuration: { renderDistance: 1024 } };
    assert.equal(previousCompatible([base], partial), null);
    assert.equal(previousCompatible([partial], base), null);
    assert.equal(previousCompatible([base], long), null);
    assert.equal(previousCompatible([base], base), base);
});
