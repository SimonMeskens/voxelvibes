import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoadRate } from '../benchmarks/load-rate.js';

test('load rate counts scene additions in overlay-length intervals', () => {
    const rate = createLoadRate(100);
    rate.record(600, 20);
    rate.record(1100, 30);
    rate.record(1600, 10);
    rate.record(2200, 12);
    rate.record(2500, 3);
    const result = rate.result(2600);
    assert.equal(result.added, 75);
    assert.equal(result.averagePerSecond, 30);
    assert.equal(result.peakIntervalPerSecond, 50);
    assert.deepEqual(result.intervals, [50, 20]);
});
