import { CHUNK_SIZE } from './constants.js';
import { REBUILD_DISTANCE } from './chunk-selection.js';

export const LOD_SETTINGS = { version: 5, nearRadius: 128, mediumRadius: 256, hysteresis: 16, fullResolutionBorders: true };

export const selectLodRoots = (position, renderDistance, previous = new Map()) => {
    const rootSize = CHUNK_SIZE * 4;
    const radius = renderDistance + REBUILD_DISTANCE + 2;
    const roots = new Map();
    const distanceTo = (x, z, size) => Math.hypot(
        position.x - Math.max(x, Math.min(position.x, x + size)),
        position.z - Math.max(z, Math.min(position.z, z + size)));
    const minX = Math.floor((position.x - radius) / rootSize);
    const maxX = Math.floor((position.x + radius) / rootSize);
    const minZ = Math.floor((position.z - radius) / rootSize);
    const maxZ = Math.floor((position.z + radius) / rootSize);
    for (let rx = minX; rx <= maxX; rx++) for (let rz = minZ; rz <= maxZ; rz++) {
        const x = rx * rootSize, z = rz * rootSize;
        if (distanceTo(x, z, rootSize) > radius) continue;
        const rootKey = `${rx},${rz}`;
        const old = previous.get(rootKey);
        const leaves = new Map();
        const visit = (level, tx, tz) => {
            const size = CHUNK_SIZE * 2 ** level;
            const d = distanceTo(tx * size, tz * size, size);
            const threshold = level === 2 ? LOD_SETTINGS.mediumRadius : LOD_SETTINGS.nearRadius;
            const nodeKey = `${level},${tx},${tz}`;
            const wasSplit = old && [...old.values()].some((leaf) => {
                if (leaf.level >= level) return false;
                const scale = 2 ** (level - leaf.level);
                return Math.floor(leaf.tx / scale) === tx && Math.floor(leaf.tz / scale) === tz;
            });
            const split = level > 0 && d < threshold + REBUILD_DISTANCE + (wasSplit ? LOD_SETTINGS.hysteresis : 0);
            if (split) {
                for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) {
                    visit(level - 1, tx * 2 + dx, tz * 2 + dz);
                }
            } else {
                leaves.set(nodeKey, { level, tx, tz, distance: d });
            }
        };
        visit(2, rx, rz);
        roots.set(rootKey, leaves);
    }
    return roots;
};
