// Unit tests for the pure graphics quality model (js/gfx.js) and its strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/gfx.js';
import { translator, stringsFor, LOCALES } from '../js/gfx-i18n.js';

test('detectPreset maps GPU strings to tiers', () => {
  assert.equal(G.detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(G.detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(G.detectPreset('Apple M2'), 'high');
  assert.equal(G.detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(G.detectPreset('Adreno (TM) 650'), 'balanced');
  assert.equal(G.detectPreset(''), 'balanced');
  // Touch/mobile devices are capped at Balanced.
  assert.equal(G.detectPreset('Apple M2', { mobile: true }), 'balanced');
  assert.equal(G.detectPreset('SwiftShader', { mobile: true }), 'low');
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
