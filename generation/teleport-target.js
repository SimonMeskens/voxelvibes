import { BLOCK, CHUNK_SIZE, WORLD_HEIGHT } from '../game/constants.js';
import { raycastBlocks } from '../game/raycast.js';
import { createCollisionData } from './collision-data.js';
import { createChunkData, createTerrainCache } from './world-gen.js';

export const findTeleportTarget = (origin, direction, distance, makeChunk = createChunkData) => {
    const cache = createTerrainCache();
    let chunk;
    let cx;
    let cz;
    const getChunk = (x, z) => {
        const nextX = Math.floor(x / CHUNK_SIZE);
        const nextZ = Math.floor(z / CHUNK_SIZE);
        if (!chunk || nextX !== cx || nextZ !== cz) {
            cx = nextX;
            cz = nextZ;
            chunk = makeChunk(cx, cz, cache);
        }
        return chunk;
    };
    const hit = raycastBlocks(origin, direction, distance, (x, y, z) =>
        y >= 0 && y < WORLD_HEIGHT && getChunk(x, z).getBlock(x, y, z) !== BLOCK.AIR);
    if (hit.status !== 'hit') return hit;
    return { ...hit, cx, cz, collisionData: createCollisionData(chunk, cx, cz) };
};
