import { createChunkPriority } from './chunk-priority.js';

// Each worker has at most one job. Results are consumed after the latest
// camera position is known, so old results cannot restore unloaded chunks.
export const createChunkQueue = (workers, onError, options = {}) => {
    let failed = false;
    let previousWanted = null;
    const pending = new Map();
    const priority = createChunkPriority();
    const slots = workers.map((worker) => {
        const slot = { worker, job: null, result: null };
        worker.addEventListener('message', ({ data }) => {
            slot.result = data;
        });
        const fail = (event) => {
            if (failed) return;
            failed = true;
            workers.forEach((item) => item.terminate());
            onError(event.message || 'A chunk worker failed to send its result.');
        };
        worker.addEventListener('error', fail);
        worker.addEventListener('messageerror', fail);
        return slot;
    });

    const update = (wanted, loaded) => {
        if (failed) return [];
        const results = [];
        for (const slot of slots) {
            if (!slot.result) continue;
            const result = slot.result;
            const key = slot.job.key;
            slot.job = null;
            slot.result = null;
            if (wanted.has(key) && !loaded.has(key)) results.push({ key, ...result });
        }

        if (wanted !== previousWanted) {
            const active = new Set(slots.filter((slot) => slot.job).map((slot) => slot.job.key));
            const completed = new Set(results.map((result) => result.key));
            for (const key of pending.keys()) {
                if (!wanted.has(key) || loaded.has(key) || active.has(key) || completed.has(key)) pending.delete(key);
            }
            let order = 0;
            for (const [key, chunk] of wanted) {
                if (!loaded.has(key) && !active.has(key) && !completed.has(key)) {
                    pending.set(key, { key, ...chunk, order });
                }
                order++;
            }
            priority.reset(pending.values());
            previousWanted = wanted;
        }

        for (const slot of slots) {
            if (slot.job) continue;
            let next;
            while ((next = priority.take())) {
                pending.delete(next.key);
                if (wanted.has(next.key) && !loaded.has(next.key)) break;
            }
            if (!next) continue;
            const { key, cx, cz } = next;
            slot.job = { key };
            const job = next.level === undefined ? (options.collision ? { cx, cz, collision: true } : { cx, cz })
                : next.level === 0 ? { cx: next.tx, cz: next.tz, collision: !!options.collision }
                : { type: 'coarse', tileX: next.tx, tileZ: next.tz, spacing: 2 ** next.level,
                    seamless: true, edges: next.edges };
            slot.worker.postMessage(job);
        }
        return results;
    };

    const stats = () => ({
        pending: failed ? 0 : pending.size,
        inFlight: failed ? 0 : slots.filter((slot) => slot.job && !slot.result).length,
    });

    return { update, stats };
};
