import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, CHUNK_SIZE, WORLD_HEIGHT } from '../game/constants.js';
import { createChunkData } from '../generation/world-gen.js';
import { createCollisionData, collisionSolidAt } from '../generation/collision-data.js';

test('collision data agrees with generated terrain, water and negative-coordinate caves', () => {
    let carved = false;
    let uncarved = false;
    for (const [cx, cz] of [[-55, 43], [-51, 45], [-14, 30], [0, 0], [22, 30]]) {
        const chunk = createChunkData(cx, cz);
        const collision = createCollisionData(chunk, cx, cz);
        assert.equal(!!collision.holes, chunk.hasCarvers);
        carved ||= !!collision.holes?.some((value) => value !== 0);
        uncarved ||= !chunk.hasCarvers;
        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                for (let y = 0; y < WORLD_HEIGHT; y++) {
                    const block = chunk.getBlock(cx * CHUNK_SIZE + x, y, cz * CHUNK_SIZE + z);
                    assert.equal(collisionSolidAt(collision, x, y, z), block !== BLOCK.AIR && block !== BLOCK.WATER);
                }
            }
        }
        assert.equal(collisionSolidAt(collision, 0, -1, 0), false);
        assert.equal(collisionSolidAt(collision, 0, WORLD_HEIGHT, 0), false);
    }
    assert.ok(carved, 'expected a carved cave');
    assert.ok(uncarved, 'expected a heightfield-only chunk');
});
