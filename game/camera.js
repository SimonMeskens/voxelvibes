import { RENDER_DISTANCE, WORLD_HEIGHT } from './constants.js';

export const createCamera = (aspect) => {
    const fov = 75 * Math.PI / 180;
    const halfHeight = Math.tan(fov / 2);
    return {
        position: { x: 0, y: WORLD_HEIGHT + RENDER_DISTANCE / (halfHeight * Math.min(1, aspect)), z: 0 },
        yaw: 0,
        pitch: -Math.PI / 2,
        fov,
        near: 0.1,
    };
};

export const createMapToggle = (camera, mapHeight) => {
    let saved = null;
    return () => {
        if (saved) {
            Object.assign(camera.position, saved.position);
            camera.yaw = saved.yaw;
            camera.pitch = saved.pitch;
            saved = null;
        } else {
            saved = { position: { ...camera.position }, yaw: camera.yaw, pitch: camera.pitch };
            camera.position.y = Math.max(mapHeight, camera.position.y + 64);
            camera.pitch = -Math.PI / 2;
        }
        return saved !== null;
    };
};
