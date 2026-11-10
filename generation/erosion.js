import { hash3D } from './noise.js';
import { gullyNoise } from './gully-noise.js';

// Frequencies are radians per block; amplitude and strength are in blocks.
export const EROSION_SETTINGS = {
    strength: 4.5,
    gullyContribution: 1,
    octaves: 4,
    baseFrequency: 0.13,
    frequencyMultiplier: 2,
    baseAmplitude: 1,
    amplitudeMultiplier: 0.5,
    detailFalloff: 0.16,
    onset: 0.08,
    onsetRange: 0.35,
    assumedSlope: 0.02,
    ridgeRounding: 0.35,
    creaseRounding: 0.15,
    peakValleyHeight: 34,
    peakValleyRange: 12,
    fade: 0.55,
};

const smoothstep = (value) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
};

// Grid phases are global; a normalization floor avoids amplifying cancellation.
export const slopeAlignedStripes = (x, z, directionX, directionZ, frequency, normalizationFloor = 1e-8) => {
    const cellSize = Math.PI * 2 / frequency;
    const gx = x / cellSize;
    const gz = z / cellSize;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const u = smoothstep(fx);
    const v = smoothstep(fz);
    const du = 6 * fx * (1 - fx) / cellSize;
    const dv = 6 * fz * (1 - fz) / cellSize;
    const waveX = -directionZ * frequency;
    const waveZ = directionX * frequency;
    let c = 0;
    let s = 0;
    let cx = 0;
    let cz = 0;
    let sx = 0;
    let sz = 0;

    for (let a = 0; a <= 1; a++) {
        for (let b = 0; b <= 1; b++) {
            const wx = a ? u : 1 - u;
            const wz = b ? v : 1 - v;
            const weight = wx * wz;
            const weightX = (a ? du : -du) * wz;
            const weightZ = wx * (b ? dv : -dv);
            const px = (ix + a) * cellSize;
            const pz = (iz + b) * cellSize;
            const phase = waveX * (x - px) + waveZ * (z - pz)
                + hash3D(ix + a, 17, iz + b) * Math.PI * 2;
            const cosine = Math.cos(phase);
            const sine = Math.sin(phase);
            c += weight * cosine;
            s += weight * sine;
            cx += weightX * cosine - weight * sine * waveX;
            cz += weightZ * cosine - weight * sine * waveZ;
            sx += weightX * sine + weight * cosine * waveX;
            sz += weightZ * sine + weight * cosine * waveZ;
        }
    }

    const magnitude = Math.hypot(c, s);
    const divisor = Math.max(magnitude, normalizationFloor);
    const value = c / divisor;
    const phaseX = (c * sx - s * cx) / (divisor * divisor);
    const phaseZ = (c * sz - s * cz) / (divisor * divisor);

    // The height stays cosine-smooth; the signed sine deliberately replaces
    // its magnitude in the feedback slope to make the gullies straight-sided.
    const straightSlope = -Math.sign(s);
    return { value, sine: s / divisor, dx: straightSlope * phaseX, dz: straightSlope * phaseZ };
};

// The mountain field is dimensionless, so height and frequency can be scaled
// independently when it is combined with the surrounding landscape.
export const MOUNTAIN_EROSION_SETTINGS = {
    strength: 0.42,
    gullyContribution: 0.55,
    octaves: 5,
    baseFrequency: 0.024,
    frequencyMultiplier: 2,
    amplitudeMultiplier: 0.52,
    assumedSlope: 0.008,
    onsetRange: 0.004,
    octaveOnset: 1.25,
    detail: 1.4,
    ridgeRounding: 0.02,
    creaseRounding: 0.08,
    roundingDecay: 0.8,
    cellScale: 0.7,
    normalization: 0.5,
};

export const FINE_EROSION_SETTINGS = {
    ...MOUNTAIN_EROSION_SETTINGS,
    strength: 0.065,
    octaves: 3,
    baseFrequency: 0.384,
    amplitudeMultiplier: 0.55,
};

export const CHAIN_EROSION_SETTINGS = {
    ...MOUNTAIN_EROSION_SETTINGS,
    strength: 0.32,
    octaves: 1,
    baseFrequency: 0.006,
    onsetRange: 0.001,
};

export const erodeMountain = (x, z, input, settings = MOUNTAIN_EROSION_SETTINGS) => {
    let height = input.height;
    let dx = input.dx;
    let dz = input.dz;
    const slope = Math.hypot(dx, dz);
    const safeSlope = Math.max(slope, 1e-8);
    let flowX = dx / safeSlope * settings.assumedSlope;
    let flowZ = dz / safeSlope * settings.assumedSlope;
    let target = input.height * 2 - 1;
    let mask = smoothstep(slope / settings.onsetRange);
    let frequency = settings.baseFrequency;
    let amplitude = settings.strength;
    let roundingScale = 1;

    for (let octave = 0; octave < settings.octaves; octave++) {
        const flowLength = Math.max(Math.hypot(flowX, flowZ), 1e-8);
        const stripe = gullyNoise(x, z, flowX / flowLength, flowZ / flowLength,
            frequency, settings.cellScale, settings.normalization);
        const faded = target * (1 - mask) + settings.gullyContribution * stripe.value * mask;
        height += amplitude * faded;
        const gullySlope = -stripe.sine * amplitude * settings.gullyContribution;
        const flowSlope = -Math.sign(stripe.sine) * amplitude * settings.gullyContribution;
        dx += gullySlope * stripe.sideX * mask;
        dz += gullySlope * stripe.sideZ * mask;
        flowX += flowSlope * stripe.sideX;
        flowZ += flowSlope * stripe.sideZ;
        target = faded;
        const peak = Math.max(0, Math.min(1, (stripe.value + 1) / 2));
        const rounding = (settings.creaseRounding * (1 - peak) + settings.ridgeRounding * peak) * roundingScale;
        const sloping = Math.max(0, Math.min(1, Math.abs(stripe.sine) * settings.octaveOnset - rounding));
        const nextMask = 1 - (1 - sloping) ** 2;
        mask = (1 - (1 - mask) ** settings.detail) * nextMask;
        frequency *= settings.frequencyMultiplier;
        amplitude *= settings.amplitudeMultiplier;
        roundingScale *= settings.roundingDecay;
    }
    return { height, dx, dz };
};

// This is an artistic feedback gradient, not the exact derivative of the
// final heightfield: stripe directions and slope masks are held fixed while
// differentiating each layer, and the straight-sided slope is intentional.
export const erodeHeight = (x, z, input, settings = EROSION_SETTINGS) => {
    let height = input.height;
    let dx = input.dx;
    let dz = input.dz;
    let frequency = settings.baseFrequency;
    let amplitude = settings.baseAmplitude * settings.strength * settings.gullyContribution;
    if (amplitude === 0 || settings.octaves <= 0) return { height, dx, dz };
    const target = Math.tanh((input.height - settings.peakValleyHeight) / settings.peakValleyRange);
    const targetScale = (1 - target * target) / settings.peakValleyRange;
    const targetX = targetScale * input.dx;
    const targetZ = targetScale * input.dz;
    let fade = settings.fade;
    let fadeX = 0;
    let fadeZ = 0;

    for (let octave = 0; octave < settings.octaves; octave++) {
        const slope = Math.hypot(dx, dz);
        const onset = smoothstep((slope - settings.onset) / settings.onsetRange);
        // With no contribution the slope cannot change, so later octaves
        // will have the same zero onset too.
        if (onset === 0) break;
        const safeSlope = Math.max(slope, settings.assumedSlope, 1e-8);
        const directionX = dx / safeSlope;
        const directionZ = dz / safeSlope;
        const stripe = slopeAlignedStripes(x, z, directionX, directionZ, frequency);
        const detail = smoothstep(slope / Math.max(1e-8, settings.assumedSlope + octave * settings.detailFalloff));

        const rounding = stripe.value >= 0 ? settings.ridgeRounding : settings.creaseRounding;
        const shaped = stripe.value + rounding * stripe.value * (1 - stripe.value * stripe.value);
        const shapedSlope = 1 + rounding * (1 - 3 * stripe.value * stripe.value);
        const towardTarget = (1 - target * stripe.value) * 0.5;
        const gain = 1 - fade * towardTarget;
        const gainX = -fadeX * towardTarget
            + fade * (targetX * stripe.value + target * stripe.dx) * 0.5;
        const gainZ = -fadeZ * towardTarget
            + fade * (targetZ * stripe.value + target * stripe.dz) * 0.5;
        const weight = amplitude * onset * detail;
        height += shaped * gain * weight;
        dx += (shapedSlope * stripe.dx * gain + shaped * gainX) * weight;
        dz += (shapedSlope * stripe.dz * gain + shaped * gainZ) * weight;

        // Carry peak/valley protection, including its feedback gradient.
        const protection = 0.5 * stripe.value * stripe.value;
        const nextFadeX = fadeX * (1 - protection) + (1 - fade) * stripe.value * stripe.dx;
        const nextFadeZ = fadeZ * (1 - protection) + (1 - fade) * stripe.value * stripe.dz;
        fade += (1 - fade) * protection;
        fadeX = nextFadeX;
        fadeZ = nextFadeZ;
        frequency *= settings.frequencyMultiplier;
        amplitude *= settings.amplitudeMultiplier;
    }

    return { height, dx, dz };
};
