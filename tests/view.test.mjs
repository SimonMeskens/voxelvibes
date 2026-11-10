import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxVisible, cameraBasis, frustumPlanes, sphereVisible } from '../graphics/view.js';
import { createCamera } from '../game/camera.js';
import { RENDER_DISTANCE, WORLD_HEIGHT } from '../game/constants.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

test('camera axes are orthonormal, including looking straight down', () => {
    for (const [yaw, pitch] of [[0, 0], [0, -Math.PI / 2], [1.2, 0.7]]) {
        const { right, up, forward } = cameraBasis(yaw, pitch);
        for (const axis of [right, up, forward]) close(dot(axis, axis), 1);
        close(dot(right, up), 0);
        close(dot(right, forward), 0);
        close(dot(up, forward), 0);
    }
    const basis = cameraBasis(0, -Math.PI / 2);
    close(basis.forward[1], -1);
    close(basis.up[2], -1);
});

test('frustum retains visible and intersecting chunks, but excludes distant chunks', () => {
    const camera = { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, fov: Math.PI / 2, near: 0.1 };
    const basis = cameraBasis(camera.yaw, camera.pitch);
    assert.equal(sphereVisible(camera, basis, [0, 0, -10], 1, 1, 100), true);
    assert.equal(sphereVisible(camera, basis, [11, 0, -10], 1, 1, 100), true);
    assert.equal(sphereVisible(camera, basis, [20, 0, -10], 1, 1, 100), false);
    assert.equal(sphereVisible(camera, basis, [0, 0, 10], 1, 1, 100), false);
    assert.equal(sphereVisible(camera, basis, [0, 0, -110], 1, 1, 100), false);
});

test('box frustum culling preserves intersections at all six planes', () => {
    const camera = { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, fov: Math.PI / 2, near: 1 };
    const planes = frustumPlanes(camera, cameraBasis(0, 0), 1, 100);
    const visible = (center, size) => boxVisible(planes, camera.position, center, size);
    for (const center of [[0, 0, -0.5], [0, 0, -100.5], [11, 0, -10], [-11, 0, -10], [0, 11, -10], [0, -11, -10]]) {
        assert.equal(visible(center, [1, 1, 1]), true, `${center}`);
    }
    for (const center of [[0, 0, 2.1], [0, 0, -101.1], [13, 0, -10], [-13, 0, -10], [0, 13, -10], [0, -13, -10]]) {
        assert.equal(visible(center, [1, 1, 1]), false, `${center}`);
    }
    assert.equal(visible([0, 0, 0], [2, 2, 2]), true);
    assert.equal(visible([20, 0, -10], [1, 30, 1]), false);
    assert.equal(sphereVisible(camera, cameraBasis(0, 0), [20, 0, -10], Math.hypot(1, 30, 1), 1, 100), true);
});

test('box culling retains sampled points inside rotated, offset frustums', () => {
    let seed = 41;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    for (let i = 0; i < 2000; i++) {
        const camera = { position: { x: -4096 + random() * 200, y: random() * 500, z: -4096 + random() * 200 },
            yaw: random() * Math.PI * 2, pitch: (random() - 0.5) * Math.PI, fov: Math.PI / 3, near: 0.1 };
        const basis = cameraBasis(camera.yaw, camera.pitch);
        const aspect = 0.5 + random() * 2;
        const far = 500;
        const depth = camera.near + random() * (far - camera.near);
        const height = depth * Math.tan(camera.fov / 2);
        const right = (random() * 2 - 1) * height * aspect;
        const up = (random() * 2 - 1) * height;
        const point = [camera.position.x, camera.position.y, camera.position.z]
            .map((value, axis) => value + depth * basis.forward[axis] + right * basis.right[axis] + up * basis.up[axis]);
        const size = [random() * 30, random() * 200, random() * 30];
        const center = point.map((value, axis) => value + (random() * 2 - 1) * size[axis]);
        assert.equal(boxVisible(frustumPlanes(camera, basis, aspect, far), camera.position, center, size), true);
    }
});

test('overhead camera fits the render radius in both landscape and portrait', () => {
    for (const aspect of [0.5, 1, 2]) {
        const camera = createCamera(aspect);
        const distance = camera.position.y - WORLD_HEIGHT;
        const visibleHalfWidth = distance * Math.tan(camera.fov / 2) * aspect;
        const visibleHalfHeight = distance * Math.tan(camera.fov / 2);
        assert.ok(visibleHalfWidth >= RENDER_DISTANCE - 1e-8);
        assert.ok(visibleHalfHeight >= RENDER_DISTANCE - 1e-8);
        assert.equal(camera.pitch, -Math.PI / 2);
    }
});
