import { BLOCK, CHUNK_SIZE, WORLD_HEIGHT } from '../game/constants.js';

export const createCollisionData = (chunk, cx, cz) => {
    const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const holes = chunk.hasCarvers ? new Uint8Array(Math.ceil(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT / 8)) : null;
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = cx * CHUNK_SIZE + x;
            const wz = cz * CHUNK_SIZE + z;
            const column = x * CHUNK_SIZE + z;
            const height = chunk.getHeight(wx, wz);
            heights[column] = height;
            if (!holes || (chunk.hasCarversAt && !chunk.hasCarversAt(wx, wz))) continue;
            for (let y = 0; y <= height; y++) {
                const block = chunk.getBlock(wx, y, wz);
                if (block === BLOCK.AIR || block === BLOCK.WATER) {
                    const index = column * WORLD_HEIGHT + y;
                    holes[index >> 3] |= 1 << (index & 7);
                }
            }
        }
    }
    return { heights, holes };
};

export const collisionSolidAt = (data, x, y, z) => {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const column = x * CHUNK_SIZE + z;
    if (y > data.heights[column]) return false;
    if (!data.holes) return true;
    const index = column * WORLD_HEIGHT + y;
    return (data.holes[index >> 3] & (1 << (index & 7))) === 0;
};
