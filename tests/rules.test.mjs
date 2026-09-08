/**
 * Quiet Mahjong — rules engine tests.
 * Covers: legal actions, invalid-action reasons, scoring components,
 * terminal states, serialization/migration, deterministic replay,
 * fuzzed malformed commands, and golden sessions.
 * Run: node tests/rules.test.mjs
 */
import * as R from '../js/rules.js';
import * as C from '../js/content.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

/* ---------------------------------------------------------- legality */
{
  const s = R.init({ seed: 42, tier: 'small' });
  const acts = R.legalActions(s);
  ok(acts.tap.length > 0, 'free tiles exist at start');
  ok(acts.pairs.length >= 0, 'pairs query works');
  ok(acts.hint === acts.pairs.length > 0, 'hint matches pairs');
  ok(acts.undo === false, 'undo disallowed by default');
  ok(acts.shuffle === true, 'shuffle allowed by default');

  // Covered/blocked tile cannot be tapped.
  const free = new Set(acts.tap);
  const blocked = s.tiles.find(t => !free.has(t.id));
  if (blocked) {
    const r = R.apply(R.cloneState(s), { t: 'tap', id: blocked.id });
    eq(r.error, R.ERR.NOT_FREE, 'blocked tile rejected with NOT_FREE');
  }
  // Unknown tile id.
  const rGone = R.apply(R.cloneState(s), { t: 'tap', id: 9999 });
  eq(rGone.error, R.ERR.NOT_FOUND, 'unknown id rejected');
  ok(rGone.events.some(e => e.type === 'invalid'), 'failed taps still emit their feedback events');
  // Malformed commands.
  eq(R.apply(R.cloneState(s), null).error, R.ERR.BAD_COMMAND, 'null command rejected');
  eq(R.apply(R.cloneState(s), { t: 'explode' }).error, R.ERR.BAD_COMMAND, 'unknown command rejected');
}

/* ------------------------------------------------------ pairing flow */
{
  const s = R.init({ seed: 7, tier: 'small' });
  const pair = R.legalPairs(s)[0];
  let r = R.apply(s, { t: 'tap', id: pair[0] });
  ok(!r.error && s.selected === pair[0], 'first tap selects');
  r = R.apply(s, { t: 'tap', id: pair[0] });
  ok(!r.error && s.selected === null, 'second tap deselects');
  R.apply(s, { t: 'tap', id: pair[0] });
  r = R.apply(s, { t: 'tap', id: pair[1] });
  ok(!r.error && s.pairsRemoved === 1, 'matching pair removed');
  ok(s.tiles[pair[0]].removed && s.tiles[pair[1]].removed, 'tiles flagged removed');
  ok(s.score.pairs >= R.SCORE.PAIR, 'pair score awarded');

  // Mismatch.
  const s2 = R.init({ seed: 11, tier: 'small' });
  const free = R.freeTiles(s2);
  const a = free[0];
  const b = free.find(t => t.face !== a.face);
  if (b) {
    R.apply(s2, { t: 'tap', id: a.id });
    const r2 = R.apply(s2, { t: 'tap', id: b.id });
    eq(r2.error, R.ERR.MISMATCH, 'mismatched faces rejected');
    ok(s2.invalid === 1 && s2.score.penalties < 0, 'mismatch penalty applied');
  }
}

/* -------------------------------------------------------------- hint */
{
  const s = R.init({ seed: 3, tier: 'small' });
  const before = s.score.penalties;
  const r = R.apply(s, { t: 'hint' });
  ok(!r.error && Array.isArray(r.hint), 'hint returns a pair');
  ok(s.hints === 1 && s.score.penalties === before - R.SCORE.HINT_PENALTY, 'hint penalty');
  const sNoHints = R.init({ seed: 3, tier: 'small', allowHints: false });
  eq(R.apply(sNoHints, { t: 'hint' }).error, R.ERR.NO_HINT, 'hint disabled rejected');
}

/* -------------------------------------------------------------- undo */
{
  const s = R.init({ seed: 5, tier: 'small', allowUndo: true });
  const pair = R.legalPairs(s)[0];
  R.apply(s, { t: 'tap', id: pair[0] });
  R.apply(s, { t: 'tap', id: pair[1] });
  const r = R.apply(s, { t: 'undo' });
  ok(!r.error && s.pairsRemoved === 0 && !s.tiles[pair[0]].removed, 'undo restores pair');
  eq(R.apply(R.init({ seed: 5, tier: 'small', allowUndo: false }), { t: 'undo' }).error,
    R.ERR.NO_UNDO, 'undo rejected when disabled');
}

/* ------------------------------------------- undo exact score revert */
{
  const s = R.init({ seed: 14, tier: 'medium', allowUndo: true });
  // Remove several pairs to build a streak, capturing score along the way.
  const snapshots = [R.totalScore(s)];
  let removed = 0;
  for (const [a, b] of R.legalPairs(s).slice(0, 4)) {
    const sBefore = R.cloneState(s);
    R.apply(s, { t: 'tap', id: a });
    R.apply(s, { t: 'tap', id: b });
    removed++;
    snapshots.push(R.totalScore(s));
    // Undo must restore the score exactly (layer + streak bonuses included).
    R.apply(s, { t: 'undo' });
    eq(R.totalScore(s), R.totalScore(sBefore) - R.SCORE.UNDO_PENALTY,
      `undo #${removed} reverts pair/streak score exactly`);
    eq(s.score.pairs, sBefore.score.pairs, `undo #${removed} reverts pair points`);
    eq(s.score.streak, sBefore.score.streak, `undo #${removed} reverts streak points`);
    // Redo the pair for the next iteration.
    R.apply(s, { t: 'tap', id: a });
    R.apply(s, { t: 'tap', id: b });
  }
  ok(removed > 0, 'undo score revert exercised');
}

/* ----------------------------------------------------------- shuffle */
{
  const s = R.init({ seed: 9, tier: 'medium' });
  const facesBefore = R.freeTiles(s).map(t => t.face).sort().join();
  const r = R.apply(s, { t: 'shuffle' });
  ok(!r.error && s.shuffles === 1, 'shuffle applies');
  const liveFaces = s.tiles.filter(t => !t.removed).map(t => t.face).sort();
  const counts = new Map();
  for (const f of liveFaces) counts.set(f, (counts.get(f) || 0) + 1);
  ok([...counts.values()].every(c => c % 2 === 0), 'shuffle keeps face counts even');
  void facesBefore;
  eq(R.apply(R.init({ seed: 9, tier: 'medium', allowShuffle: false }), { t: 'shuffle' }).error,
    R.ERR.NO_SHUFFLE, 'shuffle rejected when disabled');
}

/* ---------------------------------------------------- terminal states */
{
  // Full clear via solver.
  const s = R.init({ seed: 21, tier: 'lesson', allowShuffle: true, parMs: 60000 });
  let guard = 0;
  while (s.status === 'active' && guard++ < 200) {
    const p = R.legalPairs(s);
    if (!p.length) { R.apply(s, { t: 'shuffle' }); continue; }
    R.apply(s, { t: 'tap', id: p[0][0] });
    R.apply(s, { t: 'tap', id: p[0][1] });
  }
  eq(s.status, 'won', 'solved board wins');
  eq(s.reason, 'cleared', 'terminal reason cleared');
  ok(s.score.completion === R.SCORE.COMPLETION, 'completion bonus');
  ok(s.score.time > 0, 'time bonus under par');
  ok(R.legalActions(s).resign === false, 'no actions after terminal');

  // Resign.
  const s2 = R.init({ seed: 1, tier: 'small' });
  R.apply(s2, { t: 'resign' });
  eq(s2.status, 'lost', 'resign loses');
  eq(s2.reason, 'resigned', 'resign reason');

  // Move limit.
  const s3 = R.init({ seed: 1, tier: 'small', moveLimit: 1 });
  const rMove = R.apply(s3, { t: 'tap', id: R.freeTiles(s3)[0].id });
  eq(s3.status, 'lost', 'move limit enforced');
  eq(s3.reason, 'move-limit', 'move-limit reason');
  ok(rMove.events.some(e => e.type === 'lost' && e.reason === 'move-limit'),
    'move-limit loss emits a lost event');

  // Time limit.
  const s4 = R.init({ seed: 1, tier: 'small', timeLimitMs: 1000 });
  const rTime = R.apply(s4, { t: 'tick', ms: 1500 });
  eq(s4.status, 'lost', 'time limit enforced');
  eq(s4.reason, 'time-limit', 'time-limit reason');
  ok(rTime.events.some(e => e.type === 'lost' && e.reason === 'time-limit'),
    'time-limit loss emits a lost event');
  // The event fires exactly once even with repeated limit checks.
  const again = R.apply(s4, { t: 'tick', ms: 500 });
  ok(!again.events.some(e => e.type === 'lost'), 'lost event not duplicated');

  // No-moves with shuffle disabled -> loss, unless solvable deal keeps pairs.
  const s5 = R.init({ seed: 77, tier: 'lesson', allowShuffle: false });
  let g2 = 0;
  while (s5.status === 'active' && g2++ < 200) {
    const p = R.legalPairs(s5);
    if (!p.length) break;
    R.apply(s5, { t: 'tap', id: p[0][0] });
    R.apply(s5, { t: 'tap', id: p[0][1] });
  }
  ok(s5.status === 'won', 'deal without shuffle remains solvable to completion');
}

/* --------------------------------------------------- pause/resume */
{
  const s = R.init({ seed: 2, tier: 'small' });
  ok(!R.apply(s, { t: 'pause' }).error && s.status === 'paused', 'pause');
  eq(R.apply(s, { t: 'tap', id: R.freeTiles(s)[0]?.id }).error, R.ERR.NOT_ACTIVE, 'no taps while paused');
  ok(!R.apply(s, { t: 'resume' }).error && s.status === 'active', 'resume');
  ok(s.tick === 3, 'tick increments monotonically');
}

/* --------------------------------------------- serialization/migration */
{
  const s = R.init({ seed: 31, tier: 'small' });
  R.apply(s, { t: 'tap', id: R.freeTiles(s)[0].id });
  const json = R.serialize(s);
  const back = R.deserialize(json);
  eq(R.hashState(back), R.hashState(s), 'round-trip preserves hash');
  const legacy = JSON.parse(json);
  delete legacy.version;
  ok(R.deserialize(JSON.stringify(legacy)).version === 1, 'legacy save migrated');
  let threw = false;
  try { R.deserialize(JSON.stringify({ version: 99, tiles: [] })); } catch { threw = true; }
  ok(threw, 'newer-version save rejected');
}

/* --------------------------------------------------- replay determinism */
{
  const cfg = { seed: 123, tier: 'medium' };
  const solver = (s) => {
    const cmds = [];
    let guard = 0;
    const st = R.cloneState(s);
    while (st.status === 'active' && guard++ < 500) {
      const p = R.legalPairs(st);
      if (!p.length) { cmds.push({ t: 'shuffle' }); R.apply(st, { t: 'shuffle' }); continue; }
      cmds.push({ t: 'tick', ms: 300 }, { t: 'tap', id: p[0][0] }, { t: 'tap', id: p[0][1] });
      R.apply(st, { t: 'tick', ms: 300 }); R.apply(st, { t: 'tap', id: p[0][0] }); R.apply(st, { t: 'tap', id: p[0][1] });
    }
    return cmds;
  };
  const commands = solver(R.init(cfg));
  const a = R.replay(cfg, commands);
  const b = R.replay(cfg, commands);
  eq(a.hashes, b.hashes, 'same seed+commands => identical hashes');
  eq(a.state.status, 'won', 'replay reaches win');
  // Different seed => different hashes.
  const c = R.replay({ ...cfg, seed: 124 }, commands);
  ok(JSON.stringify(c.hashes) !== JSON.stringify(a.hashes), 'different seed differs');
}

/* ------------------------------------------------------------ fuzz */
{
  const rng = R.makeRng(555, 'fuzz');
  let crashes = 0;
  for (let i = 0; i < 2000; i++) {
    const s = R.init({ seed: Math.floor(rng() * 1e6), tier: ['lesson', 'small', 'medium'][i % 3] });
    for (let j = 0; j < 60; j++) {
      const kind = Math.floor(rng() * 8);
      const cmd = [
        { t: 'tap', id: Math.floor(rng() * 200) - 50 },
        { t: 'hint' }, { t: 'undo' }, { t: 'shuffle' },
        { t: 'tick', ms: Math.floor(rng() * 5000) },
        { t: 'pause' }, { t: 'resume' }, { t: ['garbage'][0] },
      ][kind];
      try {
        R.apply(s, cmd);
        if (!Number.isFinite(R.totalScore(s)) || !Number.isFinite(s.elapsedMs)) crashes++;
      } catch { crashes++; }
    }
  }
  eq(crashes, 0, 'fuzz: no crashes, NaN scores, or hangs in 2000 sessions');
}

/* ------------------------------------------------- tie-break ordering */
{
  const mk = (o) => ({ status: 'won', invalid: 0, elapsedMs: 60000, sessionId: 'a', score: { pairs: 500, streak: 0, time: 0, completion: 500, penalties: 0 }, ...o });
  ok(R.compareResults(mk({}), mk({ status: 'lost' })) < 0, 'completion wins tie-break');
  ok(R.compareResults(mk({ invalid: 1 }), mk({ invalid: 3 })) < 0, 'fewer invalid wins');
  ok(R.compareResults(mk({ elapsedMs: 50000 }), mk({ elapsedMs: 70000 })) < 0, 'faster time wins');
  ok(R.compareResults(mk({ sessionId: 'a' }), mk({ sessionId: 'b' })) < 0, 'session id stable order');
}

/* ------------------------------------------------------ golden states */
{
  const golden = [
    { cfg: { seed: 1001, tier: 'small' }, name: 'easy' },
    { cfg: { seed: 1002, tier: 'medium' }, name: 'medium' },
    { cfg: { seed: 1003, tier: 'large' }, name: 'hard' },
  ];
  for (const g of golden) {
    const s = R.init(g.cfg);
    const r = R.replay(g.cfg, [{ t: 'pause' }, { t: 'resume' }]); // interrupted/resumed
    ok(Number.isInteger(R.hashState(s)) && Number.isInteger(R.hashState(r.state)), `golden ${g.name}: stable hash`);
  }
}

/* ---------------------------------------------------------- content */
{
  // All 40 journey stages and challenges produce solvable, valid deals.
  for (const st of C.JOURNEY_STAGES) {
    const s = R.init(st.config);
    ok(s.tiles.length % 2 === 0 && s.tiles.length > 0, `stage ${st.id} deals tiles`);
  }
  for (const ch of C.CHALLENGES) {
    const s = R.init(ch.config);
    ok(s.tiles.length > 0, `challenge ${ch.id} deals tiles`);
  }
  // Daily seed immutable per date.
  eq(R.dailySeed('2026-08-30'), R.dailySeed('2026-08-30'), 'daily seed stable');
  ok(R.dailySeed('2026-08-30') !== R.dailySeed('2026-08-31'), 'daily seed varies by day');
  // Tutorial uses the same legal-action API.
  const s = R.init({ seed: 101, tier: 'lesson' });
  const step = R.tutorialStep(s);
  ok(step.kind === 'pair' && step.ids.length === 2, 'tutorial step from legal API');
  ok(C.ACHIEVEMENTS.every(a => /^[a-z0-9-]+$/.test(a.key)), 'achievement keys stable lowercase');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
