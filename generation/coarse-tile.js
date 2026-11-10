import { BLOCK, CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../game/constants.js';
import { soilDepthAt, terrainHeightAt } from './world-gen.js';
import { buildChunkBuffers } from './chunk-mesh.js';

const normals = [[1, 0], [-1, 0], [0, 0], [0, 0], [0, 1], [0, -1]];

export const createCoarseTileData = (tileX, tileZ, spacing, sampleHeight = terrainHeightAt) => {
    if (!Number.isSafeInteger(tileX) || !Number.isSafeInteger(tileZ) || ![2, 4].includes(spacing)) {
        throw new RangeError('Coarse tiles require integer coordinates and spacing 2 or 4.');
    }
    const samples = new Map();
    const heights = new Map();
    const depths = new Map();
    const sample = (x, z) => {
        const key = `${x},${z}`;
        if (!samples.has(key)) samples.set(key, sampleHeight(x, z));
        return samples.get(key);
    };
    const getHeight = (x, z) => {
        const key = `${x},${z}`;
        if (!heights.has(key)) heights.set(key, sample(x * spacing, z * spacing));
        return heights.get(key);
    };
    const getDepth = (x, z, surface) => {
        const key = `${x},${z}`;
        if (!depths.has(key)) depths.set(key, soilDepthAt(x * spacing, z * spacing, surface, sample));
        return depths.get(key);
    };
    const getBlock = (x, y, z) => {
        if (y < 0 || y >= WORLD_HEIGHT) return BLOCK.AIR;
        const surface = getHeight(x, z);
        if (y > surface) return y <= SEA_LEVEL ? BLOCK.WATER : BLOCK.AIR;
        const depth = y > surface - 4 ? getDepth(x, z, surface) : 0;
        return depth && y === surface && y >= SEA_LEVEL ? BLOCK.GRASS
            : depth && y > surface - depth ? BLOCK.DIRT : BLOCK.STONE;
    };
    const getFaceMaterial = (x, y, z, face, block) => {
        if (block !== BLOCK.GRASS && block !== BLOCK.DIRT) return block;
        const surface = getHeight(x, z);
        if (face === 3 && y < surface) return BLOCK.STONE;
        const [dx, dz] = normals[face];
        if ((face < 2 || face >= 4) && surface - getHeight(x + dx, z + dz) >= 4) return BLOCK.STONE;
        return block;
    };
    return { getHeight, getBlock, getFaceMaterial, hasCarvers: false };
};

export const buildCoarseTileBuffers = (tileX, tileZ, spacing, sampleHeight = terrainHeightAt) => {
    const data = createCoarseTileData(tileX, tileZ, spacing, sampleHeight);
    const buffers = buildChunkBuffers(data, tileX, tileZ);
    const { positions, uvs } = buffers;
    for (let vertex = 0; vertex < positions.length / 3; vertex += 4) {
        const p = vertex * 3;
        const u = vertex * 2;
        const horizontalV = positions[p] !== positions[p + 3] || positions[p + 2] !== positions[p + 5];
        const horizontalU = positions[p + 3] !== positions[p + 6] || positions[p + 5] !== positions[p + 8];
        for (let corner = 0; corner < 4; corner++) {
            positions[p + corner * 3] *= spacing;
            positions[p + corner * 3 + 2] *= spacing;
            if (horizontalU) uvs[u + corner * 2] *= spacing;
            if (horizontalV) uvs[u + corner * 2 + 1] *= spacing;
        }
    }
    return buffers;
};
