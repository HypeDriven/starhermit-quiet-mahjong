// Localization coverage: every English key the game's modules use is
// translated in every locale (en-GB → en-US, es-ES → es-419, fr-CA → fr-FR
// inherit), placeholders survive, the tables have no unused rows, content
// (lessons, stages, challenges, achievements, themes, tiers, score rows) is
// covered, regional tables inherit, and the game's own controls-line names
// cover the locales (account strings are the engine's starhermit.*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { codeKeys, audit, FULL } from './i18n-common.mjs';
import * as C from '../js/content.js';
import * as R from '../js/rules.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const TABLES = JSON.parse(read('assets/strings.json'));
/** The tables without the controls line's `sh.*` keys. */
const gameTables = () => Object.fromEntries(Object.entries(TABLES).map(([l, t]) => [l, Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith('sh.')))]));

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
  assert.deepEqual(audit(gameTables(), used), []);
});

test('regional tables list differences; the full locales translate', () => {
  assert.equal(TABLES['de-DE'].Paused, 'Pausiert');
  assert.equal(TABLES['fr-CA'].Score, 'Pointage');
  assert.equal(TABLES['fr-FR'].Paused, 'En pause');
  assert.equal(TABLES['en-GB']['Color palette'], 'Colour palette');
  assert.equal(TABLES['it-IT']['{n} pairs'], '{n} coppie');
});

test('the controls line names cover the full locales', () => {
  const keys = Object.keys(TABLES['en-US']).filter((k) => k.startsWith('sh.'));
  assert.ok(keys.length >= 11, 'sh keys: ' + keys.length);
  for (const l of FULL) for (const k of keys) assert.ok(TABLES[l][k], `${l} ${k}`);
});
