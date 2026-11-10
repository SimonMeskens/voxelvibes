export const PLAYER = {
    radius: 0.3,
    height: 1.8,
    eyeHeight: 1.62,
    walkSpeed: 6,
    flySpeed: 12,
    jumpSpeed: 8,
    gravity: 24,
};

const EPSILON = 0.00001;
const MAX_STEP = 0.2;

export const createPlayer = (camera, isSolid) => {
    let verticalSpeed = 0;
    let flying = false;

    const probe = (position) => {
        let unknown = false;
        const minX = Math.floor(position.x - PLAYER.radius + EPSILON);
        const maxX = Math.floor(position.x + PLAYER.radius - EPSILON);
        const minY = Math.floor(position.y - PLAYER.eyeHeight + EPSILON);
        const maxY = Math.floor(position.y - PLAYER.eyeHeight + PLAYER.height - EPSILON);
        const minZ = Math.floor(position.z - PLAYER.radius + EPSILON);
        const maxZ = Math.floor(position.z + PLAYER.radius - EPSILON);
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                for (let y = minY; y <= maxY; y++) {
                    const solid = isSolid(x, y, z);
                    if (solid === true) return 'solid';
                    if (solid === null) unknown = true;
                }
            }
        }
        return unknown ? 'unknown' : 'clear';
    };

    const onGround = () => probe({ ...camera.position, y: camera.position.y - 0.002 }) === 'solid';

    const moveAxis = (axis, distance) => {
        const steps = Math.ceil(Math.abs(distance) / MAX_STEP);
        if (!steps) return false;
        const step = distance / steps;
        for (let i = 0; i < steps; i++) {
            const start = camera.position[axis];
            camera.position[axis] = start + step;
            if (probe(camera.position) === 'clear') continue;
            let low = 0;
            let high = 1;
            for (let j = 0; j < 16; j++) {
                const middle = (low + high) / 2;
                camera.position[axis] = start + step * middle;
                if (probe(camera.position) === 'clear') low = middle;
                else high = middle;
            }
            camera.position[axis] = start + step * low;
            return true;
        }
        return false;
    };

    const jump = () => {
        if (!flying && probe(camera.position) === 'clear' && onGround()) verticalSpeed = PLAYER.jumpSpeed;
    };

    const toggleFlight = () => {
        flying = !flying;
        verticalSpeed = 0;
    };

    const teleportOnto = ({ x, y, z }) => {
        const destination = { x: x + 0.5, y: y + 1 + PLAYER.eyeHeight, z: z + 0.5 };
        if (probe(destination) !== 'clear') return false;
        Object.assign(camera.position, destination);
        verticalSpeed = 0;
        flying = false;
        return true;
    };

    const update = (delta, forward, right, up) => {
        if (probe(camera.position) !== 'clear') return;
        const length = Math.hypot(forward, right);
        const horizontalSpeed = flying ? PLAYER.flySpeed : PLAYER.walkSpeed;
        if (length) {
            const distance = horizontalSpeed * delta / length;
            moveAxis('x', (-Math.sin(camera.yaw) * forward + Math.cos(camera.yaw) * right) * distance);
            moveAxis('z', (-Math.cos(camera.yaw) * forward - Math.sin(camera.yaw) * right) * distance);
        }
        if (flying) {
            moveAxis('y', up * PLAYER.flySpeed * delta);
            if (up <= 0 && onGround()) {
                flying = false;
                verticalSpeed = 0;
            }
        } else {
            verticalSpeed -= PLAYER.gravity * delta;
            if (moveAxis('y', verticalSpeed * delta)) verticalSpeed = 0;
        }
    };

    return { update, jump, toggleFlight, teleportOnto, isFlying: () => flying };
};
