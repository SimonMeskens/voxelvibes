// Traverse each voxel crossed by the view ray, stopping at unloaded space.
export const raycastBlocks = (origin, direction, maxDistance, isBlock) => {
    const position = [origin.x, origin.y, origin.z];
    const cell = position.map(Math.floor);
    const step = direction.map(Math.sign);
    const delta = direction.map((value) => value === 0 ? Infinity : Math.abs(1 / value));
    const next = direction.map((value, axis) => value === 0 ? Infinity
        : ((step[axis] > 0 ? cell[axis] + 1 : cell[axis]) - position[axis]) / value);
    let distance = 0;
    while (distance <= maxDistance) {
        const block = isBlock(...cell);
        if (block === null) return { status: 'unloaded' };
        if (block) return { status: 'hit', x: cell[0], y: cell[1], z: cell[2] };
        distance = Math.min(...next);
        if (!Number.isFinite(distance)) break;
        for (let axis = 0; axis < 3; axis++) {
            if (next[axis] === distance) {
                cell[axis] += step[axis];
                next[axis] += delta[axis];
            }
        }
    }
    return { status: 'miss' };
};
