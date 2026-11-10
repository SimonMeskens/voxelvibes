import { hash3D } from './noise.js';

// Each jittered cell contributes a local stripe, aligned with the same slope.
export const gullyNoise = (x, z, directionX, directionZ, frequency, cellScale, normalization) => {
    const cellSize = Math.PI * 2 * cellScale / frequency;
    const gx = x / cellSize;
    const gz = z / cellSize;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const sideX = -directionZ * frequency;
    const sideZ = directionX * frequency;
    let cosine = 0;
    let sine = 0;
    let total = 0;
    for (let a = -1; a <= 2; a++) {
        for (let b = -1; b <= 2; b++) {
            const cx = ix + a;
            const cz = iz + b;
            const dx = gx - cx - (hash3D(cx, 17, cz) - 0.5);
            const dz = gz - cz - (hash3D(cx, 18, cz) - 0.5);
            const weight = Math.max(0, Math.exp(-2 * (dx * dx + dz * dz)) - Math.exp(-4.5));
            if (weight === 0) continue;
            const phase = (dx * sideX + dz * sideZ) * cellSize + Math.PI / 2;
            cosine += weight * Math.cos(phase);
            sine += weight * Math.sin(phase);
            total += weight;
        }
    }
    const magnitude = Math.max(Math.hypot(cosine, sine), total * normalization);
    return { value: cosine / magnitude, sine: sine / magnitude, sideX, sideZ };
};
