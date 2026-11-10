import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControls } from '../game/controls.js';
import { PLAYER } from '../game/player.js';

test('map mode freezes movement and look and restores the original view', () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    const canvas = new EventTarget();
    const crosshair = { hidden: false };
    documentEvents.querySelector = (selector) => selector === '#crosshair' ? crosshair : { textContent: 'Controls' };
    documentEvents.pointerLockElement = canvas;
    globalThis.window = windowEvents;
    globalThis.document = documentEvents;
    const key = (type, code, repeat = false) => {
        const event = new Event(type, { cancelable: true });
        event.code = code;
        event.repeat = repeat;
        windowEvents.dispatchEvent(event);
        return event;
    };
    const mouse = (x, y) => {
        const event = new Event('mousemove');
        event.movementX = x;
        event.movementY = y;
        documentEvents.dispatchEvent(event);
    };
    try {
        const camera = { position: { x: 0.5, y: 1 + PLAYER.eyeHeight, z: 0.5 }, yaw: 0.3, pitch: -0.2 };
        const controls = createControls(camera, canvas, (x, y) => y < 1, 1000);
        const saved = structuredClone(camera);
        key('keydown', 'KeyM');
        assert.equal(crosshair.hidden, true);
        key('keydown', 'KeyM', true);
        key('keydown', 'KeyW');
        assert.equal(key('keydown', 'Space').defaultPrevented, true);
        mouse(80, 40);
        controls.update(0.1);
        assert.deepEqual(camera.position, { x: 0.5, y: 1000, z: 0.5 });
        assert.equal(camera.yaw, saved.yaw);
        assert.equal(camera.pitch, -Math.PI / 2);
        key('keyup', 'KeyM');
        key('keydown', 'KeyM');
        assert.equal(crosshair.hidden, false);
        assert.deepEqual(camera, saved);
        controls.update(0.1);
        assert.equal(camera.position.z, saved.position.z);
        mouse(20, -10);
        assert.equal(camera.yaw, saved.yaw - 0.05);
        assert.equal(camera.pitch, saved.pitch + 0.025);
        windowEvents.dispatchEvent(new Event('blur'));
    } finally {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});

test('right-click teleports to the targeted block only outside map mode', () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    const canvas = new EventTarget();
    const hint = { textContent: 'Controls' };
    const crosshair = { hidden: false };
    documentEvents.querySelector = (selector) => selector === '#hint' ? hint : crosshair;
    documentEvents.pointerLockElement = canvas;
    globalThis.window = windowEvents;
    globalThis.document = documentEvents;
    const key = (type, code) => {
        const event = new Event(type);
        event.code = code;
        windowEvents.dispatchEvent(event);
    };
    const rightClick = () => {
        const press = new Event('mousedown', { cancelable: true });
        press.button = 2;
        canvas.dispatchEvent(press);
        assert.equal(press.defaultPrevented, true);
        const menu = new Event('contextmenu', { cancelable: true });
        canvas.dispatchEvent(menu);
        assert.equal(menu.defaultPrevented, true);
    };
    try {
        const camera = { position: { x: 0.5, y: 3.5, z: 0.5 }, yaw: 0, pitch: 0 };
        const solid = (x, y, z) => (z === -4 && y === 3) || y < 1;
        let lookups = 0;
        createControls(camera, canvas, solid, 1000, (...args) => { lookups++; return solid(...args); });
        rightClick();
        assert.deepEqual(camera.position, { x: 0.5, y: 4 + PLAYER.eyeHeight, z: -3.5 });
        const afterFirstClick = lookups;
        const saved = structuredClone(camera);
        key('keydown', 'KeyM');
        assert.equal(crosshair.hidden, true);
        const mapPosition = { ...camera.position };
        rightClick();
        assert.deepEqual(camera.position, mapPosition);
        assert.equal(lookups, afterFirstClick);
        key('keyup', 'KeyM');
        key('keydown', 'KeyM');
        assert.deepEqual(camera, saved);
        assert.equal(crosshair.hidden, false);
    } finally {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});

test('only the right mouse button triggers teleport', () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    const canvas = new EventTarget();
    documentEvents.querySelector = () => ({ textContent: 'Controls', hidden: false });
    globalThis.window = windowEvents;
    globalThis.document = documentEvents;
    try {
        let lookups = 0;
        const camera = { position: { x: 0.5, y: 3.5, z: 0.5 }, yaw: 0, pitch: 0 };
        createControls(camera, canvas, () => false, 1000, () => { lookups++; return false; });
        const event = new Event('mousedown', { cancelable: true });
        event.button = 0;
        canvas.dispatchEvent(event);
        assert.equal(lookups, 0);
        assert.equal(event.defaultPrevented, false);
    } finally {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});

test('right-click reports unloaded terrain, a miss and an obstructed destination', () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    const canvas = new EventTarget();
    const hint = { textContent: 'Controls' };
    documentEvents.querySelector = (selector) => selector === '#hint' ? hint : { hidden: false };
    globalThis.window = windowEvents;
    globalThis.document = documentEvents;
    let mode = 'unloaded';
    const isBlock = (x, y, z) => mode === 'unloaded' && z === -2 ? null
        : mode === 'blocked' && z === -2;
    const isSolid = (x, y, z) => mode === 'blocked' && z === -2 && y === 5;
    try {
        const camera = { position: { x: 0.5, y: 3.5, z: 0.5 }, yaw: 0, pitch: 0 };
        createControls(camera, canvas, isSolid, 1000, isBlock);
        const initial = structuredClone(camera);
        const click = () => {
            const event = new Event('mousedown', { cancelable: true });
            event.button = 2;
            canvas.dispatchEvent(event);
        };
        click();
        assert.match(hint.textContent, /still loading/);
        mode = 'miss';
        click();
        assert.match(hint.textContent, /no block/);
        mode = 'blocked';
        click();
        assert.match(hint.textContent, /not enough loaded space/);
        assert.deepEqual(camera, initial);
    } finally {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});

test('double Space enters flight and both shifts descend', () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    const canvas = new EventTarget();
    documentEvents.querySelector = () => ({ textContent: 'Controls' });
    documentEvents.pointerLockElement = canvas;
    globalThis.window = windowEvents;
    globalThis.document = documentEvents;
    const key = (type, code) => {
        const event = new Event(type, { cancelable: true });
        event.code = code;
        windowEvents.dispatchEvent(event);
    };
    try {
        const camera = { position: { x: 0.5, y: 1 + PLAYER.eyeHeight, z: 0.5 }, yaw: 0, pitch: 0 };
        const controls = createControls(camera, canvas, (x, y) => y < 1, 1000);
        key('keydown', 'Space');
        controls.update(0.1);
        const jumped = camera.position.y;
        assert.ok(jumped > 1 + PLAYER.eyeHeight);
        key('keyup', 'Space');
        key('keydown', 'Space');
        controls.update(0.1);
        assert.ok(camera.position.y > jumped + 1);
        key('keyup', 'Space');
        key('keydown', 'ShiftRight');
        const before = camera.position.y;
        controls.update(0.05);
        assert.ok(camera.position.y < before);
        key('keyup', 'ShiftRight');
        key('keydown', 'ShiftLeft');
        const beforeLeft = camera.position.y;
        controls.update(0.05);
        assert.ok(camera.position.y < beforeLeft);
    } finally {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});
