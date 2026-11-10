# Optimization plan

The current renderer uses full-resolution 16-by-16 chunks at a default
2048-block render distance. Workers generate terrain and greedy meshes; the
CPU selects wanted chunks and frustum-culls each mesh before issuing one draw
per nonempty visible chunk. An opt-in CPU quadtree prototype adds coarse
geometry LOD; there is no terrain occlusion culling. See the status of each
item below before treating it as complete.

## Generation and meshing

Use the Node and browser benchmarks described in `README.md` to establish a
compatible baseline before and after each optimization. Compare geometry and
queue counts as well as timings; repeat measurements under similar conditions.
Use the optional uncapped browser benchmark to measure synchronized throughput
without relying on refresh-paced frame intervals; compare it only with matching
uncapped runs and retain paced runs for normal frame-pacing behavior.
## Rendering and scheduling

Draw-call options, roughly ranked by expected benefit relative to implementation
cost for the current renderer:

1. **Batch neighboring chunks into region meshes.** A draw per region could
   reduce calls below one per chunk. Larger culling units can draw more
   off-screen geometry, and streaming, updates, and resource lifetimes become
   more complicated.
2. **Instance greedy quads.** Draw a shared unit quad with per-instance
   position, size, normal, and material. This could batch across chunks, but
   requires a different mesh representation, shader, visibility strategy, and
   buffer management. Instancing individual cubes instead would generally
   submit far more geometry than the existing hidden-face removal and greedy
   meshing.
3. **GPU-driven indirect rendering.** Move visibility decisions and draw
   parameters toward the GPU. This has substantial complexity, and indirect
   draws alone do not automatically combine many independent draws into one.
   Check browser and device capabilities and benchmark on target hardware.

An **atlas with one mesh per chunk** is an alternative to texture arrays,
not an additional optimization. Repeating greedy-quad textures within atlas
tiles requires extra UV handling to avoid bleeding; texture arrays are simpler
for the current same-size PNGs.

## Level of Detail

Goal: extend the visible distance without generating and drawing every distant
block at full resolution. Voxy is a useful architectural reference for
hierarchical visibility and LOD meshes, not a requirement to copy its code or
OpenGL renderer. In this world, the exterior is a heightfield with bounded 3D
cave carvers; start with a horizontal quadtree and retain full-resolution
caves nearby. Consider an octree only if distant 3D geometry is worth its cost.

The stages below are ordered by expected benefit relative to effort, not by
implementation dependency alone. Each stage should be independently usable,
measured, and easy to disable or roll back. Later stages depend on the earlier
data and streaming work unless stated otherwise. Do not promise speedups:
measure quality, generation, streaming, CPU submission, GPU time and memory.

### Rapid iteration

For the next few LOD steps, prefer short edit/measure cycles over running the
entire benchmark and screenshot suite on every change. Run
`node benchmarks/run.mjs rapid --distance 512 --note "description"` before and
after a change. It measures the fixed starting map view, without screenshots,
after loading settles. Use the same distance, environment and workload for
comparisons, and inspect geometry and draw counts alongside synchronized FPS.
Only move up to a higher distance (try 1024 next) after the settled result
**exceeds 60 FPS**; never treat an incomplete load as a passing result. This
gate is a local iteration target, not a universal performance guarantee.
Keep correctness tests targeted during iteration, then return to the detailed
LOD workloads, visual/transition review, broader tests and other edge cases
before enabling or declaring the feature complete. See `README.md` for limits,
commands and FPS interpretation.

Initial rapid baseline on the recorded AMD Radeon 780M: 25.6-32.5 completed
FPS over five settled 512-block runs, with 3,432 draws and 2,403,636 triangles.
The final two runs also pin the map camera in the comparison configuration.
This is below the gate, so keep iterating at 512 until it is exceeded; do not
treat these short, synchronized measurements as displayed FPS.

1. **Establish LOD workloads and a visual baseline.** Implemented as the
   separate `lod` benchmark; see `README.md` for commands, captures and
   interpretation. It provides deterministic benchmark views of a lake and
   meadow, medium mountains, a tall jagged
   mountain, and a cave entrance, including negative coordinates. Measure
   stationary overhead and low-angle views, a fixed movement path, a fast
   jump, initial load and settling. It includes both today's 512-block distance and
   a longer distance (start with 1024 blocks); compare at the same camera,
   distance, viewport and quality, not a 512-block baseline against a longer
   view. Inspect repeatable screenshots and note visible ridge loss, cracks,
   water discontinuities and popping. Extend the existing benchmark runner
   rather than treating refresh-limited FPS as GPU throughput. Record LOD
   configuration, per-level loaded/visible tiles, triangles, draw calls, CPU
   selection/upload/submission, worker time and queue depth, geometry bytes,
   and optional GPU timings. Version changed workloads; paced and uncapped
   results remain separate. Keep existing no-LOD benchmarks as a control.
   The existing browser benchmark fixes its distance at 512, so a 1024-block
   control requires a new workload and may need a larger timeout or bounded
   measurement when full-resolution generation cannot settle in time. Record
   such a limit explicitly rather than comparing incomplete runs as settled.

   Baseline on the recorded AMD RDNA 3 adapter, 800x600, uncapped with
   per-frame GPU synchronization (FPS is completed throughput, not display
   FPS). All four 512-block scenes settled after initial load, movement and
   jump:

   | Scene | Overhead FPS | Low-angle FPS | Movement FPS |
   | --- | ---: | ---: | ---: |
   | Lake/meadow | 41.8 | 56.5 | 60.9 |
   | Medium mountain | 29.5 | 57.9 | 54.8 |
   | Tall mountain | 23.4 | 57.6 | 53.2 |
   | Cave entrance | 43.4 | 80.8 | 77.7 |

   The 1024-block no-LOD run timed out at every 15-second settling limit;
   initial loads had 1,658-2,920 chunks loaded and 10,353-11,618 queued or
   in flight. Its screenshots and FPS are explicitly partial, not a
   settled 1024-block comparison. Obtain a settled no-LOD run at the same
   distance before claiming an end-to-end LOD speedup; increasing the timeout
   should be an explicit, versioned workload change.

   The baseline images show recognizable lake shores, medium terrain, tall
   erosion ridges and the cave entrance; no obvious water seam or crack was
   seen in the inspected stills. This is not an exhaustive visual audit:
   popping requires a temporal review during movement and remains unverified.
   Retain these images and check ridge loss, cracks, water seams and movement
   transitions again when implementing LOD. Level 0 is the only existing
   level; loaded counts include empty chunks. Automatic history comparisons
   require matching configuration and only fully settled runs. Comparisons
   between intentionally different LOD settings must be made explicitly at
   the same scene, quality and distance rather than bypassing those checks.

2. **Generate coarse exterior tiles on workers.** Prototype implemented as an
   opt-in worker job, now also used by the experimental streamer. Add an opt-in tile job and
   a simple standalone coarse heightfield mesher alongside the existing chunk
   path. Begin with 16-by-16 columns per tile at 2- and 4-block horizontal
   spacing, covering 32 and 64 world blocks respectively; keep voxel-like
   steps, material/grass/stone rules, opaque water at sea level, textures and
   distance AO behavior. Define vertical quantization and material selection
   explicitly, and compare sampling or inexpensive filtering strategies
   against full-resolution references on peaks, ridges, lakes and cliffs.
   Sampling a coarse tile must cost proportional to its coarse samples, not
   require generating every full-resolution child. Preserve deterministic
   global coordinates and border samples at negative positions, and do not
   change the existing near mesh or cave generation. Test fixed fixtures,
   geometry bounds, material/water choices, negative coordinates, border
   agreement and worker transfer/error handling. Benchmark coarse generation,
   geometry size and visual error before choosing default resolutions.

   The job is `{ type: 'coarse', tileX, tileZ, spacing }`, with spacing 2 or 4;
   each tile covers `16 * spacing` blocks per side. It samples the height at
   the global lower-coordinate corner of each coarse cell, without filtering,
   retaining integer block height (no additional vertical quantization).
   Soil depth is evaluated using the existing full-resolution slope rule at
   that sample, water fills to the existing sea level, and the heightfield
   mesher generates repeated world-scale UVs and coarse-grid AO. Caves are
   intentionally omitted, so this is not appropriate for nearby collision or
   cave viewing. Same-level neighbors sample a one-cell border consistently;
   mixed-level edge transitions remain future work.

   `node benchmarks/coarse-tiles.mjs` compares six lake, medium-mountain and
   tall-mountain tiles with all full-resolution chunks covering each area.
   One indicative local run measured 15-32 ms per coarse tile versus 55-382 ms
   for full generation and meshing of the corresponding area (the latter
   includes caves); geometry was 23-38% of full size at spacing 2 and
   14-23% at spacing 4. Mean sampled exterior-height error was 0.04-0.75
   blocks at spacing 2 and 0.18-2.69 at spacing 4; maximum errors were 6 and
   17 blocks respectively. These are single-run CPU figures and height errors,
   not visual quality measurements or a choice of default spacing. Check
   ridges, lakes, cliffs and temporal artifacts visually once the tile path is
   integrated; compare sampling/filtering alternatives then.

   The 512-block rapid map control measured 29.2 FPS before and 31.2 / 26.9
   FPS in two subsequent runs on the same recorded environment, with unchanged
   3,432 draws and 2,403,636 triangles. Because the new job is not used by
   the viewer at the time, these fluctuations are not an LOD speedup. Continue at 512
   until the 60 FPS gate is exceeded by an integrated implementation.

3. **Stream a CPU-selected quadtree and switch LOD safely.** Experimental
   implementation available via `?lod=1`; the default remains unchanged.
   The globally aligned 64-block roots select 16-block full chunks within
   128 blocks, 32-block coarse tiles within 256 blocks and 64-block tiles
   beyond, with a 4-block anchor margin and 16-block split hysteresis.
   All distances are horizontal distances to conservative tile bounds.
   Workers use level/coordinate keys and nearest-first priority. When a
   previously visible root changes, its old leaves remain visible until all
   newly selected leaves are ready; the root switches in one update and
   destroys obsolete GPU buffers. New roots have no fallback before their
   initial selected leaves are ready, and fast jumps can expose unloaded
   areas. Collision and cave data normally exist only for displayed
   full-resolution chunks. Distant teleport uses a separate worker to raycast
   full-resolution terrain and temporarily retains collision for the landing
   chunk until normal streaming takes over.

   Coverage, split/merge transitions, negative coordinates, stale jobs,
   collision and worker failure have focused tests. Still required before
   enabling by default: visually inspect movement and cave transitions,
   bound CPU memory during refinement, assess startup and parent fallback
   for new regions, and run detailed movement and longer-distance comparisons.
   The border treatment described in step 4 is integrated but still needs
   movement and visual review.

   The prototype preserves coverage within an already resident root, not
   during first load or after jumping to an entirely new area. It is not yet a
   complete implementation of the original no-hole streaming goal.

   Rapid map measurements on the same recorded AMD Radeon 780M, 800x600,
   four workers, uncapped with per-frame GPU synchronization (not displayed
   FPS): the 512-block full-resolution control settled in 25.8 seconds and
   measured 27.6 FPS, 3,432 draws and 2,403,636 triangles. The opt-in LOD
   settled in 7.7 seconds and measured 101.3 FPS, 668 draws and 925,556
   triangles. One earlier LOD trial measured 111.8 FPS with the same geometry;
   these short runs fluctuate and intentionally render different detail.
   At 1024 blocks LOD settled in 15.8 seconds and measured 61.6 FPS; at 1536
   blocks it settled in 21.7 seconds and measured 63.0 FPS; at 2048 it
   settled in 30.6 seconds and measured 62.4 FPS. At 3072 it settled in
   70.0 seconds and measured 59.6 FPS, below the gate. The fixed-height map
   camera culls different amounts of the farther terrain: 1536, 2048 and 3072
   submitted the same geometry even though resident geometry grew from 229 MB
   to 400 MB and 859 MB respectively.
   These numbers do not establish longer-distance visual performance. There is
   no settled same-distance no-LOD control for these longer distances.

4. **Make mixed-resolution boundaries watertight and stable.** Integrated in
   the opt-in viewer using full-resolution voxel columns around the perimeter
   of every coarse tile. Both sides therefore independently sample the same
   one-block border, including water and caves. The regular voxel mesher owns
   a face on the occupied side only, so no separate overlapping skirts or
   transition meshes are needed; levels can differ by two. Border geometry is
   built with the tile and follows existing atomic root replacement and GPU
   cleanup. Unloaded regions remain a separate streaming limitation.

   Tests rasterize faces at shared interfaces in all orientations, including
   negative coordinates, partial edges, 1:4 transitions, water, corners and a
   real carved cave. They check exact occupancy and no duplicate faces.
   Movement, popping and appearance of high-detail borders still need visual
   review before enabling LOD by default. Perimeter sampling and meshing are
   expensive; optimize their cost in subsequent iterations without changing
   the shared-border invariant.

   **Border shading:** Full-resolution rim faces now calculate AO using the
   full-resolution neighborhood, rather than an adjacent coarse interior
   that can create artificial dark trenches. This changes shading, not the
   full-resolution rim occupancy or the independent root replacement
   protocol. A controlled overhead browser view of same-level mountain tiles
   still shows straight dark lines: correcting rim AO alone does not remove
   the geometric trench. This visual issue remains open; inspect any further
   fix in motion and at mixed-resolution transitions. A regression test
   reproduces a real dark rim and checks the emitted AO against full terrain.
   The LOD configuration version is 5 to separate benchmark histories.

   **Same-level coarse edges:** Before dispatch, the selected LOD map marks
   matching coarse edges, including between roots. Edge settings form part of
   the mesh key, so obsolete worker results are discarded. Mixed-LOD edges and
   corners retain the detailed rim. If an already displayed root changes,
   the new selection is published together once all its meshes are ready;
   initial loading remains incremental. This conservative coordination may
   delay visible updates while moving or cause large upload bursts. Tests
   cover both orientations, 2x and 4x, negative coordinates and transitions.
   Movement, popping and the remaining detailed corners still need visual
   review. A 512-block rapid trial settled in 7.8 seconds and measured 61.4
   completed FPS, with 1,959,564 triangles; its LOD selection differs from
   earlier runs, so these numbers are not a compatible performance comparison.

   Rapid map at 512, same camera and settings: before, 135.5 and 114.2 FPS in
   two runs, 668 draws, 925,556 triangles; after, 102.2 FPS, 668 draws,
   2,043,490 triangles. Initial settling rose from 5.5–7.6 seconds to 20.2
   seconds and geometry from 64.8 MB to 143.1 MB. These short synchronized
   runs fluctuate and are not displayed FPS. The substantial generation and
   geometry increase is a real tradeoff; do not present this as a speedup.
   At 1024, the same-camera baseline measured 61.7 FPS, 1,803,566 triangles,
   126.3 MB and 15.2 seconds to settle. The integrated version measured
   44.7 FPS, 5,742,016 triangles, 402.0 MB and 81.9 seconds. It failed the
   60 FPS gate; do not increase the benchmark distance yet. The default
   2048-block viewer may take substantially longer to load and use more memory.

   **Coarse interior traversal:** The mesher now visits native 2x2 or 4x4
   interior cells, computes their heights and side visibility once per cell,
   and retains the original scan for the two-column perimeter. It skips
   redundant AO lookups on unoccluded cell-interior tops and bottoms. Unit
   face masks and boundary AO are still generated to preserve materials,
   lighting and greedy merging; this is not yet a direct coarse-quad mesh.
   Tests compare face coverage, material, AO, diagonals and UV scaling with
   the original unit-column scan, and verify reduced height/block queries.

   Rapid map, same camera/settings: at 512, the immediate pre-change run
   settled in 27.4 seconds at 91.4 FPS; the final repeat settled in 24.4
   seconds at 92.7 FPS, with 668 draws, 2,043,490 triangles and 143.1 MB
   in both. At 1024, the pre-change run settled in 81.9 seconds at 44.7 FPS;
   the final run settled in 78.3 seconds at 44.0 FPS, with 1,292 draws,
   5,742,016 triangles and 402.0 MB in both. These single comparisons are
   noisy and do not establish a reliable load or FPS improvement; the output
   geometry is unchanged. The 1024 result remains below the 60 FPS gate.

   **Border sampling and cave scans:** A CPU profile of representative 4x
   tiles showed substantial terrain-noise work from sampling full chunks for
   cave-adjacent borders. Those chunks now sample height grids on demand and
   share per-tile height samples with the coarse interior and other borders;
   incomplete grids never enter the worker's full-grid cache. A conservative
   horizontal cave-shape test also limits full voxel scans to columns that
   could actually intersect a cave or its immediate neighbor. Tests compare
   lazy and eager samples, verify the cave test against carved voxels, and
   compare the optimized border mesh with fully scanned borders.

   Rapid map trials at 512 settled in 25.8 seconds before and 10.0 / 9.5
   seconds after; at 1024, 78.3 seconds before and 22.9 / 25.4 seconds
   after. Draws, triangles and geometry bytes were unchanged. The new
   loading-rate measurement counts actual scene additions like the overlay.
   In the 9.5-second 512 run it averaged 70.0 tiles/s with a peak one-second
   interval of 128/s; at 1024 it averaged 51.0/s with a peak of 127.9/s.
   This is meaningful progress but does not yet reach the 250/s target; a
   peak interval, a loading average, and tiles of different LODs are not
   interchangeable. The settled map throughput remained around 90 / 44 FPS
   at 512 / 1024, respectively. These short runs vary and do not measure
   displayed FPS.

   Follow-up trials of a bounded worker-local point cache, checking only roots
   affected by worker results, and dispatching new worker jobs between
   animation frames did not improve the rapid load rate; a typed-array sort
   for face-mask keys likewise showed no improvement. Dense typed face masks
   also failed to improve the rapid runs (512: 11.0 s, 1024: 27.1 s) and
   increase temporary allocation. These experiments were removed. The
   current benchmark counts startup scene additions rather
   than continuous movement, so it cannot establish whether an earlier 250/s
   overlay reading used the same workload or LOD tile mix.

   Full-resolution chunks now also use the conservative cave-column test:
   only columns that could contain a cave, or touch one, need a complete
   voxel mesh scan; collision scans only possible cave columns. A cache avoids
   recomputing the test within a chunk. Reference tests verify identical
   buffers and collision, and at least 25% fewer block queries in four cave
   fixtures. A small warmed Node trial of those fixtures measured roughly
   66–72 ms rather than 81–88 ms for mesh and collision generation together;
   this is not an end-to-end throughput measurement.

   The latest rapid 512 run settled in 10.5 seconds, averaged 63.5 tiles/s
   and peaked at 127.9/s; 1024 settled in 30.6 seconds and averaged 42.2/s.
   The 512 settled FPS was 59.8, just below the gate; the 1024 diagnostic
   should not have been run under the gate rule. Compared with prior runs,
   FPS also fell to 59.8 / 36.9 despite unchanged geometry, so machine/run
   variability prevents attributing the loading differences to this change.
   The 250/s target remains unverified and unmet on this workload.

   **Next priority:** profile remaining terrain sampling, per-unit mesh/AO
   and main-thread upload/atomic root replacement costs against the actual
   scene-addition rate, including a repeatable movement workload. The
   border-aware mesher still emits and sorts individual face masks; investigate
   a compact native-cell/edge representation rather than assuming another
   cache or scheduling change will recover the remaining gap to 250/s.
   Investigate geometry reduction separately, preserving caves, water,
   partial edge joins and atomic replacement; compare against the current
   exact shared-edge implementation.

5. **Improve LOD selection and quality only where measurements justify it.**
   Replace fixed distance thresholds with conservative projected geometric
   error if needed: store per-tile bounds and an error estimate, account for
   camera FOV, viewport, height and near-plane intersections, and retain
   hysteresis. An error estimate must be validated against finer terrain;
   sparse samples alone are not a guarantee of a conservative bound. Tune
   resolution, filtering and thresholds with repeatable screenshots and
   measured geometry/load cost, particularly for distant ridges and lakes.
   Add selection tests at viewport/FOV changes, overhead angles, transitions
   and the frustum edge. Expose a small number of understandable quality and
   distance controls; keep original behavior available for comparison.

6. **Reduce draw and allocation overhead.** If the new per-tile draw count or
   GPU allocations dominate, first benchmark region batching or instanced
   greedy quads from the rendering section above. Move mesh data and per-tile
   origin/bounds into reusable shared GPU pools with explicit allocation,
   upload, eviction and destruction; preserve culling granularity and account
   for fragmentation and pool memory. Test resource reuse and unload/jump
   lifetimes, geometry/material/AO equivalence, and compare CPU submission,
   rendered triangles and GPU time at identical LOD quality. Do not introduce
   GPU traversal merely to reduce draw calls: indirect draws on their own do
   not combine them.

7. **Move hierarchy selection to GPU compute if CPU selection is a measured
   bottleneck.** Upload resident node metadata and bounds, traverse bounded
   per-level queues in compute, compact selected tiles, and write indirect
   arguments or instance lists into shared buffers. Keep streaming and
   generation on the CPU initially; use asynchronous, bounded requests for
   missing nodes and keep parent fallback available while requests are
   fulfilled. Define queue overflow, buffer capacity, invalidation and
   readback-latency behavior explicitly. Baseline WebGPU provides indirect
   draws, but not OpenGL-style multi-draw-indirect-count; choose a batched or
   bounded-command design and support devices without optional
   `indirect-first-instance`. Compare GPU-selected coverage against the CPU
   reference, test overflow and stale results, and benchmark total CPU/GPU
   cost including traversal and readback. Retain the CPU path if the added
   complexity or device limits erase the benefit.

8. **Add hierarchical GPU occlusion if hidden terrain is still costly.**
   Build a conservative depth pyramid and test node bounds during traversal.
   The existing terrain depth is multisampled, so design an explicit
   conservative depth source/reduction rather than assuming ordinary color
   resolve applies to depth. Account for camera movement, newly visible nodes,
   near-plane intersections, stale previous-frame depth, sky and water; false
   visibility is preferable to missing geometry. Test against a no-occlusion
   reference, especially after jumps and rotations, and measure compute cost,
   culled geometry and GPU frame time. Make it independently switchable.

9. **Consider a 3D sparse voxel hierarchy only for a demonstrated need.**
   If distant caves, overhangs or future editable voxel geometry must remain
   visible, introduce volumetric LOD bricks and an octree with explicit
   downsampling/material rules, vertical bounds, streaming and 3D boundary
   transitions. Test enclosed/flooded caves and topology loss as well as
   surface seams. Compare memory, generation and rendering against the simpler
   quadtree at the same view distance before committing to replacement.

Across all stages, preserve load-order independence, global border agreement,
existing worker/WebGPU error reporting, bounded resources, and near-detail
behavior. Avoid synchronous GPU readback in the render loop. Update the
performance overlay semantics and README whenever a stage changes what is
counted; add relevant automated tests and run `node --test` before enabling a
new default.
