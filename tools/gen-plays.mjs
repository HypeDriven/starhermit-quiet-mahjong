// Writes the native play scripts (tests/native/*.play) from the rules: each
// round is solved by the greedy solver (the first legal pair, Shuffle when
// none is open) on the real deal, and every tile is pressed by its
// accessibility name (the board mirror's label, e.g. "moon 3, layer 1, free",
// `#N` when several live tiles share it), or reached by the arrow keys with
// the game's own focus navigation (main.ts moveFocus, mirrored here) and
// chosen with Enter. tests/native.mjs also calls dailyPlay() at test time:
// the Daily's board depends on the UTC date.
//   node tools/gen-plays.mjs
import { writeFileSync } from 'node:fs';
import * as R from '../js/rules.js';
import * as C from '../js/content.js';

const FAM = { moon: 'moon', petal: 'petal', wave: 'wave', stone: 'stone', wind: 'wind', star: 'star', lantern: 'lantern' };
const faceLabel = (face) => { const [f, r] = face.split('-'); return `${FAM[f]} ${r}`; };
function label(t, free, sel) {
  return `${faceLabel(t.face)}, layer ${t.z + 1}, ${free ? 'free' : 'blocked'}${sel ? ', selected' : ''}`;
}
/** The click line for a tile: its exact name, with #N among the live tiles (build order) sharing it. */
function clickLine(s, id, verb) {
  const free = new Set(R.freeTiles(s).map((t) => t.id));
  const names = s.tiles.filter((t) => !t.removed).map((t) => ({ id: t.id, name: label(t, free.has(t.id), s.selected === t.id) }));
  const me = names.find((n) => n.id === id);
  const same = names.filter((n) => n.name === me.name);
  const nth = same.findIndex((n) => n.id === id) + 1;
  return `${verb} =${me.name}${same.length > 1 ? ` #${nth}` : ''}`;
}

/** main.ts moveFocus, mirrored. */
function moveFocus(s, focusId, dx, dy) {
  const free = R.freeTiles(s).sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  if (!free.length) return null;
  const cur = free.find((t) => t.id === focusId);
  if (!cur) return free[0].id;
  let best = null, bestD = 1e9;
  for (const t of free) {
    if (t.id === cur.id) continue;
    const vx = t.x - cur.x, vy = t.y - cur.y, vz = (t.z - cur.z) * 2;
    if (dx && Math.sign(vx || 0) !== dx && Math.abs(vx) > 0) continue;
    if (dy && Math.sign(vy || 0) !== dy && Math.abs(vy) > 0) continue;
    if (dx && vx === 0) continue;
    if (dy && vy === 0 && vz === 0) continue;
    const d = Math.hypot(vx, vy, vz);
    if (d < bestD) { bestD = d; best = t; }
  }
  if (best) return best.id;
  const i = free.findIndex((t) => t.id === cur.id);
  return free[(i + 1) % free.length].id;
}
const KEYS = [['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]];
/** The shortest arrow-key path from the focus to a tile (BFS over moveFocus). */
function keyPath(s, from, to) {
  const seen = new Map([[from, []]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to && seen.get(cur).length) return seen.get(cur);
    for (const [key, dx, dy] of KEYS) {
      const next = moveFocus(s, cur, dx, dy);
      if (next == null || seen.has(next)) continue;
      seen.set(next, [...seen.get(cur), key]);
      queue.push(next);
    }
  }
  if (from === to) return [];
  throw new Error(`no key path ${from} → ${to}`);
}

/**
 * The lines that clear a round: `mode` "click" | "touch" (presses by name) or "keys" (arrows + Enter).
 * Returns { lines, state }. `firstPairOnly`: stop after one pair.
 */
function solveLines(config, mode, { maxPairs = Infinity } = {}) {
  const s = R.init(config);
  const lines = [];
  let focus = null, pairs = 0;
  while (s.status === 'active' && pairs < maxPairs) {
    const p = R.legalPairs(s);
    if (!p.length) {
      lines.push('frames 5', mode === 'keys' ? 'key KeyS 1' : `${mode === 'touch' ? 'touch' : 'click'} =Shuffle`);
      R.apply(s, { t: 'shuffle' });
      lines.push('frames 5');
      focus = null;
      continue;
    }
    for (const id of p[0]) {
      if (mode === 'keys') {
        // the first arrow press focuses the first free tile
        if (focus == null || !R.freeTiles(s).some((t) => t.id === focus)) { lines.push('key ArrowRight 1', 'frames 3'); focus = moveFocus(s, null, 1, 0); }
        for (const k of keyPath(s, focus, id)) lines.push(`key ${k} 1`, 'frames 3');
        focus = id;
        lines.push('key Enter 1', 'frames 5');
      } else {
        lines.push('frames 5', clickLine(s, id, mode));
      }
      R.apply(s, { t: 'tap', id });
    }
    pairs++;
  }
  lines.push('frames 5');
  return { lines, state: s };
}

const header = (text) => text.split('\n').map((l) => `# ${l}`).join('\n');
function write(name, comment, body) {
  writeFileSync(new URL(`../tests/native/${name}`, import.meta.url), `${header(comment)}\n${body.join('\n')}\n`);
}

// 1. desktop: Journey stage 1 from the title by the pointer, a hint, the pause sheet and Help, the board cleared, the results.
function journey1() {
  const st = C.JOURNEY_STAGES[0];
  const { lines } = solveLines(st.config, 'click');
  return [
    'until 300 Quiet Mahjong', 'frames 60', 'save title',
    'click =Journey', 'until 60 Forty authored stages', 'frames 10', 'save journey',
    'click 1. First Step', 'until 60 Journey stage.', 'frames 10', 'save stage',
    'click =Start', 'until 120 Clear the board', 'frames 60', 'save board',
    'key KeyH 1', 'frames 20', 'save hint',
    'key Escape 1', 'until 60 =Resume', 'frames 10', 'save pause',
    'click =How to play', 'until 60 Goal', 'frames 10', 'save help',
    'click =Back', 'until 60 =Resume', 'frames 10',
    'click =Resume', 'until 60 Clear the board', 'frames 10',
    ...lines,
    'until 120 Every pair found', 'frames 20', 'save results', 'expect Board clear', 'expect Next: Open Water',
    'click =Home', 'until 120 Quiet Mahjong', 'frames 10', 'expect A moonlit garden',
  ];
}
// 2. keyboard: Lesson 1 from the mode cards, every pair by the arrow keys and Enter, then Undo after the first pair.
function lessonKeys() {
  const l = C.LESSONS[0];
  const cfg = { mode: 'learn', tier: l.tier, seed: l.seed, allowUndo: true, allowShuffle: true, allowHints: true, parMs: 5 * 60000 };
  const { lines } = solveLines(cfg, 'keys');
  return [
    'until 300 Quiet Mahjong', 'frames 60',
    'click =Play', 'until 60 Choose a mode', 'frames 10',
    'click Learn', 'until 120 Tap a glowing free tile', 'frames 60', 'save lesson',
    ...lines,
    'until 120 Every pair found', 'frames 20', 'save lesson-results', 'expect Next lesson: Matching pairs',
  ];
}
// 3. phone held upright, by touch: Moon Sprint (the timed challenge) to its results, then Score chase and the profile.
function sprintPhone() {
  const ch = C.CHALLENGES.find((c) => c.id === 'ch-speed');
  const { lines } = solveLines(ch.config, 'touch');
  return [
    '# viewport 390x844@3',
    'until 300 Quiet Mahjong', 'frames 60', 'save phone-title',
    'touch =Play', 'until 60 Choose a mode', 'frames 10', 'save phone-modes',
    'touch Challenge', 'until 60 Constrained goals', 'frames 10',
    'touch Moon Sprint', 'until 60 Beat the clock', 'frames 10', 'save phone-setup',
    'touch =Start', 'until 120 left', 'frames 60', 'save phone-board',
    ...lines,
    'until 120 Every pair found', 'frames 20', 'save phone-results',
    'touch =Home', 'until 120 Quiet Mahjong', 'frames 10',
    'touch =Profile', 'until 60 Display name', 'frames 10', 'save phone-profile', 'expect First Clear',
    'touch =Back', 'until 60 Quiet Mahjong', 'frames 10',
    'touch =Play', 'until 60 Choose a mode', 'frames 10',
    'touch Score chase', 'until 60 Leaderboards', 'frames 10', 'save phone-scores',
  ];
}
// 4. phone held sideways, by touch: Journey stage 2 (via the stage list), a shuffle, the settings sheet, then the board cleared.
function landscape() {
  const st = C.JOURNEY_STAGES[1];
  const s0 = R.init(st.config);
  R.apply(s0, { t: 'shuffle' });
  // after the shuffle the solver starts from the shuffled deal
  const body = [];
  const s = s0;
  while (s.status === 'active') {
    const p = R.legalPairs(s);
    if (!p.length) { body.push('frames 5', 'touch =Shuffle', 'frames 5'); R.apply(s, { t: 'shuffle' }); continue; }
    for (const id of p[0]) { body.push('frames 5', clickLine(s, id, 'touch')); R.apply(s, { t: 'tap', id }); }
  }
  return [
    '# viewport 844x390@3',
    'until 300 Quiet Mahjong', 'frames 60', 'save land-title',
    'touch =Journey', 'until 60 Forty authored stages', 'frames 10',
    'touch 2. Open Water', 'until 60 Journey stage.', 'frames 10',
    'touch =Start', 'until 120 Clear the board', 'frames 60', 'save land-board',
    'touch =Shuffle', 'frames 20',
    'touch =Pause', 'until 60 =Resume', 'frames 10', 'save land-pause',
    'touch =Resume', 'until 60 Clear the board', 'frames 20',
    ...body, 'frames 5',
    'until 120 Every pair found', 'frames 20', 'save land-results',
  ];
}
/** The Daily for a UTC date (desktop, by the pointer). */
export function dailyPlay(date) {
  const cfg = C.dailyConfig(date, R.dailySeed(date));
  const { lines } = solveLines(cfg, 'click');
  return `# Today's Daily (${date}), generated by tests/native.mjs with tools/gen-plays.mjs dailyPlay: the setup, the board cleared, the results.\n` + [
    'until 300 Quiet Mahjong', 'frames 60',
    'click =Daily challenge', 'until 60 One shared seed', 'frames 10', 'save daily-setup',
    'click =Start', 'until 120 Clear the board', 'frames 60',
    ...lines,
    'until 120 Every pair found', 'frames 20', 'save daily-results', 'expect Board clear',
  ].join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  write('journey-1.play', 'Journey stage 1 "First Step" on the desktop by the pointer (tools/gen-plays.mjs; generated: do not edit): the title, the\nstage list, the stage setup, a hint, the pause sheet with Help and back, the board cleared by pressing tiles by name,\nthe results with Next, Home.', journey1());
  write('lesson-keys.play', 'Lesson 1 by the keyboard (tools/gen-plays.mjs; generated: do not edit): the mode cards, every pair reached with the\narrow keys and chosen with Enter, the results with the next lesson.', lessonKeys());
  write('sprint-phone.play', 'Moon Sprint (timed challenge) on a phone held upright, by touch (tools/gen-plays.mjs; generated: do not edit), then\nthe profile and Score chase.', sprintPhone());
  write('journey-2-landscape.play', 'Journey stage 2 on a phone held sideways, by touch (tools/gen-plays.mjs; generated: do not edit): a shuffle, the\npause sheet, the board cleared.', landscape());
  console.log('wrote tests/native/*.play');
}
