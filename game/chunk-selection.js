import { CHUNK_SIZE } from './constants.js';

export const REBUILD_DISTANCE = 4;

export const selectChunks = (position, renderDistance) => {
    const radius = renderDistance + REBUILD_DISTANCE + 2;
    const minX = Math.floor((position.x - radius) / CHUNK_SIZE);
    const maxX = Math.floor((position.x + radius) / CHUNK_SIZE);
    const minZ = Math.floor((position.z - radius) / CHUNK_SIZE);
    const maxZ = Math.floor((position.z + radius) / CHUNK_SIZE);
    const wanted = new Map();
    for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
            const nearestX = Math.max(cx * CHUNK_SIZE, Math.min(position.x, (cx + 1) * CHUNK_SIZE));
            const nearestZ = Math.max(cz * CHUNK_SIZE, Math.min(position.z, (cz + 1) * CHUNK_SIZE));
            const distance = Math.hypot(position.x - nearestX, position.z - nearestZ);
            if (distance <= radius) wanted.set(`${cx},${cz}`, { cx, cz, distance });
        }
    }
    return wanted;
};
