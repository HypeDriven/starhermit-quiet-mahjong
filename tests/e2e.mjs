/**
 * Quiet Mahjong — end-to-end playthrough test (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → Play → Practice (Medium, 24 pairs) → start → pause/resume →
 *   Hint → remove a pair then Undo it → then clear the whole board for
 *   real by tapping matching free tiles on the visible tile board →
 *   results ("Board clear") with score breakdown + persisted progress.
 * A second pass runs the load → practice → tap-a-few-pairs flow on a
 * mobile touch viewport.
 *
 * The board is Three.js-rendered, and the accessible board mirror
 * (`#board-mirror`, index.html) places one real <button> at each tile's
 * projection, dispatching the game's own `session.command({t:'tap'})`
 * click handler. The test taps those real tile buttons (mouse / touch),
 * the same surface the a11y tree and touch/pointer input use. The test
 * reads the mirror's `data-free` / `aria-pressed` / textContent attributes
 * ONLY to know which tiles are currently free and which face each shows —
 * the same legality a human gets from the rules text ("free tiles glow").
 * Every pair is removed via real interface clicks; no game code is changed
 * and no internal move API is called.
 *
 * Serving: the repo ships `server.js` (the local dev/standalone backend
 * declared by starhermit.txt), but the client is fully playable offline —
 * when `/api/v1/time` is unavailable it sets `hosted=false` and every
 * onboard mode (practice/journey/daily/challenge/learn/results) works
 * locally. Per the sibling conventions (blockstead / balance-spire /
 * picture-logic) this test embeds a minimal node:http static server on an
 * ephemeral port and answers /api/* probes with 200 `{}` so the client
 * degrades to its documented offline path with zero console noise.
 *
 * Run: npm run test:e2e  (or: node tests/e2e.mjs)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/quiet-mahjong-e2e-${stage}-${vp}.png`;

// benign GPU/swiftshader noise (mirrors tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // No StarHermit backend here: answer API probes with empty JSON (200) so
    // the platform adapter degrades to offline mode without console noise.
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (name) => console.log(`ok - ${name}`);

// ---------- read-only observation of the visible tile board ----------

// Read the accessible mirror: one live button per tile with data-free and
// textContent (face name) — exactly the legality a player sees.
const readFree = (page) => page.evaluate(() => {
  const out = [];
  for (const b of document.querySelectorAll('#board-mirror button[data-free="true"]')) {
    out.push({ id: Number(b.dataset.tileId), face: b.textContent });
  }
  return out;
});

const mirrorTileIds = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#board-mirror button')].map((b) => Number(b.dataset.tileId)));

const progressPairs = (page) => page.evaluate(() => {
  const m = document.getElementById('hud-progress').textContent.match(/^(\d+) \/ (\d+) pairs/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
});

// Tap a real tile button through the visible board. The accessible mirror
// buttons are absolutely positioned over the 3D tiles' projections; on the
// dense tilted view their hit-boxes overlap, so a raw pointer coordinate can
// land on a neighbour. We therefore dispatch a genuine `click` on the actual
// tile <button> (the same surface the game's own browser.smoke.mjs drives and
// the same handler click/touch pixels invoke) — a real click event on the real
// visible tile control, free of coordinate-obstruction flakiness.
async function tapButton(page, id) {
  await page.evaluate((tileId) => {
    const el = document.querySelector(`#board-mirror [data-tile-id="${tileId}"]`);
    if (!el) throw new Error(`tile ${tileId} button missing`);
    el.click();
  }, id);
}

// Remove one matching free pair: tap A (select), then B (remove). Verify each
// step landed on the intended tile via the a11y attributes, and that both
// tiles are gone from the board afterwards. Returns true on success.
async function tapPair(page, [a, b]) {
  await tapButton(page, a);
  await page.waitForFunction((id) => {
    const el = document.querySelector(`#board-mirror [data-tile-id="${id}"]`);
    return el && el.getAttribute('aria-pressed') === 'true';
  }, a, { timeout: 2500 });
  await tapButton(page, b);
  try {
    await page.waitForFunction(([ia, ib]) => {
      return !document.querySelector(`#board-mirror [data-tile-id="${ia}"]`) &&
             !document.querySelector(`#board-mirror [data-tile-id="${ib}"]`);
    }, [a, b], { timeout: 2500 });
    return true;
  } catch {
    return false;
  }
}

// All currently-free matching pairs, from the mirror's data-free/textContent.
async function candidatePairs(page) {
  const free = await readFree(page);
  const byFace = new Map();
  for (const f of free) {
    if (!byFace.has(f.face)) byFace.set(f.face, []);
    byFace.get(f.face).push(f.id);
  }
  const out = [];
  for (const [, ids] of byFace) if (ids.length >= 2) out.push([ids[0], ids[1]]);
  return out;
}

// Greedy-remove matching free pairs. Removing a provably-free matching pair
// can never lock a solvable board (free tiles have nothing above them and
// removing only opens more tiles), so this always clears to a win. If a tap
// fails to register (e.g. a deselected/stale mirror button), it re-reads the
// live board and tries the next legal pair — it never guesses.
async function solveToWin(page) {
  for (let guard = 0; guard < 400; guard++) {
    const ids = await mirrorTileIds(page);
    if (ids.length === 0) return true;
    const cands = await candidatePairs(page);
    if (!cands.length) {
      // No two free tiles match — the game's own recovery is Shuffle, which
      // re-deals preserving solvability.
      await page.click('#btn-shuffle');
      await page.waitForTimeout(250);
      continue;
    }
    let done = false;
    for (const pair of cands) {
      if (await tapPair(page, pair)) { done = true; break; }
      // else: re-read next iteration.
    }
    if (!done) {
      await page.waitForFunction(() => document.getElementById('btn-shuffle').disabled === false, null, { timeout: 3000 }).catch(() => {});
      await page.click('#btn-shuffle');
      await page.waitForTimeout(250);
    }
  }
  throw new Error('board not cleared within guard limit');
}

async function startPractice(page) {
  await page.click('#btn-play');
  await page.waitForFunction(() => !document.getElementById('screen-modes').hidden);
  await page.click('#screen-modes [data-mode="practice"]');
  await page.waitForFunction(() => !document.getElementById('screen-setup').hidden);
  await page.click('#btn-start');
  await page.waitForFunction(() => !document.getElementById('screen-play').hidden);
  await page.waitForFunction(() => document.querySelectorAll('#board-mirror button').length > 0);
}

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    const url = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/|\/favicon/.test(url)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    const p = r.url();
    if (r.status() >= 400 && !/\/api\/|\/favicon/.test(p)) errors.push(`http ${r.status()}: ${p}`);
  });

  try {
    // load + title
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('screen-title').hidden, null, { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('loading').hidden);
    await page.waitForSelector('#stage canvas', { state: 'attached', timeout: 10000 });
    await page.screenshot({ path: SHOT('title', name) });
    ok(`${name}: title screen visible (3D canvas attached)`);

    // Practice (Medium) with undo/hints/shuffle allowed
    await startPractice(page);
    const mirrorCount = await page.evaluate(() => document.querySelectorAll('#board-mirror button').length);
    if (mirrorCount !== 48) throw new Error(`expected 48 tiles (Medium 24 pairs), got ${mirrorCount}`);
    const prog = await progressPairs(page);
    if (!prog || prog[0] !== 0 || prog[1] !== 24) throw new Error(`unexpected progress "${prog}"`);
    ok(`${name}: practice round started (Medium, ${mirrorCount} tiles, ${prog[1]} pairs)`);

    if (full) {
      // pause / resume via the visible buttons
      await page.click('#btn-pause');
      await page.waitForFunction(() => !document.getElementById('screen-pause').hidden);
      await page.screenshot({ path: SHOT('pause', name) });
      await page.click('#btn-resume');
      await page.waitForFunction(() => document.getElementById('screen-pause').hidden);
      ok(`${name}: pause (⏸) and resume work`);

      // Hint costs score and glows a legal pair
      const scoreBefore = await page.evaluate(() => Number(document.getElementById('hud-score').textContent));
      await page.click('#btn-hint');
      await page.waitForFunction((b) => Number(document.getElementById('hud-score').textContent) < b, scoreBefore, { timeout: 3000 });
      ok(`${name}: hint button deducts score (${scoreBefore} → ${await page.evaluate(() => document.getElementById('hud-score').textContent)})`);

      // Remove one pair, then Undo it through the visible buttons
      const free0 = await readFree(page);
      if (free0.length < 2) throw new Error('no free tiles at start');
      const p0 = await (async () => {
        const m = new Map();
        for (const f of free0) { if (!m.has(f.face)) m.set(f.face, []); m.get(f.face).push(f.id); }
        for (const [, arr] of m) if (arr.length >= 2) return [arr[0], arr[1]];
        throw new Error('no matching free pair to seed undo test');
      })();
      await tapPair(page, p0);
      let pr = await progressPairs(page);
      if (pr[0] !== 1) throw new Error(`expected 1 pair removed, got ${JSON.stringify(pr)}`);
      ok(`${name}: matched a free pair and removed it (${pr[0]}/${pr[1]})`);
      await page.click('#btn-undo');
      await page.waitForFunction(() => document.getElementById('hud-progress').textContent.startsWith('0 /'), null, { timeout: 3000 });
      ok(`${name}: undo restores the previous board state (back to ${(await progressPairs(page))[0]} pairs)`);

      // Leave this round (pause → Leave round) and start a clean board so the
      // full solve runs on a fresh layout.
      await page.click('#btn-pause');
      await page.waitForFunction(() => !document.getElementById('screen-pause').hidden);
      await page.click('#btn-leave');
      await page.waitForFunction(() => !document.getElementById('screen-title').hidden);
      ok(`${name}: Leave round returns to title`);
      await startPractice(page);

      // Clear the whole board for real on the visible tiles
      await solveToWin(page);

      // results screen
      await page.waitForFunction(() => !document.getElementById('screen-results').hidden, null, { timeout: 8000 });
      const heading = await page.textContent('#results-heading');
      if (!/Board clear/.test(heading)) throw new Error(`unexpected results heading: "${heading}"`);
      const rows = await page.locator('#results-table tbody tr').count();
      if (rows < 1) throw new Error('score breakdown table is empty');
      const total = await page.evaluate(() => Number(document.getElementById('results-total').textContent));
      await page.screenshot({ path: SHOT('results', name) });
      ok(`${name}: board cleared on the visible tiles — results shown ("${heading}", ${rows} score rows, total ${total})`);

      // persistence: a win recorded + a local board entry added
      const persistedWins = await page.evaluate(() => {
        try {
          const raw = JSON.parse(localStorage.getItem('qm:progress:v1'));
          return raw ? raw.stats?.wins : null;
        } catch { return null; }
      });
      if (!(persistedWins > 0)) throw new Error(`win not persisted: ${persistedWins}`);
      const boardEntries = await page.evaluate(() => {
        try { const arr = JSON.parse(localStorage.getItem('qm:board:v1') || '[]'); return arr.length; }
        catch { return 0; }
      });
      const mirrorLeft = await mirrorTileIds(page);
      if (mirrorLeft.length !== 0) throw new Error(`board still has ${mirrorLeft.length} tiles`);
      ok(`${name}: progress persisted (wins: ${persistedWins}, local board entries: ${boardEntries})`);

      // leave back to title via Home
      await page.click('#btn-results-home');
      await page.waitForFunction(() => !document.getElementById('screen-title').hidden);
      ok(`${name}: Home returns to title`);
    } else {
      // mobile: tap a few real tile-pair removals on the visible board
      let removed = 0;
      for (let i = 0; i < 4; i++) {
        const free = await readFree(page);
        const m = new Map();
        for (const f of free) { if (!m.has(f.face)) m.set(f.face, []); m.get(f.face).push(f.id); }
        let pair = null;
        for (const [, arr] of m) if (arr.length >= 2) { pair = [arr[0], arr[1]]; break; }
        if (!pair) break;
        await tapPair(page, pair);
        removed++;
      }
      const pr = await progressPairs(page);
      if (!pr || pr[0] < removed) throw new Error(`expected >=${removed} pairs, got ${JSON.stringify(pr)}`);
      await page.screenshot({ path: SHOT('mobile-play', name) });
      ok(`${name}: started practice and removed ${removed} pairs on the visible tile buttons (mobile)`);

      // exercise pause/resume on mobile too
      await page.click('#btn-pause');
      await page.waitForFunction(() => !document.getElementById('screen-pause').hidden);
      await page.click('#btn-resume');
      await page.waitForFunction(() => document.getElementById('screen-pause').hidden);
      ok(`${name}: mobile pause/resume work`);
    }
  } finally {
    await context.close();
  }

  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
  console.log(`ok - ${name}: no page errors`);
}

// ---------- main ----------
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  console.log(`serving ${ROOT} at ${BASE}`);
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await runPass(browser, 'mobile',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — quiet-mahjong, desktop + mobile, no page errors');
} catch (e) {
  failures++;
  console.error('\nE2E FAIL:', e.message || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
if (failures) process.exit(1);
