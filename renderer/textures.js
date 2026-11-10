import { BLOCK } from '../game/constants.js';

// Choose 'pixelated' for crisp nearby pixels or 'anisotropic' for smoother grazing angles.
export const BLOCK_TEXTURE_FILTER = 'pixelated';

export const blockSamplerDescriptor = (filter) => {
    if (filter === 'pixelated') {
        return { magFilter: 'nearest', minFilter: 'nearest', mipmapFilter: 'linear',
            addressModeU: 'repeat', addressModeV: 'repeat' };
    }
    if (filter === 'anisotropic') {
        return { magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
            addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 };
    }
    throw new Error(`Unknown block texture filter: ${filter}`);
};

const textureFiles = [
    [BLOCK.GRASS, new URL('../assets/grass.png', import.meta.url)],
    [BLOCK.DIRT, new URL('../assets/dirt.png', import.meta.url)],
    [BLOCK.STONE, new URL('../assets/stone.png', import.meta.url)],
    [BLOCK.WATER, new URL('../assets/water.png', import.meta.url)],
];

const loadImage = (url) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load block texture: ${url.href}`));
    image.src = url.href;
});

export const loadBlockTextures = async () => {
    const images = await Promise.all(textureFiles.map(async ([type, url]) => [type, await loadImage(url)]));
    return new Map(images);
};
