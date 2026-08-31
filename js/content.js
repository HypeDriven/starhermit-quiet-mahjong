/**
 * Quiet Mahjong — versioned content: lessons, journey stages, challenges,
 * themes, achievements. Pure data + tiny helpers; no DOM, no Three.js.
 */
import { hashSeed } from './rules.js';

export const CONTENT_ID = 'quiet-mahjong';
export const CONTENT_VERSION = 1;

/* ------------------------------------------------------------ Themes */

export const THEMES = [
  {
    id: 'moonlit-garden', name: 'Moonlit Garden',
    sky: 0x0d1226, fog: 0x0d1226, ground: 0x1a2436, table: 0x2c3a4f,
    tile: 0xe8e3d8, tileEdge: 0x8a93a8, accent: 0x9fc4ff, glow: 0x6f9dff,
    ambient: 'crickets', description: 'Ceramic tiles on a stone table under a full moon.',
  },
  {
    id: 'plum-dawn', name: 'Plum Dawn',
    sky: 0x2a1a2e, fog: 0x2a1a2e, ground: 0x33202f, table: 0x4a2f42,
    tile: 0xf3e6e0, tileEdge: 0xa87f92, accent: 0xffb7d5, glow: 0xff8fb8,
    ambient: 'birds', description: 'First light through plum branches.',
  },
  {
    id: 'jade-rain', name: 'Jade Rain',
    sky: 0x0e2018, fog: 0x0e2018, ground: 0x14291f, table: 0x24493a,
    tile: 0xe2efe4, tileEdge: 0x6f9a83, accent: 0xa8e6c1, glow: 0x6fd39a,
    ambient: 'rain', description: 'Soft rain on broad leaves and jade tile.',
  },
  {
    id: 'ember-evening', name: 'Ember Evening',
    sky: 0x241410, fog: 0x241410, ground: 0x2e1c14, table: 0x4d2f1e,
    tile: 0xf1e4d2, tileEdge: 0xa8815a, accent: 0xffc890, glow: 0xff9e56,
    ambient: 'fire', description: 'Lantern embers and warm ceramic.',
  },
  {
    id: 'winter-quiet', name: 'Winter Quiet',
    sky: 0x141a24, fog: 0x141a24, ground: 0x1c2531, table: 0x33455c,
    tile: 0xf2f5f7, tileEdge: 0x93a5b8, accent: 0xcfe6ff, glow: 0x9cc8ff,
    ambient: 'wind', description: 'Snow hush over a frozen pond.',
  },
];

export function themeById(id) {
  return THEMES.find(t => t.id === id) || THEMES[0];
}

/* ------------------------------------------------------------ Lessons */

/** Learn mode: one rule per lesson, player must perform the action. */
export const LESSONS = [
  {
    id: 'learn-select', title: 'Free tiles', tier: 'lesson', seed: 101,
    text: 'A tile is free when nothing sits on top and its left or right side is open. Tap a glowing free tile to select it.',
    goal: 'select',
  },
  {
    id: 'learn-pair', title: 'Matching pairs', tier: 'lesson', seed: 102,
    text: 'Select two free tiles with the same face to remove them both. Clear the board to win.',
    goal: 'remove', count: 1,
  },
  {
    id: 'learn-clear', title: 'Clear the board', tier: 'small', seed: 103,
    text: 'Keep removing matching free pairs until the layout is empty. New choices appear as tiles lift away.',
    goal: 'clear',
  },
  {
    id: 'learn-hint', title: 'Stuck? Hint and shuffle', tier: 'small', seed: 104,
    text: 'Use Hint to reveal a legal pair, or Shuffle to re-deal the remaining tiles. Both cost a little score.',
    goal: 'clear', allowHints: true,
  },
];

/* ------------------------------------------------------------ Journey */

/**
 * 40 authored stages. Difficulty is measured from layout depth, limits and
 * tool restrictions — not merely bigger boards. One new concept at a time,
 * combined with a known one, then a mastery stage every eighth stage.
 */
const TIER_ORDER = ['lesson', 'small', 'small', 'medium', 'medium', 'large', 'large', 'grand'];
const STAGE_NAMES = [
  'First Step', 'Open Water', 'Low Lanterns', 'Stepping Stones',
  'Quiet Corners', 'Petal Drift', 'Narrow Bridge', 'Mastery: Moon Gate',
  'Two Layers', 'Side Passage', 'Long Reflection', 'Half Moon',
  'Reeds', 'Still Pond', 'Evening Bell', 'Mastery: Star Court',
  'Deep Stack', 'Tight Rows', 'Falling Tide', 'Stone Garden',
  'Crosswinds', 'High Lanterns', 'Night Market', 'Mastery: Jade Terrace',
  'No Hints', 'Few Moves', 'Against the Clock', 'Bare Table',
  'Thin Ice', 'Long Night', 'Ember Path', 'Mastery: Silent Peak',
  'Grand Layout', 'Grand Limits', 'Grand Haste', 'Grand Silence',
  'Last Lantern', 'Last Tide', 'Last Petal', 'Mastery: Full Moon',
];

function stageConfig(i) {
  const n = i + 1;
  const tier = TIER_ORDER[Math.min(TIER_ORDER.length - 1, Math.floor(i / 5))];
  const mastery = n % 8 === 0;
  const cfg = {
    mode: 'journey',
    tier,
    seed: hashSeed(`journey:${n}`),
    parMs: (tier === 'lesson' ? 3 : tier === 'small' ? 5 : tier === 'medium' ? 8 : tier === 'large' ? 12 : 18) * 60 * 1000,
    allowUndo: n <= 8,
    allowShuffle: true,
    allowHints: true,
    moveLimit: null,
    timeLimitMs: null,
  };
  // Authored twists in the later arc.
  if (n >= 25 && n < 29) cfg.allowHints = false;             // "No Hints" block
  if (n === 26) cfg.moveLimit = Math.ceil((tier === 'medium' ? 48 : 72) * 1.4);
  if (n === 27) cfg.timeLimitMs = cfg.parMs;
  if (n >= 29 && n <= 31) cfg.allowShuffle = n !== 30;       // recovery limits
  if (n >= 33) { cfg.allowHints = false; cfg.moveLimit = Math.ceil(108 * 1.5); }
  if (mastery) { cfg.allowHints = false; cfg.parMs = Math.floor(cfg.parMs * 0.8); }
  return cfg;
}

export const JOURNEY_STAGES = STAGE_NAMES.map((name, i) => ({
  id: `j${String(i + 1).padStart(2, '0')}`,
  index: i + 1,
  name,
  mastery: (i + 1) % 8 === 0,
  theme: THEMES[Math.floor(i / 8) % THEMES.length].id,
  config: stageConfig(i),
}));

/* ---------------------------------------------------------- Challenge */

export const CHALLENGES = [
  {
    id: 'ch-moves', name: 'Few Moves', theme: 'moonlit-garden',
    description: 'Clear a medium layout within a tight tap limit.',
    config: { mode: 'challenge', tier: 'medium', seed: hashSeed('challenge:moves'),
      moveLimit: 60, allowHints: false, allowUndo: false, allowShuffle: true, parMs: 8 * 60 * 1000 },
  },
  {
    id: 'ch-speed', name: 'Moon Sprint', theme: 'ember-evening',
    description: 'Beat the clock on a small board.',
    config: { mode: 'challenge', tier: 'small', seed: hashSeed('challenge:speed'),
      timeLimitMs: 2 * 60 * 1000, allowHints: true, allowUndo: false, allowShuffle: true, parMs: 2 * 60 * 1000 },
  },
  {
    id: 'ch-bare', name: 'Bare Hands', theme: 'winter-quiet',
    description: 'No hints, no shuffles, no undo. Pure reading.',
    config: { mode: 'challenge', tier: 'medium', seed: hashSeed('challenge:bare'),
      allowHints: false, allowShuffle: false, allowUndo: false, parMs: 10 * 60 * 1000 },
  },
  {
    id: 'ch-grand', name: 'Full Table', theme: 'jade-rain',
    description: 'The grand layout, unhurried but unaided.',
    config: { mode: 'challenge', tier: 'grand', seed: hashSeed('challenge:grand'),
      allowHints: false, allowUndo: false, allowShuffle: true, parMs: 18 * 60 * 1000 },
  },
];

/* ------------------------------------------------------- Achievements */

export const ACHIEVEMENTS = [
  { key: 'first-clear', name: 'First Clear', description: 'Finish your first board.' },
  { key: 'mechanic-mastery', name: 'Steady Hands', description: 'Clear a board without hints, shuffles or undo.' },
  { key: 'streak-8', name: 'Flowing Water', description: 'Reach a streak of 8 consecutive pairs.' },
  { key: 'mastery-stage', name: 'Moon Gate', description: 'Complete any Journey mastery stage.' },
  { key: 'journey-40', name: 'Long Garden', description: 'Complete all 40 Journey stages.' },
  { key: 'daily-7', name: 'Seven Moons', description: 'Complete 7 different daily boards.' },
];

/* -------------------------------------------------------------- Daily */

/** Ruleset for a UTC day. `dateIso` is 'YYYY-MM-DD'. */
export function dailyConfig(dateIso, seed) {
  const tiers = ['small', 'medium', 'medium', 'large', 'medium', 'large', 'grand'];
  const day = new Date(dateIso + 'T00:00:00Z').getUTCDay();
  const tier = tiers[day];
  return {
    mode: 'daily', tier, seed,
    allowUndo: false, allowShuffle: true, allowHints: true,
    parMs: (tier === 'small' ? 5 : tier === 'medium' ? 8 : tier === 'large' ? 12 : 18) * 60 * 1000,
    dateIso,
  };
}
