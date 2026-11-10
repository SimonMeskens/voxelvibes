import { BLOCK } from '../game/constants.js';

// Water remains visually opaque, but does not darken neighboring solid faces.
const occludes = (block) => block !== BLOCK.AIR && block !== BLOCK.WATER;

export const faceOcclusion = (world, x, y, z, normal, corners) => {
    const axes = [0, 1, 2].filter((axis) => normal[axis] === 0);
    const origin = [x + normal[0], y + normal[1], z + normal[2]];
    const occupied = (offsetA, offsetB) => {
        const point = [...origin];
        point[axes[0]] += offsetA;
        point[axes[1]] += offsetB;
        return occludes(world.getBlock(...point));
    };
    const sidesA = [occupied(-1, 0), occupied(1, 0)];
    const sidesB = [occupied(0, -1), occupied(0, 1)];
    return corners.map((corner) => {
        const a = corner[axes[0]] ? 1 : -1;
        const b = corner[axes[1]] ? 1 : -1;
        const sideA = sidesA[(a + 1) / 2];
        const sideB = sidesB[(b + 1) / 2];
        if (sideA && sideB) return 0;
        return 3 - Number(sideA) - Number(sideB) - Number(occupied(a, b));
    });
};
