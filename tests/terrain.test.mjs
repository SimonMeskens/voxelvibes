import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../game/constants.js';
import { noise2DWithGradient } from '../generation/noise.js';
import { gullyNoise } from '../generation/gully-noise.js';
import { CHAIN_EROSION_SETTINGS, EROSION_SETTINGS, FINE_EROSION_SETTINGS, MOUNTAIN_EROSION_SETTINGS, erodeHeight, erodeMountain, slopeAlignedStripes } from '../generation/erosion.js';
import { baseTerrainAt, createChunkData, createTerrainCache, TERRAIN_SCALE, TERRAIN_SETTINGS, terrainAt, terrainHeightAt, terrainInputAt } from '../generation/world-gen.js';
import { featuresInBounds } from '../generation/features.js';

const close = (actual, expected, tolerance = 1e-6) => {
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
};

test('base noise derivatives match finite differences', () => {
    const x = 13.27;
    const z = -51.33;
    const step = 1e-4;
    const sample = noise2DWithGradient(x, z, 0.035, 9);
    close(sample.dx, (noise2DWithGradient(x + step, z, 0.035, 9).height
        - noise2DWithGradient(x - step, z, 0.035, 9).height) / (2 * step));
    close(sample.dz, (noise2DWithGradient(x, z + step, 0.035, 9).height
        - noise2DWithGradient(x, z - step, 0.035, 9).height) / (2 * step));
});

test('stripes stay normalized and use straight-sided feedback derivatives', () => {
    const x = 0.31;
    const z = 25.17;
    const frequency = 0.13;
    const sample = (a, b) => slopeAlignedStripes(a, b, 0.6, 0.8, frequency);
    const stripe = sample(x, z);
    const step = 1e-4;
    close(stripe.value ** 2 + stripe.sine ** 2, 1);
    close((sample(x + step, z).value - sample(x - step, z).value) / (2 * step),
        stripe.dx * Math.abs(stripe.sine));
    close((sample(x, z + step).value - sample(x, z - step).value) / (2 * step),
        stripe.dz * Math.abs(stripe.sine));
});

test('erosion respects strength, onset, and octave controls', () => {
    const input = { height: 40, dx: 0.5, dz: 0.3 };
    assert.deepEqual(erodeHeight(7, -13, input, { ...EROSION_SETTINGS, strength: 0 }), input);
    assert.deepEqual(erodeHeight(7, -13, input, { ...EROSION_SETTINGS, gullyContribution: 0 }), input);
    assert.deepEqual(erodeHeight(7, -13, input, { ...EROSION_SETTINGS, octaves: 0 }), input);
    const flat = { height: 40, dx: 0, dz: 0 };
    assert.deepEqual(erodeHeight(7, -13, flat), flat);
    assert.deepEqual(erodeHeight(7, -13, flat, { ...EROSION_SETTINGS, assumedSlope: 0 }), flat);
    assert.notDeepEqual(erodeHeight(7, -13, input), input);
    assert.notDeepEqual(
        erodeHeight(7, -13, input, { ...EROSION_SETTINGS, fade: 0 }),
        erodeHeight(7, -13, input, { ...EROSION_SETTINGS, fade: 1 }),
    );
    assert.notDeepEqual(
        erodeHeight(7, -13, input, { ...EROSION_SETTINGS, octaves: 1 }),
        erodeHeight(7, -13, input, { ...EROSION_SETTINGS, octaves: 4 }),
    );
});

test('stripes are continuous across a phase grid boundary', () => {
    const frequency = 0.13;
    const edge = Math.PI * 2 / frequency;
    const sample = (x) => slopeAlignedStripes(x, 12.3, 0.6, 0.8, frequency).value;
    close(sample(edge - 1e-6), sample(edge + 1e-6));
});

test('terrain is deterministic and finite across distant coordinates', () => {
    for (const [x, z] of [[0, 0], [-1234, 5678], [100000, -100000], [16, -16]]) {
        const sample = terrainAt(x, z);
        assert.deepEqual(terrainAt(x, z), sample);
        assert.ok(Object.values(sample).every(Number.isFinite));
    }
});

test('terrain scaling transforms height and erosion feedback gradient', () => {
    for (const [x, z] of [[0.123, -0.678], [-13, 39], [37, 81], [-71, -29], [351, -229], [-647, 118]]) {
        const input = terrainInputAt(x, z);
        const { height, dx, dz } = input;
        const result = baseTerrainAt(x * TERRAIN_SCALE.horizontal, z * TERRAIN_SCALE.horizontal);
        close(result.height, SEA_LEVEL + (height - SEA_LEVEL) * TERRAIN_SCALE.vertical, 1e-10);
        close(result.dx, dx * TERRAIN_SCALE.vertical / TERRAIN_SCALE.horizontal, 1e-10);
        close(result.dz, dz * TERRAIN_SCALE.vertical / TERRAIN_SCALE.horizontal, 1e-10);
    }
});

test('terrain contains extensive flat lowlands and uncommon high peaks', () => {
    let flatLand = 0;
    let high = 0;
    let veryHigh = 0;
    let underwater = 0;
    let total = 0;
    for (let x = -4096; x <= 4096; x += 64) {
        for (let z = -4096; z <= 4096; z += 64) {
            const height = baseTerrainAt(x, z).height;
            if (height >= SEA_LEVEL && Math.abs(baseTerrainAt(x + 1, z).height - height) < 0.25
                && Math.abs(baseTerrainAt(x, z + 1).height - height) < 0.25) flatLand++;
            if (height > 100) high++;
            if (height > 200) veryHigh++;
            if (height < SEA_LEVEL) underwater++;
            total++;
        }
    }
    assert.ok(flatLand / total > 0.3);
    assert.ok(high / total > 0.2 && high / total < 0.4);
    assert.ok(veryHigh / total > 0.03 && veryHigh / total < 0.1);
    assert.ok(underwater / total > 0.05);
});

test('a substantial low basin is surrounded by higher terrain and filled with water', () => {
    const step = 32;
    const start = [-224, 480];
    assert.ok(terrainHeightAt(...start) < SEA_LEVEL);
    const queue = [start];
    const seen = new Set([start.join(',')]);
    for (let i = 0; i < queue.length; i++) {
        const [x, z] = queue[i];
        assert.ok(x >= -512 && x <= 1024 && z >= 256 && z <= 1536, 'water basin escaped the surrounding land');
        for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
            const next = [x + dx, z + dz];
            const key = next.join(',');
            if (seen.has(key) || terrainHeightAt(...next) >= SEA_LEVEL) continue;
            seen.add(key);
            queue.push(next);
        }
    }
    assert.ok(queue.length > 100);
    const [x, z] = queue[Math.floor(queue.length / 2)];
    const chunk = createChunkData(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    assert.equal(chunk.getBlock(x, SEA_LEVEL, z), BLOCK.WATER);
});

test('gullies use partial normalization instead of amplifying cancellation', () => {
    let partial = 0;
    let normalized = 0;
    for (let x = 0; x < 60; x++) {
        for (let z = 0; z < 60; z++) {
            const stripe = slopeAlignedStripes(x, z, 0.6, 0.8, 0.13, 0.5);
            const magnitude = Math.hypot(stripe.value, stripe.sine);
            assert.ok(magnitude <= 1 + 1e-12 && Object.values(stripe).every(Number.isFinite));
            if (magnitude < 0.99) partial++;
            else normalized++;
        }
    }
    assert.ok(partial > 100 && normalized > 100);
});

test('mountain erosion builds successive slope-oriented layers', () => {
    const settings = MOUNTAIN_EROSION_SETTINGS;
    const input = { height: 0.65, dx: 0.004, dz: -0.003 };
    assert.deepEqual(erodeMountain(37, -23, input, { ...settings, strength: 0 }), input);
    const one = erodeMountain(37, -23, input, { ...settings, octaves: 1 });
    const many = erodeMountain(37, -23, input, settings);
    assert.notDeepEqual(one, input);
    assert.notDeepEqual(many, one);
    assert.ok(Object.values(erodeMountain(0, 0, { height: 0.5, dx: 0, dz: 0 })).every(Number.isFinite));
    assert.notEqual(erodeMountain(37, -23, input, { ...settings, gullyContribution: 0.2 }).height, many.height);
});

test('jittered mountain stripes are bounded and continuous across cell edges', () => {
    const settings = MOUNTAIN_EROSION_SETTINGS;
    const edge = Math.PI * 2 * settings.cellScale / settings.baseFrequency;
    const sample = (x, z) => gullyNoise(x, z, 0.6, 0.8, settings.baseFrequency,
        settings.cellScale, settings.normalization);
    for (const x of [-edge, 0, edge]) {
        for (const z of [-edge * 0.7, 0, edge * 0.7]) {
            const left = sample(x - 1e-5, z);
            const right = sample(x + 1e-5, z);
            close(left.value, right.value, 1e-5);
            close(left.sine, right.sine, 1e-5);
            assert.ok(Math.hypot(left.value, left.sine) <= 1 + 1e-12);
            assert.ok(Object.values(left).every(Number.isFinite));
        }
    }
    let partiallyNormalized = 0;
    let fullyNormalized = 0;
    for (let x = -100; x < 100; x += 5) {
        for (let z = -100; z < 100; z += 5) {
            const stripe = sample(x, z);
            const magnitude = Math.hypot(stripe.value, stripe.sine);
            assert.ok(magnitude <= 1 + 1e-12);
            if (magnitude < 0.99) partiallyNormalized++;
            else fullyNormalized++;
        }
    }
    assert.ok(partiallyNormalized > 100 && fullyNormalized > 100);
});

test('every mountain erosion octave adds measurable spatial detail', () => {
    const input = { height: 0.65, dx: 0.004, dz: -0.003 };
    const totals = Array(MOUNTAIN_EROSION_SETTINGS.octaves).fill(0);
    let count = 0;
    const height = (x, z, octaves) =>
        erodeMountain(x, z, input, { ...MOUNTAIN_EROSION_SETTINGS, octaves }).height;
    for (let x = -100; x <= 100; x += 8) {
        for (let z = -100; z <= 100; z += 8) {
            for (let octave = 1; octave <= totals.length; octave++) {
                const layer = (px, pz) => height(px, pz, octave) - height(px, pz, octave - 1);
                const center = layer(x, z);
                totals[octave - 1] += Math.abs(layer(x - 3, z) + layer(x + 3, z) - 2 * center)
                    + Math.abs(layer(x, z - 3) + layer(x, z + 3) - 2 * center);
            }
            count++;
        }
    }
    const minimums = [0.0008, 0.0025, 0.004, 0.006, 0.007];
    for (let i = 0; i < totals.length; i++) {
        assert.ok(totals[i] / count > minimums[i], `octave ${i + 1}: ${totals[i] / count}`);
    }
});

test('fine erosion creates visible-scale relief in both mountain regions', () => {
    const fullOctaves = MOUNTAIN_EROSION_SETTINGS.octaves;
    const fineStrength = FINE_EROSION_SETTINGS.strength;
    const ridgeAmplitude = TERRAIN_SETTINGS.alpineRidgeAmplitude;
    const smallAmplitude = TERRAIN_SETTINGS.alpineFineAmplitude;
    const regions = { tall: { count: 0, one: 0, full: 0 }, medium: { count: 0, one: 0, full: 0 } };
    const curvature = (x, z) => {
        const center = baseTerrainAt(x, z).height;
        return Math.abs(baseTerrainAt(x - 4, z).height + baseTerrainAt(x + 4, z).height - 2 * center)
            + Math.abs(baseTerrainAt(x, z - 4).height + baseTerrainAt(x, z + 4).height - 2 * center);
    };
    try {
        FINE_EROSION_SETTINGS.strength = 0;
        TERRAIN_SETTINGS.alpineRidgeAmplitude = 0;
        TERRAIN_SETTINGS.alpineFineAmplitude = 0;
        for (let x = -4096; x <= 4096; x += 128) {
            for (let z = -4096; z <= 4096; z += 128) {
                const sx = x / TERRAIN_SCALE.horizontal;
                const sz = z / TERRAIN_SCALE.horizontal;
                const tall = noise2DWithGradient(sx, sz, TERRAIN_SETTINGS.mountainFrequency, 41).height;
                const medium = noise2DWithGradient(sx, sz, TERRAIN_SETTINGS.mediumMountainFrequency, 54).height;
                const region = tall > 0.9 ? regions.tall : tall < 0.65 && medium > 0.78 ? regions.medium : null;
                if (!region) continue;
                MOUNTAIN_EROSION_SETTINGS.octaves = 1;
                region.one += curvature(x, z);
                MOUNTAIN_EROSION_SETTINGS.octaves = fullOctaves;
                region.full += curvature(x, z);
                region.count++;
            }
        }
    } finally {
        MOUNTAIN_EROSION_SETTINGS.octaves = fullOctaves;
        FINE_EROSION_SETTINGS.strength = fineStrength;
        TERRAIN_SETTINGS.alpineRidgeAmplitude = ridgeAmplitude;
        TERRAIN_SETTINGS.alpineFineAmplitude = smallAmplitude;
    }
    for (const [region, minimum] of [[regions.tall, 1], [regions.medium, 0.55]]) {
        assert.ok(region.count > 50);
        assert.ok(region.full / region.count > minimum);
        assert.ok(region.full > region.one * 1.8);
    }
});

test('high elevations gain fine gullies and jagged ridges while water-level terrain is unchanged', () => {
    const strength = FINE_EROSION_SETTINGS.strength;
    const ridge = TERRAIN_SETTINGS.alpineRidgeAmplitude;
    const small = TERRAIN_SETTINGS.alpineFineAmplitude;
    const regions = {
        low: { count: 0, erosion: 0, ridges: 0, slope: 0 },
        medium: { count: 0, erosion: 0, ridges: 0, slope: 0 },
        high: { count: 0, erosion: 0, ridges: 0, slope: 0 },
    };
    try {
        for (let x = -4096; x <= 4096; x += 128) {
            for (let z = -4096; z <= 4096; z += 128) {
                FINE_EROSION_SETTINGS.strength = 0;
                TERRAIN_SETTINGS.alpineRidgeAmplitude = 0;
                TERRAIN_SETTINGS.alpineFineAmplitude = 0;
                const base = baseTerrainAt(x, z).height;
                const neighbor = baseTerrainAt(x + 1, z).height;
                FINE_EROSION_SETTINGS.strength = strength;
                const eroded = baseTerrainAt(x, z).height;
                const erodedNeighbor = baseTerrainAt(x + 1, z).height;
                FINE_EROSION_SETTINGS.strength = 0;
                TERRAIN_SETTINGS.alpineRidgeAmplitude = ridge;
                TERRAIN_SETTINGS.alpineFineAmplitude = small;
                const ridged = baseTerrainAt(x, z).height;
                const region = base < TERRAIN_SETTINGS.alpineDetailStart ? regions.low
                    : base < TERRAIN_SETTINGS.alpineDetailFull ? regions.medium : regions.high;
                region.count++;
                region.erosion += Math.abs(eroded - base);
                region.ridges += Math.abs(ridged - base);
                region.slope += Math.abs((erodedNeighbor - eroded) - (neighbor - base));
            }
        }
    } finally {
        FINE_EROSION_SETTINGS.strength = strength;
        TERRAIN_SETTINGS.alpineRidgeAmplitude = ridge;
        TERRAIN_SETTINGS.alpineFineAmplitude = small;
    }
    assert.ok(regions.low.count > 100 && regions.low.erosion === 0 && regions.low.ridges === 0);
    for (const region of Object.values(regions)) {
        region.erosion /= region.count;
        region.ridges /= region.count;
        region.slope /= region.count;
    }
    assert.ok(regions.high.count > 100 && regions.medium.count > 100);
    assert.ok(regions.high.erosion > 1 && regions.high.ridges > 0.8 && regions.high.slope > 0.2);
    assert.ok(regions.high.erosion > regions.medium.erosion * 3);
    assert.ok(regions.high.ridges > regions.medium.ridges * 3);
});

test('mountain detail is substantially stronger at medium and fine scales', () => {
    const current = {
        ridge: TERRAIN_SETTINGS.alpineRidgeAmplitude,
        fine: TERRAIN_SETTINGS.alpineFineAmplitude,
        erosion: FINE_EROSION_SETTINGS.strength,
    };
    const previous = { ridge: 3.5, fine: 1.5, erosion: 0.03 };
    const configure = ({ ridge, fine, erosion }) => {
        TERRAIN_SETTINGS.alpineRidgeAmplitude = ridge;
        TERRAIN_SETTINGS.alpineFineAmplitude = fine;
        FINE_EROSION_SETTINGS.strength = erosion;
    };
    const regions = {
        low: { count: 0 },
        medium: { count: 0, old: [0, 0], current: [0, 0] },
        high: { count: 0, old: [0, 0], current: [0, 0] },
    };
    const curvature = (x, z, center, step) =>
        Math.abs(baseTerrainAt(x - step, z).height + baseTerrainAt(x + step, z).height - 2 * center)
        + Math.abs(baseTerrainAt(x, z - step).height + baseTerrainAt(x, z + step).height - 2 * center);
    try {
        for (let x = -4096; x <= 4096; x += 128) {
            for (let z = -4096; z <= 4096; z += 128) {
                configure(previous);
                const oldHeight = baseTerrainAt(x, z).height;
                const region = oldHeight < TERRAIN_SETTINGS.alpineDetailStart ? regions.low
                    : oldHeight < TERRAIN_SETTINGS.alpineDetailFull ? regions.medium : regions.high;
                region.count++;
                if (region === regions.low) {
                    configure(current);
                    assert.equal(baseTerrainAt(x, z).height, oldHeight);
                    continue;
                }
                region.old[0] += curvature(x, z, oldHeight, 1);
                region.old[1] += curvature(x, z, oldHeight, 4);
                configure(current);
                const height = baseTerrainAt(x, z).height;
                region.current[0] += curvature(x, z, height, 1);
                region.current[1] += curvature(x, z, height, 4);
            }
        }
    } finally {
        configure(current);
    }
    assert.ok(regions.low.count > 100 && regions.medium.count > 100 && regions.high.count > 100);
    for (let scale = 0; scale < 2; scale++) {
        assert.ok(regions.medium.current[scale] > regions.medium.old[scale] * 1.4);
        assert.ok(regions.high.current[scale] > regions.high.old[scale] * 1.8);
    }
});

test('all additional gully octaves contribute fine-scale variation', () => {
    const input = { height: 0.65, dx: 0.012, dz: -0.009 };
    const changes = Array(FINE_EROSION_SETTINGS.octaves).fill(0);
    let count = 0;
    for (let x = -100; x <= 100; x += 4) {
        for (let z = -100; z <= 100; z += 4) {
            let previous = input.height;
            for (let octave = 1; octave <= changes.length; octave++) {
                const current = erodeMountain(x, z, input, { ...FINE_EROSION_SETTINGS, octaves: octave }).height;
                changes[octave - 1] += Math.abs(current - previous);
                previous = current;
            }
            count++;
        }
    }
    for (let octave = 0; octave < changes.length; octave++) {
        assert.ok(changes[octave] / count > 0.0015, `fine octave ${octave + 1} has too little effect`);
    }
});

test('fine erosion covers mountain terrain around the grass line without increasing its strength', () => {
    const strength = FINE_EROSION_SETTINGS.strength;
    let count = 0;
    let active = 0;
    let total = 0;
    try {
        assert.equal(strength, 0.065);
        assert.equal(TERRAIN_SETTINGS.alpineDetailFull, TERRAIN_SETTINGS.stoneHeight);
        for (let x = -4096; x <= 4096; x += 128) {
            for (let z = -4096; z <= 4096; z += 128) {
                FINE_EROSION_SETTINGS.strength = 0;
                const base = baseTerrainAt(x, z).height;
                if (base < 90 || base >= 110) continue;
                FINE_EROSION_SETTINGS.strength = strength;
                const change = Math.abs(baseTerrainAt(x, z).height - base);
                count++;
                total += change;
                if (change > 0.1) active++;
            }
        }
    } finally {
        FINE_EROSION_SETTINGS.strength = strength;
    }
    assert.ok(count > 200 && active / count > 0.9 && total / count > 1);
});

test('lowland roughness forms sparse pockets and leaves water-level terrain unchanged', () => {
    const amplitude = TERRAIN_SETTINGS.pocketAmplitude;
    let count = 0;
    let active = 0;
    let water = 0;
    let slopeChange = 0;
    try {
        for (let x = -4096; x <= 4096; x += 128) {
            for (let z = -4096; z <= 4096; z += 128) {
                TERRAIN_SETTINGS.pocketAmplitude = 0;
                const base = baseTerrainAt(x, z).height;
                if (base > SEA_LEVEL && (base < 35 || base > 60)) continue;
                const neighbor = baseTerrainAt(x + 1, z).height;
                TERRAIN_SETTINGS.pocketAmplitude = amplitude;
                const result = baseTerrainAt(x, z).height;
                if (base <= SEA_LEVEL) {
                    assert.equal(result, base);
                    water++;
                } else {
                    count++;
                    if (Math.abs(result - base) > 0.1) {
                        active++;
                        slopeChange += Math.abs((baseTerrainAt(x + 1, z).height - result) - (neighbor - base));
                    }
                }
            }
        }
    } finally {
        TERRAIN_SETTINGS.pocketAmplitude = amplitude;
    }
    assert.ok(water > 100 && count > 500);
    assert.ok(active / count > 0.07 && active / count < 0.25);
    assert.ok(slopeChange / active > 0.04);
});

test('large-scale gullies shape mountain regions smoothly over long distances', () => {
    const strength = CHAIN_EROSION_SETTINGS.strength;
    const delta = (x, z) => {
        CHAIN_EROSION_SETTINGS.strength = 0;
        const base = baseTerrainAt(x, z).height;
        CHAIN_EROSION_SETTINGS.strength = strength;
        return baseTerrainAt(x, z).height - base;
    };
    let count = 0;
    let magnitude = 0;
    let nearby = 0;
    let distant = 0;
    try {
        for (let x = -4096; x <= 4096; x += 128) {
            for (let z = -4096; z <= 4096; z += 128) {
                CHAIN_EROSION_SETTINGS.strength = 0;
                const height = baseTerrainAt(x, z).height;
                if (height <= 100) continue;
                const value = delta(x, z);
                magnitude += Math.abs(value);
                nearby += Math.abs(value - delta(x + 16, z));
                distant += Math.abs(value - delta(x + 128, z));
                count++;
            }
        }
    } finally {
        CHAIN_EROSION_SETTINGS.strength = strength;
    }
    assert.ok(count > 500 && magnitude / count > 5);
    assert.ok(distant > nearby * 3);
});

test('fractal erosion contributes to both mountain scales without affecting meadow-only columns', () => {
    const strength = MOUNTAIN_EROSION_SETTINGS.strength;
    const points = [];
    try {
        MOUNTAIN_EROSION_SETTINGS.strength = 0;
        for (let x = -4096; x <= 4096; x += 64) {
            for (let z = -4096; z <= 4096; z += 64) {
                const region = noise2DWithGradient(x / TERRAIN_SCALE.horizontal, z / TERRAIN_SCALE.horizontal,
                    TERRAIN_SETTINGS.mountainFrequency, 41).height;
                const medium = noise2DWithGradient(x / TERRAIN_SCALE.horizontal, z / TERRAIN_SCALE.horizontal,
                    TERRAIN_SETTINGS.mediumMountainFrequency, 54).height;
                const kind = region >= 0.9 ? 'tall' : region <= 0.65 && medium >= 0.78 ? 'medium'
                    : region <= 0.65 && medium <= 0.44 ? 'meadow' : null;
                if (kind) points.push({ x, z, kind, before: baseTerrainAt(x, z) });
            }
        }
        MOUNTAIN_EROSION_SETTINGS.strength = strength;
        const totals = { tall: { count: 0, change: 0 }, medium: { count: 0, change: 0 } };
        let meadows = 0;
        for (const { x, z, kind, before } of points) {
            const after = baseTerrainAt(x, z);
            if (kind === 'meadow') {
                assert.deepEqual(after, before);
                meadows++;
            } else {
                totals[kind].count++;
                totals[kind].change += Math.abs(after.height - before.height);
            }
        }
        assert.ok(meadows > 1000);
        assert.ok(totals.medium.count > 500 && totals.medium.change / totals.medium.count > 5);
        assert.ok(totals.tall.count > 100 && totals.tall.change / totals.tall.count > 10);
    } finally {
        MOUNTAIN_EROSION_SETTINGS.strength = strength;
    }
});

test('the world-height safety clamp rarely clips mountain terrain', () => {
    let clipped = 0;
    let high = 0;
    let total = 0;
    for (let x = -8192; x <= 8192; x += 64) {
        for (let z = -8192; z <= 8192; z += 64) {
            const height = baseTerrainAt(x, z).height;
            if (height >= WORLD_HEIGHT - 2) clipped++;
            if (height > 200) high++;
            assert.ok(terrainHeightAt(x, z) <= WORLD_HEIGHT - 2);
            total++;
        }
    }
    assert.ok(high > 1000);
    assert.ok(clipped / total < 0.001);
});

test('medium mountains are common without changing tall mountain cores', () => {
    const amplitude = TERRAIN_SETTINGS.mediumMountainAmplitude;
    const points = [];
    for (let x = -4096; x <= 4096; x += 64) {
        for (let z = -4096; z <= 4096; z += 64) points.push([x, z]);
    }
    try {
        TERRAIN_SETTINGS.mediumMountainAmplitude = 0;
        const baseline = points.map(([x, z]) => baseTerrainAt(x, z).height);
        TERRAIN_SETTINGS.mediumMountainAmplitude = amplitude;
        let before = 0;
        let after = 0;
        let cores = 0;
        points.forEach(([x, z], index) => {
            const height = baseTerrainAt(x, z).height;
            if (baseline[index] >= 60 && baseline[index] < 150) before++;
            if (height >= 60 && height < 150) after++;
            const region = noise2DWithGradient(x / TERRAIN_SCALE.horizontal, z / TERRAIN_SCALE.horizontal,
                TERRAIN_SETTINGS.mountainFrequency, 41);
            if (region.height >= TERRAIN_SETTINGS.mountainOnset + TERRAIN_SETTINGS.mountainRange) {
                close(height, baseline[index], 1e-10);
                cores++;
            }
        });
        assert.ok(after > before * 3 && after / points.length > 0.3);
        assert.ok(cores > 10);
    } finally {
        TERRAIN_SETTINGS.mediumMountainAmplitude = amplitude;
    }
});

test('medium-scale meadow relief increases lowland variation', () => {
    const amplitude = TERRAIN_SETTINGS.meadowRollAmplitude;
    const points = [];
    for (let x = -2048; x <= 2048; x += 64) {
        for (let z = -2048; z <= 2048; z += 64) points.push([x, z]);
    }
    try {
        TERRAIN_SETTINGS.meadowRollAmplitude = 0;
        const baseline = points.map(([x, z]) => [baseTerrainAt(x, z).height, baseTerrainAt(x + 32, z).height]);
        TERRAIN_SETTINGS.meadowRollAmplitude = amplitude;
        let before = 0;
        let after = 0;
        let lowlands = 0;
        points.forEach(([x, z], index) => {
            const height = baseTerrainAt(x, z).height;
            const next = baseTerrainAt(x + 32, z).height;
            const [oldHeight, oldNext] = baseline[index];
            if (height >= SEA_LEVEL && height < 60 && oldHeight >= SEA_LEVEL && oldHeight < 60) {
                before += Math.abs(oldNext - oldHeight);
                after += Math.abs(next - height);
                lowlands++;
            }
        });
        assert.ok(lowlands > 1000 && after > before * 1.3);
    } finally {
        TERRAIN_SETTINGS.meadowRollAmplitude = amplitude;
    }
});

test('sediment adds only gentle low-amplitude height variation', () => {
    const amplitude = TERRAIN_SETTINGS.sedimentAmplitude;
    const pocket = TERRAIN_SETTINGS.pocketAmplitude;
    const fine = FINE_EROSION_SETTINGS.strength;
    const ridge = TERRAIN_SETTINGS.alpineRidgeAmplitude;
    const small = TERRAIN_SETTINGS.alpineFineAmplitude;
    try {
        TERRAIN_SETTINGS.pocketAmplitude = 0;
        FINE_EROSION_SETTINGS.strength = 0;
        TERRAIN_SETTINGS.alpineRidgeAmplitude = 0;
        TERRAIN_SETTINGS.alpineFineAmplitude = 0;
        TERRAIN_SETTINGS.sedimentAmplitude = 0;
        const samples = [[-1500, -1500], [-1234, 5678], [0, 0], [300, -200]]
            .map(([x, z]) => baseTerrainAt(x, z));
        TERRAIN_SETTINGS.sedimentAmplitude = amplitude;
        let changed = 0;
        for (const [index, [x, z]] of [[-1500, -1500], [-1234, 5678], [0, 0], [300, -200]].entries()) {
            const result = baseTerrainAt(x, z);
            const expected = noise2DWithGradient(x / TERRAIN_SCALE.horizontal, z / TERRAIN_SCALE.horizontal,
                TERRAIN_SETTINGS.sedimentFrequency, 81);
            close(result.height - samples[index].height, amplitude * (expected.height - 0.5) * TERRAIN_SCALE.vertical);
            close(result.dx - samples[index].dx, amplitude * expected.dx * TERRAIN_SCALE.vertical / TERRAIN_SCALE.horizontal);
            close(result.dz - samples[index].dz, amplitude * expected.dz * TERRAIN_SCALE.vertical / TERRAIN_SCALE.horizontal);
            if (Math.abs(result.height - samples[index].height) > 0.01) changed++;
        }
        assert.ok(changed >= 3);
    } finally {
        TERRAIN_SETTINGS.sedimentAmplitude = amplitude;
        TERRAIN_SETTINGS.pocketAmplitude = pocket;
        FINE_EROSION_SETTINGS.strength = fine;
        TERRAIN_SETTINGS.alpineRidgeAmplitude = ridge;
        TERRAIN_SETTINGS.alpineFineAmplitude = small;
    }
});

test('soil thins on slopes and gives way to stone on steep or high ground', () => {
    const column = (heightAt, x = 0, z = 0) => {
        const data = createChunkData(0, 0, null, heightAt);
        const surface = data.getHeight(x, z);
        return [0, 1, 2, 3].map((depth) => data.getBlock(x, surface - depth, z));
    };
    assert.deepEqual(column(() => 40), [BLOCK.GRASS, BLOCK.DIRT, BLOCK.DIRT, BLOCK.DIRT]);
    assert.deepEqual(column((x) => 40 + x), [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.STONE]);
    assert.deepEqual(column((x) => 40 + 2 * x), [BLOCK.STONE, BLOCK.STONE, BLOCK.STONE, BLOCK.STONE]);
    assert.deepEqual(column(() => 100), [BLOCK.STONE, BLOCK.STONE, BLOCK.STONE, BLOCK.STONE]);
    assert.deepEqual(column(() => SEA_LEVEL - 2), [BLOCK.DIRT, BLOCK.DIRT, BLOCK.DIRT, BLOCK.DIRT]);
});

test('grass line falls with sustained slope while flat and low terrain retain soil', () => {
    const surfaceBlock = (heightAt) => {
        const data = createChunkData(0, 0, null, heightAt);
        return data.getBlock(0, data.getHeight(0, 0), 0);
    };
    assert.equal(surfaceBlock(() => 99), BLOCK.GRASS);
    assert.equal(surfaceBlock(() => 100), BLOCK.STONE);
    assert.equal(surfaceBlock((x) => 96 + Math.floor(x / 4)), BLOCK.GRASS);
    assert.equal(surfaceBlock((x) => 97 + Math.floor(x / 4)), BLOCK.STONE);
    assert.equal(surfaceBlock((x) => 87 + x), BLOCK.GRASS);
    assert.equal(surfaceBlock((x) => 88 + x), BLOCK.STONE);
    assert.equal(surfaceBlock((x) => 60 + x), BLOCK.GRASS);
});

test('generated lowlands are mostly grassy and mountains are mostly bare rock', () => {
    let lowlands = 0;
    let grass = 0;
    let mountains = 0;
    let stone = 0;
    for (let cx = -128; cx <= 128; cx += 16) {
        for (let cz = -128; cz <= 128; cz += 16) {
            const data = createChunkData(cx, cz);
            for (let dx = 0; dx < CHUNK_SIZE; dx += 4) {
                for (let dz = 0; dz < CHUNK_SIZE; dz += 4) {
                    const x = cx * CHUNK_SIZE + dx;
                    const z = cz * CHUNK_SIZE + dz;
                    const height = data.getHeight(x, z);
                    if (height > SEA_LEVEL && height < 60) {
                        lowlands++;
                        if (data.getBlock(x, height, z) === BLOCK.GRASS) grass++;
                    } else if (height >= 100) {
                        mountains++;
                        if (data.getBlock(x, height, z) === BLOCK.STONE) stone++;
                    }
                }
            }
        }
    }
    assert.ok(lowlands > 1000 && grass / lowlands > 0.85);
    assert.ok(mountains > 100 && stone / mountains > 0.9);
});

test('grass-line slope variation exposes rock on generated mountain slopes', () => {
    const drop = TERRAIN_SETTINGS.grassLineSlopeDrop;
    let grassBefore = 0;
    let grassAfter = 0;
    try {
        for (let cx = -128; cx <= 128; cx += 16) {
            for (let cz = -128; cz <= 128; cz += 16) {
                TERRAIN_SETTINGS.grassLineSlopeDrop = 0;
                const original = createChunkData(cx, cz);
                const columns = [];
                for (let dx = 0; dx < CHUNK_SIZE; dx += 4) {
                    for (let dz = 0; dz < CHUNK_SIZE; dz += 4) {
                        const x = cx * CHUNK_SIZE + dx;
                        const z = cz * CHUNK_SIZE + dz;
                        const height = original.getHeight(x, z);
                        if (height < TERRAIN_SETTINGS.stoneHeight - drop || height >= TERRAIN_SETTINGS.stoneHeight) continue;
                        const block = original.getBlock(x, height, z);
                        if (block === BLOCK.GRASS) grassBefore++;
                        columns.push({ x, z, height, block });
                    }
                }
                TERRAIN_SETTINGS.grassLineSlopeDrop = drop;
                const varied = createChunkData(cx, cz);
                for (const { x, z, height, block } of columns) {
                    const material = varied.getBlock(x, height, z);
                    if (material === BLOCK.GRASS) grassAfter++;
                    if (block !== BLOCK.GRASS) assert.notEqual(material, BLOCK.GRASS);
                }
            }
        }
    } finally {
        TERRAIN_SETTINGS.grassLineSlopeDrop = drop;
    }
    assert.ok(grassBefore > 100);
    assert.ok(grassAfter / grassBefore > 0.4 && grassAfter / grassBefore < 0.9);
});

test('slope materials match across negative chunk borders and cache orders', () => {
    const heightAt = (x, z) => 40 + (x >= 0 ? 2 : 0) + (z >= 0 ? 1 : 0);
    const cache = createTerrainCache();
    const right = createChunkData(0, -1, cache, heightAt);
    const left = createChunkData(-1, -1, cache, heightAt);
    const fresh = createChunkData(-1, -1, null, heightAt);
    for (const x of [-1, 0]) {
        for (let z = -16; z <= 0; z++) {
            for (let y = 36; y <= 44; y++) {
                assert.equal(left.getBlock(x, y, z), right.getBlock(x, y, z));
                assert.equal(left.getBlock(x, y, z), fresh.getBlock(x, y, z));
            }
        }
    }
    assert.equal(left.getBlock(-1, 40, -2), BLOCK.STONE);
    assert.equal(right.getBlock(0, 42, -2), BLOCK.STONE);
});

test('grass line slope samples agree across borders and cache order', () => {
    const heightAt = (x, z) => 97 + Math.floor(x / 4) + Math.floor(z / 8);
    const cache = createTerrainCache();
    const right = createChunkData(0, -1, cache, heightAt);
    const left = createChunkData(-1, -1, cache, heightAt);
    const fresh = createChunkData(-1, -1, null, heightAt);
    let grass = 0;
    let stone = 0;
    for (const x of [-1, 0]) {
        for (let z = -16; z <= 0; z++) {
            const height = left.getHeight(x, z);
            const material = left.getBlock(x, height, z);
            assert.equal(material, right.getBlock(x, height, z));
            assert.equal(material, fresh.getBlock(x, height, z));
            if (material === BLOCK.GRASS) grass++;
            if (material === BLOCK.STONE) stone++;
        }
    }
    assert.ok(grass > 0 && stone > 0);
});

test('cached chunk grids reuse borders and evict old grids', () => {
    const cache = createTerrainCache(1);
    let samples = 0;
    const sample = (x, z) => { samples++; return terrainHeightAt(x, z); };
    createChunkData(-1, -1, cache, sample);
    assert.equal(samples, 18 * 18);
    samples = 0;
    createChunkData(0, -1, cache, sample);
    assert.equal(samples, 18 * 16);
    samples = 0;
    createChunkData(-1, -1, cache, sample);
    assert.equal(samples, 18 * 16);
    samples = 0;
    createChunkData(5, 5, cache, sample);
    assert.equal(samples, 18 * 18);
    samples = 0;
    createChunkData(-1, -1, cache, sample);
    assert.equal(samples, 18 * 18);
});

test('cached chunk data matches uncached data in any generation order', () => {
    const cache = createTerrainCache(8);
    const positions = [[0, 0], [1, 0], [-1, -1], [0, -1], [1, 1], [0, 0], [-2, 0]];
    for (const [cx, cz] of positions) {
        const cached = createChunkData(cx, cz, cache);
        const original = createChunkData(cx, cz);
        for (let x = cx * CHUNK_SIZE - 1; x <= (cx + 1) * CHUNK_SIZE; x++) {
            for (let z = cz * CHUNK_SIZE - 1; z <= (cz + 1) * CHUNK_SIZE; z++) {
                for (let y = 0; y < WORLD_HEIGHT; y++) {
                    assert.equal(cached.getBlock(x, y, z), original.getBlock(x, y, z));
                }
            }
        }
    }
});

test('adjacent chunk borders agree, including at negative coordinates', () => {
    for (const cx of [-3, -1, 0, 2]) {
        const left = createChunkData(cx, -1);
        const right = createChunkData(cx + 1, -1);
        for (const x of [(cx + 1) * CHUNK_SIZE - 1, (cx + 1) * CHUNK_SIZE]) {
            for (let z = -16; z < 0; z++) {
                for (let y = 0; y < 96; y++) {
                    assert.equal(left.getBlock(x, y, z), right.getBlock(x, y, z));
                }
            }
        }
    }
});

test('generated caves are deterministic across borders and cache orders', () => {
    const cache = createTerrainCache(8);
    for (const [cx, cz] of [[11, -12], [12, -12], [-12, 39], [-11, 39], [-35, 47], [-52, -40], [9, -31]]) {
        const a = createChunkData(cx, cz, cache);
        const b = createChunkData(cx + 1, cz, cache);
        const fresh = createChunkData(cx, cz);
        for (const x of [(cx + 1) * CHUNK_SIZE - 1, (cx + 1) * CHUNK_SIZE]) {
            for (let z = cz * CHUNK_SIZE; z < (cz + 1) * CHUNK_SIZE; z++) {
                for (let y = 0; y < 100; y++) {
                    assert.equal(a.getBlock(x, y, z), b.getBlock(x, y, z));
                    assert.equal(a.getBlock(x, y, z), fresh.getBlock(x, y, z));
                }
            }
        }
    }
});

test('cave queries only include enabled caves and do not alter the exterior heightfield', () => {
    for (const [x, z] of [[187, -186], [-607, 820], [0, 0], [100000, -100000]]) {
        assert.deepEqual(terrainAt(x, z), baseTerrainAt(x, z));
        assert.ok(featuresInBounds(x, z, x, z).every((feature) => feature.cave));
    }
});
