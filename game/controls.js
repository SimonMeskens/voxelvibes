import { createMapToggle } from './camera.js';
import { createPlayer } from './player.js';
import { RENDER_DISTANCE } from './constants.js';
import { cameraBasis } from '../graphics/view.js';
import { raycastBlocks } from './raycast.js';

const LOOK_SPEED = 0.0025;
const DOUBLE_JUMP_MS = 300;

export const createControls = (camera, domElement, isSolid, mapHeight, isBlock, teleport = null) => {
    const pressedKeys = new Set();
    const hint = document.querySelector('#hint');
    const crosshair = document.querySelector('#crosshair');
    const defaultHint = hint.textContent;
    const player = createPlayer(camera, isSolid);
    const toggleMap = createMapToggle(camera, mapHeight);
    let mapMode = false;
    let lastJump = -Infinity;
    let pendingTeleport = null;
    const cancelTeleport = () => {
        if (!pendingTeleport) return;
        pendingTeleport.cancel();
        pendingTeleport = null;
        hint.textContent = defaultHint;
    };
    const sameView = (view) => camera.yaw === view.yaw && camera.pitch === view.pitch
        && Math.hypot(camera.position.x - view.position.x, camera.position.y - view.position.y,
            camera.position.z - view.position.z) < 0.1;
    const applyHit = (hit) => {
        if (hit.status === 'miss') {
            hint.textContent = 'Teleport unavailable: no block in view within render distance.';
        } else if (!player.teleportOnto(hit)) {
            hint.textContent = 'Teleport unavailable: not enough loaded space above that block.';
            if (teleport) teleport.setCollision(null);
        } else {
            hint.textContent = defaultHint;
        }
    };

    domElement.addEventListener('click', async (event) => {
        if (event.button !== 0) return;
        try {
            await domElement.requestPointerLock();
        } catch (error) {
            hint.textContent = 'Mouse look unavailable. WASD moves, Space jumps, and M opens the map.';
            console.warn('Could not lock the pointer:', error);
        }
    });

    domElement.addEventListener('contextmenu', (event) => event.preventDefault());
    domElement.addEventListener('mousedown', (event) => {
        if (event.button !== 2) return;
        event.preventDefault();
        if (mapMode) return;
        cancelTeleport();
        const direction = cameraBasis(camera.yaw, camera.pitch).forward;
        const hit = raycastBlocks(camera.position, direction, RENDER_DISTANCE, isBlock);
        if (hit.status === 'unloaded') {
            if (!teleport) {
                hint.textContent = 'Teleport unavailable: terrain along the view is still loading.';
                return;
            }
            const view = { position: { ...camera.position }, yaw: camera.yaw, pitch: camera.pitch };
            const request = { cancel: () => {}, view };
            pendingTeleport = request;
            hint.textContent = 'Loading terrain for teleport...';
            const fail = (error) => {
                if (pendingTeleport !== request) return;
                pendingTeleport = null;
                hint.textContent = 'Teleport failed: could not load terrain.';
                teleport.onError(error);
            };
            try {
                request.cancel = teleport.request(view.position, direction, RENDER_DISTANCE, (result) => {
                    if (pendingTeleport !== request) return;
                    pendingTeleport = null;
                    if (mapMode || !sameView(view)) {
                        hint.textContent = 'Teleport cancelled: view changed.';
                        return;
                    }
                    if (result.status === 'hit') teleport.setCollision(result);
                    applyHit(result);
                }, fail);
            } catch (error) {
                fail(error.message);
            }
        } else {
            applyHit(hit);
        }
    });

    document.addEventListener('mousemove', (event) => {
        if (mapMode || document.pointerLockElement !== domElement) return;
        camera.yaw -= event.movementX * LOOK_SPEED;
        camera.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.pitch - event.movementY * LOOK_SPEED));
        if (pendingTeleport && !sameView(pendingTeleport.view)) cancelTeleport();
    });

    window.addEventListener('keydown', (event) => {
        if (typeof Element !== 'undefined' && event.target instanceof Element && event.target.closest('#performance')) return;
        if (['Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
        if (event.repeat || pressedKeys.has(event.code)) return;
        if (event.code === 'KeyM') {
            cancelTeleport();
            mapMode = toggleMap();
            crosshair.hidden = mapMode;
            pressedKeys.clear();
            lastJump = -Infinity;
        } else if (event.code === 'Space' && !mapMode) {
            const now = performance.now();
            if (now - lastJump <= DOUBLE_JUMP_MS) {
                player.toggleFlight();
                lastJump = -Infinity;
            } else {
                player.jump();
                lastJump = now;
            }
        }
        pressedKeys.add(event.code);
    });
    window.addEventListener('keyup', (event) => pressedKeys.delete(event.code));
    const clearKeys = () => { pressedKeys.clear(); lastJump = -Infinity; };
    window.addEventListener('blur', clearKeys);
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement !== domElement) clearKeys();
        else hint.textContent = defaultHint;
    });

    const update = (deltaSeconds) => {
        if (mapMode) return;
        const forward = Number(pressedKeys.has('KeyW')) - Number(pressedKeys.has('KeyS'));
        const right = Number(pressedKeys.has('KeyD')) - Number(pressedKeys.has('KeyA'));
        const down = pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight');
        const up = Number(pressedKeys.has('Space')) - Number(down);
        player.update(deltaSeconds, forward, right, up);
        if (pendingTeleport && (forward || right || up || !sameView(pendingTeleport.view))) cancelTeleport();
    };

    return { update };
};
