import { BLOCK, CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../game/constants.js';
import { createChunkData, soilDepthAt, terrainHeightAt } from './world-gen.js';
import { featuresInBounds } from './features.js';
import { createCoarseTileData } from './coarse-tile.js';
import { buildChunkBuffers } from './chunk-mesh.js';

export const createLodTileData = (tileX, tileZ, spacing, cache = null, sampleHeight = terrainHeightAt, options = {}) => {
    const heights = new Map();
    const fullHeight = (x, z) => {
        const key = `${x},${z}`;
        if (!heights.has(key)) heights.set(key, sampleHeight(x, z));
        return heights.get(key);
    };
    const coarse = createCoarseTileData(tileX, tileZ, spacing, fullHeight);
    const size = CHUNK_SIZE * spacing;
    const originX = tileX * size;
    const originZ = tileZ * size;
    const chunks = new Map();
    const carvers = new Map();
    const carvedColumns = new Map();
    const depths = new Map();
    const edges = options.edges ?? {};
    const isBorder = (x, z) => {
        const lx = x - originX, lz = z - originZ;
        if (lx <= 0 && !(edges.west && lz > 0 && lz < size - 1)) return true;
        if (lx >= size - 1 && !(edges.east && lz > 0 && lz < size - 1)) return true;
        if (lz <= 0 && !(edges.north && lx > 0 && lx < size - 1)) return true;
        if (lz >= size - 1 && !(edges.south && lx > 0 && lx < size - 1)) return true;
        return false;
    };
    const fullChunk = (x, z) => {
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
        const key = `${cx},${cz}`;
        if (!chunks.has(key)) chunks.set(key, createChunkData(cx, cz, cache, fullHeight, {
            ...options, features: options.features ?? sampleHeight === terrainHeightAt, lazyHeights: true,
        }));
        return chunks.get(key);
    };
    const hasCarvers = (x, z) => {
        if (!(options.features ?? sampleHeight === terrainHeightAt)) return false;
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
        const key = `${cx},${cz}`;
        if (!carvers.has(key)) {
            const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
            carvers.set(key, featuresInBounds(x0 - 1, z0 - 1, x0 + CHUNK_SIZE, z0 + CHUNK_SIZE).length > 0);
        }
        return carvers.get(key);
    };
    const fullBlock = (x, y, z) => {
        if (hasCarvers(x, z)) return fullChunk(x, z).getBlock(x, y, z);
        if (y < 0 || y >= WORLD_HEIGHT) return BLOCK.AIR;
        const surface = fullHeight(x, z);
        if (y > surface) return y <= SEA_LEVEL ? BLOCK.WATER : BLOCK.AIR;
        if (y <= surface - 4) return BLOCK.STONE;
        const key = `${x},${z}`;
        if (!depths.has(key)) depths.set(key, soilDepthAt(x, z, surface, fullHeight));
        const depth = depths.get(key);
        return depth && y === surface && y >= SEA_LEVEL ? BLOCK.GRASS
            : depth && y > surface - depth ? BLOCK.DIRT : BLOCK.STONE;
    };
    const coarsePosition = (x, z) => [Math.floor(x / spacing), Math.floor(z / spacing)];
    const getHeight = (x, z) => {
        if (isBorder(x, z)) return fullHeight(x, z);
        const [cx, cz] = coarsePosition(x, z);
        return coarse.getHeight(cx, cz);
    };
    const getBlock = (x, y, z) => {
        if (isBorder(x, z)) return fullBlock(x, y, z);
        const [cx, cz] = coarsePosition(x, z);
        return coarse.getBlock(cx, y, cz);
    };
    const fullResolutionOcclusion = { getBlock: fullBlock };
    const occlusionWorldAt = (x, z) => isBorder(x, z) ? fullResolutionOcclusion : null;
    const getFaceMaterial = (x, y, z, face, block) => {
        if (isBorder(x, z)) {
            if (hasCarvers(x, z)) return fullChunk(x, z).getFaceMaterial(x, y, z, face, block);
            if (block !== BLOCK.GRASS && block !== BLOCK.DIRT) return block;
            const surface = fullHeight(x, z);
            if (face === 3 && y < surface) return BLOCK.STONE;
            const normal = [[1, 0], [-1, 0], [0, 0], [0, 0], [0, 1], [0, -1]][face];
            if ((face < 2 || face >= 4) && surface - fullHeight(x + normal[0], z + normal[1]) >= 4) return BLOCK.STONE;
            return block;
        }
        const [cx, cz] = coarsePosition(x, z);
        return coarse.getFaceMaterial(cx, y, cz, face, block);
    };
    const hasCarversAt = (x, z) => {
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const sx = x + dx, sz = z + dz;
            if (!isBorder(sx, sz) || !hasCarvers(sx, sz)) continue;
            const key = `${sx},${sz}`;
            if (!carvedColumns.has(key)) carvedColumns.set(key, fullChunk(sx, sz).hasCarversAt(sx, sz));
            if (carvedColumns.get(key)) return true;
        }
        return false;
    };
    return { getHeight, getBlock, getFaceMaterial, hasCarversAt, occlusionWorldAt };
};

export const buildLodTileBuffers = (tileX, tileZ, spacing, cache = null, edges = undefined) =>
    buildChunkBuffers(createLodTileData(tileX, tileZ, spacing, cache, terrainHeightAt, { edges }),
        tileX, tileZ, CHUNK_SIZE * spacing, spacing);
