/**
 * Quiet Mahjong — rules engine.
 * Pure, deterministic, dependency-free ES module. No DOM, no Three.js.
 * Exposes: seeded RNG streams, layout/tile generation (always solvable),
 * legal-action queries, validated command application, scoring components,
 * serialization + migration, state hashing, and replay.
 */

export const RULES_VERSION = 1;
export const CONTENT_VERSION = 1;

/* ---------------------------------------------------------------- RNG */

/** mulberry32 — deterministic seeded stream. Streams are named so rules,
 * decoration and audiovisual randomness never share a sequence. */
export function makeRng(seed, stream = 'rules') {
  let h = (seed >>> 0) || 1;
  for (let i = 0; i < stream.length; i++) {
    h = Math.imul(h ^ stream.charCodeAt(i), 2654435761) >>> 0;
  }
  let a = h >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/* ------------------------------------------------------------- Faces */

/** Original face set: four numbered suits + three honor families. */
export const SUITS = ['moon', 'petal', 'wave', 'stone'];
export const HONORS = ['wind', 'star', 'lantern'];
export const SUIT_RANKS = 9;
export const HONOR_RANKS = 4;

export const FACE_GLYPHS = {
  moon: ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘', '🌝'],
  petal: ['❀', '✿', '❁', '✾', '❃', '❋', '✽', '⚘', '❆'],
  wave: ['∿', '≈', '≋', '∽', '⌇', '〰', '☂', '☔', '❄'],
  stone: ['◈', '◆', '◇', '⬖', '⬗', '⬘', '⬙', '◊', '■'],
  wind: ['→', '↗', '↑', '↖'],
  star: ['☆', '★', '✦', '✧'],
  lantern: ['♦', '♢', '✺', '☼'],
};
export const FACE_NAMES = {};
for (const s of SUITS) for (let r = 1; r <= SUIT_RANKS; r++) {
  FACE_NAMES[`${s}-${r}`] = `${s} ${r}`;
}
for (const h of HONORS) for (let r = 1; r <= HONOR_RANKS; r++) {
  FACE_NAMES[`${h}-${r}`] = `${h} ${r}`;
}
export function faceGlyph(face) {
  const [fam, r] = face.split('-');
  return FACE_GLYPHS[fam][Number(r) - 1];
}
export function faceName(face) { return FACE_NAMES[face] || face; }

/** Build `pairCount` distinct faces, deterministic for a seed. */
function facesFor(seed, pairCount) {
  const all = [];
  for (const s of SUITS) for (let r = 1; r <= SUIT_RANKS; r++) all.push(`${s}-${r}`);
  for (const h of HONORS) for (let r = 1; r <= HONOR_RANKS; r++) all.push(`${h}-${r}`);
  const rng = makeRng(seed, 'faces');
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const picked = all.slice(0, Math.min(pairCount, all.length));
  const out = [];
  while (out.length < pairCount) out.push(picked[out.length % picked.length]);
  return out;
}

/* ------------------------------------------------------------ Layout */

/**
 * Layout tiers. Each returns positions [{x,y,z}] in half-cell units
 * (integers; upper layers sit on odd offsets so they straddle tiles below).
 */
export const LAYOUT_TIERS = {
  lesson: { pairs: 6,  name: 'Lesson' },
  small:  { pairs: 12, name: 'Small' },
  medium: { pairs: 24, name: 'Medium' },
  large:  { pairs: 36, name: 'Large' },
  grand:  { pairs: 54, name: 'Grand' },
};

export function layoutFor(tier, seed = 0) {
  const t = LAYOUT_TIERS[tier] || LAYOUT_TIERS.medium;
  const n = t.pairs * 2;
  const rng = makeRng(seed ^ 0x9e3779b9, 'layout:' + tier);
  const pos = [];
  // Base rectangle, sized to the tier.
  const cols = Math.ceil(Math.sqrt(n * 1.7));
  const rows = Math.ceil(n / cols);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      pos.push({ x: x * 2, y: y * 2, z: 0 });
  // Trim to a rounded silhouette.
  const cx = (cols - 1), cy = (rows - 1);
  const shaped = pos.filter(p => {
    const dx = (p.x / 2 - cx / 2) / (cols / 2), dy = (p.y / 2 - cy / 2) / (rows / 2);
    return dx * dx + dy * dy <= 1.05;
  });
  // Upper layer: a smaller centered cluster on odd (straddling) offsets.
  const upper = [];
  if (t.pairs >= 12) {
    const uCols = Math.max(2, Math.floor(cols * 0.55));
    const uRows = Math.max(2, Math.floor(rows * 0.55));
    const ox = (cols - uCols), oy = (rows - uRows);
    for (let y = 0; y < uRows; y++)
      for (let x = 0; x < uCols; x++)
        upper.push({ x: ox + x * 2 + 1, y: oy + y * 2 + 1, z: 1 });
  }
  let all = shaped.concat(upper);
  // Deterministic shuffle, then take exactly n positions, lower layer first
  // so stacks remain physically supported.
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  all.sort((a, b) => a.z - b.z);
  const base = all.filter(p => p.z === 0), up = all.filter(p => p.z > 0);
  const takeBase = Math.min(base.length, n);
  const takeUp = Math.min(up.length, n - takeBase);
  let chosen = base.slice(0, takeBase).concat(up.slice(0, takeUp));
  const seen = new Set(); const final = [];
  for (const p of chosen) {
    const key = `${p.x},${p.y},${p.z}`;
    if (seen.has(key)) continue;
    seen.add(key); final.push({ x: p.x, y: p.y, z: p.z });
  }
  // Pad on z=0 if a tiny tier came up short (guaranteed room for our tiers).
  let k = 0;
  while (final.length < n) {
    const p = pos[k++ % pos.length];
    const key = `${p.x},${p.y},0`;
    if (!seen.has(key)) { seen.add(key); final.push({ x: p.x, y: p.y, z: 0 }); }
  }
  final.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  return final;
}

/* ------------------------------------------------------ Tile dealing */

/**
 * Deal faces onto positions such that the layout is always solvable:
 * repeatedly pick two currently-free positions and assign them the next
 * pair face, simulating the removal order.
 */
export function buildTiles(seed, tier) {
  const positions = layoutFor(tier, seed);
  const pairCount = positions.length / 2;
  const faces = facesFor(seed, pairCount);
  const rng = makeRng(seed, 'deal');
  const tiles = positions.map((p, i) => ({
    id: i, face: null, x: p.x, y: p.y, z: p.z, removed: false,
  }));
  const alive = new Set(tiles.map(t => t.id));
  let pair = 0;
  while (alive.size > 0) {
    const cur = tiles.filter(t => alive.has(t.id));
    const free = cur.filter(t => isFree(t, cur));
    const face = faces[pair % faces.length];
    if (free.length >= 2) {
      const a = free[Math.floor(rng() * free.length)];
      let b = a;
      while (b === a) b = free[Math.floor(rng() * free.length)];
      a.face = face; b.face = face;
      alive.delete(a.id); alive.delete(b.id);
      pair++;
    } else {
      // Defensive: break a deadlock on the topmost tile.
      const top = cur.sort((a, b) => b.z - a.z)[0];
      top.face = face; alive.delete(top.id);
    }
  }
  return tiles;
}

/* --------------------------------------------------------- Legality */

function liveTiles(state) { return state.tiles.filter(t => !t.removed); }

/** A tile is free when nothing rests above it and at least one long side
 * (left or right along x) is open. */
export function isFree(tile, tiles) {
  for (const o of tiles) {
    if (o === tile || o.removed) continue;
    if (o.z > tile.z && Math.abs(o.x - tile.x) < 2 && Math.abs(o.y - tile.y) < 2) return false;
  }
  let leftOpen = true, rightOpen = true;
  for (const o of tiles) {
    if (o === tile || o.removed || o.z !== tile.z) continue;
    if (Math.abs(o.y - tile.y) >= 2) continue;
    if (o.x === tile.x - 2) leftOpen = false;
    if (o.x === tile.x + 2) rightOpen = false;
  }
  return leftOpen || rightOpen;
}

export function freeTiles(state) {
  const live = liveTiles(state);
  return live.filter(t => isFree(t, live));
}

export function legalPairs(state) {
  const free = freeTiles(state);
  const byFace = new Map();
  for (const t of free) {
    if (!byFace.has(t.face)) byFace.set(t.face, []);
    byFace.get(t.face).push(t);
  }
  const pairs = [];
  for (const group of byFace.values())
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        pairs.push([group[i].id, group[j].id]);
  return pairs;
}

/** Full legal-action query — hints, tutorials and play all call this. */
export function legalActions(state) {
  if (state.status !== 'active' && state.status !== 'paused') {
    return { pairs: [], tap: [], hint: false, undo: false, shuffle: false, resign: false };
  }
  const pairs = legalPairs(state);
  const free = freeTiles(state);
  return {
    pairs,
    tap: free.map(t => t.id),
    hint: state.config.allowHints !== false && pairs.length > 0,
    undo: state.config.allowUndo === true && state.history.length > 0,
    shuffle: state.config.allowShuffle !== false && liveTiles(state).length > 0,
    resign: true,
  };
}

/* ------------------------------------------------------------ State */

export function init(config) {
  const cfg = {
    mode: 'practice',
    tier: 'medium',
    seed: 1,
    allowUndo: false,
    allowShuffle: true,
    allowHints: true,
    moveLimit: null,
    timeLimitMs: null,
    parMs: 10 * 60 * 1000,
    contentVersion: CONTENT_VERSION,
    ...config,
  };
  const tiles = buildTiles(cfg.seed, cfg.tier);
  return {
    version: RULES_VERSION,
    contentVersion: cfg.contentVersion,
    config: cfg,
    tiles,
    selected: null,
    tick: 0,
    elapsedMs: 0,
    taps: 0,
    invalid: 0,
    hints: 0,
    undos: 0,
    shuffles: 0,
    pairsRemoved: 0,
    streak: 0,
    bestStreak: 0,
    noHintStreak: 0,
    score: { pairs: 0, streak: 0, time: 0, completion: 0, penalties: 0 },
    history: [],
    status: 'active',
    reason: null,
  };
}

/* ----------------------------------------------------------- Scoring */

export const SCORE = {
  PAIR: 50,
  LAYER_BONUS: 10,
  STREAK_STEP: 15,
  TIME_PER_SECOND_UNDER_PAR: 2,
  COMPLETION: 500,
  HINT_PENALTY: 25,
  SHUFFLE_PENALTY: 50,
  INVALID_PENALTY: 5,
  UNDO_PENALTY: 10,
};

export function totalScore(state) {
  const s = state.score;
  return s.pairs + s.streak + s.time + s.completion + s.penalties;
}

export function scoreBreakdown(state) {
  const s = state.score;
  return [
    { key: 'pairs', label: 'Pairs removed', value: s.pairs },
    { key: 'streak', label: 'Streak bonus', value: s.streak },
    { key: 'time', label: 'Time bonus', value: s.time },
    { key: 'completion', label: 'Completion', value: s.completion },
    { key: 'penalties', label: 'Penalties', value: s.penalties },
  ];
}

/** Tie-break ordering per spec: completion, score, fewer invalid actions,
 * lower elapsed time, then stable session id. */
export function compareResults(a, b) {
  const done = (b.status === 'won' ? 1 : 0) - (a.status === 'won' ? 1 : 0);
  if (done) return done;
  const scoreDiff = totalScore(b) - totalScore(a);
  if (scoreDiff) return scoreDiff;
  if (a.invalid !== b.invalid) return a.invalid - b.invalid;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  return String(a.sessionId || '').localeCompare(String(b.sessionId || ''));
}

/* --------------------------------------------------------- Commands */

export const ERR = {
  NOT_ACTIVE: 'round-not-active',
  NOT_FOUND: 'tile-not-found',
  NOT_FREE: 'tile-covered-or-blocked',
  MISMATCH: 'faces-do-not-match',
  NO_UNDO: 'undo-not-available',
  NO_SHUFFLE: 'shuffle-not-available',
  NO_HINT: 'hint-not-available',
  BAD_COMMAND: 'malformed-command',
  MOVE_LIMIT: 'move-limit-reached',
  TIME_LIMIT: 'time-limit-reached',
};

function fail(state, reason, detail) {
  return { state, error: reason, detail, events: [] };
}

function checkLimits(state) {
  const cfg = state.config;
  if (state.status === 'active' && cfg.moveLimit != null && state.taps >= cfg.moveLimit) {
    state.status = 'lost'; state.reason = 'move-limit';
  } else if (state.status === 'active' && cfg.timeLimitMs != null && state.elapsedMs >= cfg.timeLimitMs) {
    state.status = 'lost'; state.reason = 'time-limit';
  }
  return state.status === 'lost';
}

function finalizeIfTerminal(state, events) {
  if (state.status !== 'active') return;
  if (liveTiles(state).length === 0) {
    state.status = 'won'; state.reason = 'cleared';
    state.score.completion = SCORE.COMPLETION;
    const under = Math.max(0, state.config.parMs - state.elapsedMs);
    state.score.time = Math.floor(under / 1000) * SCORE.TIME_PER_SECOND_UNDER_PAR;
    events.push({ type: 'won', reason: 'cleared' });
    return;
  }
  if (legalPairs(state).length === 0 && state.config.allowShuffle === false) {
    state.status = 'lost'; state.reason = 'no-moves';
    events.push({ type: 'lost', reason: 'no-moves' });
  }
}

/**
 * Apply a validated command. Returns {state, events} or {state, error}.
 * Never throws on malformed input. `state` is mutated; use cloneState for
 * prediction/rollback. tick increments monotonically for every command.
 */
export function apply(state, cmd) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.t !== 'string') {
    return fail(state, ERR.BAD_COMMAND);
  }
  state.tick++;
  const events = [];
  switch (cmd.t) {
    case 'tick': {
      if (state.status !== 'active') return fail(state, ERR.NOT_ACTIVE);
      const ms = Math.max(0, Math.min(60000, Math.floor(cmd.ms || 0)));
      state.elapsedMs += ms;
      checkLimits(state);
      return { state, events };
    }
    case 'pause': {
      if (state.status !== 'active') return fail(state, ERR.NOT_ACTIVE);
      state.status = 'paused';
      return { state, events };
    }
    case 'resume': {
      if (state.status !== 'paused') return fail(state, ERR.NOT_ACTIVE);
      state.status = 'active';
      return { state, events };
    }
    case 'tap': {
      if (state.status !== 'active') return fail(state, ERR.NOT_ACTIVE);
      if (checkLimits(state)) return fail(state, ERR.MOVE_LIMIT);
      const tile = state.tiles.find(t => t.id === cmd.id);
      if (!tile || tile.removed) {
        state.invalid++; state.score.penalties -= SCORE.INVALID_PENALTY;
        events.push({ type: 'invalid', reason: ERR.NOT_FOUND, id: cmd.id });
        return fail(state, ERR.NOT_FOUND, cmd.id);
      }
      const live = liveTiles(state);
      if (!isFree(tile, live)) {
        state.invalid++; state.score.penalties -= SCORE.INVALID_PENALTY;
        state.taps++;
        events.push({ type: 'invalid', reason: ERR.NOT_FREE, id: tile.id });
        checkLimits(state);
        return fail(state, ERR.NOT_FREE, tile.id);
      }
      state.taps++;
      if (state.selected == null) {
        state.selected = tile.id;
        events.push({ type: 'select', id: tile.id });
        checkLimits(state);
        return { state, events };
      }
      if (state.selected === tile.id) {
        state.selected = null;
        events.push({ type: 'deselect', id: tile.id });
        return { state, events };
      }
      const first = state.tiles.find(t => t.id === state.selected);
      if (!first || first.removed) {
        state.selected = tile.id;
        events.push({ type: 'select', id: tile.id });
        return { state, events };
      }
      if (first.face !== tile.face) {
        state.invalid++; state.score.penalties -= SCORE.INVALID_PENALTY;
        state.selected = tile.id;
        state.streak = 0;
        events.push({ type: 'invalid', reason: ERR.MISMATCH, id: tile.id, other: first.id });
        checkLimits(state);
        return fail(state, ERR.MISMATCH, { a: first.id, b: tile.id });
      }
      // Valid pair removal.
      first.removed = true; tile.removed = true;
      state.selected = null;
      state.pairsRemoved++;
      state.streak++;
      state.noHintStreak++;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      state.score.pairs += SCORE.PAIR + tile.z * SCORE.LAYER_BONUS;
      state.score.streak += Math.min(state.streak - 1, 10) * SCORE.STREAK_STEP;
      state.history.push({ a: first.id, b: tile.id });
      events.push({ type: 'remove', ids: [first.id, tile.id], face: tile.face, streak: state.streak });
      finalizeIfTerminal(state, events);
      checkLimits(state);
      return { state, events };
    }
    case 'hint': {
      if (state.status !== 'active') return fail(state, ERR.NOT_ACTIVE);
      const pairs = legalPairs(state);
      if (state.config.allowHints === false || pairs.length === 0) return fail(state, ERR.NO_HINT);
      state.hints++;
      state.score.penalties -= SCORE.HINT_PENALTY;
      state.noHintStreak = 0;
      const [a, b] = pairs[0];
      events.push({ type: 'hint', ids: [a, b] });
      return { state, events, hint: [a, b] };
    }
    case 'undo': {
      if (state.status !== 'active' && state.status !== 'paused') return fail(state, ERR.NOT_ACTIVE);
      if (state.config.allowUndo !== true || state.history.length === 0) return fail(state, ERR.NO_UNDO);
      const last = state.history.pop();
      for (const id of [last.a, last.b]) {
        const t = state.tiles.find(x => x.id === id);
        if (t) t.removed = false;
      }
      state.pairsRemoved--;
      state.undos++;
      state.streak = 0;
      state.score.penalties -= SCORE.UNDO_PENALTY;
      state.score.pairs -= SCORE.PAIR;
      events.push({ type: 'undo', ids: [last.a, last.b] });
      return { state, events };
    }
    case 'shuffle': {
      if (state.status !== 'active') return fail(state, ERR.NOT_ACTIVE);
      if (state.config.allowShuffle === false) return fail(state, ERR.NO_SHUFFLE);
      const live = liveTiles(state);
      if (live.length < 2) return fail(state, ERR.NO_SHUFFLE);
      // Re-deal faces among live tiles deterministically, keeping the
      // layout solvable by assigning pairs to two free positions at a time.
      const rng = makeRng(state.config.seed + state.shuffles * 7919, 'shuffle');
      const counts = new Map();
      for (const t of live) counts.set(t.face, (counts.get(t.face) || 0) + 1);
      const pairFaces = [];
      for (const [face, c] of counts) for (let i = 0; i < c / 2; i++) pairFaces.push(face);
      for (let i = pairFaces.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pairFaces[i], pairFaces[j]] = [pairFaces[j], pairFaces[i]];
      }
      const alive = new Set(live.map(t => t.id));
      let p = 0;
      while (alive.size > 0) {
        const cur = state.tiles.filter(t => alive.has(t.id));
        const free = cur.filter(t => isFree(t, cur));
        const face = pairFaces[p++];
        if (free.length >= 2) {
          const a = free[Math.floor(rng() * free.length)];
          let b = a;
          while (b === a) b = free[Math.floor(rng() * free.length)];
          a.face = face; b.face = face;
          alive.delete(a.id); alive.delete(b.id);
        } else {
          const top = cur.sort((a, b) => b.z - a.z)[0];
          top.face = face; alive.delete(top.id);
        }
      }
      state.shuffles++;
      state.streak = 0;
      state.selected = null;
      state.score.penalties -= SCORE.SHUFFLE_PENALTY;
      events.push({ type: 'shuffle' });
      return { state, events };
    }
    case 'resign': {
      if (state.status !== 'active' && state.status !== 'paused') return fail(state, ERR.NOT_ACTIVE);
      state.status = 'lost'; state.reason = 'resigned';
      events.push({ type: 'lost', reason: 'resigned' });
      return { state, events };
    }
    default:
      state.invalid++;
      return fail(state, ERR.BAD_COMMAND, cmd.t);
  }
}

/* -------------------------------------------------- Hash & serialize */

export function hashState(state) {
  const parts = [
    state.tick, state.elapsedMs, state.taps, state.invalid, state.hints,
    state.undos, state.shuffles, state.pairsRemoved, state.status,
    totalScore(state), state.selected,
    state.tiles.map(t => (t.removed ? '1' : '0') + ':' + t.face).join(','),
  ];
  return hashSeed(parts.join('|'));
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function serialize(state) {
  return JSON.stringify(state);
}

/** Deserialize with schema migration. Version 1 is current; unknown newer
 * saves are rejected and older fields defaulted. */
export function deserialize(json) {
  const s = typeof json === 'string' ? JSON.parse(json) : json;
  if (!s || typeof s !== 'object') throw new Error('bad-save');
  if (s.version == null) s.version = 1;
  if (s.version > RULES_VERSION) throw new Error('save-from-newer-version');
  if (!Array.isArray(s.tiles)) throw new Error('bad-save-tiles');
  if (!s.score) s.score = { pairs: 0, streak: 0, time: 0, completion: 0, penalties: 0 };
  if (!Array.isArray(s.history)) s.history = [];
  return s;
}

/* ------------------------------------------------------------ Replay */

/**
 * Deterministic replay: init from config, apply ordered commands,
 * return final state + periodic hashes. Identical inputs => identical
 * hashes, always.
 */
export function replay(config, commands, hashEvery = 10) {
  const state = init(config);
  const hashes = [{ tick: 0, hash: hashState(state) }];
  const errors = [];
  for (let i = 0; i < commands.length; i++) {
    const r = apply(state, commands[i]);
    if (r.error) errors.push({ i, tick: state.tick, error: r.error });
    if (state.tick % hashEvery === 0) hashes.push({ tick: state.tick, hash: hashState(state) });
  }
  hashes.push({ tick: state.tick, hash: hashState(state) });
  return { state, hashes, errors };
}

/** Daily seed: one immutable seed per UTC day. */
export function dailySeed(dateIso) {
  return hashSeed('quiet-mahjong-daily:' + dateIso);
}

/** Tutorials call the same legal-action API used by play. */
export function tutorialStep(state) {
  const acts = legalActions(state);
  if (acts.pairs.length > 0) {
    const [a, b] = acts.pairs[0];
    return { kind: 'pair', ids: [a, b], text: 'These two free tiles match. Tap each to remove the pair.' };
  }
  if (acts.shuffle) return { kind: 'shuffle', text: 'No pairs are open. Shuffle the remaining tiles.' };
  return { kind: 'done', text: 'The board is clear.' };
}
