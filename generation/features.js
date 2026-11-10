import { hash3D } from './noise.js';

// Coordinates and dimensions are in world blocks.
export const FEATURE_SETTINGS = {
    cellSize: 384,
    caveLength: 100,
    caveRadius: 5,
    chamberRadius: 11,
    rockCover: 8,
    caveSideCover: 3,
};

const smooth = (value) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
};

const feature = (cx, cz) => {
    const size = FEATURE_SETTINGS.cellSize;
    const random = (seed) => hash3D(cx, seed, cz);
    return {
        x: (cx + 0.25 + 0.5 * random(70)) * size,
        z: (cz + 0.25 + 0.5 * random(71)) * size,
        cave: random(74) > 0.25,
        caveAngle: random(75) * Math.PI * 2,
        caveOffset: 55 + random(76) * 25,
    };
};

export const featuresInBounds = (minX, minZ, maxX, maxZ) => {
    const radius = 80 + FEATURE_SETTINGS.caveLength * 1.2 + FEATURE_SETTINGS.chamberRadius * 1.3 + FEATURE_SETTINGS.caveRadius;
    const size = FEATURE_SETTINGS.cellSize;
    const features = [];
    for (let cx = Math.floor((minX - radius) / size); cx <= Math.floor((maxX + radius) / size); cx++) {
        for (let cz = Math.floor((minZ - radius) / size); cz <= Math.floor((maxZ + radius) / size); cz++) {
            const f = feature(cx, cz);
            if (f.cave && f.x + radius >= minX && f.x - radius <= maxX && f.z + radius >= minZ && f.z - radius <= maxZ) {
                features.push(f);
            }
        }
    }
    return features;
};

// Anchor each feature to a few fixed samples, never to the current voxel's column.
export const prepareCarvers = (features, sampleHeight) => features.map((f) => {
    const candidates = Array.from({ length: 3 }, (_, index) => {
        const angle = f.caveAngle + index * Math.PI * 2 / 3;
        const caveUx = Math.cos(angle);
        const caveUz = Math.sin(angle);
        const caveX = f.x + caveUx * f.caveOffset;
        const caveZ = f.z + caveUz * f.caveOffset;
        const heights = [0, 0.35, 0.8].map((fraction) => {
            const distance = fraction * FEATURE_SETTINGS.caveLength;
            return sampleHeight(caveX + distance * caveUx, caveZ + distance * caveUz);
        });
        const depth = FEATURE_SETTINGS.rockCover + FEATURE_SETTINGS.chamberRadius;
        return { caveUx, caveUz, caveX, caveZ, heights,
            score: Math.min(heights[0] - 12, heights[1] - depth, heights[2] - depth) };
    });
    const best = candidates.reduce((a, b) => b.score > a.score ? b : a);
    const caveHeight = Math.min(best.score, ...[0.6, 1].map((fraction) => {
        const distance = fraction * FEATURE_SETTINGS.caveLength;
        return sampleHeight(best.caveX + distance * best.caveUx, best.caveZ + distance * best.caveUz)
            - FEATURE_SETTINGS.rockCover - FEATURE_SETTINGS.chamberRadius;
    }));
    return { ...f, caveUx: best.caveUx, caveUz: best.caveUz,
        caveX: best.caveX, caveZ: best.caveZ, entryHeight: best.heights[0], caveHeight };
});

// Keep these horizontal projections in sync with the shapes in carvesVoxel.
export const carverMayAffectColumn = (x, z, features) => features.some((f) => {
    const dx = x - f.caveX, dz = z - f.caveZ;
    const distance = dx * f.caveUx + dz * f.caveUz;
    const length = FEATURE_SETTINGS.caveLength, radius = FEATURE_SETTINGS.caveRadius;
    if (distance < -radius || distance > length + FEATURE_SETTINGS.chamberRadius * 1.3) return false;
    const sideways = -dx * f.caveUz + dz * f.caveUx;
    const bend = 3 * Math.sin(Math.max(0, distance) / 25);
    const end = Math.max(0, distance - length);
    if ((sideways - bend) ** 2 + end ** 2 < radius ** 2) return true;
    const branchStart = length * 0.48;
    const branchDistance = Math.max(0, Math.min(length * 0.36, distance - branchStart));
    const branchSide = 3 * Math.sin(branchStart / 25) + branchDistance * 0.55;
    const branchEnd = distance - branchStart - branchDistance;
    if ((sideways - branchSide) ** 2 + branchEnd ** 2 < (radius * 0.8) ** 2) return true;
    const chamberCenter = length * 0.8, chamberRadius = FEATURE_SETTINGS.chamberRadius;
    return ((distance - chamberCenter) / (chamberRadius * 1.3)) ** 2
        + ((sideways - 3 * Math.sin(chamberCenter / 25)) / chamberRadius) ** 2 < 1;
});

export const carvesVoxel = (x, y, z, surface, features, coverHeight) => {
    for (const f of features) {
        const dx = x - f.caveX;
        const dz = z - f.caveZ;
        const distance = dx * f.caveUx + dz * f.caveUz;
        const length = FEATURE_SETTINGS.caveLength;
        if (distance < -FEATURE_SETTINGS.caveRadius || distance > length + FEATURE_SETTINGS.chamberRadius * 1.3) continue;
        const sideways = -dx * f.caveUz + dz * f.caveUx;
        const bend = 3 * Math.sin(Math.max(0, distance) / 25);
        const depth = smooth(distance / (length * 0.4));
        const centerY = f.entryHeight + 2 + (f.caveHeight - f.entryHeight - 2) * depth;
        const end = Math.max(0, distance - length);
        const tunnel = (sideways - bend) ** 2 + ((y - centerY) / 0.8) ** 2 + end ** 2
            < FEATURE_SETTINGS.caveRadius ** 2;
        const branchStart = length * 0.48;
        const branchDistance = Math.max(0, Math.min(length * 0.36, distance - branchStart));
        const branchSide = 3 * Math.sin(branchStart / 25) + branchDistance * 0.55;
        const branchEnd = distance - branchStart - branchDistance;
        const branch = (sideways - branchSide) ** 2 + ((y - f.caveHeight) / 0.8) ** 2
            + branchEnd ** 2 < (FEATURE_SETTINGS.caveRadius * 0.8) ** 2;
        const chamberCenter = length * 0.8;
        const chamberRadius = FEATURE_SETTINGS.chamberRadius;
        const chamber = ((distance - chamberCenter) / (chamberRadius * 1.3)) ** 2
            + ((sideways - 3 * Math.sin(chamberCenter / 25)) / chamberRadius) ** 2
            + ((y - f.caveHeight) / (chamberRadius * 0.73)) ** 2 < 1;
        const cover = FEATURE_SETTINGS.rockCover * smooth((distance - 18) / 20);
        if ((tunnel || branch || chamber) && y <= surface - cover
            && (cover === 0 || y <= coverHeight(x, z) - Math.min(cover, FEATURE_SETTINGS.caveSideCover))) return true;
    }
    return false;
};
