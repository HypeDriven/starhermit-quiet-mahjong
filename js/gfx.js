/**
 * Quiet Mahjong — graphics quality model: presets, per-category overrides,
 * StarHermit hardware-level detection, per-preset budgets and a cost summary. Pure (no three.js, no DOM) so the
 * settings panel, the renderer and the unit tests agree on what a setting means.
 */

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],       // image-based lighting on tiles and table
  detail: ['plain', 'detailed'],    // rounded clear-coated tiles, textured stone, stars, props
  particles: ['off', 'low', 'high'],// match bursts
  background: ['static', 'animated'], // fireflies, lantern flicker, title orbit
};

// Each preset is a row of tiers, a render scale (multiplies the capped device
// pixel ratio) and a device-pixel-ratio cap.
const TABLE = {
  low: { scale: 1, dprCap: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'off', reflections: 'off', detail: 'plain', particles: 'off', background: 'static' },
  balanced: { scale: 1, dprCap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', detail: 'detailed', particles: 'low', background: 'animated' },
  high: { scale: 1, dprCap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' },
  ultra: { scale: 1.25, dprCap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; js/gpu-level.js → window.StarHermitGpu, a classic script loaded before the game): Low from 0,
// Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') };
  if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
  return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Tiles, layout, picking
 * and rules are identical on every preset — only visuals change.
 *   material  tile and garden shading: lambert (Low) / standard (Balanced) / clear-coated physical tiles
 *             (High, Ultra; Detail on)
 *   face      tile face canvas width in px (height 400/256 of it)
 *   bevel     rounded-tile bevel segments (Detail on)
 *   stone     table stone texture size in px (gravel ground: half; Detail on)
 *   sparks    sparks per match burst at Particles "high" (low: 3/7), scaled with the level
 *   fireflies drifting fireflies (Background animated), scaled with the level
 *   stars     sky star count (Detail on)
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', face: 128, bevel: 1, stone: 256, sparks: 40, fireflies: 24, stars: 180, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', face: 256, bevel: 2, stone: 256, sparks: 50, fireflies: 32, stars: 260, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', face: 256, bevel: 3, stone: 512, sparks: 70, fireflies: 42, stars: 360, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', face: 512, bevel: 4, stone: 1024, sparks: 100, fireflies: 64, stars: 600, bloomRes: 1, aoRes: 1 },
};
export const SPARK_MAX = 200;
export const FIREFLY_MAX = 128;
export const PARTICLE_POOL = 800;
const PARTICLE_SHARE = { off: 0, low: 3 / 7, high: 1 };

/** A preset's concrete budget for a hardware level (particle counts scale ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  b.fireflies = Math.min(FIREFLY_MAX, Math.round(b.fireflies * k));
  return b;
}

/** Sparks per match burst for a resolved setting (Particles tier share of the preset's budget). */
export function burstSize(r) {
  return Math.round(r.budget.sparks * (PARTICLE_SHARE[r.particles] ?? 0));
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const renderScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, renderScale, scale: row.scale * renderScale, dprCap: row.dprCap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; MSAA uses a multisampled target.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias !== 'off';
  return out;
}

/** Choosing a preset clears every per-category override (scale/toggles are kept). */
export function choosePreset(saved, preset) {
  const s = { ...(saved || {}) };
  for (const cat of Object.keys(CATEGORIES)) delete s[cat];
  s.preset = PRESETS.includes(preset) ? preset : 'auto';
  return s;
}

/** Set one category override ('preset' removes it). */
export function setOverride(saved, cat, tier) {
  const s = { ...(saved || {}) };
  if (!CATEGORIES[cat]) return s;
  if (CATEGORIES[cat].includes(tier)) s[cat] = tier;
  else delete s[cat];
  return s;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

/** Short cost summary. `t` optionally translates the English fragments. */
export function describe(r, pixels, t = (k, v) => v) {
  const parts = [
    r.shadows === 'off' ? t('noShadows', 'no shadows') : t('shadowsN', `${SHADOW_MAP[r.shadows]}² shadows`, SHADOW_MAP[r.shadows]),
    r.ao === 'off' ? null : r.ao === 'high' ? t('aoFull', 'full ambient occlusion') : t('ao', 'ambient occlusion'),
    r.bloom === 'on' ? t('bloom', 'bloom') : null,
    r.reflections === 'on' ? t('reflections', 'reflections') : null,
    r.antialias === 'off' ? t('noAa', 'no anti-aliasing') : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
