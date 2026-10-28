/**
 * Quiet Mahjong — the player's data, pure (no engine, no DOM) so the client
 * and the node tests agree on it: the progress document and its two-device
 * merge (the browser build's js/platform.js mergeProgress, unchanged in what
 * it decides), the game's own options (the browser build's settings keys that
 * are still the game's, not the runtime's Options), reading the browser
 * build's cloud save (the JS SDK's saveJSON of { version, progress, settings }
 * under game:<slug>), and the device store (the interrupted-round snapshot and
 * the local leaderboard under the browser build's localStorage key names).
 */

export const SAVE_SCHEMA = 1;

/** A new player's progress (js/main.js progress.data). */
export function emptyProgress() {
  return { version: 1, journey: {}, dailies: {}, achievements: {}, stats: { rounds: 0, wins: 0, bestScore: 0, pairsTotal: 0 }, friends: [], name: '' };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Any stored shape → a well-formed progress document. */
export function normalizeProgress(p) {
  const base = emptyProgress();
  if (!isObj(p)) return base;
  const out = { ...base, ...p, version: 1 };
  out.journey = isObj(p.journey) ? { ...p.journey } : {};
  out.dailies = isObj(p.dailies) ? { ...p.dailies } : {};
  out.achievements = isObj(p.achievements) ? { ...p.achievements } : {};
  out.stats = { ...base.stats };
  if (isObj(p.stats)) for (const [k, v] of Object.entries(p.stats)) out.stats[k] = num(v);
  out.friends = Array.isArray(p.friends) ? p.friends.filter((f) => typeof f === 'string') : [];
  out.name = typeof p.name === 'string' ? p.name.slice(0, 24) : '';
  delete out.checksum;
  return out;
}

/**
 * Merge two progress docs (this device and the cloud copy another device
 * wrote) without losing either side: larger stat counters and best score,
 * the better result per journey stage and per daily date, the union of
 * achievements (earliest unlock time) and friends; the local name wins.
 */
export function mergeProgress(local, remote) {
  const a = isObj(local) ? local : {};
  const b = isObj(remote) ? remote : {};
  const stats = {};
  for (const k of new Set([...Object.keys(a.stats || {}), ...Object.keys(b.stats || {})])) {
    stats[k] = Math.max(num((a.stats || {})[k]), num((b.stats || {})[k]));
  }
  const better = (x, y) => (!x ? y : !y ? x : num(y.score) > num(x.score) || (num(y.score) === num(x.score) && num(y.ms) && num(y.ms) < num(x.ms)) ? y : x);
  const bests = (x = {}, y = {}) => {
    const out = { ...x };
    for (const [k, v] of Object.entries(y)) out[k] = better(out[k], v);
    return out;
  };
  const achievements = {};
  for (const k of new Set([...Object.keys(a.achievements || {}), ...Object.keys(b.achievements || {})])) {
    const va = (a.achievements || {})[k], vb = (b.achievements || {})[k];
    const times = [va, vb].filter((v) => typeof v === 'number' && v > 0);
    achievements[k] = times.length ? Math.min(...times) : (va || vb);
  }
  return normalizeProgress({
    ...b, ...a,
    journey: bests(a.journey, b.journey),
    dailies: bests(a.dailies, b.dailies),
    achievements,
    stats,
    friends: [...new Set([...(a.friends || []), ...(b.friends || [])])],
    name: a.name || b.name || '',
  });
}

/** Whether two progress docs hold the same data. */
export function sameProgress(a, b) {
  return JSON.stringify(normalizeProgress(a)) === JSON.stringify(normalizeProgress(b));
}

/** The engine save document: { v, progress }. */
export function normalizeSave(doc) {
  return { v: SAVE_SCHEMA, progress: normalizeProgress(isObj(doc) ? doc.progress : null) };
}

// ---------------------------------------------------------------------------
// the game's options (engine `settings`, kept with the account)

export const THEME_IDS = ['moonlit-garden', 'plum-dawn', 'jade-rain', 'ember-evening', 'winter-quiet'];
export const PALETTES = ['standard', 'deuteranopia', 'protanopia', 'tritanopia'];
export const DEFAULT_OPTIONS = { captions: false, theme: 'moonlit-garden', palette: 'standard', leftHanded: false, tutorialDone: false };
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);
/** Every key the browser build mirrored to the account's settings KV (removed once read). */
export const BROWSER_KEYS = ['music', 'effects', 'ambience', 'voice', 'captions', 'gfx', 'theme', 'reducedMotion', 'highContrast',
  'largeText', 'leftHanded', 'holdToggle', 'haptics', 'palette', 'tutorialDone', 'gamepad'];

/** The valid option values in an object (others dropped). */
export function pickOptions(obj) {
  const out = {};
  if (!isObj(obj)) return out;
  for (const k of ['captions', 'leftHanded', 'tutorialDone']) if (typeof obj[k] === 'boolean') out[k] = obj[k];
  if (THEME_IDS.includes(obj.theme)) out.theme = obj.theme;
  if (PALETTES.includes(obj.palette)) out.palette = obj.palette;
  return out;
}

/** The browser build's cloud save ({ version, progress, settings } as JSON): its progress and options, or null. */
export function readForeign(text) {
  let doc;
  try { doc = JSON.parse(String(text)); } catch { return null; }
  if (!isObj(doc)) return null;
  return { progress: isObj(doc.progress) ? normalizeProgress(doc.progress) : null, options: pickOptions(doc.settings) };
}

// ---------------------------------------------------------------------------
// the device store (the browser build's localStorage keys)

export const KEYS = { snapshot: 'qm:save:v1', board: 'qm:board:v1' };

/** backend: { get(k) → string|null, set(k, v), remove(k) }. */
export function createStore(backend) {
  const read = (k) => { try { return JSON.parse(backend.get(k) || 'null'); } catch { return null; } };
  return {
    /** The interrupted round: { version, config, commands, contentRef, at } or null. */
    loadSnapshot() {
      const raw = read(KEYS.snapshot);
      return raw && raw.version === 1 && isObj(raw.config) && Array.isArray(raw.commands) ? raw : null;
    },
    saveSnapshot(config, commands, contentRef, at) {
      try { backend.set(KEYS.snapshot, JSON.stringify({ version: 1, config, commands, contentRef, at })); } catch { /* full */ }
    },
    clearSnapshot() { try { backend.remove(KEYS.snapshot); } catch { /* gone */ } },
    /** The local board: top 50 by score ('global' = every entry; 'friends' = names in friends or yours). */
    board(kind, friends = [], me = '') {
      const list = Array.isArray(read(KEYS.board)) ? read(KEYS.board) : [];
      let out = list.filter((e) => isObj(e) && (e.board === kind || kind === 'global'));
      if (kind === 'friends') out = list.filter((e) => isObj(e) && (friends.includes(e.name) || e.name === me));
      return out.sort((x, y) => num(y.score) - num(x.score)).slice(0, 50);
    },
    addBoardEntry(entry) {
      const list = Array.isArray(read(KEYS.board)) ? read(KEYS.board) : [];
      list.push(entry);
      while (list.length > 200) list.shift();
      try { backend.set(KEYS.board, JSON.stringify(list)); } catch { /* full */ }
    },
    resetAll() { for (const k of Object.values(KEYS)) { try { backend.remove(k); } catch { /* gone */ } } },
  };
}
