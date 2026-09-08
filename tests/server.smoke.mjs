import assert from 'node:assert/strict';
import * as R from '../js/rules.js';
import * as C from '../js/content.js';

const base = process.env.QM_TEST_BASE || 'http://localhost:8080';
const d = await (await fetch(base + '/api/v1/daily')).json();
const cfg = { ...C.dailyConfig(d.date, d.seed), contentVersion: 1 };
const s = R.init(cfg);
const cmds = [];
let g = 0;
while (s.status === 'active' && g++ < 1000) {
  const p = R.legalPairs(s);
  if (!p.length) { R.apply(s, { t: 'shuffle' }); cmds.push({ t: 'shuffle' }); continue; }
  cmds.push({ t: 'tap', id: p[0][0] }, { t: 'tap', id: p[0][1] }, { t: 'tick', ms: 400 });
  R.apply(s, { t: 'tap', id: p[0][0] }); R.apply(s, { t: 'tap', id: p[0][1] }); R.apply(s, { t: 'tick', ms: 400 });
}
const post = (body) => fetch(base + '/api/v1/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const entry = {
  name: 'Tester', sessionId: 'sess-' + Date.now(), board: 'daily', date: d.date,
  score: R.totalScore(s), components: R.scoreBreakdown(s), ruleset: 1, contentVersion: 1,
  seed: d.seed, tier: cfg.tier, assists: { hints: 0, shuffles: s.shuffles, undos: 0 },
  durationMs: s.elapsedMs, config: cfg, commands: cmds,
};
const good = await post(entry); assert.equal(good.status, 200); assert.equal((await good.json()).ok, true);
assert.equal((await (await post(entry)).json()).duplicate, true);
const tampered = { ...entry, sessionId: 'other-' + Date.now(), score: entry.score + 5 };
const r3 = await post(tampered);
assert.equal(r3.status, 422); assert.equal((await r3.json()).error, 'score-mismatch');
for (const config of [{...entry.config, mode:'practice'}, {...entry.config, parMs:99999999}, {...entry.config, tier:'small'}]) {
  const changed = await post({...entry, sessionId: 'changed-'+Math.random(), config});
  assert.equal(changed.status,422);
}
const lb = await (await fetch(base + '/api/v1/leaderboard?board=daily&date=' + d.date)).json();
assert.ok(lb.entries.some(e => e.sessionId === entry.sessionId));
console.log('leaderboard:', JSON.stringify(lb.entries.map(e => [e.name, e.score])), 'label=' + lb.label);
console.log('achievement:', JSON.stringify(await (await fetch(base + '/api/v1/achievements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'first-clear' }) })).json()));
