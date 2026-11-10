import { findTeleportTarget } from './teleport-target.js';

self.addEventListener('message', ({ data }) => {
    const result = findTeleportTarget(data.origin, data.direction, data.distance);
    const transfer = [];
    if (result.collisionData) {
        transfer.push(result.collisionData.heights.buffer);
        if (result.collisionData.holes) transfer.push(result.collisionData.holes.buffer);
    }
    self.postMessage(result, transfer);
});
