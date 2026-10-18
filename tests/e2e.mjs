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
 * declared by starhermit.txt), but without a launch token the client makes
 * no own-server request at all and every mode works locally. This test
 * embeds a minimal node:http static server on an ephemeral port and asserts
 * it never sees an /api or /ws request.
 *
 * Run: npm run test:e2e  (or: node tests/e2e.mjs)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubStarHermit, launchToken } from './starhermit-e2e.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Screenshots go to $E2E_SHOT_DIR (default /tmp).
const SHOT = (stage, vp) => path.join(process.env.E2E_SHOT_DIR || '/tmp', `quiet-mahjong-e2e-${stage}-${vp}.png`);

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

const ownServerCalls = [];
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // Standalone the game must never call its own server.
    if (/^\/(api|ws)(\/|$)/.test(p)) ownServerCalls.push(p);
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

// ---------- graphics settings (title → Settings → Graphics) ----------
const gfxState = (page) => page.evaluate(() => ({
  preset: document.body.dataset.gfxPreset,
  bloom: document.body.dataset.gfxBloom,
  shadows: document.body.dataset.gfxShadows,
  quality: document.getElementById('set-quality').value,
  bloomSel: document.getElementById('set-gfx-bloom').value,
  summary: document.getElementById('gfx-summary').textContent,
}));

async function openGraphics(page) {
  await page.click('#btn-settings');
  await page.waitForFunction(() => !document.getElementById('screen-pause').hidden);
  if (!(await page.isVisible('#btn-settings-back'))) throw new Error('settings opened from title should offer Back');
  if (await page.isVisible('#btn-leave')) throw new Error('Leave round must be hidden outside a round');
  if (!(await page.evaluate(() => document.getElementById('settings-graphics').open))) {
    await page.click('#settings-graphics > summary');
  }
  await page.waitForSelector('#set-quality', { state: 'visible' });
}

async function graphicsFlow(page, name) {
  await openGraphics(page);
  const auto = await gfxState(page);
  if (auto.quality !== 'auto') throw new Error(`default quality should be auto, got ${auto.quality}`);
  await page.selectOption('#set-quality', 'low');
  await page.waitForFunction(() => document.body.dataset.gfxPreset === 'low');
  await page.selectOption('#set-quality', 'high');
  await page.waitForFunction(() => document.body.dataset.gfxPreset === 'high' && document.body.dataset.gfxShadows === 'medium');
  await page.selectOption('#set-gfx-bloom', 'off');
  await page.waitForFunction(() => document.body.dataset.gfxBloom === 'off');
  let st = await gfxState(page);
  if (!/2048² shadows/.test(st.summary) || /bloom/.test(st.summary)) throw new Error(`summary not updated: "${st.summary}"`);
  if (!/ · Level 0 · /.test(st.summary)) throw new Error(`summary lacks the hardware level: "${st.summary}"`);
  await page.waitForTimeout(600); // render a few High frames
  await page.screenshot({ path: SHOT('graphics', name) });
  ok(`${name}: Graphics panel — Low → High, bloom override applied ("${st.summary}")`);

  // Survives reload.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 15000 });
  st = await gfxState(page);
  if (st.preset !== 'high' || st.bloom !== 'off' || st.quality !== 'high' || st.bloomSel !== 'off') {
    throw new Error(`graphics settings not persisted: ${JSON.stringify(st)}`);
  }
  ok(`${name}: graphics settings persist across reload`);

  // Choosing a preset clears overrides; Ultra renders cleanly; back to Auto.
  await openGraphics(page);
  await page.selectOption('#set-quality', 'ultra');
  await page.waitForFunction(() => document.body.dataset.gfxPreset === 'ultra' && document.body.dataset.gfxBloom === 'on');
  if ((await gfxState(page)).bloomSel !== 'preset') throw new Error('preset change did not clear the bloom override');
  await page.waitForTimeout(600);
  await page.selectOption('#set-quality', 'auto');
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, auto.preset);
  await page.click('#btn-settings-back');
  await page.waitForFunction(() => !document.getElementById('screen-title').hidden);
  ok(`${name}: Ultra clears overrides, Auto restores "${auto.preset}", Back returns to title`);
}

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type()) || browserNoise.test(m.text())) return;
    const url = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && /\/favicon/.test(url)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    const p = r.url();
    if (r.status() >= 400 && !/\/favicon/.test(p)) errors.push(`http ${r.status()}: ${p}`);
  });

  try {
    // load + title
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('screen-title').hidden, null, { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('loading').hidden);
    await page.waitForSelector('#stage canvas', { state: 'attached', timeout: 10000 });
    await page.screenshot({ path: SHOT('title', name) });
    ok(`${name}: title screen visible (3D canvas attached)`);

    await graphicsFlow(page, name);

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

// ---------- language pass (desktop + mobile, signed in via a stubbed API) ----------
// Automatic follows the StarHermit preferred language (fr-CA); switching to
// Italian mid-round in the pause sheet re-renders it, the HUD and the tile
// mirror without ending the round and saves ui.language; Report a problem
// posts a bug report.
async function runLanguage(browser, name, ctxOpts) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() !== 'error' && m.type() !== 'warning') || browserNoise.test(m.text())) return;
    if (/Failed to load resource/.test(m.text()) && /\/favicon|\/sfx\//.test(m.location()?.url || '')) return;
    errors.push(`console ${m.type()}: ${m.text()}`);
  });
  const text = async (sel) => (await page.locator(sel).first().innerText()).trim();
  try {
    const calls = await stubStarHermit(page, { preferredLanguage: 'fr-CA' });
    await page.goto('about:blank');
    await page.goto(BASE + '/index.html#game_token=' + launchToken(), { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.lang === 'fr-CA');
    await page.waitForSelector('#btn-play', { state: 'visible', timeout: 20000 });
    if (await text('#btn-play') !== 'Jouer') throw new Error('title not in French: ' + await text('#btn-play'));
    if (await text('#btn-settings') !== 'Réglages') throw new Error('settings button not in fr-CA');
    ok(`${name}: Automatic resolves to the account language (fr-CA); title in French`);

    // Start a practice round in French, then pause it.
    await page.click('#btn-play');
    await page.click('#screen-modes .card[data-mode="practice"]');
    await page.waitForSelector('#screen-setup', { state: 'visible' });
    if (await text('#setup-heading') !== 'Entraînement') throw new Error('setup not in French');
    await page.click('#btn-start');
    await page.waitForFunction(() => /paires/.test(document.getElementById('hud-progress').textContent));
    const tiles = await page.locator('#board-mirror button').count();
    await page.click('#btn-pause');
    await page.waitForSelector('#screen-pause', { state: 'visible' });
    const choice = page.locator('#screen-pause [data-game-language="choice"]');
    await choice.scrollIntoViewIfNeeded();
    const auto = await choice.locator('option').first().textContent();
    if (!/^Automatique — Français \(Canada\)$/.test(auto)) throw new Error('Automatic label not resolved: ' + auto);
    if (await page.locator('[data-game-language="choice"]').count() !== 1) throw new Error('expected exactly one language selector');
    await choice.selectOption('it-IT');
    await page.waitForFunction(() => document.documentElement.lang === 'it-IT');
    await page.waitForFunction(() => /Salvato/.test(document.querySelector('[data-game-language="status"]').textContent));
    if (calls.settings['ui.language']?.choice !== 'it-IT') throw new Error('ui.language not saved: ' + JSON.stringify(calls.settings));
    if (await text('#pause-heading') !== 'In pausa') throw new Error('pause heading not re-rendered');
    if (await text('#btn-resume') !== 'Riprendi') throw new Error('resume button not re-rendered');
    await page.locator('#screen-pause').getByLabel('Movimento ridotto', { exact: true }).waitFor({ state: 'attached' });
    await page.locator('[data-game-report="title"]').scrollIntoViewIfNeeded();
    await page.fill('[data-game-report="title"]', 'Test report');
    await page.click('[data-game-report="send"]');
    await page.waitForFunction(() => /Grazie/.test(document.querySelector('[data-game-report="status"]').textContent));
    if (!calls.reports?.[0] || calls.reports[0].kind !== 'bug') throw new Error('report not posted');
    await choice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: SHOT('language', name) });
    const vw = page.viewportSize().width;
    for (const sel of ['[data-game-language="choice"]', '[data-game-report="send"]', '#set-quality']) {
      const b = await page.locator(sel).boundingBox();
      if (b && (b.x < 0 || b.x + b.width > vw + 1)) throw new Error(`${sel} cut off: ${JSON.stringify(b)}`);
    }

    // Back to the same round: Italian HUD, actions and tile mirror.
    await page.locator('#btn-resume').scrollIntoViewIfNeeded();
    await page.click('#btn-resume');
    await page.waitForSelector('#screen-pause', { state: 'hidden' });
    if (await text('#hud-objective') !== 'Svuota il tavolo') throw new Error('HUD objective not re-rendered');
    if (!/coppie/.test(await text('#hud-progress'))) throw new Error('HUD progress not re-rendered');
    if (await text('#btn-shuffle') !== 'Mescola') throw new Error('action bar not re-rendered');
    if (await page.locator('#board-mirror button').count() !== tiles) throw new Error('round changed by the language switch');
    const label = await page.locator('#board-mirror button').first().getAttribute('aria-label');
    if (!/livello/.test(label)) throw new Error('tile mirror not re-rendered: ' + label);
    await page.screenshot({ path: SHOT('language-hud', name) });
    ok(`${name}: Italian chosen mid-round — pause sheet, HUD and tile mirror re-rendered, ui.language saved, report sent`);

    // Back to Automatic → fr-CA.
    await page.click('#btn-pause');
    await page.waitForSelector('#screen-pause', { state: 'visible' });
    await choice.scrollIntoViewIfNeeded();
    await choice.selectOption('auto');
    await page.waitForFunction(() => document.documentElement.lang === 'fr-CA');
    if (calls.settings['ui.language']?.choice !== 'auto') throw new Error('ui.language auto not saved');
    if (await text('#pause-heading') !== 'En pause') throw new Error('pause heading not back in French');
    ok(`${name}: back to Automatic (fr-CA)`);
  } finally {
    await context.close();
  }
  if (errors.length) throw new Error(`${name} language pass had console output:\n  ${errors.join('\n  ')}`);
  console.log(`ok - ${name}: language pass, no console errors or warnings`);
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
  await runLanguage(browser, 'lang-desktop', { viewport: { width: 1280, height: 800 } });
  await runLanguage(browser, 'lang-mobile', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  if (ownServerCalls.length) throw new Error('standalone made own-server requests: ' + ownServerCalls.join(', '));
  console.log('ok - standalone load made zero same-origin /api or /ws requests');
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
