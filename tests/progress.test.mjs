// The player's data (js/progress.js): the two-device progress merge the
// browser build's saveconflict handling used, normalising old documents, the
// game's options, reading the browser build's cloud save (the JS SDK's
// saveJSON of { version, progress, settings }) and the device store under the
// browser build's localStorage keys. Signed-in paths cannot be driven live
// here, so their logic is covered by these tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/progress.js';

test('merge keeps the better of each side', () => {
  const a = { journey: { j01: { score: 900, ms: 50000 } }, dailies: { '2026-10-01': { score: 1200 } }, achievements: { 'first-clear': 200 },
    stats: { rounds: 5, wins: 3, bestScore: 1500, pairsTotal: 40 }, friends: ['Ann'], name: 'Moon' };
  const b = { journey: { j01: { score: 900, ms: 40000 }, j02: { score: 700, ms: 1 } }, dailies: { '2026-10-01': { score: 800 }, '2026-10-02': { score: 50 } },
    achievements: { 'first-clear': 100, 'streak-8': 300 }, stats: { rounds: 9, wins: 1, bestScore: 2000, pairsTotal: 10 }, friends: ['Bo'], name: 'Other' };
  const m = P.mergeProgress(a, b);
  assert.deepEqual(m.journey, { j01: { score: 900, ms: 40000 }, j02: { score: 700, ms: 1 } });
  assert.deepEqual(m.dailies, { '2026-10-01': { score: 1200 }, '2026-10-02': { score: 50 } });
  assert.deepEqual(m.achievements, { 'first-clear': 100, 'streak-8': 300 });
  assert.deepEqual(m.stats, { rounds: 9, wins: 3, bestScore: 2000, pairsTotal: 40 });
  assert.deepEqual(m.friends.sort(), ['Ann', 'Bo']);
  assert.equal(m.name, 'Moon');
  assert.ok(P.sameProgress(P.mergeProgress(m, m), m));
});

test('normalising drops junk and the old checksum', () => {
  const p = P.normalizeProgress({ version: 1, checksum: 123, journey: [], stats: { rounds: 'x', wins: 2 }, friends: [1, 'A'], name: 'x'.repeat(40) });
  assert.equal(p.checksum, undefined);
  assert.deepEqual(p.journey, {});
  assert.deepEqual(p.stats, { rounds: 0, wins: 2, bestScore: 0, pairsTotal: 0 });
  assert.deepEqual(p.friends, ['A']);
  assert.equal(p.name.length, 24);
  assert.deepEqual(P.normalizeSave(null), { v: P.SAVE_SCHEMA, progress: P.emptyProgress() });
});

test('the browser build\'s cloud save: progress and the options that are still the game\'s', () => {
  const text = JSON.stringify({ version: 1, progress: { version: 1, journey: { j03: { score: 10, ms: 5 } }, checksum: 9 },
    settings: { music: 30, captions: true, theme: 'jade-rain', palette: 'tritanopia', leftHanded: true, tutorialDone: true, gfx: { preset: 'high' }, highContrast: true } });
  const f = P.readForeign(text);
  assert.deepEqual(f.progress.journey, { j03: { score: 10, ms: 5 } });
  assert.deepEqual(f.options, { captions: true, leftHanded: true, tutorialDone: true, theme: 'jade-rain', palette: 'tritanopia' });
  assert.equal(P.readForeign('not json'), null);
  assert.deepEqual(P.pickOptions({ theme: 'nope', palette: 'x', captions: 'yes' }), {});
  for (const k of P.OPTION_KEYS) assert.ok(P.BROWSER_KEYS.includes(k), k);
});

test('device store: snapshot and local board under the old keys', () => {
  const mem = new Map();
  const store = P.createStore({ get: (k) => mem.get(k) ?? null, set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) });
  assert.equal(store.loadSnapshot(), null);
  store.saveSnapshot({ mode: 'practice', tier: 'small', seed: 3 }, [{ t: 'tick', ms: 1000 }], null, 5);
  assert.ok(mem.has('qm:save:v1'));
  assert.deepEqual(store.loadSnapshot().commands, [{ t: 'tick', ms: 1000 }]);
  store.clearSnapshot();
  assert.equal(store.loadSnapshot(), null);
  // the browser build's entries (with configs and command logs) still read
  mem.set('qm:board:v1', JSON.stringify([{ name: 'Old', board: 'daily', score: 5, commands: [] }]));
  store.addBoardEntry({ name: 'Me', board: 'global', score: 50 });
  store.addBoardEntry({ name: 'Ann', board: 'daily', score: 20 });
  assert.deepEqual(store.board('global').map((e) => e.score), [50, 20, 5]);
  assert.deepEqual(store.board('daily').map((e) => e.name), ['Ann', 'Old']);
  assert.deepEqual(store.board('friends', ['Ann'], 'Me').map((e) => e.name), ['Me', 'Ann']);
  for (let i = 0; i < 250; i++) store.addBoardEntry({ name: 'x', board: 'global', score: i });
  assert.equal(JSON.parse(mem.get('qm:board:v1')).length, 200);
  store.resetAll();
  assert.equal(mem.size, 0);
});
