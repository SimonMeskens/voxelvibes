// Each root is four chunks wide. A boundary segment is either detailed or
// coarse at a particular level; both displayed sides must agree.
const boundary = (leaves, rx, rz, side) => {
    if (!leaves) return null;
    const result = Array(4);
    for (const leaf of leaves) {
        const width = 2 ** leaf.level;
        const x = leaf.tx * width - rx * 4;
        const z = leaf.tz * width - rz * 4;
        const touches = side === 'west' ? x === 0 : side === 'east' ? x + width === 4
            : side === 'north' ? z === 0 : z + width === 4;
        if (!touches) continue;
        const from = side === 'west' || side === 'east' ? z : x;
        const value = leaf.edges && leaf.edges[side] ? leaf.level : 0;
        for (let i = from; i < from + width; i++) result[i] = value;
    }
    return result;
};

const compatible = (a, b) => !a || !b || a.every((value, i) => value === b[i]);

export const readyLodRootGroups = (roots, displayed, resident) => {
    const changed = new Set();
    const before = new Map(), after = new Map();
    for (const [key, leaves] of roots) {
        const old = displayed.get(key);
        if (!old || old.size !== leaves.size || [...old].some((id) => !leaves.has(id))) changed.add(key);
        before.set(key, old ? [...old].map((id) => resident.get(id).leaf) : null);
        after.set(key, [...leaves.values()]);
    }
    const graph = new Map([...changed].map((key) => [key, new Set()]));
    for (const key of changed) {
        const [x, z] = key.split(',').map(Number);
        for (const [dx, dz, side, opposite] of [[1, 0, 'east', 'west'], [-1, 0, 'west', 'east'],
            [0, 1, 'south', 'north'], [0, -1, 'north', 'south']]) {
            const neighbor = `${x + dx},${z + dz}`;
            if (!roots.has(neighbor)) continue;
            const oldA = boundary(before.get(key), x, z, side);
            const newA = boundary(after.get(key), x, z, side);
            const oldB = boundary(before.get(neighbor), x + dx, z + dz, opposite);
            const newB = boundary(after.get(neighbor), x + dx, z + dz, opposite);
            if (compatible(oldA, newB) && compatible(newA, oldB)) continue;
            if (!changed.has(neighbor)) throw new Error(`Incompatible unchanged LOD boundary: ${key} / ${neighbor}`);
            graph.get(key).add(neighbor);
            graph.get(neighbor).add(key);
        }
    }
    const groups = [];
    while (changed.size) {
        const first = changed.values().next().value;
        const group = [first];
        changed.delete(first);
        for (let i = 0; i < group.length; i++) for (const next of graph.get(group[i])) {
            if (changed.delete(next)) group.push(next);
        }
        if (group.every((key) => [...roots.get(key).keys()].every((id) => resident.has(id)))) groups.push(group);
    }
    return groups;
};
