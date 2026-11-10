import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../game/constants.js';
import { buildChunkBuffers } from '../generation/chunk-mesh.js';
import { createChunkData, createTerrainCache } from '../generation/world-gen.js';

const faces = [
    { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
    { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
    { normal: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
    { normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
    { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];
const uvs = [[0, 0], [0, 1], [1, 1], [1, 0]];

// Reference scan of every voxel, independent of the heightfield mesher.
const referenceBuffers = (world, chunkX, chunkZ) => {
    const groups = new Map();
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = chunkX * CHUNK_SIZE + x;
            const wz = chunkZ * CHUNK_SIZE + z;
            for (let y = 0; y < WORLD_HEIGHT; y++) {
                const block = world.getBlock(wx, y, wz);
                if (block === BLOCK.AIR) continue;
                for (const [faceIndex, { normal, corners }] of faces.entries()) {
                    if (world.getBlock(wx + normal[0], y + normal[1], wz + normal[2]) !== BLOCK.AIR) continue;
                    const material = world.getFaceMaterial ? world.getFaceMaterial(wx, y, wz, faceIndex, block) : block;
                    if (!groups.has(material)) groups.set(material, { positions: [], normals: [], uvs: [], occlusion: [], indices: [] });
                    const group = groups.get(material);
                    const start = group.positions.length / 3;
                    corners.forEach(([cx, cy, cz], i) => {
                        group.positions.push(x + cx, y + cy, z + cz);
                        group.normals.push(...normal);
                        group.uvs.push(...uvs[i]);
                        const corner = [cx, cy, cz];
                        const axes = [0, 1, 2].filter((axis) => normal[axis] === 0);
                        const base = [wx + normal[0], y + normal[1], wz + normal[2]];
                        const isSolid = (a, b) => {
                            const point = [...base];
                            point[axes[0]] += a;
                            point[axes[1]] += b;
                            const block = world.getBlock(...point);
                            return block !== BLOCK.AIR && block !== BLOCK.WATER;
                        };
                        const a = corner[axes[0]] ? 1 : -1;
                        const b = corner[axes[1]] ? 1 : -1;
                        const sideA = isSolid(a, 0), sideB = isSolid(0, b);
                        group.occlusion.push((sideA && sideB ? 0
                            : 3 - Number(sideA) - Number(sideB) - Number(isSolid(a, b))) / 3);
                    });
                    group.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
                }
            }
        }
    }
    return [...groups].map(([blockType, data]) => ({
        blockType,
        positions: new Float32Array(data.positions),
        normals: new Float32Array(data.normals),
        uvs: new Float32Array(data.uvs),
        occlusion: new Float32Array(data.occlusion),
        indices: data.positions.length / 3 > 65535
            ? new Uint32Array(data.indices) : new Uint16Array(data.indices),
    }));
};

// Expand merged quads back into unit faces, checking UV orientation and winding.
const unitFaces = (buffers) => {
    const result = [];
    for (const mesh of buffers) {
        if (mesh.normals) assert.equal(mesh.positions.length / 3, mesh.normals.length / 3);
        assert.equal(mesh.positions.length / 3, mesh.uvs.length / 2);
        if (mesh.materials) assert.equal(mesh.positions.length / 3, mesh.materials.length);
        assert.equal(mesh.positions.length / 3, mesh.occlusion.length / (mesh.materials ? 2 : 1));
        const quadCount = mesh.positions.length / 12;
        assert.equal(mesh.indices.length, quadCount * 6);
        for (let q = 0; q < quadCount; q++) {
            const start = q * 4;
            const blockType = mesh.materials ? mesh.materials[start] + 1 : mesh.blockType;
            assert.ok(Object.values(BLOCK).includes(blockType) && blockType !== BLOCK.AIR);
            const ao = Array.from({ length: 4 }, (_, i) =>
                mesh.occlusion[(start + i) * (mesh.materials ? 2 : 1)]);
            const levels = ao.map((value) => Math.round(value * 3));
            if (mesh.materials) {
                const indices = [...mesh.indices.slice(q * 6, q * 6 + 6)];
                const sum = indices.reduce((total, index) => total + levels[index - start], 0);
                const average = Math.fround(sum / 18);
                for (let i = 0; i < 4; i++) assert.equal(mesh.occlusion[(start + i) * 2 + 1], average);
            }
            const expectedIndices = levels[0] + levels[2] > levels[1] + levels[3]
                ? [start, start + 1, start + 3, start + 1, start + 2, start + 3]
                : [start, start + 1, start + 2, start, start + 2, start + 3];
            if (mesh.materials) assert.deepEqual([...mesh.indices.slice(q * 6, q * 6 + 6)], expectedIndices);
            const points = Array.from({ length: 4 }, (_, i) =>
                [...mesh.positions.slice((start + i) * 3, (start + i + 1) * 3)]);
            const a = points[1].map((value, i) => value - points[0][i]);
            const b = points[2].map((value, i) => value - points[0][i]);
            const cross = [a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
            const normal = cross.map((value) => Math.sign(value) || 0);
            const faceIndex = faces.findIndex((face) => face.normal.every((n, i) => n === normal[i]));
            assert.notEqual(faceIndex, -1);
            const uAxis = faceIndex < 2 ? 2 : 0;
            const vAxis = faceIndex < 2 || faceIndex >= 4 ? 1 : 2;
            const min = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
            const max = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
            const width = max[uAxis] - min[uAxis];
            const height = max[vAxis] - min[vAxis];
            assert.ok(width >= 1 && height >= 1 && Number.isInteger(width) && Number.isInteger(height));
            if (width > 1 || height > 1) assert.ok(ao.every((value) => value === ao[0]));
            for (let i = 0; i < 4; i++) {
                if (mesh.materials) assert.equal(mesh.materials[start + i] + 1, blockType);
                if (mesh.normals) assert.deepEqual([...mesh.normals.slice((start + i) * 3, (start + i + 1) * 3)], normal);
                assert.deepEqual([...mesh.uvs.slice((start + i) * 2, (start + i + 1) * 2)],
                    [uvs[i][0] * width, uvs[i][1] * height]);
                for (const axis of [uAxis, vAxis]) {
                    assert.equal(points[i][axis], min[axis] + faces[faceIndex].corners[i][axis] * (max[axis] - min[axis]));
                }
            }
            for (let u = 0; u < width; u++) {
                for (let v = 0; v < height; v++) {
                    const coordinate = [...min];
                    coordinate[uAxis] += u;
                    coordinate[vAxis] += v;
                    result.push([blockType, faceIndex, ...coordinate, ...ao].join(','));
                }
            }
        }
    }
    return result.sort();
};

const compare = (data, cx, cz) => {
    assert.deepEqual(unitFaces([buildChunkBuffers(data, cx, cz)]), unitFaces(referenceBuffers(data, cx, cz)));
};

test('distant AO matches the area average for both triangle diagonals', () => {
    const heightAt = (x, z) => 40 + ((x * x + 3 * z * z + x * z + 1000) % 4);
    const mesh = buildChunkBuffers(createChunkData(0, 0, null, heightAt), 0, 0);
    const seen = new Set();
    for (let q = 0; q < mesh.indices.length / 6; q++) {
        const start = q * 4;
        const levels = Array.from({ length: 4 }, (_, i) => Math.round(mesh.occlusion[(start + i) * 2] * 3));
        const indices = [...mesh.indices.slice(q * 6, q * 6 + 6)].map((index) => index - start);
        const expected = Math.fround(indices.reduce((sum, index) => sum + levels[index], 0) / 18);
        const fourCornerAverage = Math.fround(levels.reduce((sum, level) => sum + level, 0) / 12);
        for (let i = 0; i < 4; i++) assert.equal(mesh.occlusion[(start + i) * 2 + 1], expected);
        if (expected !== fourCornerAverage) seen.add(indices[2] === 3 ? 'flipped' : 'regular');
    }
    assert.deepEqual(seen, new Set(['regular', 'flipped']));
});

test('heightfield mesh matches voxel scan for generated chunks and cached borders', () => {
    const cache = createTerrainCache();
    for (const [cx, cz] of [[0, 0], [-1, -1], [1, 0], [-10, 7], [5, -12]]) {
        compare(createChunkData(cx, cz, cache), cx, cz);
    }
});

test('heightfield mesh matches voxel scan for cliffs, water and world limits', () => {
    const heights = [0, SEA_LEVEL - 2, SEA_LEVEL - 1, SEA_LEVEL, SEA_LEVEL + 1, WORLD_HEIGHT - 2];
    const heightAt = (x, z) => heights[((x * 3 + z * 5) % heights.length + heights.length) % heights.length];
    const data = createChunkData(-1, 1, null, heightAt);
    compare(data, -1, 1);
    assert.deepEqual(new Set(buildChunkBuffers(data, -1, 1).materials),
        new Set([BLOCK.STONE - 1, BLOCK.WATER - 1]));
});

test('flat heightfield has top and bottom faces without interior side faces', () => {
    const data = createChunkData(0, 0, null, () => SEA_LEVEL + 5);
    const buffers = buildChunkBuffers(data, 0, 0);
    assert.equal(buffers.indices.length / 6, 2);
    assert.ok(buffers.positions instanceof Float32Array && buffers.indices instanceof Uint16Array);
    assert.ok(buffers.materials instanceof Uint32Array);
    assert.deepEqual(new Set(buffers.materials), new Set([BLOCK.GRASS - 1, BLOCK.STONE - 1]));
    assert.deepEqual(unitFaces([buffers]), unitFaces([buildChunkBuffers({ ...data, hasCarvers: true }, 0, 0)]));
});

test('AO matches at shared vertices across a negative chunk boundary', () => {
    const heightAt = (x, z) => x === -1 && z === -1 ? 41 : 40;
    const left = buildChunkBuffers(createChunkData(-1, 0, null, heightAt), -1, 0);
    const right = buildChunkBuffers(createChunkData(0, 0, null, heightAt), 0, 0);
    const vertexAO = (mesh, localX) => {
        const values = [];
        for (let start = 0; start < mesh.positions.length / 3; start += 4) {
            const p = Array.from({ length: 4 }, (_, i) => [...mesh.positions.slice((start + i) * 3, (start + i + 1) * 3)]);
            const a = p[1].map((value, i) => value - p[0][i]);
            const b = p[2].map((value, i) => value - p[0][i]);
            if (a[2] * b[0] - a[0] * b[2] <= 0) continue;
            for (let i = 0; i < 4; i++) {
                if (p[i][0] === localX && p[i][1] === 41 && p[i][2] === 0) values.push(mesh.occlusion[(start + i) * 2]);
            }
        }
        return values;
    };
    const a = vertexAO(left, 16);
    const b = vertexAO(right, 0);
    assert.deepEqual(a, [Math.fround(2 / 3)]);
    assert.deepEqual(b, a);
});

test('general voxel mesher matches reference for generated caves and flooded undercuts', () => {
    for (const [cx, cz] of [[11, -12], [-12, 39], [-16, 8], [17, 8], [-35, 47]]) {
        const data = createChunkData(cx, cz);
        assert.equal(data.hasCarvers, true);
        compare(data, cx, cz);
    }
});

test('cave column culling matches full voxel scans and avoids unnecessary block queries', () => {
    let optimizedQueries = 0, referenceQueries = 0, skippedColumns = 0;
    for (const [cx, cz] of [[11, -12], [-35, 47], [-116, -76], [-150, -123]]) {
        const data = createChunkData(cx, cz);
        const optimized = { ...data, getBlock: (...args) => { optimizedQueries++; return data.getBlock(...args); } };
        const reference = { ...data, hasCarversNear: () => true,
            getBlock: (...args) => { referenceQueries++; return data.getBlock(...args); } };
        for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) {
            if (!data.hasCarversNear(cx * CHUNK_SIZE + x, cz * CHUNK_SIZE + z)) skippedColumns++;
        }
        assert.deepEqual(buildChunkBuffers(optimized, cx, cz), buildChunkBuffers(reference, cx, cz));
    }
    assert.ok(skippedColumns > 0);
    assert.ok(optimizedQueries < referenceQueries * 0.75, `${optimizedQueries} vs ${referenceQueries}`);
});

test('general voxel mesher retains cave ceilings and openings', () => {
    const data = createChunkData(-116, -76);
    let cave = 0;
    let ceilings = 0;
    let openings = 0;
    let stoneCeilings = 0;
    for (let x = -1856; x < -1840; x++) {
        for (let z = -1216; z < -1200; z++) {
            for (let y = SEA_LEVEL + 1; y < data.getHeight(x, z); y++) {
                if (data.getBlock(x, y, z) === BLOCK.AIR) {
                    cave++;
                    const above = data.getBlock(x, y + 1, z);
                    if (above !== BLOCK.AIR) {
                        ceilings++;
                        if (data.getFaceMaterial(x, y + 1, z, 3, above) === BLOCK.STONE) stoneCeilings++;
                    }
                    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        if (data.getHeight(x + dx, z + dz) < y) openings++;
                    }
                }
            }
        }
    }
    const entrance = createChunkData(-113, -77);
    for (let x = -1808; x < -1792; x++) {
        for (let z = -1232; z < -1216; z++) {
            for (let y = SEA_LEVEL + 1; y < entrance.getHeight(x, z); y++) {
                if (entrance.getBlock(x, y, z) !== BLOCK.AIR) continue;
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    if (entrance.getHeight(x + dx, z + dz) < y) openings++;
                }
            }
        }
    }
    assert.ok(cave > 100 && ceilings > 10 && stoneCeilings > 10 && openings > 0);
    const meshFaces = unitFaces([buildChunkBuffers(data, -116, -76)]);
    assert.ok(meshFaces.some((face) => face.split(',')[1] === '3'));
    compare(entrance, -113, -77);
});

test('carved space below sea level is filled with water', () => {
    const data = createChunkData(-150, -123);
    let flooded = 0;
    for (let x = -2400; x < -2384; x++) {
        for (let z = -1968; z < -1952; z++) {
            for (let y = 0; y <= Math.min(SEA_LEVEL, data.getHeight(x, z)); y++) {
                if (data.getBlock(x, y, z) === BLOCK.WATER) flooded++;
            }
        }
    }
    assert.ok(flooded > 0);
});
