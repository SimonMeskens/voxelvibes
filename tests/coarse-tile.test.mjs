import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, CHUNK_SIZE, SEA_LEVEL } from '../game/constants.js';
import { createChunkData, terrainHeightAt } from '../generation/world-gen.js';
import { createCoarseTileData, buildCoarseTileBuffers } from '../generation/coarse-tile.js';

test('coarse columns preserve sampled full-resolution material and height rules', () => {
    for (const [cx, cz, spacing] of [[-55, 43, 2], [-14, 30, 4], [22, 30, 2]]) {
        const tile = createCoarseTileData(cx, cz, spacing);
        const originX = cx * CHUNK_SIZE * spacing;
        const originZ = cz * CHUNK_SIZE * spacing;
        const chunks = new Map();
        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                const wx = originX + x * spacing;
                const wz = originZ + z * spacing;
                const key = `${Math.floor(wx / CHUNK_SIZE)},${Math.floor(wz / CHUNK_SIZE)}`;
                if (!chunks.has(key)) chunks.set(key, createChunkData(
                    Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE), null, terrainHeightAt, { features: false }));
                const full = chunks.get(key);
                const gx = cx * CHUNK_SIZE + x;
                const gz = cz * CHUNK_SIZE + z;
                const height = full.getHeight(wx, wz);
                assert.equal(tile.getHeight(gx, gz), height);
                for (const y of [height, height - 1, height - 3, SEA_LEVEL, SEA_LEVEL + 1]) {
                    assert.equal(tile.getBlock(gx, y, gz), full.getBlock(wx, y, wz));
                }
            }
        }
    }
});

test('tiles sample matching borders independent of order at negative coordinates', () => {
    for (const spacing of [2, 4]) {
        const left = createCoarseTileData(-2, -3, spacing);
        const right = createCoarseTileData(-1, -3, spacing);
        const south = createCoarseTileData(-2, -2, spacing);
        for (let n = -1; n <= CHUNK_SIZE; n++) {
            const x = -2 * CHUNK_SIZE + n;
            const z = -3 * CHUNK_SIZE + n;
            for (const [a, b, gx, gz] of [[left, right, -CHUNK_SIZE, z], [left, south, x, -2 * CHUNK_SIZE]]) {
                assert.equal(a.getHeight(gx, gz), b.getHeight(gx, gz));
                for (const y of [SEA_LEVEL, a.getHeight(gx, gz)]) assert.equal(a.getBlock(gx, y, gz), b.getBlock(gx, y, gz));
            }
        }
    }
});

test('flat coarse meshes use correct bounds, repeating UVs, water, and AO layout', () => {
    for (const spacing of [2, 4]) {
        for (const [height, material] of [[40, BLOCK.GRASS], [10, BLOCK.WATER]]) {
            const mesh = buildCoarseTileBuffers(-1, 2, spacing, () => height);
            assert.equal(mesh.positions.length / 3, 8);
            assert.equal(mesh.indices.length, 12);
            assert.ok([...mesh.materials].includes(material - 1));
            assert.equal(Math.max(...mesh.positions.filter((_, i) => i % 3 === 0)), CHUNK_SIZE * spacing);
            assert.equal(Math.max(...mesh.positions.filter((_, i) => i % 3 === 2)), CHUNK_SIZE * spacing);
            assert.equal(Math.max(...mesh.positions.filter((_, i) => i % 3 === 1)), Math.max(height, SEA_LEVEL) + 1);
            assert.equal(Math.max(...mesh.uvs), CHUNK_SIZE * spacing);
            assert.equal(mesh.occlusion.length, mesh.positions.length / 3 * 2);
            assert.ok([...mesh.occlusion].every((v) => v >= 0 && v <= 1));
        }
    }
});

test('coarse tiles have bounded sample counts and reject invalid jobs', () => {
    for (const spacing of [2, 4]) {
        let calls = 0;
        buildCoarseTileBuffers(-1, -2, spacing, (x, z) => { calls++; return 40 + Math.abs((x + z) % 4); });
        assert.ok(calls < 3500, `unexpected ${calls} samples`);
    }
    assert.throws(() => buildCoarseTileBuffers(0, 0, 1), RangeError);
    assert.throws(() => createCoarseTileData(0.5, 0, 2), RangeError);
});

test('sloped tile UVs repeat at one texture per world block on horizontal and vertical faces', () => {
    for (const spacing of [2, 4]) {
        const mesh = buildCoarseTileBuffers(0, 0, spacing, (x, z) => 45 + Math.floor(x / spacing) + Math.floor(z / spacing));
        let sides = 0;
        for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 4) {
            const p = vertex * 3;
            const u = vertex * 2;
            const length = (a, b) => Math.hypot(...[0, 1, 2].map((axis) => mesh.positions[p + 3 * a + axis] - mesh.positions[p + 3 * b + axis]));
            assert.equal(Math.abs(mesh.uvs[u + 4] - mesh.uvs[u + 2]), length(2, 1));
            assert.equal(Math.abs(mesh.uvs[u + 3] - mesh.uvs[u + 1]), length(1, 0));
            if (mesh.positions[p + 1] !== mesh.positions[p + 4]) sides++;
        }
        assert.ok(sides > 0);
    }
});

test('worker coarse jobs transfer mesh buffers and reject unknown job types', async () => {
    const original = globalThis.self;
    let listener;
    let result;
    globalThis.self = {
        addEventListener: (type, callback) => { assert.equal(type, 'message'); listener = callback; },
        postMessage: (message, transfer) => { result = structuredClone(message, { transfer }); },
    };
    try {
        await import('../generation/chunk-worker.js');
        listener({ data: { type: 'coarse', tileX: -2, tileZ: 1, spacing: 2 } });
        assert.equal(result.type, 'coarse');
        assert.equal(result.tileX, -2);
        assert.equal(result.spacing, 2);
        assert.ok(result.buffers.indices.length > 0);
        assert.ok(result.generationTime >= 0);
        listener({ data: { type: 'coarse', tileX: -2, tileZ: 1, spacing: 2, seamless: true } });
        assert.ok(result.buffers.indices.length > 0);
        assert.equal(Math.max(...result.buffers.positions.filter((_, i) => i % 3 === 0)), 32);
        const detailed = result.buffers;
        listener({ data: { type: 'coarse', tileX: -2, tileZ: 1, spacing: 2, seamless: true,
            edges: { east: true } } });
        assert.notDeepEqual(result.buffers.positions, detailed.positions);
        assert.throws(() => listener({ data: { type: 'coarse', tileX: 0, tileZ: 0, spacing: 3 } }), RangeError);
        assert.throws(() => listener({ data: { type: 'unknown' } }), /Unknown chunk job type/);
    } finally {
        globalThis.self = original;
    }
});
