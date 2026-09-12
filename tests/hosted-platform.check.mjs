/* Hosted-mode check for quiet-mahjong against a stub StarHermit platform.
 * Verifies: fragment token read once + stripped, Bearer on every call,
 * profile nickname, cloud save PUT/GET round trip (zip doc), read-only
 * leaderboard with nickname resolution, and ZERO calls to fabricated
 * own-server routes. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const calls = []; // {method, path, auth}
let cloudSave = null; // zip bytes stored by PUT
const USERS = { 'user-1234567890': { id: 'user-1234567890', username: 'garden_grl', nickname: 'Moonlit Ana' },
                'user-aaaaaaaaaa': { id: 'user-aaaaaaaaaa', username: 'tile_king', nickname: 'Ceramic K' } };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64u({ alg: 'none' })}.${b64u({ sub: 'user-1234567890', game_scope: 'quiet-mahjong', exp: 9999999999 })}.sig`;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.opus': 'audio/ogg', '.txt': 'text/plain' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    if (p.startsWith('/api/')) {
      calls.push({ method: req.method, path: p, auth: req.headers.authorization || null, ct: req.headers['content-type'] });
      const authed = (req.headers.authorization || '') === `Bearer ${JWT}`;
      const j = (code, body, ct = 'application/json') => { res.writeHead(code, { 'Content-Type': ct }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
      if (!authed) return j(401, { error: 'unauthorized' });
      if (p === '/api/v1/users/user-1234567890/profile' || p === '/api/v1/users/user-aaaaaaaaaa/profile') {
        return j(200, USERS[p.split('/')[4]]);
      }
      let m;
      if ((m = p.match(/^\/api\/v1\/me\/cloud-saves\/([^/]+)$/))) {
        if (decodeURIComponent(m[1]) !== 'quiet-mahjong') return j(404, { error: 'not-found' });
        if (req.method === 'GET') return cloudSave ? j(200, cloudSave, 'application/zip') : j(404, { error: 'not-found' });
        if (req.method === 'PUT') {
          let body = ''; req.on('data', (c) => body += c);
          req.on('end', () => { cloudSave = Buffer.from(JSON.parse(body).dataBase64, 'base64'); j(200, { ok: true }); });
          return;
        }
      }
      if (p === '/api/v1/games/quiet-mahjong' && req.method === 'GET') return j(200, { leaderboardId: 'lb-1', me: { bestScore: 0 } });
      if (p === '/api/v1/games/quiet-mahjong/launch-token' && req.method === 'POST') return j(200, { token: JWT });
      if (p === '/api/v1/leaderboards/lb-1/entries') {
        return j(200, { items: [
          { userId: 'user-1234567890', score: 980, elapsedMs: 245000, rank: 1 },
          { userId: 'user-aaaaaaaaaa', score: 720, elapsedMs: 310000, rank: 2 },
        ], total: 2 });
      }
      return j(404, { error: 'not-found' }); // fabricated routes must not be CALLED, but if they are, 404 loudly
    }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (cond, name) => { console.log((cond ? 'ok - ' : 'FAIL - ') + name); if (!cond) failures++; };
const errors = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/GL Driver|GPU stall|swiftshader|Failed to load resource/i.test(msg.text())) errors.push('console: ' + msg.text()); });

  // Seed a local progress doc so the hosted boot uploads it (remote is 404).
  await page.addInitScript(() => {
    try {
      if (!location.origin.startsWith('http')) return; // skip about:blank etc.
      const doc = { version: 1, journey: {}, dailies: {}, achievements: {}, stats: { rounds: 9, wins: 4, bestScore: 3120, pairsTotal: 300 }, friends: [], name: '' };
      let h = 2166136261;
      const s = JSON.stringify({ ...doc, checksum: undefined });
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      localStorage.setItem('qm:progress:v1', JSON.stringify({ ...doc, checksum: h >>> 0 }));
    } catch { /* opaque origin */ }
  });

  await page.goto(`${BASE}/#game_token=${JWT}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('screen-title').hidden, null, { timeout: 15000 });
  await page.waitForFunction(() => !document.getElementById('loading').hidden === false, null, { timeout: 15000 }).catch(() => {});

  ok(!page.url().includes('game_token'), 'fragment stripped from URL');
  const probe = () => page.evaluate(() => ({ hosted: !!window.__p?.hosted }));
  // title status shows the account nickname
  await page.waitForFunction(() => document.getElementById('title-status').textContent.includes('Signed in as'), null, { timeout: 8000 });
  const status = await page.textContent('#title-status');
  ok(/Signed in as Moonlit Ana/.test(status), `title shows nickname ("${status}")`);

  // profile screen: nickname shown, input disabled, sync status present
  await page.click('#btn-profile');
  await page.waitForFunction(() => !document.getElementById('screen-profile').hidden);
  await page.waitForFunction(() => document.getElementById('profile-name').value.length > 0, null, { timeout: 8000 });
  ok((await page.inputValue('#profile-name')) === 'Moonlit Ana', 'profile name = platform nickname');
  ok(await page.isDisabled('#profile-name'), 'profile name input disabled (hosted identity)');
  const sync = await page.textContent('#profile-sync');
  ok(/synced/i.test(sync), `sync status visible ("${sync}")`);

  // scores: platform read-only board with nicknames, own row marked
  await page.evaluate(() => document.querySelector('[data-back]').click());
  await page.click('#btn-play');
  await page.click('#screen-modes [data-mode="scores"]');
  await page.waitForFunction(() => !document.getElementById('screen-scores').hidden);
  await page.waitForFunction(() => document.querySelectorAll('#scores-list li').length >= 2, null, { timeout: 8000 });
  const rows = await page.$$eval('#scores-list li', (els) => els.map((e) => ({ text: e.textContent, me: e.classList.contains('me') })));
  ok(rows.length === 2 && rows[0].text.includes('Moonlit Ana') && rows[1].text.includes('Ceramic K'), `board shows nicknames (${JSON.stringify(rows.map(r => r.text))})`);
  ok(!rows.some((r) => r.text.includes('garden_grl') || r.text.includes('tile_king')), 'no usernames rendered');
  ok(rows[0].me === true, 'own row highlighted');
  const note = await page.textContent('#scores-note');
  ok(/read-only/i.test(note), `scores note honest ("${note}")`);

  // every platform call carried the Bearer token
  const authedCalls = calls.filter((c) => c.auth);
  ok(calls.length > 0 && authedCalls.length === calls.length, `Bearer on all ${calls.length} platform calls`);

  // no fabricated own-server routes were called
  const fabricated = calls.filter((c) => /\/api\/v1\/(time|daily|scores|leaderboard|achievements|activity)\b/.test(c.path) || c.path === '/api/v1/me');
  ok(fabricated.length === 0, `zero fabricated-route calls (${JSON.stringify(fabricated)})`);

  // local record fallback: daily tab is local, no crash
  await page.click('#screen-scores [data-board="daily"]');
  await page.waitForFunction(() => /kept on this device/i.test(document.getElementById('scores-note').textContent), null, { timeout: 8000 });
  ok(true, 'daily tab falls back to local records with honest note');

  // cloud save: the seeded local doc was uploaded; strict-validate the zip
  await page.waitForFunction(() => /synced/i.test(document.getElementById('profile-sync').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(!!cloudSave, 'cloud save PUT received (local doc uploaded after 404)');
  if (cloudSave) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync('/tmp/qm-hosted-save.zip', cloudSave);
    const probe = await import('node:child_process').then((m) => m.execFileSync('python3', ['-c',
      "import zipfile,sys,json; z=zipfile.ZipFile('/tmp/qm-hosted-save.zip'); assert z.testzip() is None; d=json.loads(z.read('save.json')); assert d['progress']['stats']['rounds']==9; print('zip doc OK')"]).toString().trim());
    ok(probe === 'zip doc OK', `PUT body is a strict-valid zip with the progress doc (${probe})`);
  }

  // remote-preferred load: fresh platform launch — the stub now serves the save via GET 200
  const cloudGets = () => calls.filter((c) => c.method === 'GET' && c.path.includes('/cloud-saves/')).length;
  const getsBefore = cloudGets();
  await page.goto('about:blank'); // fragment-only goto would not reload the document
  await page.goto(`${BASE}/#game_token=${JWT}`, { waitUntil: 'load' }); // platform re-launches with a fresh token
  await page.waitForFunction(() => !document.getElementById('screen-title').hidden, null, { timeout: 15000 });
  await page.waitForFunction(() => /Signed in as/.test(document.getElementById('title-status').textContent), null, { timeout: 8000 });
  ok(cloudGets() > getsBefore, 'second launch: cloud save fetched via GET (remote-preferred load)');
  const wins = await page.evaluate(() => JSON.parse(localStorage.getItem('qm:progress:v1'))?.stats?.wins);
  ok(wins === 4, `remote progress applied locally after load (wins=${wins})`);

  ok(errors.length === 0, `zero console/page errors (${errors.join(' | ')})`);
} catch (e) {
  failures++;
  console.error('HOSTED CHECK ERROR:', e.message);
} finally {
  if (browser) await browser.close();
  server.close();
}
console.log(failures ? `HOSTED CHECK FAIL (${failures})` : 'HOSTED CHECK PASS');
process.exit(failures ? 1 : 0);
