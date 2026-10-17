// Localization coverage: every English key the markup and code use is
// translated in every locale (en-GB → en-US, es-ES → es-419, fr-CA → fr-FR
// inherit), placeholders survive, content (lessons, stages, challenges,
// achievements, themes, tiers, score rows) is covered, and the language
// follows sh-language.js and switches live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTables, codeKeys, htmlKeys, audit, bootI18n, LOCALES } from './i18n-common.mjs';
import * as C from '../js/content.js';
import * as R from '../js/rules.js';
import { stringsFor } from '../js/gfx-i18n.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

function contentKeys() {
  return [
    ...C.LESSONS.flatMap((l) => [l.title, l.text]),
    ...C.JOURNEY_STAGES.map((s) => s.name),
    ...C.CHALLENGES.flatMap((c) => [c.name, c.description]),
    ...C.ACHIEVEMENTS.flatMap((a) => [a.name, a.description]),
    ...C.THEMES.map((t) => t.name),
    ...Object.values(R.LAYOUT_TIERS).map((t) => t.name),
    ...R.scoreBreakdown(R.init({ mode: 'practice', tier: 'small', seed: 1 })).map((c) => c.label),
  ];
}

function usedKeys() {
  const keys = new Set(htmlKeys(read('index.html')));
  for (const f of ['js/main.js', 'js/platform.js']) codeKeys(read(f)).forEach((k) => keys.add(k));
  contentKeys().forEach((k) => keys.add(k));
  return [...keys].sort();
}

test('every used key is translated in every locale; placeholders intact', () => {
  const used = usedKeys();
  assert.ok(used.length > 250, 'keys found: ' + used.length);
  assert.deepEqual(audit(loadTables(ROOT, 'js/strings.js', 'QM_STRINGS'), used), []);
});

test('the locale follows sh-language and switches live', () => {
  const { I18N, events, doc } = bootI18n(ROOT, { strings: 'js/strings.js', i18n: 'js/i18n.js', global: 'QMI18N', languages: ['de-DE'] });
  assert.equal(I18N.lang, 'de-DE');
  assert.equal(doc.documentElement.lang, 'de-DE');
  assert.equal(I18N.T('Paused'), 'Pausiert');
  I18N.language.setChoice('fr-CA');
  assert.equal(I18N.lang, 'fr-CA');
  assert.equal(events.at(-1), 'fr-CA');
  assert.equal(I18N.T('Score'), 'Pointage');
  assert.equal(I18N.T('Paused'), 'En pause');
  I18N.language.setChoice('en-GB');
  assert.equal(I18N.T('Color palette'), 'Colour palette');
  I18N.language.setChoice('it-IT');
  assert.equal(I18N.T('{n} pairs', { n: 24 }), '24 coppie');
});

test('Graphics and account strings cover all nine locales', () => {
  const keys = Object.keys(stringsFor('en-US'));
  for (const l of LOCALES) for (const k of keys) assert.ok(stringsFor(l)[k], `${l} ${k}`);
});
