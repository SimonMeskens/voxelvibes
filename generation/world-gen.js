import { BLOCK, CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../game/constants.js';
import { noise2DWithGradient } from './noise.js';
import { erodeHeight, erodeMountain, CHAIN_EROSION_SETTINGS, FINE_EROSION_SETTINGS } from './erosion.js';
import { carverMayAffectColumn, carvesVoxel, FEATURE_SETTINGS, featuresInBounds, prepareCarvers } from './features.js';

export const TERRAIN_SCALE = { horizontal: 1.5, vertical: 1.8 };
export const TERRAIN_SETTINGS = {
    meadowFrequency: 0.0014,
    meadowRollFrequency: 0.014,
    meadowRollAmplitude: 14,
    hillFrequency: 0.006,
    detailFrequency: 0.025,
    mountainFrequency: 0.0022,
    mountainOnset: 0.65,
    mountainRange: 0.25,
    mediumMountainFrequency: 0.0035,
    mediumMountainOnset: 0.44,
    mediumMountainRange: 0.34,
    mountainAmplitude: 125,
    mediumMountainAmplitude: 60,
    mountainBase: 0.5,
    mountainRelief: 0.5,
    sedimentFrequency: 0.009,
    sedimentAmplitude: 2,
    alpineDetailStart: 60,
    alpineDetailFull: 100,
    chainBaseFrequency: 0.0018,
    pocketFrequency: 0.006,
    pocketOnset: 0.72,
    pocketRange: 0.16,
    pocketDetailFrequency: 0.1,
    pocketAmplitude: 3.5,
    alpineRidgeFrequency: 0.045,
    alpineRidgeAmplitude: 11,
    alpineFineFrequency: 0.09,
    alpineFineAmplitude: 5,
    stoneHeight: 100,
    stoneSlope: 2,
    grassLineSlopeDrop: 24,
    grassLineSlopeDistance: 4,
};
const FACE_HORIZONTAL_NORMALS = [[1, 0], [-1, 0], [0, 0], [0, 0], [0, 1], [0, -1]];
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// The mountain erosion slope is feedback for further detail, not an exact derivative.
export const terrainInputAt = (x, z) => {
    const meadow = noise2DWithGradient(x, z, TERRAIN_SETTINGS.meadowFrequency, 13);
    const hills = noise2DWithGradient(x, z, TERRAIN_SETTINGS.hillFrequency, 3);
    const detail = noise2DWithGradient(x, z, TERRAIN_SETTINGS.detailFrequency, 9);
    const region = noise2DWithGradient(x, z, TERRAIN_SETTINGS.mountainFrequency, 41);
    const mediumRegion = noise2DWithGradient(x, z, TERRAIN_SETTINGS.mediumMountainFrequency, 54);
    const roll = noise2DWithGradient(x, z, TERRAIN_SETTINGS.meadowRollFrequency, 33);
    const sediment = noise2DWithGradient(x, z, TERRAIN_SETTINGS.sedimentFrequency, 81);
    const t = Math.max(0, Math.min(1, (region.height - TERRAIN_SETTINGS.mountainOnset) / TERRAIN_SETTINGS.mountainRange));
    const mask = t * t * (3 - 2 * t);
    const maskSlope = 6 * t * (1 - t) / TERRAIN_SETTINGS.mountainRange;
    const meadowRoll = (roll.height - 0.5) * TERRAIN_SETTINGS.meadowRollAmplitude;
    const lowlandMask = 1 - mask;
    const mediumT = Math.max(0, Math.min(1,
        (mediumRegion.height - TERRAIN_SETTINGS.mediumMountainOnset) / TERRAIN_SETTINGS.mediumMountainRange));
    const mediumMask = mediumT * mediumT * (3 - 2 * mediumT);
    const mediumMaskSlope = 6 * mediumT * (1 - mediumT) / TERRAIN_SETTINGS.mediumMountainRange;
    const mediumWeight = mediumMask * lowlandMask;
    const mountainAmplitude = mask * TERRAIN_SETTINGS.mountainAmplitude
        + mediumWeight * TERRAIN_SETTINGS.mediumMountainAmplitude;
    let mountain = hills;
    if (mountainAmplitude !== 0) {
        mountain = erodeMountain(x, z, hills);
        const broad = noise2DWithGradient(x, z, TERRAIN_SETTINGS.chainBaseFrequency, 97);
        const chain = erodeMountain(x, z, broad, CHAIN_EROSION_SETTINGS);
        mountain = {
            height: mountain.height + chain.height - broad.height,
            dx: mountain.dx + chain.dx - broad.dx,
            dz: mountain.dz + chain.dz - broad.dz,
        };
    }
    const relief = TERRAIN_SETTINGS.mountainBase + TERRAIN_SETTINGS.mountainRelief * mountain.height;
    const meadowTerrain = erodeHeight(x, z, {
        height: 20 + meadow.height * 12 + hills.height * 6 + detail.height * 1.5 + meadowRoll,
        dx: meadow.dx * 12 + hills.dx * 6 + detail.dx * 1.5 + roll.dx * TERRAIN_SETTINGS.meadowRollAmplitude,
        dz: meadow.dz * 12 + hills.dz * 6 + detail.dz * 1.5 + roll.dz * TERRAIN_SETTINGS.meadowRollAmplitude,
    });
    const regionRelief = (TERRAIN_SETTINGS.mountainAmplitude
        - mediumMask * TERRAIN_SETTINGS.mediumMountainAmplitude) * relief;
    const terrain = {
        height: meadowTerrain.height + mountainAmplitude * relief
            + TERRAIN_SETTINGS.sedimentAmplitude * (sediment.height - 0.5),
        dx: meadowTerrain.dx + maskSlope * region.dx * regionRelief
            + lowlandMask * mediumMaskSlope * mediumRegion.dx * TERRAIN_SETTINGS.mediumMountainAmplitude * relief
            + TERRAIN_SETTINGS.mountainRelief * mountainAmplitude * mountain.dx
            + TERRAIN_SETTINGS.sedimentAmplitude * sediment.dx,
        dz: meadowTerrain.dz + maskSlope * region.dz * regionRelief
            + lowlandMask * mediumMaskSlope * mediumRegion.dz * TERRAIN_SETTINGS.mediumMountainAmplitude * relief
            + TERRAIN_SETTINGS.mountainRelief * mountainAmplitude * mountain.dz
            + TERRAIN_SETTINGS.sedimentAmplitude * sediment.dz,
    };
    let worldHeight = SEA_LEVEL + (terrain.height - SEA_LEVEL) * TERRAIN_SCALE.vertical;
    const pocket = noise2DWithGradient(x, z, TERRAIN_SETTINGS.pocketFrequency, 102);
    const pocketT = Math.max(0, Math.min(1, (pocket.height - TERRAIN_SETTINGS.pocketOnset) / TERRAIN_SETTINGS.pocketRange));
    const pocketMask = pocketT * pocketT * (3 - 2 * pocketT);
    const pocketSlope = 6 * pocketT * (1 - pocketT) / TERRAIN_SETTINGS.pocketRange;
    const pocketElevation = Math.max(0, Math.min(1, (worldHeight - SEA_LEVEL - 3) / 18));
    const pocketWeight = pocketElevation * pocketElevation * (3 - 2 * pocketElevation);
    const pocketWeightSlope = 6 * pocketElevation * (1 - pocketElevation) * TERRAIN_SCALE.vertical / 18;
    if (pocketMask > 0 && pocketWeight > 0) {
        const rough = noise2DWithGradient(x, z, TERRAIN_SETTINGS.pocketDetailFrequency, 103);
        const amplitude = TERRAIN_SETTINGS.pocketAmplitude;
        const value = rough.height - 0.5;
        const weight = pocketMask * pocketWeight;
        terrain.height += amplitude * weight * value;
        terrain.dx += amplitude * (weight * rough.dx + value * (pocketSlope * pocket.dx * pocketWeight
            + pocketMask * pocketWeightSlope * terrain.dx));
        terrain.dz += amplitude * (weight * rough.dz + value * (pocketSlope * pocket.dz * pocketWeight
            + pocketMask * pocketWeightSlope * terrain.dz));
        worldHeight = SEA_LEVEL + (terrain.height - SEA_LEVEL) * TERRAIN_SCALE.vertical;
    }
    const elevation = Math.max(0, Math.min(1, (worldHeight - TERRAIN_SETTINGS.alpineDetailStart)
        / (TERRAIN_SETTINGS.alpineDetailFull - TERRAIN_SETTINGS.alpineDetailStart)));
    if (elevation === 0 || mountainAmplitude === 0) return terrain;

    const elevationWeight = elevation * elevation * (3 - 2 * elevation);
    const elevationSlope = 6 * elevation * (1 - elevation) * TERRAIN_SCALE.vertical
        / (TERRAIN_SETTINGS.alpineDetailFull - TERRAIN_SETTINGS.alpineDetailStart);
    const amplitudeX = maskSlope * region.dx * (TERRAIN_SETTINGS.mountainAmplitude
        - mediumMask * TERRAIN_SETTINGS.mediumMountainAmplitude)
        + lowlandMask * mediumMaskSlope * mediumRegion.dx * TERRAIN_SETTINGS.mediumMountainAmplitude;
    const amplitudeZ = maskSlope * region.dz * (TERRAIN_SETTINGS.mountainAmplitude
        - mediumMask * TERRAIN_SETTINGS.mediumMountainAmplitude)
        + lowlandMask * mediumMaskSlope * mediumRegion.dz * TERRAIN_SETTINGS.mediumMountainAmplitude;
    const fine = erodeMountain(x, z, mountain, FINE_EROSION_SETTINGS);
    const ridge = noise2DWithGradient(x, z, TERRAIN_SETTINGS.alpineRidgeFrequency, 91);
    const smallRidge = noise2DWithGradient(x, z, TERRAIN_SETTINGS.alpineFineFrequency, 92);
    const ridgeValue = (noise) => 1 - Math.abs(2 * noise.height - 1) - 0.65;
    const ridgeSlope = (noise) => -2 * Math.sign(noise.height - 0.5);
    const scale = 1 / TERRAIN_SETTINGS.mountainAmplitude;
    const detailHeight = TERRAIN_SETTINGS.mountainRelief * (fine.height - mountain.height)
        + scale * (TERRAIN_SETTINGS.alpineRidgeAmplitude * ridgeValue(ridge)
            + TERRAIN_SETTINGS.alpineFineAmplitude * ridgeValue(smallRidge));
    const detailX = TERRAIN_SETTINGS.mountainRelief * (fine.dx - mountain.dx)
        + scale * (TERRAIN_SETTINGS.alpineRidgeAmplitude * ridgeSlope(ridge) * ridge.dx
            + TERRAIN_SETTINGS.alpineFineAmplitude * ridgeSlope(smallRidge) * smallRidge.dx);
    const detailZ = TERRAIN_SETTINGS.mountainRelief * (fine.dz - mountain.dz)
        + scale * (TERRAIN_SETTINGS.alpineRidgeAmplitude * ridgeSlope(ridge) * ridge.dz
            + TERRAIN_SETTINGS.alpineFineAmplitude * ridgeSlope(smallRidge) * smallRidge.dz);
    const weight = elevationWeight * mountainAmplitude;
    return {
        height: terrain.height + weight * detailHeight,
        dx: terrain.dx + weight * detailX
            + detailHeight * (elevationWeight * amplitudeX + mountainAmplitude * elevationSlope * terrain.dx),
        dz: terrain.dz + weight * detailZ
            + detailHeight * (elevationWeight * amplitudeZ + mountainAmplitude * elevationSlope * terrain.dz),
    };
};

export const baseTerrainAt = (x, z) => {
    const sampleX = x / TERRAIN_SCALE.horizontal;
    const sampleZ = z / TERRAIN_SCALE.horizontal;
    const terrain = terrainInputAt(sampleX, sampleZ);
    const gradientScale = TERRAIN_SCALE.vertical / TERRAIN_SCALE.horizontal;
    return {
        height: SEA_LEVEL + (terrain.height - SEA_LEVEL) * TERRAIN_SCALE.vertical,
        dx: terrain.dx * gradientScale,
        dz: terrain.dz * gradientScale,
    };
};

export const terrainAt = baseTerrainAt;

export const terrainHeightAt = (x, z) =>
    Math.max(0, Math.min(WORLD_HEIGHT - 2, Math.floor(terrainAt(x, z).height)));

export const soilDepthAt = (x, z, surface, heightAt) => {
    let slope = 0;
    for (const [dx, dz] of NEIGHBORS) {
        slope = Math.max(slope, Math.abs(surface - heightAt(x + dx, z + dz)));
    }
    let grassLine = TERRAIN_SETTINGS.stoneHeight;
    if (surface >= grassLine - TERRAIN_SETTINGS.grassLineSlopeDrop && slope < TERRAIN_SETTINGS.stoneSlope) {
        const distance = TERRAIN_SETTINGS.grassLineSlopeDistance;
        let broadSlope = 0;
        for (const [dx, dz] of NEIGHBORS) {
            broadSlope = Math.max(broadSlope, Math.abs(surface - heightAt(x + dx * distance, z + dz * distance)) / distance);
        }
        grassLine -= TERRAIN_SETTINGS.grassLineSlopeDrop * Math.min(1, broadSlope / TERRAIN_SETTINGS.stoneSlope);
    }
    return surface >= grassLine || slope >= TERRAIN_SETTINGS.stoneSlope ? 0 : slope > 0 ? 2 : 4;
};

// Cache sampled grids per worker, including their one-block borders.
export const createTerrainCache = (maxEntries = 64) => {
    const chunks = new Map();
    const keys = [];
    let next = 0;
    const width = CHUNK_SIZE + 2;

    const copyOverlaps = (chunkX, chunkZ, heights) => {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const source = chunks.get(`${chunkX + dx},${chunkZ + dz}`);
                if (!source) continue;
                const offsetX = dx * CHUNK_SIZE;
                const offsetZ = dz * CHUNK_SIZE;
                const minX = Math.max(0, offsetX);
                const maxX = Math.min(width, width + offsetX);
                const minZ = Math.max(0, offsetZ);
                const maxZ = Math.min(width, width + offsetZ);
                for (let x = minX; x < maxX; x++) {
                    for (let z = minZ; z < maxZ; z++) {
                        heights[x * width + z] = source[(x - offsetX) * width + z - offsetZ];
                    }
                }
            }
        }
    };

    const remember = (chunkX, chunkZ, heights) => {
        const key = `${chunkX},${chunkZ}`;
        if (chunks.has(key)) {
            chunks.set(key, heights);
            return;
        }
        if (maxEntries > 0) {
            if (chunks.size >= maxEntries) chunks.delete(keys[next]);
            keys[next] = key;
            next = (next + 1) % maxEntries;
            chunks.set(key, heights);
        }
    };

    return { copyOverlaps, remember };
};

// Sample a border too, so neighboring faces do not depend on loaded chunks.
export const createChunkData = (chunkX, chunkZ, cache = null, sampleHeight = terrainHeightAt, options = {}) => {
    const width = CHUNK_SIZE + 2;
    const heights = new Int16Array(width * width);
    heights.fill(-1);
    if (cache) cache.copyOverlaps(chunkX, chunkZ, heights);
    const originX = chunkX * CHUNK_SIZE;
    const originZ = chunkZ * CHUNK_SIZE;
    const features = (options.features ?? sampleHeight === terrainHeightAt)
        ? prepareCarvers(featuresInBounds(originX - 1, originZ - 1,
            originX + CHUNK_SIZE, originZ + CHUNK_SIZE), sampleHeight) : [];

    // Incomplete grids must not enter the cache, which assumes every sample exists.
    if (!options.lazyHeights) {
        for (let x = -1; x <= CHUNK_SIZE; x++) {
            for (let z = -1; z <= CHUNK_SIZE; z++) {
                const index = (x + 1) * width + z + 1;
                if (heights[index] === -1) heights[index] = sampleHeight(originX + x, originZ + z);
            }
        }
        if (cache) cache.remember(chunkX, chunkZ, heights);
    }
    const blocks = features.length ? new Uint8Array(width * width * WORLD_HEIGHT) : null;
    const coverHeights = features.length ? new Map() : null;
    const nearbyHeights = new Map();
    const soilDepths = new Uint8Array(width * width);
    soilDepths.fill(255);

    const getHeight = (x, z) => {
        const localX = x - originX + 1;
        const localZ = z - originZ + 1;
        if (localX < 0 || localX >= width || localZ < 0 || localZ >= width) {
            throw new RangeError('Block is outside the chunk sampling border');
        }
        const index = localX * width + localZ;
        if (heights[index] === -1) heights[index] = sampleHeight(x, z);
        return heights[index];
    };

    const heightOutsideBorder = (x, z) => {
        const key = `${x},${z}`;
        if (!nearbyHeights.has(key)) nearbyHeights.set(key, sampleHeight(x, z));
        return nearbyHeights.get(key);
    };

    const getSoilDepth = (x, z, surface) => {
        const localX = x - originX + 1;
        const localZ = z - originZ + 1;
        const index = localX * width + localZ;
        if (soilDepths[index] !== 255) return soilDepths[index];
        const heightAt = (sx, sz) => {
            const nx = sx - originX + 1;
            const nz = sz - originZ + 1;
            return nx >= 0 && nx < width && nz >= 0 && nz < width
                ? getHeight(sx, sz) : heightOutsideBorder(sx, sz);
        };
        const depth = soilDepthAt(x, z, surface, heightAt);
        soilDepths[index] = depth;
        return depth;
    };

    const getCoverHeight = (x, z) => {
        const key = `${x},${z}`;
        if (coverHeights.has(key)) return coverHeights.get(key);
        const radius = FEATURE_SETTINGS.caveSideCover;
        let lowest = getHeight(x, z);
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (dx * dx + dz * dz > radius * radius) continue;
                const sx = x + dx;
                const sz = z + dz;
                const localX = sx - originX + 1;
                const localZ = sz - originZ + 1;
                let height;
                if (localX >= 0 && localX < width && localZ >= 0 && localZ < width) {
                    height = getHeight(sx, sz);
                } else {
                    height = heightOutsideBorder(sx, sz);
                }
                lowest = Math.min(lowest, height);
            }
        }
        coverHeights.set(key, lowest);
        return lowest;
    };

    const getBlock = (x, y, z) => {
        if (y < 0 || y >= WORLD_HEIGHT) return BLOCK.AIR;
        const surface = getHeight(x, z);
        const index = ((x - originX + 1) * width + z - originZ + 1) * WORLD_HEIGHT + y;
        if (blocks && blocks[index]) return blocks[index] - 1;
        const empty = y > surface
            || (blocks && hasCarversAt(x, z) && carvesVoxel(x, y, z, surface, features, getCoverHeight));
        const soilDepth = !empty && y > surface - 4 ? getSoilDepth(x, z, surface) : 0;
        const block = empty ? (y <= SEA_LEVEL ? BLOCK.WATER : BLOCK.AIR)
            : soilDepth && y === surface && y >= SEA_LEVEL ? BLOCK.GRASS
            : soilDepth && y > surface - soilDepth ? BLOCK.DIRT : BLOCK.STONE;
        if (blocks) blocks[index] = block + 1;
        return block;
    };

    const getFaceMaterial = (x, y, z, faceIndex, block) => {
        if (block !== BLOCK.GRASS && block !== BLOCK.DIRT) return block;
        const surface = getHeight(x, z);
        if (faceIndex === 3 && y < surface) return BLOCK.STONE;
        const normal = FACE_HORIZONTAL_NORMALS[faceIndex];
        if ((faceIndex < 2 || faceIndex >= 4) &&
            (surface - getHeight(x + normal[0], z + normal[1]) >= 4 ||
             (features.length && y <= getHeight(x + normal[0], z + normal[1])))) return BLOCK.STONE;
        return block;
    };

    const columnCarvers = new Int8Array(width * width);
    columnCarvers.fill(-1);
    const hasCarversAt = (x, z) => {
        const index = (x - originX + 1) * width + z - originZ + 1;
        if (columnCarvers[index] < 0) columnCarvers[index] = carverMayAffectColumn(x, z, features) ? 1 : 0;
        return columnCarvers[index] === 1;
    };
    const hasCarversNear = (x, z) => hasCarversAt(x, z)
        || hasCarversAt(x + 1, z) || hasCarversAt(x - 1, z)
        || hasCarversAt(x, z + 1) || hasCarversAt(x, z - 1);
    return { getHeight, getBlock, getFaceMaterial, hasCarvers: features.length > 0, hasCarversAt, hasCarversNear };
};
