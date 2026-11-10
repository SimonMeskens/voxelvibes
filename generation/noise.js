// An extremely simple 3D "value noise" generator.
//
// The idea: pick a pseudo-random value at every whole-number grid point,
// then smoothly blend between the 8 grid points that surround any (x, y, z)
// position. This gives a smooth, hill-and-valley-like signal without needing
// a full Perlin/Simplex noise implementation.

// Turns three integers into one pseudo-random number between 0 and 1.
// This is just arithmetic, so the same (x, y, z) always gives the same
// result - that's what makes the generated world reproducible.
export const hash3D = (x, y, z) => {
    const seed = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
    return seed - Math.floor(seed);
};

// A horizontal slice of the same 3D value noise, with exact derivatives.
export const noise2DWithGradient = (x, z, scale, slice = 0) => {
    const sx = x * scale;
    const sz = z * scale;
    const x0 = Math.floor(sx);
    const z0 = Math.floor(sz);
    const fx = sx - x0;
    const fz = sz - z0;
    const tx = smoothstep(fx);
    const tz = smoothstep(fz);
    const dx = 6 * fx * (1 - fx) * scale;
    const dz = 6 * fz * (1 - fz) * scale;
    const a = hash3D(x0, slice, z0);
    const b = hash3D(x0 + 1, slice, z0);
    const c = hash3D(x0, slice, z0 + 1);
    const d = hash3D(x0 + 1, slice, z0 + 1);
    return {
        height: lerp(lerp(a, b, tx), lerp(c, d, tx), tz),
        dx: lerp(b - a, d - c, tz) * dx,
        dz: (lerp(c, d, tx) - lerp(a, b, tx)) * dz,
    };
};

// Eases a 0..1 value so it speeds up in the middle and slows down at the
// ends, instead of blending in a straight line. This is what makes the
// noise look like smooth terrain instead of a blocky grid.
const smoothstep = (t) => t * t * (3 - 2 * t);

// Blends linearly between `a` and `b` using a 0..1 weight `t`.
const lerp = (a, b, t) => a + (b - a) * t;

// Samples smooth 3D noise at any position, returning a value in [0, 1].
// `scale` controls how "zoomed in" the noise is - smaller scale means
// bigger, smoother features.
export const noise3D = (x, y, z, scale = 1) => {
    const sx = x * scale;
    const sy = y * scale;
    const sz = z * scale;

    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const z0 = Math.floor(sz);

    const tx = smoothstep(sx - x0);
    const ty = smoothstep(sy - y0);
    const tz = smoothstep(sz - z0);

    // Blend along x first, for each of the 4 edges of the surrounding cube...
    const x00 = lerp(hash3D(x0, y0, z0), hash3D(x0 + 1, y0, z0), tx);
    const x10 = lerp(hash3D(x0, y0 + 1, z0), hash3D(x0 + 1, y0 + 1, z0), tx);
    const x01 = lerp(hash3D(x0, y0, z0 + 1), hash3D(x0 + 1, y0, z0 + 1), tx);
    const x11 = lerp(hash3D(x0, y0 + 1, z0 + 1), hash3D(x0 + 1, y0 + 1, z0 + 1), tx);

    // ...then blend those along y...
    const y0z0 = lerp(x00, x10, ty);
    const y0z1 = lerp(x01, x11, ty);

    // ...and finally along z, to get a single smooth value.
    return lerp(y0z0, y0z1, tz);
};
