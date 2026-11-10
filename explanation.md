# Voxel terrain

Run a local HTTP server in this folder, for example `python -m http.server`,
then open `http://localhost:8000`. A browser and device with WebGPU support
are required; there is no WebGL fallback or external rendering dependency.
WebGPU also requires a secure context; localhost is suitable for local testing.
Click the view to look around and use WASD to walk. Space jumps; double-tap
Space to toggle flight. In flight, Space ascends and either Shift key descends;
touching solid ground returns to walking. Both modes collide with solid terrain
and cave walls; water is not solid. The player starts on the ground, and
movement waits for collision data when nearby chunks have not loaded.
Press M to open a locked overhead map view. Press M again to restore the exact
previous position and facing; movement and mouse look are disabled and the
crosshair is hidden on the map. Outside map mode, right-click to teleport onto
the first block under the crosshair within the configured render distance.
Teleporting requires the
ray and the space above the target to be loaded and unobstructed. In LOD mode,
if the ray reaches coarse-only terrain, a worker loads full-resolution data
along the ray before teleporting; changing your view, moving, or opening the map
cancels the request. The accurate target can differ from the visible coarse
surface. Water is
targetable but not solid, so you fall through it after teleporting.
Press Escape to release the mouse.

The world is generated deterministically as you travel. The default render
distance is 2048 horizontal blocks, configured in `game/constants.js`. Chunks
intersecting the wanted area are built nearest-first relative to a streaming
anchor. The anchor moves when the camera travels 4
blocks; the wanted area includes an additional 6-block margin so the render
circle remains covered between updates. This retains some chunks outside the
render distance until they leave the wanted area. Terrain starts as an eroded
heightfield, with 3D cave carvers. Water fills every carved or exterior air
block at or below sea level, including enclosed caves; it does not simulate
connected groundwater. A small pool of Web Workers generates terrain and mesh
data off the main thread; completed meshes are uploaded to the GPU on the main
thread. Workers also provide compact solid-block collision data, retained only
while each chunk is loaded; collision treats water as passable. Worker mesh
timings include collision-data construction in the interactive viewer. The
renderer uses WebGPU for drawing, not compute-based terrain
generation.

An experimental CPU-selected LOD viewer is available at `?lod=1`, for example
`http://localhost:8000/?lod=1`. The default viewer remains full resolution.
The prototype uses full-resolution chunks near the player and coarse exterior
tiles at 2- or 4-block horizontal spacing farther away. Coarse tiles have no
caves or collision data; teleport uses a full-resolution terrain query instead.
Existing 64-block regions retain their previous coverage until all replacement
tiles are ready; newly requested regions can still be empty while loading.
Coarse tiles use full-resolution voxel columns along their borders, including
water and cave carving, so adjacent tile faces agree at every LOD. Same-level
coarse neighbors instead share coarse edges, including across regions; edge
corners remain full resolution. Changes affecting displayed regions wait until
the new selection is ready, then switch together to keep borders watertight.
This can delay visible LOD updates while moving. Interior
terrain remains coarse and is traversed by coarse cell, although face masks
and edge AO still use individual blocks to preserve the detailed mesh. This
uses full-resolution neighbors for AO on detailed rim faces so coarse interiors
do not artificially darken tile borders. It adds generation work and geometry, and the abrupt
change in detail near tile edges and LOD switches may be visible; visual and
movement review remains important.
In this mode, the overlay counts LOD tiles as chunks; coarse worker time is
reported as terrain time because coarse generation and meshing are combined.
Run
`node benchmarks/coarse-tiles.mjs` for a small, single-run comparison of tile
generation, geometry and point-sampled height error against the corresponding
full-resolution area. This is not a visual or frame-rate benchmark.
Chunk meshing uses column heights for chunks outside carver bounds and a
general voxel scan for chunks that may contain carved spaces. Both paths
greedily merge adjacent coplanar faces of the same material where their
ambient occlusion is uniform. Varying corner AO stays on individual faces
so shading is not stretched across a merged quad. Cave interiors,
overhang undersides and steep exposed faces reveal stone; textures repeat once
per block across merged quads. Chunks sample a one-block border, with extra
height samples where needed for border-column slopes, so chunk boundaries do
not depend on loading order.
Chunk visibility uses conservative mesh bounding boxes against the camera
frustum; this avoids submitting some chunks that only intersect the frustum
with their larger bounding spheres. It is not terrain occlusion culling.
The four opaque 16x16 block textures are PNG files in `assets/`; the renderer
loads them into a texture array at startup. Each layer has a full mip chain,
generated on the GPU in linear color space. By default, nearest-neighbor
sampling preserves nearby pixel art while blending mip levels reduces distant
texture shimmer. Each nonempty visible chunk uses one mesh and draw call,
with a material layer per vertex.
The grayscale grass texture is tinted green in linear color space; adjust
`GRASS_TINT` in `renderer/shader.js` to change the color without modifying
the texture.

Terrain textures are unlit apart from subtle voxel-corner ambient occlusion:
neighboring solid blocks darken creases and overhangs. Water does not occlude.
AO uses centroid interpolation for partially covered MSAA pixels and is clamped
so it cannot brighten the texture.
Adjust `AO_STRENGTH` in `renderer/shader.js` from 0 to 1 (zero disables the darkening).
Within 64 blocks, AO varies across each face; by 160 blocks it smoothly
transitions to the area-weighted average of the two rendered triangles,
reducing tiny high-contrast gradients while retaining the face's overall
interpolated darkening.
Adjust `AO_FADE` independently of FXAA in the same file; distances are
measured from the camera.
AO is local and does not model skylight or darken entire caves.
The sky and aerial perspective use a stylized single-scattering Rayleigh
approximation: blue wavelengths scatter more strongly, and an exponential
height-dependent density produces colored transmission and in-scattering
along the camera-to-surface ray. The sky uses an approximate horizon air mass
and the same scattering coefficients and phase function. There is no separate
distance fog or fade at the render boundary, so distant chunk cutoffs may be
visible. Tune `RAYLEIGH_SETTINGS` in `renderer/atmosphere.js`: scattering is RGB per
block at sea level, heightFalloff is per block, skyHorizonCurve and
skyHorizonBias control the horizon approximation. This omits multiple scattering,
sunlight attenuation along its path, and aerosol haze; it is not a full
atmosphere simulation or day/night cycle.

To try smoother ground textures at shallow viewing angles, change
`BLOCK_TEXTURE_FILTER` in `renderer/textures.js` from `'pixelated'` to
`'anisotropic'` and reload. Anisotropic filtering uses 8x anisotropy and linear
filtering, which also softens nearby pixels; WebGPU requires linear filtering
when anisotropy is enabled.

The renderer also applies a distance-weighted FXAA pass: it leaves surfaces
within 64 blocks unfiltered, fading in up to full strength at 160 blocks.
This smooths some distant edges without changing meshes, but cannot eliminate
temporal shimmer. Adjust or disable `FXAA_SETTINGS` in `renderer/fxaa.js`.
The sky adds a full-screen draw in the terrain pass, and the post-process adds
a separate full-screen pass. Displayed chunk draw calls exclude both; GPU
render-pass timing includes the sky and terrain but excludes post-processing.
Each worker caches up to 64 height grids and reuses their overlapping borders.
Entries are evicted in insertion order, not least-recently-used order.
The cache is local to each worker and does not affect the deterministic terrain.

The top-left overlay shows frames per second, the 1% low frame rate, and
accepted chunks added to the world per second over the latest measurement
interval. This includes empty chunks, which have no mesh. The 1% low
is 1000 divided by the average duration of the slowest 1% of frames (rounded
up to at least one frame). It also shows the number of chunks submitted
for rendering in the most recent sampled frame, and the configured render
distance in blocks. Rendered chunks exclude frustum-culled and empty chunks;
they correspond to one draw call each. Results for chunks no longer in
the wanted area are discarded and not counted. Chunk throughput falls to zero
when no chunks are being generated. Use the chevron to expand the overlay for
average and 95th-percentile frame intervals, average worker terrain and mesh
times for chunks added during the last interval, pending and in-flight jobs,
loaded chunks (including empty chunks), draw calls, submitted triangles, and
allocated chunk-buffer memory. GPU render-pass time is sampled only while
expanded and requires the optional WebGPU `timestamp-query` feature; it is
reported as unavailable on unsupported devices. GPU memory excludes textures
and other non-chunk buffers.

Adjust `EROSION_SETTINGS` in `generation/erosion.js` for the lowland erosion
and `MOUNTAIN_EROSION_SETTINGS` for the mountain field. Mountain gullies use
the preceding octaves' separate flow slope for their direction and carry the faded
peak/valley target and mask forward, protecting larger ridges as smaller
gullies branch away. Jittered cells blend overlapping slope-aligned stripes;
the sine/cosine pair is partially normalized to avoid amplifying cancellation.
Height uses smooth waves while the flow slope uses straight-sided gullies.
The output slope is an artistic approximation, not the exact derivative of
the resulting heightfield. `ridgeRounding`, `creaseRounding`, `octaveOnset`,
and `detail` control how later gullies fade near ridges and valleys.
This is an artistic approximation inspired by Rune Skovbo Johansen's
[erosion filter](https://blog.runevision.com/2026/03/fast-and-gorgeous-erosion-filter.html),
not a water or sediment simulation.

`TERRAIN_SETTINGS` in `generation/world-gen.js` controls the scale and
rarity of mountain regions. Broad, gently rolling lowlands leave room for
meadows and water; more frequent medium mountains surround and alternate with
rarer, taller mountain regions. The two region masks scale the same fractal
mountain erosion field by different amplitudes; the medium contribution fades
out in the cores of the tallest mountains. The masks control where and how
much terrain is raised, not a summit height cap. The gently rolling lowland
base remains underneath, and a separate, low-amplitude smooth noise layer
evokes sediment; it does not simulate deposition. Tune it with
`sedimentFrequency` and `sedimentAmplitude`. Low basins can still fall below
sea level and fill with water.
Above `alpineDetailStart`, small slope-aligned gullies and two folded-noise
ridge layers fade in, reaching full strength at `alpineDetailFull`, around
the grass line (both heights are in world blocks). Their strength also follows
the mountain masks. A separate broad, slope-aligned gully layer shapes mountain
chains; tune it with `CHAIN_EROSION_SETTINGS` and `chainBaseFrequency`.
Sparse pockets of finer noise add texture to lowlands, fading out at water
level; the `pocket` settings control their size, rarity, and amplitude.
Tune the ridge frequencies and amplitudes in `TERRAIN_SETTINGS` and the
extra gully octaves in `FINE_EROSION_SETTINGS` in `generation/erosion.js`.
The input noise and mask derivatives are analytic; erosion feedback gradients
are approximations. `TERRAIN_SCALE` stretches the eroded heightfield
horizontally by 1.5 and vertically by 1.8 around sea level. Erosion settings
operate in the unscaled terrain space. `terrainAt` returns an unclamped
floating-point height and feedback gradient; block columns use the floored
height clamped to 0 through `WORLD_HEIGHT - 2` (398 by default).

Grass and dirt depth depend on the greatest height difference to an adjacent
column: flat ground has deeper soil, gentle slopes have thinner soil, and
steep slopes expose stone. The grass line is highest on flat ground
(`stoneHeight`) and falls with slope, by up to `grassLineSlopeDrop` blocks.
Slope for this transition is measured over `grassLineSlopeDistance` blocks,
while `stoneSlope` still exposes rock on very steep adjacent columns at any
height. Adjust these values in `TERRAIN_SETTINGS`. Material choices use the
actual sampled heightfield, not the erosion feedback gradient, and agree at
chunk borders.

`FEATURE_SETTINGS` in `generation/features.js` controls the spacing and size
of the deterministic tunnels, chambers, and rock cover in world blocks.
Cave features choose among three deterministic directions,
favoring higher terrain; a sloping entrance leads to a tunnel, a side branch,
and a larger chamber. Away from the entrance, carving leaves the configured
vertical rock cover and checks nearby columns for side cover, reducing thin
walls where a passage approaches an exposed slope. The terrain can still intersect or flood a passage:
not every generated cave is guaranteed to have a dry, accessible entrance.
This is artistic terrain, not a geological simulation. Feature anchors use
fixed global-coordinate height samples, so workers and chunk load order agree.
The height toggle uses the original exterior heightfield, not cave floors.

For example, a dry cave entrance is near `(x, y, z) = (-876, 59, 691)`,
with its chamber center near `(-804, 45, 726)`. These locations use the default
generation settings and may change if terrain settings are adjusted. Expand
the performance panel to see your current x/y/z position. Cave interiors use
the same local AO as other terrain.

Run the checks with Node.js 22 or newer: `node --test`.

### Bash shortcuts and VS Code tasks

Run these from Bash, including an MSYS2 Bash terminal on Windows:

```bash
bash scripts/test.sh
bash scripts/test.sh tests/view.test.mjs tests/renderer.test.mjs
bash scripts/benchmark.sh node --note "generation baseline"
bash scripts/benchmark.sh browser --uncapped --note "testing culling"
bash scripts/benchmark.sh lod --distance 512 --uncapped
bash scripts/benchmark.sh rapid --distance 512 --note "iteration"
bash scripts/benchmark.sh all
bash scripts/history.sh browser 5
```

The test script runs the full Node test suite unless individual test files
relative to the project root are supplied. The benchmark script defaults to
`all`; it also accepts `node`, `browser`, `lod` or `rapid`. `--uncapped` applies to the browser
and LOD suites (or the browser part of `all`); `rapid` is always uncapped.
`--note` labels each run. Benchmark
output and errors are passed through, including the native exit status. The
history script defaults to the last 10 runs across all suites; it shows each
run's note, key metrics and changes from its most recent compatible earlier
run, even if that baseline is outside the displayed range.

The scripts run from the project root without changing the caller's location
and forward arguments to Node. Node.js 22+ must be on the Bash `PATH`.
`BENCHMARK_LOG`, `BENCHMARK_URL`, `BENCHMARK_LOD_CAPTURES` and `CHROME_PATH` work as described below; a
relative `BENCHMARK_LOG` path is relative to the project root.

The VS Code **Tasks: Run Task** menu offers test, benchmark and history tasks
defined in `.vscode/tasks.json`. Benchmark tasks prompt for a note; the history
task prompts for the suite and count. **Tasks: Run Test Task** runs all tests.
The tasks invoke `C:\msys64\usr\bin\bash.exe` directly and inherit VS Code's
environment, including `PATH` and the benchmark variables above. If MSYS2 is
installed elsewhere, update the Bash path in the task file. The underlying Node
commands below are also available without Bash.

## Performance benchmarks

With Node.js 22 or newer, run:

```text
node benchmarks/run.mjs node
node benchmarks/run.mjs browser
node benchmarks/run.mjs browser --uncapped --note "uncapped baseline"
node benchmarks/run.mjs lod --distance 512 --uncapped --note "LOD baseline"
node benchmarks/run.mjs lod --distance 1024 --uncapped --note "long-distance baseline"
node benchmarks/run.mjs rapid --distance 512 --note "iteration"
node benchmarks/run.mjs rapid --distance 512 --lod --note "LOD iteration"
node benchmarks/run.mjs all
node benchmarks/run.mjs browser --note "texture array after change"
node benchmarks/history-report.mjs browser 5
node benchmarks/history-report.mjs lod 5
node benchmarks/history-report.mjs rapid 5
```

The Node suite measures a fixed terrain grid and repeated flat, sloped,
underwater and negative-coordinate landmarks (scaled with the terrain), uncached generation, adjacent
chunk cache reuse, a fully warm cache, greedy meshing of pre-generated flat,
water, cliff, typical, cave and flooded-cave chunks, and generation plus meshing. Each batch has two
warmups and seven measurements. The output includes batch mean, median, p95
and maximum milliseconds, throughput, height-sampling calls, a terrain checksum,
and geometry counts and bytes. Per-sample and per-chunk timings are batch
medians divided by the batch size, not individual latency percentiles.

The browser suite launches Chrome headlessly using the Chrome DevTools Protocol
and needs a Chrome installation with working WebGPU. On Windows and macOS it
looks in the usual Chrome location; on Linux it invokes `google-chrome` on PATH.
Set `CHROME_PATH` to an executable to override this. No browser automation
package or rendering dependency is needed. The runner uses the existing
`http://127.0.0.1:3000` preview when available, otherwise starts a temporary
loopback server. Set `BENCHMARK_URL` to use a different project server. It
reports browser startup, worker, WebGPU and timeout failures rather than writing
successful-looking results.

The browser workload pins an 800x600 viewport, pixel ratio 1, 512-block render
distance, four workers and the static PNG textures. The texture content hash,
filtering mode, grass tint, mipmapping, FXAA and atmosphere settings are recorded in the benchmark
configuration, so different filtering modes are not compared automatically.
It fully loads the initial scene
before measuring fixed overhead and near-surface views, each with 60 warmup and
180 measured animation frames in the default paced mode. It then moves the camera along a fixed 240-frame
path, measuring frame intervals, render submission CPU time, queue depth,
chunks added and removed, and final loaded/pending/in-flight counts. Stationary
results also include rendered chunks, draw calls, submitted triangles, and
allocated chunk-buffer bytes. Initial load time is reported separately.
Streaming additionally reports CPU time per update spent selecting and unloading
chunks, maintaining the worker queue, and uploading completed chunks, plus the
number of selection rebuilds. The first
measurement includes unloading; the third includes integration bookkeeping.
Frame statistics include median, p95, maximum and 1% low FPS. GPU render-pass
timings are sampled asynchronously at most once per second when timestamp
queries are supported; `null` means no sample was available. Render CPU time
does not wait for GPU completion. Animation frames may be refresh-rate limited;
streaming speed depends on both frame pacing and asynchronous workers.

The optional `--uncapped` mode launches Chrome with
`--disable-frame-rate-limit` and `--disable-gpu-vsync`. Flags request unpaced
animation frames but do not guarantee that the browser, compositor or device
actually removes the cap. Check the measured frame intervals and throughput.
This mode uses 1 second of warmup and 3 seconds of measurement for each
stationary view, then traverses the same streaming path over 4 seconds of
elapsed time. It records frame count, actual elapsed time and completed frames
per second. The last streaming frame reaches the endpoint; slow frames can make
the measured duration slightly longer.

Uncapped mode waits for submitted GPU work to finish after each frame, limiting
the queue to one benchmark frame. Its frame intervals include scheduling, world
updates, submission and that wait; render CPU time excludes the wait, while
optional GPU timestamps cover the render pass only. This synchronized
throughput is not displayed FPS or the normal viewer's asynchronous frame
pacing. The fixed path and speed are reproducible, but worker completion order,
loaded chunks and actual geometry can vary. The mode, flags, durations and GPU
backpressure are recorded in the run configuration, so paced and uncapped
results are never treated as compatible baselines.

For fast LOD iteration, `rapid` runs only the starting location's overhead map
view, with no screenshots, movement tests or other scenes. It uses the actual
map camera toggle and the viewer's collision-enabled worker jobs, at 800x600
with four workers. It waits up to 120 seconds for the entire wanted area to
load, then measures for three seconds after a one-second warmup. It also
reports scene additions per second during loading, including the average and
peak one-second interval; like the overlay, this counts displayed tiles, not
worker jobs or equal-size terrain areas. If loading
times out it reports a partial run without FPS and excludes it from comparisons.
The benchmark uses uncapped Chrome flags and waits for the GPU after each frame:
its FPS is completed throughput, not displayed frame rate. Start at 512 blocks;
only try a larger distance after the settled measurement exceeds 60 FPS. For
example, use `--distance 1024` for the next trial. Distances from 512 to 4096
in multiples of 16 are accepted. The map camera height uses the viewer's current
default map height, held fixed across these benchmark distances.
Use `--lod` to measure the experimental quadtree instead of full-resolution
streaming. History keeps the configurations separate; compare them manually at
the same distance and camera when evaluating the quality/performance tradeoff.

Runs append to the existing history and compare only matching configuration and
environment. Compare runs at the same distance and review draw counts and
geometry as well as FPS. This is a quick performance signal, not a replacement
for visual, streaming, correctness and full LOD checks before shipping.

The separate `lod` suite provides full-resolution reference workloads; it does
not enable LOD or change the existing browser control. It runs fixed lake,
medium mountain, tall mountain and dry cave entrance viewpoints at 512 blocks
by default or 1024 with `--distance 1024`. Each uses an overhead and low-angle
view, a 256-by-64-block movement path, and a 1024-by-minus-1024-block jump.
Initial load and both subsequent settling phases are timed separately. Load
waits are limited to 120 seconds at 512 and 15 seconds at 1024; a timed-out
phase is explicitly marked `settled: false`, and the entire run is excluded
from automatic comparisons. A partial scene's FPS and images describe only the
geometry loaded at that point, not a fully loaded long-distance baseline.
Changing distance, scene definitions, pacing or recorded settings prevents
automatic comparisons; compare completed runs at matching quality and distance.

Each scene records level 0 loaded and visible chunks (loaded includes empty
chunks), draw calls, triangles, geometry bytes, CPU selection/queue/upload and
render submission, worker generation/meshing averages and queue depth, plus
GPU timing where supported. This reference suite uses only level 0. The initial and
settling phases record worker and queue statistics as well. Screenshots are
written as `overhead.png` and `near.png` under a unique run directory in
`benchmarks/lod-captures/` (ignored by Git). Set `BENCHMARK_LOD_CAPTURES` to
choose another output directory. To prevent screenshot writes triggering live
reloads, this suite starts its own temporary server by default rather than
using the preview server; if `BENCHMARK_URL` is set, use a server without
live reload. The JSON history records the run directory.
Inspect the images and movement yourself for ridge loss, cracks, water seams
and popping; screenshots alone cannot detect temporal artifacts.

Every successful suite appends one JSON object to `benchmarks/history.jsonl`
and prints a comparison with the most recent compatible record in that file.
Use the optional `--note` argument to describe what the run tests. It is stored
as a `note` field on each run, preserving valid JSON Lines; with `all`, both
suites get the same note. Notes do not affect compatibility, and a matching
baseline's note is shown in comparison output. Older and unlabelled runs have
no note.
Set `BENCHMARK_LOG` to change the path; its parent directory must exist. The
default history is ignored by Git and includes hardware and software metadata;
review it before sharing. Do not run multiple benchmark processes against the
same history concurrently. Failed suites are not logged. The comparison shows
percentage changes, not a pass/fail verdict: lower times are better, while
higher throughput and FPS are better. Draw and geometry counts describe the
work performed and should be checked when interpreting timing changes.

Compatibility requires matching suite, workload version, pinned settings,
operating system, CPU, memory, Node version and, for browser runs, browser,
GPU/driver, adapter information and timestamp-query support. Browsers may
redact adapter fields, so check the reported hardware and actual device
selection before comparing. The source hash is recorded for traceability but
does not block comparison: comparing code changes is the point. Bump the
workload version when changing benchmark scenarios or measurement semantics.
Run on the same machine under similar load and power conditions, repeat runs,
and inspect variance. These are measurements, not universal FPS thresholds.
