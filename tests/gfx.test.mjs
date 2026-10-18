// Unit tests for the pure graphics quality model (js/gfx.js) and its strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// js/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../js/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const G = await import('../js/gfx.js');
const { translator, stringsFor, LOCALES } = await import('../js/gfx-i18n.js');

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(G.detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(G.detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(G.detectPreset('', DESK), 'low', 'no WebGL');
  assert.equal(G.detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(G.detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(G.detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(G.detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(G.LEVELS)) assert.equal(G.presetForLevel(lv), p);
  assert.equal(G.presetForLevel(3), 'low');
  assert.equal(G.presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(G.detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(G.detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(G.detectPreset('Apple M2', PHONE), 'balanced');
  assert.equal(G.detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['material', 'face', 'bevel', 'stone', 'sparks', 'fireflies', 'stars', 'bloomRes', 'aoRes'];
  for (const p of G.PRESETS) for (const k of keys) assert.ok(G.BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < G.PRESETS.length; i++) for (const k of keys) {
    if (typeof G.BUDGETS.low[k] === 'number') assert.ok(G.BUDGETS[G.PRESETS[i]][k] >= G.BUDGETS[G.PRESETS[i - 1]][k], `${G.PRESETS[i]}.${k}`);
  }
  assert.deepEqual(G.PRESETS.map((p) => G.BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(G.PRESETS.map((p) => G.BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], 'half-res bloom below Ultra');
  assert.deepEqual(G.resolve({ preset: 'high' }, 'low', 10).budget, G.BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(G.resolve({ preset: 'ultra' }, 'low', 0).budget, G.resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(G.budgetFor('balanced', 9).fireflies > G.budgetFor('balanced', 4).fireflies, 'counts scale up within the preset');
  assert.ok(G.budgetFor('ultra', 20).sparks <= G.SPARK_MAX && G.budgetFor('ultra', 20).fireflies <= G.FIREFLY_MAX);
  assert.equal(G.burstSize(G.resolve({ preset: 'high' }, 'low', 10)), G.BUDGETS.high.sparks);
  assert.equal(G.burstSize(G.resolve({ preset: 'balanced' }, 'low', 4)), Math.round(G.BUDGETS.balanced.sparks * 3 / 7));
  assert.equal(G.burstSize(G.resolve({ preset: 'low' }, 'low', 0)), 0, 'Low: particles off');
  assert.equal(G.resolve({}, 'low', 0).budget.material, 'lambert', 'headless SwiftShader: Low, Lambert');
});

test('resolve uses the detected preset for auto and honours overrides', () => {
  const auto = G.resolve({}, 'low');
  assert.equal(auto.preset, 'low');
  assert.equal(auto.auto, true);
  assert.equal(auto.shadows, 'off');
  assert.equal(auto.post, false, 'Low renders without post-processing');
  assert.equal(auto.dprCap, 1);

  const high = G.resolve({ preset: 'high' }, 'low');
  assert.equal(high.preset, 'high');
  assert.equal(high.auto, false);
  assert.equal(high.shadows, G.presetTier('high', 'shadows'));
  assert.equal(high.post, true);

  const over = G.resolve({ preset: 'high', bloom: 'off', shadows: 'bogus' }, 'low');
  assert.equal(over.bloom, 'off');
  assert.equal(over.shadows, 'medium', 'invalid override falls back to the preset tier');

  assert.equal(G.resolve({ preset: 'nonsense' }, 'ultra').preset, 'ultra');
  assert.equal(G.resolve({}, undefined).preset, 'balanced');
  assert.equal(G.resolve({}, 'low').adaptive, true);
  assert.equal(G.resolve({ adaptive: false, show_fps: true }, 'low').adaptive, false);
  assert.equal(G.resolve({ show_fps: true }, 'low').showFps, true);
});

test('render scale is clamped to 50–200% and multiplies the preset scale', () => {
  assert.equal(G.resolve({ preset: 'high', render_scale: 5 }, 'low').scale, 2);
  assert.equal(G.resolve({ preset: 'high', render_scale: 0.1 }, 'low').scale, 0.5);
  assert.equal(G.resolve({ preset: 'ultra', render_scale: 2 }, 'low').scale, 2.5);
  assert.equal(G.resolve({ preset: 'balanced' }, 'low').renderScale, 1);
});

test('choosing a preset clears overrides but keeps scale and toggles', () => {
  let s = G.setOverride({ preset: 'high', render_scale: 1.5, show_fps: true }, 'bloom', 'off');
  s = G.setOverride(s, 'particles', 'low');
  assert.equal(s.bloom, 'off');
  const next = G.choosePreset(s, 'low');
  assert.equal(next.preset, 'low');
  assert.equal(next.bloom, undefined);
  assert.equal(next.particles, undefined);
  assert.equal(next.render_scale, 1.5);
  assert.equal(next.show_fps, true);
  assert.equal(G.choosePreset({}, 'auto').preset, 'auto');
  assert.equal(G.setOverride({ bloom: 'off' }, 'bloom', 'preset').bloom, undefined);
});

test('every preset defines every category with an allowed tier', () => {
  for (const p of G.PRESETS) {
    for (const [cat, tiers] of Object.entries(G.CATEGORIES)) {
      assert.ok(tiers.includes(G.presetTier(p, cat)), `${p}.${cat}`);
    }
  }
});

test('describe summarises cost and pixels', () => {
  const d = G.describe(G.resolve({ preset: 'high' }, 'low'), [1280, 800]);
  assert.match(d, /2048² shadows/);
  assert.match(d, /SMAA/);
  assert.match(d, /1280×800 px/);
  assert.match(G.describe(G.resolve({}, 'low')), /no shadows · no anti-aliasing/);
});

test('graphics strings exist for every supported locale', () => {
  const keys = Object.keys(stringsFor('en-US'));
  for (const loc of LOCALES) {
    const s = stringsFor(loc);
    for (const k of keys) assert.ok(typeof s[k] === 'string' && s[k].length, `${loc} ${k}`);
  }
  assert.equal(translator('de-DE')('graphics'), 'Grafik');
  assert.equal(translator('fr-CA')('auto', { tier: 'Basse' }), 'Automatique (détectée : Basse)');
  assert.equal(translator('en-GB')('cat_grade'), 'Colour grade');
  assert.equal(translator('es-MX')('quality'), 'Calidad');
  assert.equal(translator('xx')('quality'), 'Quality');
});
