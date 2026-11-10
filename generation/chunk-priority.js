const before = (a, b) => a.distance < b.distance || (a.distance === b.distance && a.order < b.order);

export const createChunkPriority = () => {
    let heap = [];
    const siftDown = (start) => {
        let index = start;
        const item = heap[index];
        while (index * 2 + 1 < heap.length) {
            let child = index * 2 + 1;
            if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
            if (!before(heap[child], item)) break;
            heap[index] = heap[child];
            index = child;
        }
        heap[index] = item;
    };
    const reset = (items) => {
        heap = [...items];
        for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) siftDown(i);
    };
    const take = () => {
        if (!heap.length) return null;
        const first = heap[0];
        const last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            siftDown(0);
        }
        return first;
    };
    return { reset, take };
};
