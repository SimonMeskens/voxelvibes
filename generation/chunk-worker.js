import { createChunkData, createTerrainCache } from './world-gen.js';
import { buildChunkBuffers } from './chunk-mesh.js';
import { createCollisionData } from './collision-data.js';
import { buildCoarseTileBuffers } from './coarse-tile.js';
import { buildLodTileBuffers } from './lod-tile.js';

const terrainCache = createTerrainCache();

self.addEventListener('message', ({ data: job }) => {
    if (job.type === 'coarse') {
        const { tileX, tileZ, spacing } = job;
        const start = performance.now();
        const buffers = job.seamless ? buildLodTileBuffers(tileX, tileZ, spacing, terrainCache, job.edges)
            : buildCoarseTileBuffers(tileX, tileZ, spacing);
        const generationTime = performance.now() - start;
        const transfer = [buffers.positions.buffer, buffers.uvs.buffer,
            buffers.materials.buffer, buffers.occlusion.buffer, buffers.indices.buffer];
        self.postMessage({ type: 'coarse', tileX, tileZ, spacing, buffers, generationTime }, transfer);
        return;
    }
    if (job.type !== undefined) throw new Error(`Unknown chunk job type: ${job.type}`);
    const { cx, cz, collision } = job;
    const start = performance.now();
    const data = createChunkData(cx, cz, terrainCache);
    const terrainTime = performance.now() - start;
    const meshStart = performance.now();
    const buffers = buildChunkBuffers(data, cx, cz);
    const collisionData = collision ? createCollisionData(data, cx, cz) : null;
    const meshTime = performance.now() - meshStart;
    const transfer = [buffers.positions.buffer, buffers.uvs.buffer,
        buffers.materials.buffer, buffers.occlusion.buffer, buffers.indices.buffer];
    if (collisionData) {
        transfer.push(collisionData.heights.buffer);
        if (collisionData.holes) transfer.push(collisionData.holes.buffer);
    }
    self.postMessage({ cx, cz, buffers, terrainTime, meshTime, collisionData }, transfer);
});
