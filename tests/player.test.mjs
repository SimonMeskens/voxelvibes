import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, PLAYER } from '../game/player.js';

const cameraAt = (x = 0.5, feet = 1, z = 0.5) => ({
    position: { x, y: feet + PLAYER.eyeHeight, z }, yaw: 0, pitch: 0,
});
const advance = (player, frames, forward = 0, right = 0, up = 0) => {
    for (let i = 0; i < frames; i++) player.update(1 / 60, forward, right, up);
};

test('walking, jumping and gravity respect floors, walls and ceilings', () => {
    const camera = cameraAt();
    const solid = (x, y, z) => y < 1 || x === 2 || (y === 4 && x < 2);
    const player = createPlayer(camera, solid);
    advance(player, 120, 0, 1);
    assert.ok(camera.position.x <= 2 - PLAYER.radius + 0.001);
    assert.ok(Math.abs(camera.position.y - (1 + PLAYER.eyeHeight)) < 0.002);
    player.jump();
    advance(player, 15);
    assert.ok(camera.position.y > 1 + PLAYER.eyeHeight + 0.5);
    assert.ok(camera.position.y - PLAYER.eyeHeight + PLAYER.height <= 4.001);
    advance(player, 120);
    assert.ok(Math.abs(camera.position.y - (1 + PLAYER.eyeHeight)) < 0.002);
});

test('flight collides in every direction and touching ground lands', () => {
    const camera = cameraAt();
    const player = createPlayer(camera, (x, y) => y < 1 || x === 2 || y === 6);
    player.jump();
    advance(player, 5);
    player.toggleFlight();
    assert.equal(player.isFlying(), true);
    advance(player, 120, 0, 1, 1);
    assert.ok(camera.position.x <= 2 - PLAYER.radius + 0.001);
    assert.ok(camera.position.y - PLAYER.eyeHeight + PLAYER.height <= 6.001);
    advance(player, 120, 0, 0, -1);
    assert.equal(player.isFlying(), false);
    assert.ok(Math.abs(camera.position.y - (1 + PLAYER.eyeHeight)) < 0.002);
});

test('unloaded chunks block movement without pretending to be ground', () => {
    const camera = cameraAt(0.5);
    const player = createPlayer(camera, (x, y) => x >= 1 ? null : y < 1);
    advance(player, 60, 0, 1);
    assert.ok(camera.position.x <= 1 - PLAYER.radius + 0.001);
    player.jump();
    advance(player, 10);
    assert.ok(camera.position.y > 1 + PLAYER.eyeHeight);
});

test('collision is swept even for large time steps', () => {
    const camera = cameraAt();
    const player = createPlayer(camera, (x, y) => y < 1 || x === 2);
    player.update(1, 0, 1, 0);
    assert.ok(camera.position.x <= 2 - PLAYER.radius + 0.001);
    assert.ok(camera.position.y >= 1 + PLAYER.eyeHeight - 0.002);
});

test('unknown space is not treated as a landing surface', () => {
    const camera = cameraAt(0.5, 5);
    const player = createPlayer(camera, (x, y) => y < 5 ? null : false);
    player.toggleFlight();
    advance(player, 90, 0, 0, -1);
    assert.equal(player.isFlying(), true);
    assert.ok(camera.position.y >= 5 + PLAYER.eyeHeight - 0.002);
});

test('teleport checks headroom and unloaded space and resets flight and vertical velocity', () => {
    const camera = cameraAt();
    const player = createPlayer(camera, (x, y) => x === 3 && y === 3 ? true : x === 5 ? null : y < 1);
    player.jump();
    player.toggleFlight();
    const original = { ...camera.position };
    assert.equal(player.teleportOnto({ x: 3, y: 1, z: 0 }), false);
    assert.equal(player.teleportOnto({ x: 5, y: 1, z: 0 }), false);
    assert.deepEqual(camera.position, original);
    assert.equal(player.teleportOnto({ x: 2, y: 0, z: 0 }), true);
    assert.equal(player.isFlying(), false);
    advance(player, 1);
    assert.ok(Math.abs(camera.position.y - (1 + PLAYER.eyeHeight)) < 0.002);
});
