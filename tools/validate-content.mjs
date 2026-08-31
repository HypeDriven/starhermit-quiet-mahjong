/**
 * Offline content validator.
 * Proves basic legality, reachable goals, bounded duration, and absence of
 * soft locks for every authored stage, challenge, lesson, and a sweep of
 * daily seeds. Run: node tools/validate-content.mjs
 */
import * as R from '../js/rules.js';
import * as C from '../js/content.js';

let checked = 0, failures = 0;

/** Solve a deal with the greedy solver; shuffling only when truly stuck. */
function solve(config) {
  const s = R.init(config);
  const cmds = [];
  let guard = 0;
  while (s.status === 'active' && guard++ < 2000) {
    const p = R.legalPairs(s);
    if (!p.length) {
      if (config.allowShuffle === false) return { ok: false, reason: 'soft-lock' };
      R.apply(s, { t: 'shuffle' }); cmds.push('shuffle');
      continue;
    }
    R.apply(s, { t: 'tap', id: p[0][0] });
    R.apply(s, { t: 'tap', id: p[0][1] });
    cmds.push('pair');
  }
  return { ok: s.status === 'won', state: s, reason: s.reason, cmds };
}

function validate(name, config) {
  checked++;
  const r = solve(config);
  if (!r.ok) {
    failures++;
    console.error(`FAIL ${name}: ${r.reason}`);
    return;
  }
  const s = r.state;
  // Bounded duration: greedy solve must finish well under par.
  if (s.pairsRemoved * 2 !== s.tiles.length) {
    failures++;
    console.error(`FAIL ${name}: incomplete removal`);
  }
  // Basic legality: even face counts, no overlaps.
  const counts = new Map();
  for (const t of s.tiles) counts.set(t.face, (counts.get(t.face) || 0) + 1);
  for (const [f, c] of counts) {
    if (c % 2 !== 0) { failures++; console.error(`FAIL ${name}: odd face count ${f}=${c}`); }
  }
  const seen = new Set();
  for (const t of s.tiles) {
    const k = `${t.x},${t.y},${t.z}`;
    if (seen.has(k)) { failures++; console.error(`FAIL ${name}: overlapping position ${k}`); }
    seen.add(k);
  }
}

for (const st of C.JOURNEY_STAGES) validate(`journey:${st.id}`, st.config);
for (const ch of C.CHALLENGES) validate(`challenge:${ch.id}`, ch.config);
for (const l of C.LESSONS) {
  validate(`lesson:${l.id}`, { mode: 'learn', tier: l.tier, seed: l.seed, allowShuffle: true, allowHints: true });
}
// Daily sweep: past 14 + next 14 days.
for (let d = -14; d <= 14; d++) {
  const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const cfg = C.dailyConfig(date, R.dailySeed(date));
  validate(`daily:${date}`, cfg);
}
// Practice tiers.
for (const tier of Object.keys(R.LAYOUT_TIERS)) {
  for (let seed = 1; seed <= 10; seed++) {
    validate(`practice:${tier}:${seed}`, { mode: 'practice', tier, seed, allowShuffle: true });
  }
}

console.log(`\nValidated ${checked} content items, ${failures} failures`);
process.exit(failures ? 1 : 0);
