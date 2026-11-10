import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK } from '../game/constants.js';
import { faceOcclusion } from '../generation/ambient-occlusion.js';

const top = { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] };
const sample = (blocks) => faceOcclusion({
    getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? BLOCK.AIR,
}, 0, 0, 0, top.normal, top.corners);

test('AO uses side and corner neighbors, including the closed-corner rule', () => {
    const blocks = new Map();
    assert.deepEqual(sample(blocks), [3, 3, 3, 3]);
    blocks.set('-1,1,0', BLOCK.STONE);
    assert.deepEqual(sample(blocks), [2, 2, 3, 3]);
    blocks.set('-1,1,-1', BLOCK.DIRT);
    assert.deepEqual(sample(blocks), [1, 2, 3, 3]);
    blocks.set('0,1,-1', BLOCK.GRASS);
    assert.deepEqual(sample(blocks), [0, 2, 3, 2]);
    blocks.delete('-1,1,-1');
    assert.equal(sample(blocks)[0], 0);
});

test('water does not occlude vertices', () => {
    const water = new Map([['-1,1,0', BLOCK.WATER], ['-1,1,-1', BLOCK.WATER], ['0,1,-1', BLOCK.WATER]]);
    assert.deepEqual(sample(water), [3, 3, 3, 3]);
});
