# Style guidelines
- This code is meant to be read and understood by a human. Write it as if you are writing sample code to teach someone.
- Use type="module" for all script tags, and put them in the head.
- Prefer a modern functional style of JS. Prefer arrows over functions where possible. Prefer composition of objects and functions over classes.
- Work event-driven and reactive where needed, but keep it simple, don't start implementing complex event stores.
- Prefer small single-responsibility JS files.

# Project
- Browser voxel terrain viewer using ES modules and raw WebGPU; no build step or external rendering dependencies. WebGPU requires a supported browser/device and secure context; there is no WebGL fallback.
- The world is an infinite deterministic eroded heightfield with bounded 3D cave carvers. Water fills all air up to sea level, including enclosed caves.
- Run `node --test` with Node.js 22+ for the tests. For browser checks, use the existing preview server at `http://127.0.0.1:3000` when available.
- See `README.md` for controls and generation details; `optimization-plan.md` tracks performance work.

# File map
- `index.html`, `style.css`: page, overlay, and styles.
- `assets/`: static 16x16 PNG block textures loaded by the renderer.
- `scripts/main.js`: startup and render loop.
- `scripts/*.sh`: Bash shortcuts for tests, benchmarks, and compatible-history summaries; `.vscode/tasks.json` runs them through MSYS2.
- `game/`: constants, overhead camera, fly controls, chunk streaming, and performance overlay.
- `generation/`: heightfield, bounded global-coordinate cave carvers, noise, erosion, per-worker height cache, chunk queue, worker, and visible-face mesh buffers.
- `graphics/`: reusable WebGPU device/buffer helpers and view/frustum math.
- `renderer/`: voxel WebGPU pipeline, WGSL shaders, block textures, ambient occlusion, atmosphere, FXAA, and GPU resource lifecycle.
- `tests/`: Node tests for terrain, cache, mesh buffers, worker queue, and performance reporting.
- `benchmarks/`: deterministic Node workloads, headless Chrome/WebGPU streaming and rendering workloads, statistics, and append-only JSONL history.

# Generation invariants
- Chunk generation must be independent of load order and agree across borders, including negative coordinates. Each chunk samples a one-block border, with additional deterministic height samples for slope and cave cover checks; caches are worker-local and must not change results.
- Carver anchors and cave side-cover checks use deterministic global-coordinate height samples, so neighboring chunks make identical feature decisions. Preserve rock cover away from cave entrances.
- Discard out-of-range worker results and destroy unloaded GPU buffers. Report worker and WebGPU failures rather than silently stopping generation.
- `terrainAt` returns exterior height and a feedback gradient. The base noise gradient is analytic; the erosion gradient is an artistic approximation.
- A chunk may use the heightfield mesher only if no carver can intersect its one-block border; other chunks use the general voxel mesher. Both use the same material and water rules.
- `TERRAIN_SCALE` stretches the eroded field horizontally and vertically around sea level; transform its feedback gradient by vertical/horizontal scale and record the scale in benchmark configurations.
- Grass and soil use sampled height differences, including the longer-distance slope used to lower the grass line; preserve material agreement across chunk borders.
- The overlay's chunks/s counts accepted chunk results added to the world, including empty chunks, not worker compute speed. Loaded counts also include empty chunks; rendered chunks and draw calls do not.
- Each nonempty visible chunk has one greedy mesh and draw call. Vertex material indices select texture-array layers in block-ID order; keep the worker transfer list and geometry-memory accounting in sync.
- Terrain has no directional lighting; voxel-corner AO is derived from neighboring solid blocks, with water non-occluding. Blend AO toward the face average with distance and record its settings in browser benchmarks. Merge only faces with uniform matching AO and preserve chunk-border agreement.
- Block textures use GPU-generated sRGB mip chains. `BLOCK_TEXTURE_FILTER` selects crisp pixelated or linear anisotropic sampling; record the mode in browser benchmark configurations.
- Grass uses a linear RGB tint on its grayscale texture, selected by its block material layer; keep other materials unchanged and record the tint in browser benchmarks.
- Distance-weighted FXAA is configured in `renderer/fxaa.js`; preserve unfiltered nearby surfaces, and record its settings in browser benchmarks. GPU timing and chunk draw counts exclude the post-process pass.
- Sky and aerial perspective share Rayleigh scattering coefficients and phase; terrain rays integrate exponential height density without a separate render-edge fade. The sun does not directly light terrain. Sky uses a full-screen draw in the terrain pass, timed but not counted as a chunk draw.
- Frustum culling uses conservative mesh bounds; retain chunks that intersect the frustum, including at large or negative coordinates.

# Benchmarks
- Run `node benchmarks/run.mjs node`, `node benchmarks/run.mjs browser`, or `node benchmarks/run.mjs all` with Node.js 22+. Browser benchmarks require Chrome and a working WebGPU adapter; `CHROME_PATH` overrides the executable.
- Use `node benchmarks/run.mjs browser --uncapped` for duration-based, GPU-synchronized throughput; the Chrome flags request but do not guarantee uncapped frames. Never compare its records with the paced mode.
- The browser benchmark uses the existing preview on `http://127.0.0.1:3000` when available, otherwise a temporary local server. `BENCHMARK_URL` overrides the server.
- Successful runs append to ignored `benchmarks/history.jsonl`; `BENCHMARK_LOG` overrides its path. Compare only matching workload settings and environment, and run sequentially when sharing a log. The source hash is informational so code changes can be compared.
- Use `--note "description"` to label benchmark runs; notes are stored in JSONL records and do not affect baseline compatibility.
- Bash shortcuts include `scripts/test.sh`, `scripts/benchmark.sh`, and `scripts/history.sh`; see `README.md` for arguments and VS Code tasks.
- Keep workload settings deterministic, report missing GPU timing and failures explicitly, and increment the workload version when scenarios or measurement semantics change. Never assert universal timing or FPS thresholds in correctness tests.
- See `README.md` for the pinned scenes, statistical definitions, history, and comparison limitations.