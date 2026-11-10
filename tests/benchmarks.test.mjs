import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarize } from '../benchmarks/statistics.js';
import { compare, previousCompatible, readHistory, saveRun } from '../benchmarks/history.mjs';
import { runNodeBenchmarks } from '../benchmarks/node-bench.js';
import { parseArguments } from '../benchmarks/arguments.mjs';
import { measureTimedFrames } from '../benchmarks/timed-frames.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('benchmark statistics use nearest-rank percentiles and slowest 1% mean', () => {
    const result = summarize(Array.from({ length: 101 }, (_, index) => index + 1), true);
    assert.equal(result.count, 101);
    assert.equal(result.median, 51);
    assert.equal(result.p95, 96);
    assert.equal(result.onePercentLowFps, 1000 / 100.5);
    assert.throws(() => summarize([]));
    assert.throws(() => summarize([NaN]));
    assert.throws(() => summarize([-1]));
});

test('benchmark workloads produce deterministic geometry and cache reuse', () => {
    const first = runNodeBenchmarks();
    const second = runNodeBenchmarks();
    assert.equal(first.sampling.samples, 1024);
    assert.equal(first.sampling.checksum, second.sampling.checksum);
    for (const name of ['flat', 'sloped', 'underwater', 'negative']) {
        assert.equal(first.sampling.landmarks[name].samples, 1024);
        assert.equal(first.sampling.landmarks[name].checksum, second.sampling.landmarks[name].checksum);
    }
    assert.equal(first.generation.uncached.sampleCalls - first.generation.warm.sampleCalls, 64 * 18 * 18);
    assert.ok(first.generation.adjacent.sampleCalls < first.generation.uncached.sampleCalls);
    for (const name of ['flat', 'water', 'cliffs', 'typical', 'cave', 'floodedCave']) {
        assert.ok(first.meshing[name].quads > 0);
        assert.equal(first.meshing[name].quads, second.meshing[name].quads);
        assert.equal(first.meshing[name].triangles, first.meshing[name].quads * 2);
        assert.equal(first.meshing[name].bytes, second.meshing[name].bytes);
    }
    assert.equal(first.pipeline.quads, first.meshing.typical.quads);
    assert.equal(first.pipeline.bytes, first.meshing.typical.bytes);
});

test('history appends and only compares matching environments and workloads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voxel-history-test-'));
    const path = join(directory, 'history.jsonl');
    const make = (suite, version, cpu, median) => ({
        schema: 1, suite, configuration: { version }, environment: { cpu },
        measurements: { terrain: { batchMs: { median } } },
    });
    const first = { ...make('node', 1, 'a', 100), note: 'before' };
    const other = make('node', 2, 'a', 5);
    const latest = { ...make('node', 1, 'a', 80), note: 'after' };
    try {
        assert.equal(await saveRun(path, first), null);
        assert.equal(await saveRun(path, other), null);
        assert.deepEqual(await saveRun(path, latest), first);
        const records = await readHistory(path);
        assert.deepEqual(records, [first, other, latest]);
        assert.equal(previousCompatible(records, make('node', 1, 'b', 1)), null);
        assert.ok(Math.abs(compare(first, latest)['terrain.batchMs.median'].changePercent + 20) < 1e-10);
        await writeFile(path, 'not json\n');
        await assert.rejects(readHistory(path), /Invalid benchmark history line 1/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('benchmark arguments accept optional descriptive notes', () => {
    assert.deepEqual(parseArguments([]), { suite: 'all', note: undefined, uncapped: false });
    assert.deepEqual(parseArguments(['node', '--note', '  test change  ']), { suite: 'node', note: 'test change', uncapped: false });
    assert.deepEqual(parseArguments(['--note', 'baseline', 'browser']), { suite: 'browser', note: 'baseline', uncapped: false });
    assert.deepEqual(parseArguments(['browser', '--uncapped']), { suite: 'browser', note: undefined, uncapped: true });
    for (const args of [['--note'], ['--note', ' '], ['--note', '--note'], ['other'], ['node', 'browser'],
        ['--note', 'a', '--note', 'b'], ['node', '--uncapped'], ['--uncapped', '--uncapped']]) {
        assert.throws(() => parseArguments(args));
    }
});

test('timed frames follow elapsed time, reach the endpoint, and wait for every GPU submission', async () => {
    let clock = 0;
    let pending = false;
    let waits = 0;
    const progress = [];
    const result = await measureTimedFrames({
        now: () => clock,
        nextFrame: async () => { assert.equal(pending, false); clock += 4; },
        update: (value) => progress.push(value),
        render: () => { assert.equal(pending, false); pending = true; clock += 2; return { gpuTimeMs: null, renderedChunks: 1 }; },
        waitForGpu: async () => { assert.equal(pending, true); pending = false; waits++; clock += 4; },
        check: () => {},
        warmupMs: 20,
        durationMs: 25,
    });
    assert.equal(waits, 6);
    assert.deepEqual(progress, [4 / 25, 14 / 25, 24 / 25, 1]);
    assert.equal(result.frameMs.count, 4);
    assert.equal(result.elapsedMs, 40);
    assert.equal(result.framesPerSecond, 100);
    assert.equal(result.gpuPassMs, null);
});

test('paced and uncapped browser runs cannot share a baseline', () => {
    const base = { schema: 1, suite: 'browser', environment: {}, configuration: { mode: 'paced' } };
    const uncapped = { ...base, configuration: { mode: 'uncapped' } };
    assert.equal(previousCompatible([base], uncapped), null);
});

test('browser runs with different texture filtering cannot share a baseline', () => {
    const base = { schema: 1, suite: 'browser', environment: {}, configuration: { textureFilter: 'pixelated', mipmapped: true } };
    const anisotropic = { ...base, configuration: { ...base.configuration, textureFilter: 'anisotropic' } };
    const old = { ...base, configuration: {} };
    assert.equal(previousCompatible([base], anisotropic), null);
    assert.equal(previousCompatible([old], base), null);
});

test('browser runs with different FXAA settings cannot share a baseline', () => {
    const base = { schema: 1, suite: 'browser', environment: {}, configuration: { fxaa: { enabled: true, start: 64, end: 160 } } };
    const other = { ...base, configuration: { fxaa: { enabled: false, start: 64, end: 160 } } };
    assert.equal(previousCompatible([base], other), null);
});

test('browser runs with different AO fades cannot share a baseline', () => {
    const base = { schema: 1, suite: 'browser', environment: {}, configuration: { aoFade: { start: 64, end: 160 } } };
    const other = { ...base, configuration: { aoFade: { start: 80, end: 160 } } };
    const old = { ...base, configuration: {} };
    assert.equal(previousCompatible([base], other), null);
    assert.equal(previousCompatible([old], base), null);
});

test('terrain scales cannot share a benchmark baseline', () => {
    const base = { schema: 1, suite: 'node', environment: {}, configuration: { terrainScale: { horizontal: 1.5, vertical: 1.8 } } };
    const other = { ...base, configuration: { terrainScale: { horizontal: 1, vertical: 1 } } };
    assert.equal(previousCompatible([base], other), null);
});

test('atmosphere changes cannot share a browser benchmark baseline', () => {
    const base = { schema: 1, suite: 'browser', environment: {}, configuration: { atmosphereVersion: 1 } };
    const older = { ...base, configuration: {} };
    assert.equal(previousCompatible([older], base), null);
});

test('Rayleigh settings cannot share a browser benchmark baseline', () => {
    const base = { schema: 1, suite: 'browser', environment: {}, configuration: { rayleigh: { scattering: [0.00002, 0.00006, 0.00019] } } };
    const other = { ...base, configuration: { rayleigh: { scattering: [0.00002, 0.00006, 0.0002] } } };
    assert.equal(previousCompatible([base], other), null);
});

test('timed benchmark propagates GPU synchronization failures', async () => {
    let clock = 0;
    await assert.rejects(measureTimedFrames({
        now: () => clock,
        nextFrame: async () => { clock++; },
        update: () => {},
        render: () => ({ gpuTimeMs: null }),
        waitForGpu: async () => { throw new Error('device lost'); },
        check: () => {},
        warmupMs: 0,
        durationMs: 10,
    }), /device lost/);
});

test('benchmark CLI persists notes and reports the baseline note', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voxel-cli-test-'));
    const path = join(directory, 'history.jsonl');
    const runner = fileURLToPath(new URL('../benchmarks/run.mjs', import.meta.url));
    const run = promisify(execFile);
    try {
        const options = { env: { ...process.env, BENCHMARK_LOG: path }, maxBuffer: 1024 * 1024 };
        await run(process.execPath, [runner, 'node', '--note', 'baseline test'], options);
        const { stdout } = await run(process.execPath, [runner, 'node', '--note', 'optimized test'], options);
        const records = await readHistory(path);
        assert.deepEqual(records.map((record) => record.note), ['baseline test', 'optimized test']);
        assert.equal(JSON.parse(stdout).comparison.baselineNote, 'baseline test');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('history report uses earlier compatible records even outside the displayed results', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voxel-report-test-'));
    const path = join(directory, 'history.jsonl');
    const reporter = fileURLToPath(new URL('../benchmarks/history-report.mjs', import.meta.url));
    const run = promisify(execFile);
    const make = (timestamp, version, median, note) => ({
        schema: 1, suite: 'node', timestamp, note, configuration: { workloadVersion: version },
        environment: { cpu: 'test' }, measurements: {
            pipeline: { chunks: 64, batchMs: { median } },
            meshing: { typical: { batchMs: { median } } },
        },
    });
    try {
        await saveRun(path, make('first', 1, 100, 'before'));
        await saveRun(path, make('different', 2, 20, 'incompatible'));
        await saveRun(path, make('last', 1, 80, 'after'));
        const options = { env: { ...process.env, BENCHMARK_LOG: path } };
        const { stdout } = await run(process.execPath, [reporter, 'node', '1'], options);
        assert.match(stdout, /1 of 3 runs shown/);
        assert.match(stdout, /Baseline: first "before"/);
        assert.match(stdout, /pipeline\.batchMs\.median -20\.0%/);
        assert.doesNotMatch(stdout, /incompatible/);
        await assert.rejects(run(process.execPath, [reporter, 'node', '0'], options));
        await writeFile(path, 'not json\n');
        await assert.rejects(run(process.execPath, [reporter], options), /Invalid benchmark history/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
