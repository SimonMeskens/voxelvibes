// Shared numbers and block ids used across the whole renderer.
// Keeping them in one place makes it easy to tweak the world's look and feel.

// Each block type is just a small integer. 0 always means "empty / air".
export const BLOCK = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    WATER: 4,
};

export const CHUNK_SIZE = 16; // blocks per chunk, on both the x and z axis
export const WORLD_HEIGHT = 400;
export const SEA_LEVEL = 27;

// Chunks intersecting this radius are streamed around the camera.
export const RENDER_DISTANCE = 2048;
