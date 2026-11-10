import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raycastBlocks } from '../game/raycast.js';

test('raycasting finds the first block, including negative coordinates and grid boundaries', () => {
    const blocks = new Set(['-3,2,-1', '-5,2,-1']);
    const lookup = (x, y, z) => blocks.has(`${x},${y},${z}`);
    assert.deepEqual(raycastBlocks({ x: 0, y: 2.5, z: -0.5 }, [-1, 0, 0], 10, lookup),
        { status: 'hit', x: -3, y: 2, z: -1 });
    assert.deepEqual(raycastBlocks({ x: 0.5, y: 2.5, z: -0.5 }, [-1, 0, 0], 2, lookup),
        { status: 'miss' });
});

test('raycasting stops at unloaded cells rather than passing through them', () => {
    const lookup = (x) => x === 2 ? null : x === 3;
    assert.deepEqual(raycastBlocks({ x: 0.5, y: 2.5, z: 0.5 }, [1, 0, 0], 10, lookup),
        { status: 'unloaded' });
});

test('diagonal rays advance all axes at a corner and respect the distance limit', () => {
    const v = Math.SQRT1_2;
    const visited = [];
    const lookup = (x, y, z) => { visited.push([x, y, z]); return x === 2 && z === 2; };
    assert.deepEqual(raycastBlocks({ x: 0.5, y: 1.5, z: 0.5 }, [v, 0, v], 4, lookup),
        { status: 'hit', x: 2, y: 1, z: 2 });
    assert.deepEqual(visited, [[0, 1, 0], [1, 1, 1], [2, 1, 2]]);
    assert.deepEqual(raycastBlocks({ x: 0.5, y: 1.5, z: 0.5 }, [0, 0, 0], 10, () => false),
        { status: 'miss' });
});
