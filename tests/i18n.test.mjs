// Localization coverage: every English key the game's modules use is
// translated in every locale (en-GB → en-US, es-ES → es-419, fr-CA → fr-FR
// inherit), placeholders survive, the tables have no unused rows, content
// (lessons, stages, challenges, achievements, themes, tiers, score rows) is
// covered, the locale switches live, and the account strings cover the nine
// locales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadTables, codeKeys, audit, bootI18n, LOCALES } from './i18n-common.mjs';
import { shStrings } from '../js/sh-strings.js';
import * as C from '../js/content.js';
import * as R from '../js/rules.js';

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
/** Keys the client draws: T()/N() in native/*.ts and the content. */
function usedKeys() {
  const keys = new Set();
  for (const f of readdirSync(new URL('native/', ROOT)).filter((f) => f.endsWith('.ts'))) codeKeys(read('native/' + f)).forEach((k) => keys.add(k));
  contentKeys().forEach((k) => keys.add(k));
  return [...keys].sort();
}

test('every used key is translated in every locale; placeholders intact; no unused rows', () => {
  const used = usedKeys();
  assert.ok(used.length > 200, 'keys found: ' + used.length);
  assert.deepEqual(audit(loadTables(ROOT, 'js/strings.js', 'QM_STRINGS'), used), []);
});

test('the locale switches live, regional tables inherit', () => {
  const { I18N } = bootI18n(ROOT, { strings: 'js/strings.js', i18n: 'js/i18n.js', global: 'QMI18N' });
  assert.equal(I18N.lang, 'en-US');
  assert.equal(I18N.setLocale('de-DE'), 'de-DE');
  assert.equal(I18N.T('Paused'), 'Pausiert');
  I18N.setLocale('fr-CA');
  assert.equal(I18N.T('Score'), 'Pointage');
  assert.equal(I18N.T('Paused'), 'En pause');
  I18N.setLocale('en-GB');
  assert.equal(I18N.T('Color palette'), 'Colour palette');
  I18N.setLocale('it-IT');
  assert.equal(I18N.T('{n} pairs', { n: 24 }), '24 coppie');
  assert.equal(I18N.setLocale('xx-YY'), 'en-US');
});

test('account strings cover all nine locales', () => {
  const keys = Object.keys(shStrings('en-US'));
  for (const l of LOCALES) for (const k of keys) assert.ok(shStrings(l)[k], `${l} ${k}`);
});
