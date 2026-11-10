import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMapToggle } from '../game/camera.js';

test('map view restores the complete original position and orientation', () => {
    const camera = { position: { x: -13.2, y: 120, z: 39.9 }, yaw: 0.8, pitch: -0.5 };
    const toggle = createMapToggle(camera, 1000);
    assert.equal(toggle(), true);
    assert.deepEqual(camera.position, { x: -13.2, y: 1000, z: 39.9 });
    assert.equal(camera.pitch, -Math.PI / 2);
    camera.position.x = 100;
    camera.position.y = 90;
    camera.yaw = 2;
    assert.equal(toggle(), false);
    assert.deepEqual(camera.position, { x: -13.2, y: 120, z: 39.9 });
    assert.equal(camera.yaw, 0.8);
    assert.equal(camera.pitch, -0.5);
});

test('map view is above a player who is already higher than the usual map height', () => {
    const camera = { position: { x: 0, y: 1500, z: 0 }, yaw: 0, pitch: 0 };
    createMapToggle(camera, 1000)();
    assert.equal(camera.position.y, 1564);
});
