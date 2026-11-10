// Builds visible faces using a heightfield fast path or a general voxel scan.
import { BLOCK, CHUNK_SIZE, SEA_LEVEL } from '../game/constants.js';
import { faceOcclusion } from './ambient-occlusion.js';

// The 6 faces of a cube: which way each one faces, and the 4 corners that
// make it up (as offsets from the block's "lower corner"). Corners are
// listed counter-clockwise when viewed from outside the cube, which is what
// gives each face the correct front-facing direction.
const FACES = [
    { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
    { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
    { normal: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
    { normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
    { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

const FACE_UVS = [[0, 0], [0, 1], [1, 1], [1, 0]];

// Coarse spacing requires aligned, uniform interior cells and a detailed outer border.
export const buildChunkBuffers = (world, chunkX, chunkZ, size = CHUNK_SIZE, coarseSpacing = 1) => {
    const buffers = { positions: [], uvs: [], materials: [], occlusion: [], indices: [] };
    const masks = FACES.map(() => new Map());
    const originX = chunkX * size;
    const originZ = chunkZ * size;

    const addFace = (faceIndex, x, y, z, blockType) => {
        if (world.getFaceMaterial) {
            blockType = world.getFaceMaterial(originX + x, y, originZ + z, faceIndex, blockType);
        }
        const plane = faceIndex < 2 ? x : faceIndex < 4 ? y : z;
        const u = faceIndex < 2 ? z : x;
        const v = faceIndex < 2 || faceIndex >= 4 ? y : z;
        const planes = masks[faceIndex];
        if (!planes.has(plane)) planes.set(plane, new Map());
        const aoWorld = world.occlusionWorldAt?.(originX + x, originZ + z) ?? world;
        const ao = faceOcclusion(aoWorld, originX + x, y, originZ + z,
            FACES[faceIndex].normal, FACES[faceIndex].corners);
        const packed = ao[0] | ao[1] << 2 | ao[2] << 4 | ao[3] << 6;
        planes.get(plane).set(v * size + u, blockType * 256 + packed);
    };

    const addUniformHorizontal = (faceIndex, x, y, z, material) => {
        const planes = masks[faceIndex];
        if (!planes.has(y)) planes.set(y, new Map());
        planes.get(y).set(z * size + x, material * 256 + 255);
    };

    const scanColumn = (lx, lz) => {
        const x = originX + lx;
        const z = originZ + lz;
        const top = Math.max(world.getHeight(x, z), SEA_LEVEL);
        const needsVoxelScan = world.hasCarversNear ? world.hasCarvers && world.hasCarversNear(x, z)
            : world.hasCarvers || (world.hasCarversAt && world.hasCarversAt(x, z));
        if (needsVoxelScan) {
            for (let y = 0; y <= top; y++) {
                const block = world.getBlock(x, y, z);
                if (block === BLOCK.AIR) continue;
                for (let faceIndex = 0; faceIndex < FACES.length; faceIndex++) {
                    const [dx, dy, dz] = FACES[faceIndex].normal;
                    if (world.getBlock(x + dx, y + dy, z + dz) === BLOCK.AIR) {
                        addFace(faceIndex, lx, y, lz, block);
                    }
                }
            }
            return;
        }
        const neighborTops = [
            Math.max(world.getHeight(x + 1, z), SEA_LEVEL),
            Math.max(world.getHeight(x - 1, z), SEA_LEVEL),
            0, 0,
            Math.max(world.getHeight(x, z + 1), SEA_LEVEL),
            Math.max(world.getHeight(x, z - 1), SEA_LEVEL),
        ];
        const lowestVisible = Math.min(neighborTops[0], neighborTops[1], neighborTops[4], neighborTops[5]) + 1;

        // The bottom face is visible; between it and the lowest adjacent
        // column no side face can be visible, so skip that buried span.
        for (let y = 0; y <= top; y = y === 0 ? Math.min(lowestVisible, top) : y + 1) {
            const blockType = world.getBlock(x, y, z);
            for (let faceIndex = 0; faceIndex < FACES.length; faceIndex++) {
                if (faceIndex === 2 ? y !== top
                    : faceIndex === 3 ? y !== 0
                    : y <= neighborTops[faceIndex]) continue;
                addFace(faceIndex, lx, y, lz, blockType);
            }
        }
    };

    if (coarseSpacing === 1) {
        for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) scanColumn(x, z);
    } else {
        // The two-column ring may touch full-resolution columns or caves.
        for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) {
            if (x < 2 || z < 2 || x >= size - 2 || z >= size - 2) scanColumn(x, z);
        }
        for (let cx = 0; cx < size; cx += coarseSpacing) for (let cz = 0; cz < size; cz += coarseSpacing) {
            const x0 = Math.max(2, cx), z0 = Math.max(2, cz);
            const x1 = Math.min(size - 2, cx + coarseSpacing), z1 = Math.min(size - 2, cz + coarseSpacing);
            if (x0 >= x1 || z0 >= z1) continue;
            const x = originX + x0, z = originZ + z0;
            const top = Math.max(world.getHeight(x, z), SEA_LEVEL);
            const topBlock = world.getBlock(x, top, z);
            const bottomBlock = world.getBlock(x, 0, z);
            const topMaterial = world.getFaceMaterial ? world.getFaceMaterial(x, top, z, 2, topBlock) : topBlock;
            const bottomMaterial = world.getFaceMaterial ? world.getFaceMaterial(x, 0, z, 3, bottomBlock) : bottomBlock;
            for (let lx = x0; lx < x1; lx++) for (let lz = z0; lz < z1; lz++) {
                // Cell-interior tops and all bottoms have no AO occluders.
                if (lx > cx && lx < cx + coarseSpacing - 1 && lz > cz && lz < cz + coarseSpacing - 1) {
                    addUniformHorizontal(2, lx, top, lz, topMaterial);
                } else {
                    addFace(2, lx, top, lz, topBlock);
                }
                addUniformHorizontal(3, lx, 0, lz, bottomMaterial);
            }
            const edges = [
                { face: 0, fixed: x1 - 1, start: z0, end: z1, nx: x1, nz: z0 },
                { face: 1, fixed: x0, start: z0, end: z1, nx: x0 - 1, nz: z0 },
                { face: 4, fixed: z1 - 1, start: x0, end: x1, nx: x0, nz: z1 },
                { face: 5, fixed: z0, start: x0, end: x1, nx: x0, nz: z0 - 1 },
            ];
            for (const edge of edges) {
                const neighborTop = Math.max(world.getHeight(originX + edge.nx, originZ + edge.nz), SEA_LEVEL);
                for (let y = neighborTop + 1; y <= top; y++) {
                    const block = world.getBlock(x, y, z);
                    for (let along = edge.start; along < edge.end; along++) {
                        const lx = edge.face < 2 ? edge.fixed : along;
                        const lz = edge.face < 2 ? along : edge.fixed;
                        addFace(edge.face, lx, y, lz, block);
                    }
                }
            }
        }
    }

    for (let faceIndex = 0; faceIndex < FACES.length; faceIndex++) {
        const face = FACES[faceIndex];
        for (const [plane, mask] of masks[faceIndex]) {
            const keys = [...mask.keys()].sort((a, b) => a - b);
            for (const key of keys) {
                const value = mask.get(key);
                if (value === undefined) continue;
                const blockType = Math.floor(value / 256);
                const packed = value % 256;
                const ao = [packed & 3, (packed >> 2) & 3, (packed >> 4) & 3, (packed >> 6) & 3];
                const flip = ao[0] + ao[2] > ao[1] + ao[3];
                const diagonal = flip ? ao[1] + ao[3] : ao[0] + ao[2];
                const average = (ao[0] + ao[1] + ao[2] + ao[3] + diagonal) / 18;
                const uniform = ao.every((level) => level === ao[0]);
                const u = key % size;
                const v = Math.floor(key / size);
                let width = 1;
                while (uniform && u + width < size && mask.get(key + width) === value) width++;
                let height = 1;
                while (uniform) {
                    const row = key + height * size;
                    let matching = true;
                    for (let i = 0; i < width; i++) {
                        if (mask.get(row + i) !== value) {
                            matching = false;
                            break;
                        }
                    }
                    if (!matching) break;
                    height++;
                }
                for (let j = 0; j < height; j++) {
                    for (let i = 0; i < width; i++) mask.delete(key + j * size + i);
                }

                const startIndex = buffers.positions.length / 3;
                const origin = faceIndex < 2 ? [plane, v, u]
                    : faceIndex < 4 ? [u, plane, v] : [u, v, plane];
                const scale = faceIndex < 2 ? [1, height, width]
                    : faceIndex < 4 ? [width, 1, height] : [width, height, 1];
                for (let corner = 0; corner < 4; corner++) {
                    const point = face.corners[corner];
                    buffers.positions.push(
                        origin[0] + point[0] * scale[0],
                        origin[1] + point[1] * scale[1],
                        origin[2] + point[2] * scale[2],
                    );
                    buffers.uvs.push(FACE_UVS[corner][0] * width, FACE_UVS[corner][1] * height);
                    buffers.materials.push(blockType - 1);
                    buffers.occlusion.push(ao[corner] / 3, average);
                }
                if (flip) {
                    buffers.indices.push(startIndex, startIndex + 1, startIndex + 3,
                        startIndex + 1, startIndex + 2, startIndex + 3);
                } else {
                    buffers.indices.push(startIndex, startIndex + 1, startIndex + 2,
                        startIndex, startIndex + 2, startIndex + 3);
                }
            }
        }
    }

    return {
        positions: new Float32Array(buffers.positions),
        uvs: new Float32Array(buffers.uvs),
        materials: new Uint32Array(buffers.materials),
        occlusion: new Float32Array(buffers.occlusion),
        indices: buffers.positions.length / 3 > 65535
            ? new Uint32Array(buffers.indices)
            : new Uint16Array(buffers.indices),
    };
};
