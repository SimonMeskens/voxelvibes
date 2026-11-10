import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, CHUNK_SIZE, WORLD_HEIGHT } from '../game/constants.js';
import { createChunkData, createTerrainCache, terrainHeightAt } from '../generation/world-gen.js';
import { createLodTileData } from '../generation/lod-tile.js';
import { buildChunkBuffers } from '../generation/chunk-mesh.js';
import { faceOcclusion } from '../generation/ambient-occlusion.js';

const boundaryBetween = (a, b) => {
    const bounds = (tile) => {
        const size = CHUNK_SIZE * 2 ** tile.level;
        return { x: tile.tx * size, z: tile.tz * size, size };
    };
    for (const axis of ['x', 'z']) {
        const along = axis === 'x' ? 'z' : 'x';
        const [low, high] = bounds(a)[axis] < bounds(b)[axis] ? [a, b] : [b, a];
        const l = bounds(low), h = bounds(high);
        const start = Math.max(l[along], h[along]);
        const end = Math.min(l[along] + l.size, h[along] + h.size);
        if (l[axis] + l.size === h[axis] && start < end) return { axis, plane: h[axis], start, end, low, high };
    }
    throw new Error('Tiles must share an edge.');
};

const sample = (x, z) => 20 + Math.abs((x * 7 + z * 11) % 31);
const make = (tile, sampleHeight = sample, options = { features: false }) => {
    const spacing = 2 ** tile.level;
    const size = CHUNK_SIZE * spacing;
    const data = tile.level === 0 ? createChunkData(tile.tx, tile.tz, null, sampleHeight, options)
        : createLodTileData(tile.tx, tile.tz, spacing, null, sampleHeight, options);
    return { data, buffers: buildChunkBuffers(data, tile.tx, tile.tz, size, spacing),
        x: tile.tx * size, z: tile.tz * size };
};

const unitFaces = ({ positions, materials, occlusion, indices, uvs }) => {
    const result = new Map();
    for (let vertex = 0; vertex < positions.length / 3; vertex += 4) {
        const points = Array.from({ length: 4 }, (_, n) => [...positions.slice((vertex + n) * 3, (vertex + n + 1) * 3)]);
        const a = points[1].map((v, i) => v - points[0][i]);
        const b = points[2].map((v, i) => v - points[0][i]);
        const normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]].map(Math.sign);
        const axis = normal.findIndex((v) => v !== 0);
        const tangents = [0, 1, 2].filter((i) => i !== axis);
        const min = [0, 1, 2].map((i) => Math.min(...points.map((point) => point[i])));
        const max = [0, 1, 2].map((i) => Math.max(...points.map((point) => point[i])));
        const ao = Array.from({ length: 4 }, (_, i) => occlusion[(vertex + i) * 2]);
        const width = Math.hypot(...points[2].map((value, i) => value - points[1][i]));
        const height = Math.hypot(...points[1].map((value, i) => value - points[0][i]));
        assert.deepEqual([...uvs.slice(vertex * 2, vertex * 2 + 8)], [0, 0, 0, height, width, height, width, 0]);
        if (max[tangents[0]] - min[tangents[0]] > 1 || max[tangents[1]] - min[tangents[1]] > 1) {
            assert.ok(ao.every((value) => value === ao[0]));
        }
        const diagonal = [...indices.slice(vertex / 4 * 6, vertex / 4 * 6 + 6)].map((i) => i - vertex).join(',');
        for (let u = min[tangents[0]]; u < max[tangents[0]]; u++) for (let v = min[tangents[1]]; v < max[tangents[1]]; v++) {
            const pos = [...min];
            pos[tangents[0]] = u;
            pos[tangents[1]] = v;
            const key = `${normal.join(',')}:${pos.join(',')}`;
            assert.ok(!result.has(key), `duplicate ${key}`);
            result.set(key, `${materials[vertex]}:${ao.join(',')}:${diagonal}`);
        }
    }
    return [...result].sort(([a], [b]) => a.localeCompare(b));
};

test('native coarse-cell traversal preserves every face, material, AO and diagonal', () => {
    for (const [tx, tz, spacing, height, options] of [
        [0, 0, 2, sample, { features: false }],
        [-2, 1, 4, sample, { features: false }],
        [3, -2, 4, () => 10, { features: false }],
        [-17, 23, 2, terrainHeightAt, { features: true }],
        [4, -3, 4, terrainHeightAt, { features: true }],
    ]) {
        const size = CHUNK_SIZE * spacing;
        const reference = buildChunkBuffers(createLodTileData(tx, tz, spacing, null, height, options), tx, tz, size);
        const optimized = buildChunkBuffers(createLodTileData(tx, tz, spacing, null, height, options), tx, tz, size, spacing);
        assert.deepEqual(unitFaces(optimized), unitFaces(reference), `${tx},${tz},${spacing}`);
    }
});

test('detailed tile rims use full-resolution neighbors for ambient occlusion', () => {
    const tx = -10, tz = -5, spacing = 4;
    const size = CHUNK_SIZE * spacing, ox = tx * size, oz = tz * size;
    const x = -577, z = -313;
    const data = createLodTileData(tx, tz, spacing);
    const height = data.getHeight(x, z);
    const corners = [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]];
    const full = { getBlock: (wx, y, wz) =>
        createChunkData(Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE)).getBlock(wx, y, wz) };
    const correct = faceOcclusion(full, x, height, z, [0, 1, 0], corners);
    const old = faceOcclusion(data, x, height, z, [0, 1, 0], corners);
    assert.notDeepEqual(old, correct, 'fixture must reproduce coarse-interior darkening');
    const mesh = buildChunkBuffers(data, tx, tz, size, spacing);
    let found = false;
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 4) {
        const points = Array.from({ length: 4 }, (_, n) =>
            [...mesh.positions.slice((vertex + n) * 3, (vertex + n + 1) * 3)]);
        if (!points.every((point) => point[1] === height + 1)) continue;
        if (points[0][0] !== x - ox || points[0][2] !== z - oz
            || points[2][0] !== x - ox + 1 || points[2][2] !== z - oz + 1) continue;
        assert.deepEqual(Array.from({ length: 4 }, (_, n) => mesh.occlusion[(vertex + n) * 2]),
            correct.map((level) => Math.fround(level / 3)));
        found = true;
        break;
    }
    assert.ok(found, 'expected the affected border top face');
});

test('rim AO samples match full-resolution terrain on all sides and at corners', () => {
    const chunks = new Map();
    const full = { getBlock: (x, y, z) => {
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
        const key = `${cx},${cz}`;
        if (!chunks.has(key)) chunks.set(key, createChunkData(cx, cz));
        return chunks.get(key).getBlock(x, y, z);
    } };
    const faces = [
        { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
        { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
        { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
    ];
    for (const [tx, tz, spacing] of [[-17, 23, 2], [-10, -5, 4], [3, -2, 4]]) {
        const size = CHUNK_SIZE * spacing, ox = tx * size, oz = tz * size;
        const tile = createLodTileData(tx, tz, spacing);
        for (const [lx, lz] of [[0, 0], [0, 5], [size - 1, 7], [8, 0], [9, size - 1],
            [size - 1, size - 1]]) {
            const x = ox + lx, z = oz + lz;
            const surface = tile.getHeight(x, z);
            const aoWorld = tile.occlusionWorldAt(x, z);
            assert.ok(aoWorld);
            for (const y of [0, 28, Math.max(0, surface - 5), surface]) for (const face of faces) {
                assert.deepEqual(faceOcclusion(aoWorld, x, y, z, face.normal, face.corners),
                    faceOcclusion(full, x, y, z, face.normal, face.corners), `${x},${y},${z}`);
            }
        }
        assert.equal(tile.occlusionWorldAt(ox + 2, oz + 2), null);
    }
});

test('narrow cave-column checks preserve the fully scanned border mesh', () => {
    for (const [tx, tz, spacing] of [[-17, 23, 2], [4, -3, 4], [-8, 6, 2]]) {
        const size = CHUNK_SIZE * spacing, ox = tx * size, oz = tz * size;
        const data = createLodTileData(tx, tz, spacing);
        const reference = { ...data, hasCarversAt: (x, z) =>
            x <= ox + 1 || x >= ox + size - 2 || z <= oz + 1 || z >= oz + size - 2 };
        const expected = buildChunkBuffers(reference, tx, tz, size, spacing);
        const actual = buildChunkBuffers(data, tx, tz, size, spacing);
        assert.deepEqual(unitFaces(actual), unitFaces(expected), `${tx},${tz},${spacing}`);
    }
});

const collect = (mesh, edge, faces) => {
    const { positions } = mesh.buffers;
    for (let vertex = 0; vertex < positions.length / 3; vertex += 4) {
        const p = vertex * 3;
        const v = Array.from({ length: 4 }, (_, n) =>
            [positions[p + n * 3] + mesh.x, positions[p + n * 3 + 1], positions[p + n * 3 + 2] + mesh.z]);
        const axis = edge.axis === 'x' ? 0 : 2;
        if (!v.every((point) => point[axis] === edge.plane)) continue;
        const d1 = v[1].map((n, i) => n - v[0][i]), d2 = v[2].map((n, i) => n - v[0][i]);
        const cross = axis === 0 ? d1[1] * d2[2] - d1[2] * d2[1] : d1[0] * d2[1] - d1[1] * d2[0];
        const alongAxis = axis === 0 ? 2 : 0;
        const from = Math.max(edge.start, Math.min(...v.map((point) => point[alongAxis])));
        const to = Math.min(edge.end, Math.max(...v.map((point) => point[alongAxis])));
        const minY = Math.min(...v.map((point) => point[1]));
        const maxY = Math.max(...v.map((point) => point[1]));
        for (let along = from; along < to; along++) for (let y = minY; y < maxY; y++) {
            const key = `${along},${y}`;
            assert.ok(!faces.has(key), `overlapping face ${key}`);
            faces.set(key, Math.sign(cross));
        }
    }
};

test('coarse traversal avoids redundant interior height and block queries', () => {
    const spacing = 4, size = CHUNK_SIZE * spacing;
    const measure = (step) => {
        const data = createLodTileData(0, 0, spacing, null, sample, { features: false });
        const calls = { height: 0, block: 0 };
        const world = { ...data, getHeight: (...args) => { calls.height++; return data.getHeight(...args); },
            getBlock: (...args) => { calls.block++; return data.getBlock(...args); } };
        buildChunkBuffers(world, 0, 0, size, step);
        return calls;
    };
    const reference = measure(1), optimized = measure(spacing);
    assert.ok(optimized.height < reference.height * 0.6, JSON.stringify({ reference, optimized }));
    assert.ok(optimized.block < reference.block, JSON.stringify({ reference, optimized }));
});

test('full and coarse meshes produce exactly one correct face across every shared edge', () => {
    const cases = [
        [{ level: 0, tx: -1, tz: -2 }, { level: 1, tx: 0, tz: -1 }],
        [{ level: 1, tx: -1, tz: -1 }, { level: 0, tx: 0, tz: -2 }],
        [{ level: 0, tx: -2, tz: -1 }, { level: 1, tx: -1, tz: 0 }],
        [{ level: 1, tx: -1, tz: -1 }, { level: 0, tx: -2, tz: 0 }],
        [{ level: 0, tx: -1, tz: -4 }, { level: 2, tx: 0, tz: -1 }],
        [{ level: 1, tx: -1, tz: -2 }, { level: 2, tx: 0, tz: -1 }],
        [{ level: 2, tx: -1, tz: -1 }, { level: 2, tx: 0, tz: -1 }],
    ];
    for (const [a, b] of cases) {
        const edge = boundaryBetween(a, b);
        const low = make(edge.low), high = make(edge.high);
        const faces = new Map();
        collect(low, edge, faces);
        collect(high, edge, faces);
        for (let along = edge.start; along < edge.end; along++) for (let y = 0; y < WORLD_HEIGHT; y++) {
            const point = (side) => edge.axis === 'x' ? [edge.plane - 1 + side, y, along]
                : [along, y, edge.plane - 1 + side];
            const left = low.data.getBlock(...point(0));
            const right = high.data.getBlock(...point(1));
            const expected = left !== BLOCK.AIR && right === BLOCK.AIR ? 1
                : right !== BLOCK.AIR && left === BLOCK.AIR ? -1 : undefined;
            assert.equal(faces.get(`${along},${y}`), expected, `${edge.axis} ${edge.plane} ${along},${y}`);
        }
    }
});

test('same-level edges use matching coarse samples without gaps or duplicate faces', () => {
    for (const [axis, tx, tz, level] of [['x', -2, 1, 1], ['z', 1, -2, 1],
        ['x', -2, 1, 2], ['z', 1, -2, 2]]) {
        const a = { level, tx, tz };
        const b = { level, tx: tx + (axis === 'x' ? 1 : 0), tz: tz + (axis === 'z' ? 1 : 0) };
        const spacing = 2 ** level, edge = boundaryBetween(a, b), size = CHUNK_SIZE * spacing;
        const makeSibling = (tile, edges) => {
            const data = createLodTileData(tile.tx, tile.tz, spacing, null, sample, { features: false, edges });
            return { data, buffers: buildChunkBuffers(data, tile.tx, tile.tz, size, spacing),
                x: tile.tx * size, z: tile.tz * size };
        };
        const low = makeSibling(a, axis === 'x' ? { east: true } : { south: true });
        const high = makeSibling(b, axis === 'x' ? { west: true } : { north: true });
        const faces = new Map();
        collect(low, edge, faces);
        collect(high, edge, faces);
        for (let along = edge.start; along < edge.end; along++) for (let y = 0; y < WORLD_HEIGHT; y++) {
            const point = (side) => axis === 'x' ? [edge.plane - 1 + side, y, along]
                : [along, y, edge.plane - 1 + side];
            const left = low.data.getBlock(...point(0)), right = high.data.getBlock(...point(1));
            const expected = left !== BLOCK.AIR && right === BLOCK.AIR ? 1
                : right !== BLOCK.AIR && left === BLOCK.AIR ? -1 : undefined;
            assert.equal(faces.get(`${along},${y}`), expected, `${axis} ${along},${y}`);
            assert.equal(low.data.getBlock(...point(1)), right);
            assert.equal(high.data.getBlock(...point(0)), left);
        }
    }
});

test('real cave boundary and border samples match full resolution', () => {
    const tile = { tx: -8, tz: 6, spacing: 2 };
    const data = createLodTileData(tile.tx, tile.tz, tile.spacing);
    const size = CHUNK_SIZE * tile.spacing, ox = tile.tx * size, oz = tile.tz * size;
    for (const [x, z] of [[ox, oz], [ox + size - 1, oz + 11], [ox + 5, oz - 1], [ox + size, oz + size]]) {
        const full = createChunkData(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
        assert.equal(data.getHeight(x, z), full.getHeight(x, z));
        for (let y = 0; y < WORLD_HEIGHT; y++) assert.equal(data.getBlock(x, y, z), full.getBlock(x, y, z));
        const height = data.getHeight(x, z);
        for (let y = Math.max(0, height - 3); y <= height; y++) for (let face = 0; face < 6; face++) {
            const block = full.getBlock(x, y, z);
            assert.equal(data.getFaceMaterial(x, y, z, face, block), full.getFaceMaterial(x, y, z, face, block));
        }
    }
});

test('lazy cave-border chunks match eager chunks without caching incomplete grids', () => {
    let samples = 0;
    const sampleHeight = (x, z) => { samples++; return terrainHeightAt(x, z); };
    const cache = createTerrainCache();
    const lazy = createChunkData(-35, 47, cache, sampleHeight, { features: true, lazyHeights: true });
    const initialSamples = samples;
    const eager = createChunkData(-35, 47, null, terrainHeightAt);
    assert.ok(lazy.hasCarvers);
    assert.ok(initialSamples < (CHUNK_SIZE + 2) ** 2);
    for (const [x, z] of [[-560, 752], [-545, 760], [-546, 767], [-561, 751]]) {
        assert.equal(lazy.getHeight(x, z), eager.getHeight(x, z));
        for (let y = 0; y < WORLD_HEIGHT; y++) {
            const block = lazy.getBlock(x, y, z);
            assert.equal(block, eager.getBlock(x, y, z), `${x},${y},${z}`);
            for (let face = 0; face < 6; face++) {
                if ((x === -561 && face === 1) || (z === 751 && face === 5)) continue;
                assert.equal(lazy.getFaceMaterial(x, y, z, face, block), eager.getFaceMaterial(x, y, z, face, block));
            }
        }
    }
    const cached = createChunkData(-35, 47, cache, terrainHeightAt);
    for (let x = -561; x <= -544; x++) for (let z = 751; z <= 768; z++) {
        assert.equal(cached.getHeight(x, z), eager.getHeight(x, z));
    }
});

test('real cave entrance geometry matches across a mixed-resolution boundary', () => {
    const a = { level: 0, tx: -35, tz: 47 }, b = { level: 1, tx: -17, tz: 23 };
    const edge = boundaryBetween(a, b);
    const low = make(edge.low, terrainHeightAt, { features: true });
    const high = make(edge.high, terrainHeightAt, { features: true });
    const faces = new Map();
    collect(low, edge, faces);
    collect(high, edge, faces);
    let carved = 0;
    for (let z = edge.start; z < edge.end; z++) for (let y = 0; y < WORLD_HEIGHT; y++) {
        const left = low.data.getBlock(-545, y, z), right = high.data.getBlock(-544, y, z);
        const expected = left !== BLOCK.AIR && right === BLOCK.AIR ? 1
            : right !== BLOCK.AIR && left === BLOCK.AIR ? -1 : undefined;
        if (right === BLOCK.AIR && y <= high.data.getHeight(-544, z)) carved++;
        assert.equal(faces.get(`${z},${y}`), expected, `${z},${y}`);
    }
    assert.ok(carved > 0);
});
