import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGpuTiming } from '../graphics/gpu-timing.js';

test('unsupported GPU timing is reported and does not issue GPU commands', () => {
    const timing = createGpuTiming({ features: new Set() }, assert.fail);
    assert.equal(timing.begin(true, 1000), null);
    timing.end(null, null);
    timing.read(null);
    assert.equal(timing.value(), 'Unavailable');
});
