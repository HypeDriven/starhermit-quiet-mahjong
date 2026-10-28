// Plays the web package in Chrome on the machine's GPU (~/games/tools/
// gpu-chrome.mjs; GPU_ADAPTER=software for headless SwiftShader), the loader
// index.html that `npm run package` writes, at a desktop viewport, a phone
// (DPR 3) and a phone held sideways (DPR 3). Desktop: Journey stage 1 from
// the title, a drag orbit on the table (not a tap), a hint, the pause sheet,
// the board cleared by clicking the 3D tiles (found by their accessibility
// names) to the results. Phone: Lesson 1 from the mode cards by touch to the
// results, then the profile. Landscape: Moon Sprint (the timed challenge)
// cleared by touch against its clock.
// Screenshots of each step go to --shots. Fails on console errors or
// warnings, the runtime's error screen, or a round that does not finish.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
// Serves GAME_DIR on loopback (never tests/, tools/ or dot-names), the engine
// itself from wiki.starhermit.com as the loader pins it.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import * as C from '../js/content.js';
import { pressSequence } from './gen-plays.mjs';

const args = process.argv.slice(2);
const dir = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    for (const name of ['playwright-core', 'playwright']) {
      const p = join(r, 'node_modules', name);
      if (existsSync(p)) return createRequire(join(r, 'package.json'))(name);
    }
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  // The platform's clock (platform.serverTime / serverNow), as the game host answers it.
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const lesson = C.LESSONS[0];
const lessonCfg = { mode: 'learn', tier: lesson.tier, seed: lesson.seed, allowUndo: true, allowShuffle: true, allowHints: true, parMs: 5 * 60000 };
const desktop = [
  ['shot', 'title'], ['role', 'Journey'], ['wait', 1000], ['shot', 'journey'], ['role', '1. First Step. Lesson'], ['wait', 800], ['role', 'Start'], ['wait', 3000],
  ['drag'], ['wait', 600], ['key', 'KeyH'], ['wait', 600], ['shot', 'play'], ['key', 'Escape'], ['wait', 800], ['expect', 'Leave round'], ['shot', 'paused'],
  ['role', 'Resume'], ['wait', 800], ['key', 'KeyC'], ['wait', 300], ['tiles', pressSequence(C.JOURNEY_STAGES[0].config)], ['wait', 2000], ['expect', 'Every pair found'], ['shot', 'results'],
];
const phone = [
  ['shot', 'title'], ['role', 'Play'], ['wait', 1000], ['shot', 'modes'], ['role', 'Learn. Short interactive lessons, one rule at a time.'], ['wait', 3000], ['shot', 'lesson'],
  ['tiles', pressSequence(lessonCfg)], ['wait', 2000], ['expect', 'Every pair found'], ['shot', 'results'], ['role', 'Home'], ['wait', 1000], ['role', 'Profile'], ['wait', 1000], ['shot', 'profile'],
];
const sprint = C.CHALLENGES.find((c) => c.id === 'ch-speed');
const landscape = [
  ['shot', 'title'], ['role', 'Play'], ['wait', 1000], ['role', 'Challenge. Move limits, speed targets, restricted tools.'], ['wait', 1000], ['role', 'Moon Sprint. Beat the clock on a small board.'], ['wait', 800],
  ['shot', 'setup'], ['role', 'Start'], ['wait', 3000], ['shot', 'play'], ['tiles', pressSequence(sprint.config)], ['wait', 2000], ['expect', 'Every pair found'], ['expect', 'Time bonus'], ['shot', 'results'],
];
const views = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, steps: desktop },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, steps: phone },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, steps: landscape },
];

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const cdp = v.hasTouch ? await ctx.newCDPSession(page) : null;
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  await page.waitForTimeout(4000); // the first press can be lost while the runtime starts up
  const press = async (loc) => (v.hasTouch ? loc.tap({ timeout: 10000 }) : loc.click({ timeout: 10000 }));
  const seen = async (text) => (await page.getByText(text).count().catch(() => 0)) > 0 || (await page.getByLabel(text).count().catch(() => 0)) > 0;
  /** Taps or clicks a 3D tile's accessibility target (ui.target: a button in the a11y mirror) at its centre. */
  async function tile(t) {
    if (t === 'Shuffle') { await press(page.getByRole('button', { name: 'Shuffle', exact: true }).first()); return; }
    const box = await page.getByRole('button', { name: t.name, exact: true }).nth(t.nth - 1).boundingBox({ timeout: 10000 });
    if (!box) throw new Error(`tile not found: ${t.name} #${t.nth}`);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.mouse.click(x, y);
  }
  for (const [op, a] of v.steps) {
    try {
      if (op === 'key') { await page.keyboard.down(a); await page.waitForTimeout(80); await page.keyboard.up(a); await page.waitForTimeout(80); }
      if (op === 'wait') await page.waitForTimeout(a);
      if (op === 'wheel') { const vp = page.viewportSize(); await page.mouse.move(vp.width / 2, vp.height / 2); await page.mouse.wheel(0, a); }
      if (op === 'role') await press(page.getByRole('button', { name: a, exact: true }).first());
      if (op === 'tiles') for (const name of a) { await tile(name); await page.waitForTimeout(450); }
      if (op === 'drag') {
        // a drag past 12 px on the table orbits the camera; it is not a tap
        const vp = page.viewportSize();
        await page.mouse.move(vp.width * 0.2, vp.height * 0.7); await page.mouse.down();
        for (let i = 1; i <= 8; i++) { await page.waitForTimeout(16); await page.mouse.move(vp.width * 0.2 + i * 15, vp.height * 0.7); }
        await page.mouse.up();
      }
      if (op === 'expect' && !(await seen(a))) problems.push(`expected "${a}" on screen`);
      if (op === 'shot' && shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${a}.png`) }); }
    } catch (e) { problems.push(`${op} ${typeof a === 'string' ? a : JSON.stringify(a).slice(0, 80)}: ${e.message.split('\n')[0]}`); }
  }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state === 'running' && problems.length === 0;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
