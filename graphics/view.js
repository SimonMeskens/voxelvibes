// Camera basis in a right-handed world; the forward axis points into the view.
export const cameraBasis = (yaw, pitch) => {
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    return {
        right: [cy, 0, -sy],
        up: [sy * sp, cp, cy * sp],
        forward: [-sy * cp, sp, -cy * cp],
    };
};

// Conservative sphere test against the perspective frustum.
export const sphereVisible = (camera, basis, center, radius, aspect, far) => {
    const x = center[0] - camera.position.x;
    const y = center[1] - camera.position.y;
    const z = center[2] - camera.position.z;
    const dot = (v) => x * v[0] + y * v[1] + z * v[2];
    const depth = dot(basis.forward);
    if (depth + radius < camera.near || depth - radius > far) return false;
    const halfHeight = Math.tan(camera.fov / 2);
    const halfWidth = halfHeight * aspect;
    return Math.abs(dot(basis.right)) <= depth * halfWidth + radius * Math.hypot(1, halfWidth)
        && Math.abs(dot(basis.up)) <= depth * halfHeight + radius * Math.hypot(1, halfHeight);
};

// Plane normals point into the frustum; distances are relative to the camera.
export const frustumPlanes = (camera, basis, aspect, far) => {
    const halfHeight = Math.tan(camera.fov / 2);
    const halfWidth = halfHeight * aspect;
    const plane = (axis, sign, slope) => [
        basis.forward[0] * slope + axis[0] * sign,
        basis.forward[1] * slope + axis[1] * sign,
        basis.forward[2] * slope + axis[2] * sign,
        0,
    ];
    return [
        [...basis.forward, -camera.near],
        basis.forward.map((value) => -value).concat(far),
        plane(basis.right, 1, halfWidth),
        plane(basis.right, -1, halfWidth),
        plane(basis.up, 1, halfHeight),
        plane(basis.up, -1, halfHeight),
    ].map(([x, y, z, offset]) => [x, y, z, offset, Math.abs(x), Math.abs(y), Math.abs(z)]);
};

// Reject only when the entire box is outside one plane.
export const boxVisible = (planes, position, center, halfSize) => {
    const x = center[0] - position.x;
    const y = center[1] - position.y;
    const z = center[2] - position.z;
    const positionTolerance = 1e-6 * (Math.abs(x) + Math.abs(y) + Math.abs(z) + 1);
    for (const plane of planes) {
        const distance = plane[0] * x + plane[1] * y + plane[2] * z + plane[3];
        const extent = plane[4] * halfSize[0] + plane[5] * halfSize[1] + plane[6] * halfSize[2];
        const tolerance = positionTolerance + 1e-6 * (extent + Math.abs(plane[3]));
        if (distance + extent < -tolerance) return false;
    }
    return true;
};
