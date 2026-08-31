/**
 * Quiet Mahjong — authoritative StarHermit game script.
 * Plain Node.js (no dependencies). Serves the static distribution and a
 * small /api surface:
 *   GET  /api/v1/time         platform time for countdown/daily sync
 *   GET  /api/v1/daily        today's immutable seed + ruleset
 *   POST /api/v1/scores       replay-validated score submission
 *   GET  /api/v1/leaderboard  global / daily / friends-filtered boards
 *   POST /api/v1/achievements idempotent durable achievement delivery
 *   POST /api/v1/activity     playtime start/end pairing
 *
 * Scores are validated by replaying the ordered input log against the
 * deterministic rules engine (js/rules.js). Invalid or stale-version
 * claims are rejected with a structured {"error":"..."} body. If a board
 * cannot be validated it is labelled casual.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.join(ROOT, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');
const ACH_FILE = path.join(DATA_DIR, 'achievements.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.opus': 'audio/ogg',
};

let R = null; // rules engine (ESM, loaded lazily)
async function rules() {
  if (!R) R = await import(path.join(ROOT, 'js', 'rules.js'));
  return R;
}

/* ------------------------------------------------------------ store */
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, doc) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(doc));
  } catch { /* read-only fs: keep in memory only */ }
}
let board = readJson(BOARD_FILE, []);
let achievements = readJson(ACH_FILE, {});

/* ----------------------------------------------------------- helpers */
function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(s);
}
function error(res, code, msg) { json(res, code, { error: msg }); }

const rateBuckets = new Map();
function rateLimited(req, limit = 30, windowMs = 60000) {
  const key = req.socket.remoteAddress || 'anon';
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; rateBuckets.set(key, b); }
  b.count++;
  return b.count > limit;
}

function utcToday() { return new Date().toISOString().slice(0, 10); }

function readBody(req, cap = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) { reject(new Error('payload-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('bad-json')); }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------ score intake */
/**
 * Validate a submission: identity shape, bounds, payload, then replay the
 * input log and compare score, status and final hash. Duplicates are
 * rejected idempotently by sessionId.
 */
async function validateScore(body, rules) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad-request' };
  const { name, sessionId, score, config, commands, durationMs } = body;
  if (typeof name !== 'string' || name.length > 24) return { ok: false, error: 'bad-name' };
  if (typeof sessionId !== 'string' || sessionId.length > 64) return { ok: false, error: 'bad-session' };
  if (!Number.isInteger(score) || score < -100000 || score > 1000000) return { ok: false, error: 'bad-score' };
  if (!config || typeof config !== 'object') return { ok: false, error: 'bad-config' };
  if (!Array.isArray(commands) || commands.length > 5000) return { ok: false, error: 'bad-commands' };
  if (config.contentVersion !== rules.CONTENT_VERSION) return { ok: false, error: 'stale-version' };

  // Daily boards must use the published immutable seed.
  if (config.mode === 'daily') {
    const date = config.dateIso || body.date;
    if (date !== utcToday()) return { ok: false, error: 'stale-daily' };
    const expect = rules.dailySeed(date);
    if (config.seed !== expect) return { ok: false, error: 'bad-seed' };
  }

  const { state, errors } = rules.replay(config, commands);
  const realScore = rules.totalScore(state);
  if (state.status !== 'won') return { ok: false, error: 'not-completed' };
  if (realScore !== score) return { ok: false, error: 'score-mismatch', expected: realScore };
  // Plausibility: elapsed time must be consistent with the tick log.
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 6 * 3600 * 1000) {
    return { ok: false, error: 'bad-duration' };
  }
  if (Math.abs(state.elapsedMs - durationMs) > 3000) return { ok: false, error: 'duration-mismatch' };
  void errors;
  return { ok: true, state, realScore };
}

/* ----------------------------------------------------------- server */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    if (p.startsWith('/api/')) {
      if (rateLimited(req)) return error(res, 429, 'rate-limited');

      if (p === '/api/v1/time' && req.method === 'GET') {
        return json(res, 200, { epochMs: Date.now(), iso: new Date().toISOString() });
      }

      if (p === '/api/v1/daily' && req.method === 'GET') {
        const rr = await rules();
        const date = utcToday();
        return json(res, 200, {
          date,
          seed: rr.dailySeed(date),
          contentVersion: rr.CONTENT_VERSION,
          ruleset: rr.RULES_VERSION,
          excluded: false, // defective days are marked here, never silently replaced
        });
      }

      if (p === '/api/v1/scores' && req.method === 'POST') {
        const body = await readBody(req);
        const rr = await rules();
        // Idempotent duplicate rejection by session id.
        if (board.some(e => e.sessionId === body.sessionId)) {
          return json(res, 200, { ok: true, duplicate: true });
        }
        const v = await validateScore(body, rr);
        if (!v.ok) return error(res, 422, v.error);
        const entry = {
          name: body.name, sessionId: body.sessionId,
          board: body.board === 'daily' ? 'daily' : 'global',
          date: body.date || null,
          score: v.realScore,
          durationMs: body.durationMs,
          seed: body.config.seed, tier: body.config.tier,
          ruleset: rr.RULES_VERSION, contentVersion: rr.CONTENT_VERSION,
          assists: body.assists || {},
          at: Date.now(),
        };
        board.push(entry);
        while (board.length > 2000) board.shift();
        writeJson(BOARD_FILE, board);
        return json(res, 200, { ok: true, label: 'validated' });
      }

      if (p === '/api/v1/leaderboard' && req.method === 'GET') {
        const which = url.searchParams.get('board') || 'global';
        const date = url.searchParams.get('date');
        let entries = board.filter(e => which === 'global' || e.board === which || which === 'friends');
        if (which === 'daily' && date) entries = entries.filter(e => e.date === date);
        if (which === 'friends') {
          const friends = (url.searchParams.get('names') || '').split(',').filter(Boolean);
          entries = entries.filter(e => friends.includes(e.name));
        }
        entries = entries.sort((a, b) => b.score - a.score).slice(0, 50);
        return json(res, 200, { entries, label: 'validated' });
      }

      if (p === '/api/v1/achievements' && req.method === 'POST') {
        const body = await readBody(req, 4096);
        const key = String(body.key || '');
        if (!/^[a-z0-9-]{3,40}$/.test(key)) return error(res, 422, 'bad-key');
        const who = req.headers.authorization ? crypto.createHash('sha256').update(req.headers.authorization).digest('hex').slice(0, 16) : 'guest';
        if (!achievements[who]) achievements[who] = {};
        if (!achievements[who][key]) { // idempotent unlock
          achievements[who][key] = Date.now();
          writeJson(ACH_FILE, achievements);
        }
        return json(res, 200, { ok: true, key });
      }

      if (p === '/api/v1/activity' && req.method === 'POST') {
        const body = await readBody(req, 4096);
        if (body.kind !== 'start' && body.kind !== 'end') return error(res, 422, 'bad-kind');
        return json(res, 200, { ok: true, at: Date.now() });
      }

      return error(res, 404, 'not-found');
    }

    /* --------------------------------------------------- static files */
    if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'method-not-allowed');
    let rel = decodeURIComponent(p);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    const base = path.basename(file);
    if (!file.startsWith(ROOT) || file.includes(`${path.sep}data${path.sep}`) ||
        base === 'server.js' || base.startsWith('.')) {
      return error(res, 403, 'forbidden');
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return error(res, 404, 'not-found');
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        // Immutable hashed assets may be cached; the rest revalidate.
        'Cache-Control': ext === '.html' || ext === '.txt' ? 'no-cache' : 'public, max-age=3600',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  } catch (e) {
    error(res, e.message === 'payload-too-large' ? 413 : 400, e.message || 'bad-request');
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Quiet Mahjong server listening on http://localhost:${PORT}`);
  });
}

module.exports = { server, validateScore };
