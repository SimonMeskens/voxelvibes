import { createCamera } from '../game/camera.js';
import { createControls } from '../game/controls.js';
import { createWorld } from '../game/world.js';
import { createLodWorld } from '../game/lod-world.js';
import { requestTeleportTarget } from '../game/teleport-request.js';
import { createPerformanceMeter } from '../game/performance.js';
import { RENDER_DISTANCE } from '../game/constants.js';
import { createRenderer } from '../renderer/renderer.js';
import { terrainHeightAt } from '../generation/world-gen.js';
import { PLAYER } from '../game/player.js';

const canvas = document.querySelector('#scene');
const showError = (message) => {
    console.error(message);
    const error = document.querySelector('#error');
    error.textContent = message;
    error.hidden = false;
};

const toggle = document.querySelector('#performance-toggle');
const panel = document.querySelector('#performance-details');
toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(expanded));
    panel.inert = !expanded;
    panel.classList.toggle('expanded', expanded);
});
const detailsOpen = () => toggle.getAttribute('aria-expanded') === 'true';

const start = async () => {
    const renderer = await createRenderer(canvas, showError);
    const camera = createCamera(window.innerWidth / window.innerHeight);
    const mapHeight = camera.position.y;
    camera.position = { x: 0.5, y: terrainHeightAt(0, 0) + 1 + PLAYER.eyeHeight, z: 0.5 };
    camera.pitch = 0;
    const lod = true;
    const world = (lod ? createLodWorld : createWorld)(renderer,
        (message) => showError(`Chunk generation failed: ${message}`), { collision: true });
    const teleport = lod ? { request: requestTeleportTarget, setCollision: world.setTeleportCollision,
        onError: (message) => showError(`Teleport failed: ${message}`) } : null;
    const controls = createControls(camera, canvas, world.isSolid, mapHeight, world.isBlock, teleport);
    const details = {
        isOpen: detailsOpen,
        position: document.querySelector('#camera-position'),
        frameTimes: document.querySelector('#frame-times'),
        workerTimes: document.querySelector('#worker-times'),
        queueSize: document.querySelector('#queue-size'),
        loadedChunks: document.querySelector('#loaded-chunks'),
        drawCalls: document.querySelector('#draw-calls'),
        triangles: document.querySelector('#triangles'),
        bufferMemory: document.querySelector('#buffer-memory'),
        gpuTime: document.querySelector('#gpu-time'),
    };
    const meter = createPerformanceMeter(
        document.querySelector('#fps'), document.querySelector('#fps-low'), document.querySelector('#chunk-rate'),
        document.querySelector('#rendered-chunks'), document.querySelector('#render-distance'),
        RENDER_DISTANCE, performance.now(), details,
    );
    let previousTime = performance.now();

    const renderLoop = (time) => {
        try {
            controls.update(Math.min((time - previousTime) / 1000, 0.1));
            previousTime = time;
            const chunksBuilt = world.update(camera.position);
            const renderedChunks = renderer.render(camera, detailsOpen());
            meter.recordFrame(performance.now(), chunksBuilt, renderedChunks,
                () => ({ world: world.stats(), renderer: renderer.stats(), position: camera.position }));
            requestAnimationFrame(renderLoop);
        } catch (error) {
            showError(`Render loop failed: ${error.message}`);
        }
    };
    requestAnimationFrame(renderLoop);
};

start().catch((error) => showError(`Renderer failed to start: ${error.message}`));
