// Artistic single-scattering approximation in linear RGB, in world-block units.
export const ATMOSPHERE_VERSION = 4;
export const RAYLEIGH_SETTINGS = {
    scattering: [0.00002, 0.00006, 0.00019],
    scatteringExponent: 1.35,
    heightFalloff: 0.0004,
    skyHorizonCurve: 0.015,
    skyHorizonBias: 0.025,
    skyVerticalStrength: 0.0,
};

export const atmosphereShader = /* wgsl */ `
fn sunDirection() -> vec3f {
    return normalize(vec3f(1.0, 1.5, 0.5));
}

fn rayleighPhase(direction: vec3f) -> f32 {
    let cosine = dot(direction, sunDirection());
    return 0.75 * (1.0 + cosine * cosine);
}

fn curveRayleighDepth(opticalDepth: vec3f) -> vec3f {
    return pow(opticalDepth, vec3f(${RAYLEIGH_SETTINGS.scatteringExponent}));
}

fn rayleighOpticalDepth(distance: f32, cameraHeight: f32, surfaceHeight: f32, seaLevel: f32) -> vec3f {
    let falloff = ${RAYLEIGH_SETTINGS.heightFalloff};
    let startExponent = clamp(-falloff * (cameraHeight - seaLevel), -80.0, 20.0);
    let endExponent = clamp(-falloff * (surfaceHeight - seaLevel), -80.0, 20.0);
    let delta = endExponent - startExponent;
    var meanDensity: f32;
    if (abs(delta) < 0.01) {
        meanDensity = exp((startExponent + endExponent) * 0.5) * (1.0 + delta * delta / 24.0);
    } else {
        meanDensity = (exp(endExponent) - exp(startExponent)) / delta;
    }
    let verticalStrength = mix(1.0, ${RAYLEIGH_SETTINGS.skyVerticalStrength},
        clamp(abs(surfaceHeight - cameraHeight) / max(distance, 0.000001), 0.0, 1.0));
    let opticalDepth = vec3f(${RAYLEIGH_SETTINGS.scattering.map(s => s * 10).join(', ')}) * distance * meanDensity * verticalStrength;
    return curveRayleighDepth(opticalDepth);
}

fn rayleighSky(direction: vec3f, cameraHeight: f32, seaLevel: f32) -> vec3f {
    let elevation = clamp(direction.y, 0.0, 1.0);
    let airMass = exp(clamp(-${RAYLEIGH_SETTINGS.heightFalloff} * (cameraHeight - seaLevel), -80.0, 20.0))
        / (${RAYLEIGH_SETTINGS.heightFalloff} * (sqrt(elevation * elevation + ${RAYLEIGH_SETTINGS.skyHorizonCurve})
            + ${RAYLEIGH_SETTINGS.skyHorizonBias}));
    let opticalDepth = vec3f(${RAYLEIGH_SETTINGS.scattering.join(', ')}) * airMass;
    let transmission = exp(-opticalDepth);
    return (vec3f(1.0) - transmission) * rayleighPhase(direction);
}

fn skyColor(direction: vec3f, cameraHeight: f32, seaLevel: f32) -> vec3f {
    let sun = dot(direction, sunDirection());
    let disc = smoothstep(0.9997, 0.99985, sun);
    return mix(rayleighSky(direction, cameraHeight, seaLevel), vec3f(1.0, 0.95, 0.82), disc);
}
`;
