import test from 'node:test';
import assert from 'node:assert/strict';
import { readyLodRootGroups } from '../game/lod-transitions.js';

const leaf = (tx, edges = {}) => ({ level: 2, tx, tz: 0, edges });

test('only roots with incompatible old/new shared edges must wait together', () => {
    const oldA = leaf(0), oldB = leaf(1), oldC = leaf(2);
    const newA = leaf(0, { east: true });
    const newB = leaf(1, { west: true });
    const newC = leaf(2);
    const roots = new Map([
        ['0,0', new Map([['new-a', newA]])],
        ['1,0', new Map([['new-b', newB]])],
        ['2,0', new Map([['new-c', newC]])],
    ]);
    const displayed = new Map([['0,0', new Set(['old-a'])], ['1,0', new Set(['old-b'])],
        ['2,0', new Set(['old-c'])]]);
    const resident = new Map([['old-a', { leaf: oldA }], ['old-b', { leaf: oldB }],
        ['old-c', { leaf: oldC }], ['new-a', { leaf: newA }], ['new-c', { leaf: newC }]]);
    assert.deepEqual(readyLodRootGroups(roots, displayed, resident), [['2,0']]);
    resident.set('new-b', { leaf: newB });
    assert.deepEqual(readyLodRootGroups(roots, displayed, resident), [['0,0', '1,0'], ['2,0']]);
});

test('new roots load independently when no incompatible displayed neighbors exist', () => {
    const roots = new Map([['0,0', new Map([['a', leaf(0, { east: true })]])],
        ['1,0', new Map([['b', leaf(1, { west: true })]])]]);
    assert.deepEqual(readyLodRootGroups(roots, new Map(), new Map([['a', { leaf: leaf(0) }]])), [['0,0']]);
});
