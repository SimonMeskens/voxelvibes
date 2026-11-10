import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, SEA_LEVEL } from '../game/constants.js';
import { carverMayAffectColumn, carvesVoxel, FEATURE_SETTINGS, featuresInBounds, prepareCarvers } from '../generation/features.js';
import { createChunkData, createTerrainCache, terrainHeightAt } from '../generation/world-gen.js';

const neighbors = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const featureNear = (x, z) => prepareCarvers(featuresInBounds(x, z, x, z), terrainHeightAt)
    .find((f) => Math.hypot(f.caveX - x, f.caveZ - z) < 3);

const cavePoint = (f, distance, sideways = 0, y = f.caveHeight) => [
    Math.round(f.caveX + distance * f.caveUx - sideways * f.caveUz),
    Math.round(y),
    Math.round(f.caveZ + distance * f.caveUz + sideways * f.caveUx),
];

const createCoverHeight = (heightAt) => {
    const cache = new Map();
    return (x, z) => {
        const key = `${x},${z}`;
        if (!cache.has(key)) {
            let lowest = heightAt(x, z);
            const radius = FEATURE_SETTINGS.caveSideCover;
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    if (dx * dx + dz * dz <= radius * radius) lowest = Math.min(lowest, heightAt(x + dx, z + dz));
                }
            }
            cache.set(key, lowest);
        }
        return cache.get(key);
    };
};

test('horizontal cave test never rejects a carved column', () => {
    let carved = 0, rejected = 0;
    for (const angle of [0, 0.7, 2.4]) {
        const f = { caveX: -13.2, caveZ: 25.7, caveUx: Math.cos(angle), caveUz: Math.sin(angle),
            entryHeight: 65, caveHeight: 50 };
        for (let distance = -7; distance <= 115; distance += 2) for (let side = -20; side <= 30; side += 2) {
            const [x, , z] = cavePoint(f, distance, side);
            const possible = carverMayAffectColumn(x, z, [f]);
            if (!possible) rejected++;
            for (let y = 35; y <= 75; y += 2) {
                if (!carvesVoxel(x, y, z, 100, [f], () => 100)) continue;
                carved++;
                assert.ok(possible, `${angle}: ${x},${y},${z}`);
            }
        }
    }
    assert.ok(carved > 100 && rejected > 100);
});

test('dry cave fixtures have a large chamber connected to their intended entrance', () => {
    for (const [x, z] of [[-1804, -1235], [-876, 691], [-647, 664]]) {
        const f = featureNear(x, z);
        assert.ok(f?.cave);
        const heights = new Map();
        const heightAt = (x, z) => {
            const key = `${x},${z}`;
            if (!heights.has(key)) heights.set(key, terrainHeightAt(x, z));
            return heights.get(key);
        };
        const coverHeight = createCoverHeight(heightAt);
        const isAir = (x, y, z) => y > SEA_LEVEL &&
            (y > heightAt(x, z) || carvesVoxel(x, y, z, heightAt(x, z), [f], coverHeight));
        const bend = 3 * Math.sin(80 / 25);
        for (let side = -8; side <= 8; side++) {
            assert.ok(isAir(...cavePoint(f, 80, bend + side)), `narrow chamber at ${x},${z}`);
        }
        for (let dy = -6; dy <= 6; dy++) {
            assert.ok(isAir(...cavePoint(f, 80, bend, f.caveHeight + dy)), `low chamber at ${x},${z}`);
        }

        const start = cavePoint(f, 80, bend);
        const branch = cavePoint(f, 72, 3 * Math.sin(48 / 25) + 24 * 0.55);
        const queue = [start];
        const seen = new Set([start.join(',')]);
        let reachedEntrance = false;
        let reachedBranch = false;
        for (let i = 0; i < queue.length; i++) {
            const [px, py, pz] = queue[i];
            if (px === branch[0] && py === branch[1] && pz === branch[2]) reachedBranch = true;
            const dx = px - f.caveX;
            const dz = pz - f.caveZ;
            const distance = dx * f.caveUx + dz * f.caveUz;
            if (distance < 12 && py > heightAt(px, pz)) {
                reachedEntrance = true;
            }
            if (reachedEntrance && reachedBranch) break;
            for (const [nx, ny, nz] of neighbors) {
                const next = [px + nx, py + ny, pz + nz];
                const [xx, yy, zz] = next;
                const along = (xx - f.caveX) * f.caveUx + (zz - f.caveZ) * f.caveUz;
                const across = -(xx - f.caveX) * f.caveUz + (zz - f.caveZ) * f.caveUx;
                const key = next.join(',');
                if (along < -7 || along > 105 || Math.abs(across) > 25 || yy > f.entryHeight + 10 ||
                    seen.has(key) || !isAir(xx, yy, zz)) continue;
                seen.add(key);
                queue.push(next);
            }
        }
        assert.ok(reachedEntrance, `chamber at ${x},${z} has no dry path to its entrance`);
        assert.ok(reachedBranch, `branch at ${x},${z} is disconnected`);
    }
});

test('the tunnel and chamber retain rock cover away from their entrance', () => {
    const f = featureNear(-607, 820);
    const coverHeight = createCoverHeight(terrainHeightAt);
    for (let distance = 40; distance <= 100; distance++) {
        for (let side = -12; side <= 12; side++) {
            const [x, , z] = cavePoint(f, distance, side);
            const surface = terrainHeightAt(x, z);
            for (let depth = 0; depth < 8; depth++) {
                assert.equal(carvesVoxel(x, surface - depth, z, surface, [f], coverHeight), false);
            }
        }
    }
});

test('cave carving preserves solid side cover next to a cliff', () => {
    const f = { cave: true, caveX: 0, caveZ: 0, caveUx: 1, caveUz: 0,
        entryHeight: 65, caveHeight: 50 };
    const distance = 55;
    const x = distance;
    const z = Math.round(3 * Math.sin(distance / 25));
    const heightAt = (x, z) => z >= 5 ? 40 : 80;
    const coverHeight = createCoverHeight(heightAt);
    assert.equal(carvesVoxel(x, 50, z, heightAt(x, z), [f], coverHeight), false);
    assert.equal(carvesVoxel(x, 50, z, 80, [f], () => 80), true);
});

test('cave side cover agrees across a negative-coordinate chunk border', () => {
    const f = featureNear(-607, 820);
    const coverHeight = createCoverHeight(terrainHeightAt);
    const cache = createTerrainCache();
    const left = createChunkData(-35, 47, cache);
    const right = createChunkData(-34, 47, cache);
    let carved = 0;
    for (const x of [-545, -544]) {
        for (let z = 752; z < 768; z++) {
            const surface = terrainHeightAt(x, z);
            for (let y = SEA_LEVEL + 1; y <= surface; y++) {
                if (!carvesVoxel(x, y, z, surface, [f], coverHeight)) continue;
                carved++;
                assert.equal(left.getBlock(x, y, z), BLOCK.AIR);
                assert.equal(right.getBlock(x, y, z), BLOCK.AIR);
                assert.ok(y <= coverHeight(x, z) - FEATURE_SETTINGS.caveSideCover);
            }
        }
    }
    assert.ok(carved > 0, 'fixture must contain a carved cave at the border');
});
