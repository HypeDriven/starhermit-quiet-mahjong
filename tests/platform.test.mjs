/* Platform adapter (js/platform.js) over the shipped StarHermit SDK with a
 * stubbed fetch and launch fragment: token read, profile nickname, cloud
 * save round trip on `game:<slug>`, settings KV, control bindings, and no
 * network traffic when standalone. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The SDK is a classic browser script (UMD); evaluate it CommonJS-style.
const SDK = (() => {
  const m = { exports: {} };
  new Function('module', 'exports', readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(m, m.exports);
  return m.exports;
})();

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64u({ alg: 'none' })}.${b64u({ sub: 'u-1234567890', game_scope: 'quiet-mahjong', exp: 9999999999 })}.sig`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeWindow(hash, hostname = 'localhost') {
  const loc = { hash, pathname: '/', search: '', hostname, href: `https://${hostname}/${hash}`, origin: `https://${hostname}` };
  return { location: loc, history: { state: null, replaceState(_s, _t, url) { loc.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } } };
}

function stubPlatform() {
  const calls = [];
  const store = { save: null, settings: { music: 10, gfx: { preset: 'low' } }, patches: [] };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, auth: init.headers && init.headers.Authorization });
    const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/v1/users/u-1234567890/profile') return json(200, { nickname: 'Moonlit Ana', username: 'ana' });
    if (url === '/api/v1/me/cloud-saves/game%3Aquiet-mahjong') {
      if (method === 'GET') return store.save ? new Response(store.save, { status: 200 }) : json(404, { error: 'not-found' });
      if (method === 'PUT') { store.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return json(200, { etag: `"v${calls.length}"` }); }
    }
    if (url === '/api/v1/games/quiet-mahjong/settings') {
      if (method === 'GET') return json(200, { settings: store.settings });
      if (method === 'PATCH') { store.patches.push(JSON.parse(init.body).settings); return json(200, {}); }
    }
    if (url === '/api/v1/games/quiet-mahjong/controls') return json(200, { actions: [{ action: 'hint', codes: ['KeyJ'] }] });
    return json(404, { error: 'not-found' });
  };
  return { calls, store, fetch };
}

function timers() {
  // Long SDK timers (token renewal) are not scheduled so the test can exit.
  return { setTimeout: (fn, ms) => (ms > 5000 ? 0 : setTimeout(fn, ms)), clearTimeout: (t) => t && clearTimeout(t) };
}

async function load(tag, sh) {
  globalThis.StarHermit = sh;
  globalThis.addEventListener = () => {};
  globalThis.document = { addEventListener() {}, hidden: false };
  const mod = await import(`../js/platform.js?${tag}`);
  const DEFAULTS = { music: 60, effects: 80, gfx: {}, tutorialDone: false };
  const settings = { data: { ...DEFAULTS }, save() { mod.platform.scheduleCloud(); mod.platform.mirrorSettings(); } };
  const progress = { data: { version: 1, stats: { rounds: 0 } }, save() { mod.platform.scheduleCloud(); } };
  const ui = { syncStatus() {}, toast() {} };
  return { mod, settings, progress, ui, DEFAULTS };
}

test('hosted: token, profile, cloud save, settings KV and bindings', async () => {
  const net = stubPlatform();
  const sh = SDK.create({ window: fakeWindow(`#game_token=${JWT}&session_id=s-1`), fetch: net.fetch, ...timers() });
  const { mod, settings, progress, ui, DEFAULTS } = await load('hosted', sh);
  const { platform } = mod;
  const localFetch = [];
  platform.bind({ progress, settings, ui, defaultSettings: DEFAULTS, hasLocalProgress: () => true });
  globalThis.fetch = (u) => { localFetch.push(String(u)); throw new Error('no'); };
  await platform.init();

  assert.equal(platform.hosted, true, 'launch token read');
  assert.equal(platform.userId, 'u-1234567890');
  assert.equal(platform.gameKey, 'quiet-mahjong', 'slug from game_scope');
  assert.equal(sh.launchSessionId, 's-1');
  assert.equal(platform.displayName(), 'Moonlit Ana', 'profile nickname');
  assert.ok(net.calls.every((c) => c.auth === `Bearer ${JWT}`), 'Bearer on every call');
  assert.ok(!net.calls.some((c) => c.url === '/api/v1/me'), 'never /api/v1/me');
  assert.deepEqual(localFetch, [], 'no dev-server calls while hosted');

  // Empty slot seeded from local progress on the game:<slug> path.
  await sleep(20);
  assert.ok(net.calls.some((c) => c.method === 'PUT' && c.url === '/api/v1/me/cloud-saves/game%3Aquiet-mahjong'));

  // Settings KV wins over local defaults.
  assert.equal(settings.data.music, 10);
  assert.deepEqual(settings.data.gfx, { preset: 'low' });

  // Bindings: platform override applied, defaults kept.
  assert.deepEqual(platform.bindings.hint, ['KeyJ']);
  assert.equal(platform.actionFor('KeyJ'), 'hint');
  assert.equal(platform.actionFor('KeyH'), null);
  assert.equal(platform.actionFor('ArrowUp'), 'up');

  // A settings change patches only the diff.
  settings.data.effects = 33;
  settings.save();
  await sleep(700);
  assert.deepEqual(net.store.patches.at(-1), { effects: 33 });

  // Checkpoint save + flush, then a fresh launch loads it remote-first.
  progress.data.stats.rounds = 7;
  progress.save();
  await platform.flushCloud();
  await sleep(20);
  const sh2 = SDK.create({ window: fakeWindow(`#game_token=${JWT}`), fetch: net.fetch, ...timers() });
  const second = await load('hosted2', sh2);
  second.mod.platform.bind({ progress: second.progress, settings: second.settings, ui: second.ui, defaultSettings: second.DEFAULTS });
  await second.mod.platform.init();
  assert.equal(second.progress.data.stats.rounds, 7, 'cloud save round trip');

  assert.ok(platform.inviteLink().includes('/game-invite/u-1234567890/quiet-mahjong'));
});

test('standalone on the platform host: no network, sign-in offered', async () => {
  const net = stubPlatform();
  const sh = SDK.create({ window: fakeWindow('', '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com'), fetch: net.fetch, ...timers() });
  const { mod, settings, progress, ui, DEFAULTS } = await load('standalone', sh);
  const localFetch = [];
  mod.platform.bind({ progress, settings, ui, defaultSettings: DEFAULTS });
  globalThis.fetch = (u) => { localFetch.push(String(u)); throw new Error('no'); };
  await mod.platform.init();
  progress.save(); settings.save();
  await sleep(700);
  assert.equal(mod.platform.hosted, false);
  assert.equal(mod.platform.canSignIn(), true);
  assert.equal(mod.platform.inviteLink(), null);
  assert.deepEqual(net.calls, [], 'no platform calls');
  assert.deepEqual(localFetch, [], 'no dev-server probe on the platform host');
  assert.deepEqual(mod.platform.bindings.hint, ['KeyH'], 'default bindings');
});

test('standalone locally: no network request at all', async () => {
  const net = stubPlatform();
  const sh = SDK.create({ window: fakeWindow('', 'localhost'), fetch: net.fetch, ...timers() });
  const { mod, settings, progress, ui, DEFAULTS } = await load('local', sh);
  const localFetch = [];
  mod.platform.bind({ progress, settings, ui, defaultSettings: DEFAULTS });
  globalThis.fetch = (u) => { localFetch.push(String(u)); throw new Error('no'); };
  await mod.platform.init();
  assert.equal(mod.platform.canSignIn(), false, 'no sign-in when running locally');
  assert.deepEqual(net.calls, []);
  assert.deepEqual(localFetch, [], 'no own-server probe');
  assert.equal(mod.platform.online, false);
  const C = { dailyConfig: (date, seed) => ({ date, seed }) };
  const R = { dailySeed: () => 42 };
  mod.platform.bind({ progress, settings, ui, defaultSettings: DEFAULTS, C, R, localBoard: { all: () => ['x'] } });
  const d = await mod.platform.getDaily();
  assert.equal(d.date, new Date().toISOString().slice(0, 10), 'device-clock UTC day');
  assert.deepEqual((await mod.platform.leaderboard('global')).entries, ['x'], 'local board');
  assert.deepEqual(localFetch, [], 'still no request after daily/board reads');
});

test('hosted: a save conflict reloads the cloud copy, merges progress and saves again', async () => {
  // ETag-versioned slot: writes after a load are conditional (If-Match / If-None-Match).
  let slot = null, version = 0;
  const puts = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const h = init.headers || {};
    const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/profile')) return json(200, { nickname: 'Moonlit Ana' });
    if (url === '/api/v1/me/cloud-saves/game%3Aquiet-mahjong/info') return json(200, slot ? { exists: true, etag: `"v${version}"` } : { exists: false });
    if (url === '/api/v1/me/cloud-saves/game%3Aquiet-mahjong') {
      if (method === 'GET') return slot ? new Response(slot, { status: 200 }) : json(404, {});
      const cur = slot ? `"v${version}"` : null;
      puts.push(h['If-Match'] || h['If-None-Match'] || null);
      if ((h['If-Match'] && h['If-Match'] !== cur) || (h['If-None-Match'] === '*' && slot)) return json(412, { error: 'precondition failed', etag: cur });
      slot = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
      version++;
      return json(200, { etag: `"v${version}"` });
    }
    if (url.endsWith('/settings')) return json(200, { settings: {} });
    if (url.endsWith('/controls')) return json(200, { actions: [] });
    return json(404, {});
  };
  const sh = SDK.create({ window: fakeWindow(`#game_token=${JWT}`), fetch, ...timers() });
  const { mod, settings, progress, ui, DEFAULTS } = await load('conflict', sh);
  progress.data = { version: 1, journey: { j01: { score: 900, ms: 60000 } }, dailies: {}, achievements: { 'first-clear': 50 },
    stats: { rounds: 3, wins: 1, bestScore: 900, pairsTotal: 6 }, friends: [], name: '' };
  mod.platform.bind({ progress, settings, ui, defaultSettings: DEFAULTS, hasLocalProgress: () => true });
  await mod.platform.init();
  await sleep(20); // empty slot seeded from local progress (If-None-Match: *)
  assert.equal(puts[0], '*');

  // Another device saves different progress.
  const other = { version: 1, progress: { version: 1, journey: { j01: { score: 700, ms: 50000 }, j02: { score: 1200, ms: 70000 } },
    dailies: { '2026-10-16': { score: 2000 } }, achievements: { 'first-clear': 10, 'streak-8': 20 },
    stats: { rounds: 9, wins: 4, bestScore: 2000, pairsTotal: 40 }, friends: [], name: '' }, settings: {} };
  slot = Buffer.from(sh._zip('save.json', new TextEncoder().encode(JSON.stringify(other))));
  version++;

  progress.data.stats.rounds = 4;
  progress.save();
  await mod.platform.flushCloud(); // refused (412) → saveconflict → reload + merge + save
  await sleep(50);
  await sh.flushSave();
  await sleep(20);
  const p = progress.data;
  assert.deepEqual(p.journey, { j01: { score: 900, ms: 60000 }, j02: { score: 1200, ms: 70000 } });
  assert.deepEqual(p.dailies, { '2026-10-16': { score: 2000 } });
  assert.deepEqual(p.achievements, { 'first-clear': 10, 'streak-8': 20 });
  assert.deepEqual(p.stats, { rounds: 9, wins: 4, bestScore: 2000, pairsTotal: 40 });
  assert.equal(sh.saveConflicted(), false);
  assert.equal(puts.at(-1), `"v${version - 1}"`, 'merged doc written on top of the other device\'s version');
  const saved = JSON.parse(new TextDecoder().decode(await sh._unzip(new Uint8Array(slot))));
  assert.deepEqual(saved.progress.journey.j02, { score: 1200, ms: 70000 });
  assert.equal(saved.progress.journey.j01.score, 900);
});
