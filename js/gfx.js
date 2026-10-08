/**
 * Quiet Mahjong — graphics quality model: presets, per-category overrides,
 * GPU detection and a cost summary. Pure (no three.js, no DOM) so the
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
export const PARTICLE_BURST = { off: 0, low: 30, high: 70 };

/** Best preset for this GPU, from the unmasked renderer string when exposed. */
export function detectPreset(gpu, { mobile = false } = {}) {
  const g = String(gpu || '').toLowerCase();
  let p = 'balanced';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?!.*graphics)|apple m\d/.test(g)) p = 'high';
  // Touch/mobile devices never auto-select above Balanced.
  if (mobile && (p === 'high' || p === 'ultra')) p = 'balanced';
  return p;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const renderScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, renderScale, scale: row.scale * renderScale, dprCap: row.dprCap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
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
