import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BLOCK } from '../game/constants.js';
import { blockSamplerDescriptor, loadBlockTextures } from '../renderer/textures.js';

test('texture filters preserve pixel art by default or enable anisotropic sampling', () => {
    assert.deepEqual(blockSamplerDescriptor('pixelated'), {
        magFilter: 'nearest', minFilter: 'nearest', mipmapFilter: 'linear',
        addressModeU: 'repeat', addressModeV: 'repeat',
    });
    assert.deepEqual(blockSamplerDescriptor('anisotropic'), {
        magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
        addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8,
    });
    assert.throws(() => blockSamplerDescriptor('invalid'), /Unknown block texture filter/);
});

test('block texture assets are 16x16 RGB, indexed, or RGBA PNGs', async () => {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    for (const name of ['grass', 'dirt', 'stone', 'water']) {
        const data = await readFile(new URL(`../assets/${name}.png`, import.meta.url));
        assert.deepEqual(data.subarray(0, 8), signature);
        assert.equal(data.readUInt32BE(16), 16);
        assert.equal(data.readUInt32BE(20), 16);
        assert.ok([2, 3, 6].includes(data[25]), `${name} must be an RGB, indexed, or RGBA PNG`);
        const validDepths = data[25] === 3 ? [1, 2, 4, 8] : [8, 16];
        assert.ok(validDepths.includes(data[24]), `${name} has an invalid PNG bit depth`);
    }
});

test('loads each block texture and reports missing images', async (t) => {
    const previousImage = globalThis.Image;
    let failing = false;
    globalThis.Image = class {
        set src(url) {
            this.url = url;
            queueMicrotask(() => {
                if (failing && url.endsWith('/water.png')) this.onerror();
                else this.onload();
            });
        }
    };
    t.after(() => {
        if (previousImage === undefined) delete globalThis.Image;
        else globalThis.Image = previousImage;
    });

    const textures = await loadBlockTextures();
    assert.deepEqual([...textures.keys()], [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.WATER]);
    for (const [type, name] of [[BLOCK.GRASS, 'grass'], [BLOCK.DIRT, 'dirt'], [BLOCK.STONE, 'stone'], [BLOCK.WATER, 'water']]) {
        assert.ok(textures.get(type).url.endsWith(`/assets/${name}.png`));
    }
    failing = true;
    await assert.rejects(loadBlockTextures(), /Could not load block texture: .*\/assets\/water\.png/);
});
