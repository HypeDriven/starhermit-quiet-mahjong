/**
 * Quiet Mahjong — client application.
 * Modules in one file, organized by section:
 *   bootstrap / platform / settings+persistence / audio / render (Three.js)
 *   ui shell / session (commands, snapshots, replay log) / input / analytics
 *
 * Rules state is only mutated through rules.apply(). Rendering consumes
 * the state snapshot; UI state and simulation state are separate.
 */
import * as THREE from './three.module.min.js';
import * as R from './rules.js';
import * as C from './content.js';

/* ================================================== small utilities */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)) + Date.now().toString(16));

/* ======================================================= analytics */
/** Anonymous aggregate funnel events only: start, tutorial step, round
 * end, retry, settings change, error category. Local, short retention. */
const analytics = {
  key: 'qm:analytics:v1',
  push(type, detail = {}) {
    try {
      const list = JSON.parse(localStorage.getItem(this.key) || '[]');
      list.push({ t: Date.now(), type, ...detail, sid: analytics.sid });
      while (list.length > 200) list.shift();
      localStorage.setItem(this.key, JSON.stringify(list));
    } catch { /* storage unavailable */ }
  },
  sid: uuid(),
};

/* ======================================================= settings */
const DEFAULT_SETTINGS = {
  music: 60, effects: 80, ambience: 50, voice: 0, captions: false,
  quality: 'medium', theme: 'moonlit-garden',
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  highContrast: false, largeText: false, leftHanded: false,
  holdToggle: true, haptics: true, palette: 'standard',
  tutorialDone: false,
  keys: {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    confirm: 'Enter', cancel: 'Escape', pause: 'Escape',
    hint: 'h', undo: 'u', shuffle: 's', camera: 'c',
  },
  gamepad: { confirm: 0, cancel: 1, shuffle: 2, hint: 3, pause: 9, undo: 8 },
};
const settings = {
  data: { ...DEFAULT_SETTINGS },
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem('qm:settings:v1') || '{}');
      this.data = { ...DEFAULT_SETTINGS, ...raw, keys: { ...DEFAULT_SETTINGS.keys, ...(raw.keys || {}) } };
    } catch { this.data = { ...DEFAULT_SETTINGS }; }
  },
  save() {
    try { localStorage.setItem('qm:settings:v1', JSON.stringify(this.data)); } catch { /* ok */ }
  },
};

/* ====================================================== progression */
function progressChecksum(doc) {
  let h = 2166136261;
  const s = JSON.stringify({ ...doc, checksum: undefined });
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const progress = {
  data: { version: 1, journey: {}, dailies: {}, achievements: {}, stats: { rounds: 0, wins: 0, bestScore: 0, pairsTotal: 0 }, friends: [], name: '' },
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem('qm:progress:v1') || 'null');
      if (raw && raw.version === 1 && raw.checksum === progressChecksum(raw)) {
        const { checksum, ...rest } = raw; this.data = { ...this.data, ...rest };
      }
    } catch { /* fresh profile */ }
  },
  save() {
    try {
      const doc = { ...this.data };
      doc.checksum = progressChecksum(doc);
      localStorage.setItem('qm:progress:v1', JSON.stringify(doc));
    } catch { /* ok */ }
  },
};

/* ======================================================== platform */
/** Token-aware REST adapter. Launch token is read from the URL and never
 * persisted. Same-origin /api routes when hosted; offline otherwise. */
const platform = {
  online: false,
  token: null,
  timeOffset: 0,
  async init() {
    const url = new URL(location.href);
    this.token = url.searchParams.get('token'); // short-lived launch token
    if (url.searchParams.has('token')) {
      url.searchParams.delete('token');
      history.replaceState(null, '', url.pathname + url.search);
    }
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', { signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error('http');
      const body = await res.json();
      const t1 = Date.now();
      this.timeOffset = body.epochMs - Math.round((t0 + t1) / 2); // round-trip adjusted
      this.online = true;
    } catch {
      this.online = false;
    }
  },
  now() { return Date.now() + this.timeOffset; },
  utcToday() { return new Date(this.now()).toISOString().slice(0, 10); },
  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  },
  async api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: this.headers(), signal: AbortSignal.timeout(5000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `http-${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  },
  async getDaily() {
    const date = this.utcToday();
    if (this.online) {
      try {
        const d = await this.api('/api/v1/daily');
        return { date: d.date, seed: d.seed, excluded: !!d.excluded, config: C.dailyConfig(d.date, d.seed) };
      } catch (e) {
        if (e.status === 429) ui.toast('Server is busy; using local daily board.');
      }
    }
    return { date, seed: R.dailySeed(date), excluded: false, config: C.dailyConfig(date, R.dailySeed(date)) };
  },
  async submitScore(entry) {
    if (!this.online) return { ok: false, local: true };
    try {
      return await this.api('/api/v1/scores', { method: 'POST', body: JSON.stringify(entry) });
    } catch {
      return { ok: false, local: true };
    }
  },
  async leaderboard(board, date) {
    if (this.online) {
      try { return await this.api(`/api/v1/leaderboard?board=${board}${date ? `&date=${date}` : ''}`); }
      catch { /* fall through to local */ }
    }
    return { entries: localBoard.all(board), label: 'casual' };
  },
  activity(kind) {
    if (!this.online) return;
    this.api('/api/v1/activity', { method: 'POST', body: JSON.stringify({ kind }) }).catch(() => {});
  },
};

/* -------------------------------------------------- local leaderboard */
const localBoard = {
  key: 'qm:board:v1',
  all(board) {
    try {
      const list = JSON.parse(localStorage.getItem(this.key) || '[]');
      let out = list.filter(e => e.board === board || board === 'global');
      if (board === 'friends') out = list.filter(e => progress.data.friends.includes(e.name) || e.name === progress.data.name);
      return out.sort((a, b) => b.score - a.score).slice(0, 50);
    } catch { return []; }
  },
  add(entry) {
    try {
      const list = JSON.parse(localStorage.getItem(this.key) || '[]');
      list.push(entry);
      while (list.length > 200) list.shift();
      localStorage.setItem(this.key, JSON.stringify(list));
    } catch { /* ok */ }
  },
};

/* =========================================================== audio */
/** Original procedural audio: short transients tied to logical events,
 * quiet ambience loop, adaptive pad. Independent buses. */
const audio = {
  ctx: null, buses: {}, ambienceNode: null, musicTimer: null,
  // Authored one-shot samples (sfx/<name>.opus, see sfx/manifest.json) mapped
  // onto the logical events below. Samples are lazy-fetched after the audio
  // unlock; procedural synthesis stays as the fallback until a clip is ready
  // (or permanently if it cannot be loaded).
  sfx: {
    'select': ['tile-tap-select', 'ui-focus-tick'],
    'deselect': ['tile-tap-release'],
    'remove': ['tile-pair-chime', 'tile-pair-clack'],
    'invalid': ['invalid-dull-thud'],
    'hint': ['hint-glimmer'],
    'shuffle': ['tiles-shuffle-swish'],
    'undo': ['undo-reverse-tap'],
    'won': ['win-garden-chime'],
    'lost': ['lose-low-gong'],
    'pause': ['pause-soft-knock'],
  },
  sampleCache: new Map(), // name -> {buffer, failed, promise}
  samplePick: new Map(),  // event -> round-robin index
  ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const master = this.ctx.createGain();
      master.connect(this.ctx.destination);
      master.gain.value = 0.9;
      for (const b of ['music', 'effects', 'ambience', 'voice']) {
        const g = this.ctx.createGain();
        g.connect(master);
        g.gain.value = (settings.data[b] ?? 50) / 100;
        this.buses[b] = g;
      }
      this.startAmbience();
      this.startMusic();
      return true;
    } catch { return false; }
  },
  setBus(name, v) { if (this.buses[name]) this.buses[name].gain.value = v / 100; },
  tone(bus, freq, dur, { type = 'sine', gain = 0.2, slide = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.buses[bus]);
    o.start(t); o.stop(t + dur + 0.05);
  },
  noise(bus, dur, { gain = 0.15, freq = 1200, q = 1, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    const rng = R.makeRng(1234, 'audio-variant'); // seeded variants
    for (let i = 0; i < len; i++) d[i] = (rng() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.buses[bus]);
    src.start(t);
  },
  /** Returns the decoded sample buffer if cached, else kicks off a lazy
   * fetch/decode and returns null (caller falls back to synthesis). */
  sample(name) {
    if (!this.ctx) return null;
    let entry = this.sampleCache.get(name);
    if (!entry) {
      entry = { buffer: null, failed: false, promise: null };
      this.sampleCache.set(name, entry);
    }
    if (entry.buffer || entry.failed) return entry.buffer;
    if (!entry.promise) {
      entry.promise = fetch(`sfx/${name}.opus`)
        .then((r) => { if (!r.ok) throw new Error(`sfx ${name}: ${r.status}`); return r.arrayBuffer(); })
        .then((ab) => this.ctx.decodeAudioData(ab))
        .then((buf) => { entry.buffer = buf; })
        .catch(() => { entry.failed = true; });
    }
    return null;
  },
  /** Plays a cached sample through the effects bus; false if not ready. */
  playSample(name) {
    const buf = this.sample(name);
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.buses.effects);
    src.start();
    return true;
  },
  event(name) {
    if (!this.ensure()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const names = this.sfx[name];
    if (names) {
      // Prefer the mapped authored sample (round-robin over variants);
      // failed sample() lookups still lazy-load clips for later plays.
      const start = this.samplePick.get(name) || 0;
      for (let i = 0; i < names.length; i++) {
        const idx = (start + i) % names.length;
        if (this.playSample(names[idx])) {
          this.samplePick.set(name, (idx + 1) % names.length);
          if (settings.data.captions) ui.caption(name);
          return;
        }
      }
    }
    switch (name) {
      case 'select': this.tone('effects', 640, 0.08, { type: 'triangle', gain: 0.18 }); break;
      case 'deselect': this.tone('effects', 440, 0.07, { type: 'triangle', gain: 0.12 }); break;
      case 'remove':
        this.noise('effects', 0.12, { gain: 0.12, freq: 2400, q: 2 });
        this.tone('effects', 780, 0.14, { type: 'sine', gain: 0.2 });
        this.tone('effects', 1170, 0.2, { type: 'sine', gain: 0.14, delay: 0.06 });
        break;
      case 'invalid': this.tone('effects', 160, 0.12, { type: 'square', gain: 0.08, slide: -60 }); break;
      case 'shuffle': this.noise('effects', 0.3, { gain: 0.14, freq: 900, q: 0.8 }); break;
      case 'hint': this.tone('effects', 980, 0.25, { type: 'sine', gain: 0.12, slide: 200 }); break;
      case 'undo': this.tone('effects', 520, 0.12, { type: 'triangle', gain: 0.14, slide: -180 }); break;
      case 'won':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('effects', f, 0.35, { gain: 0.16, delay: i * 0.12 }));
        break;
      case 'lost': this.tone('effects', 220, 0.5, { type: 'sine', gain: 0.14, slide: -80 }); break;
      case 'pause': this.tone('effects', 330, 0.08, { gain: 0.1 }); break;
    }
    if (settings.data.captions) ui.caption(name);
  },
  startAmbience() {
    if (!this.ctx || this.ambienceNode) return;
    const len = this.ctx.sampleRate * 4;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    const rng = R.makeRng(99, 'ambience');
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.98 + (rng() * 2 - 1) * 0.02; d[i] = last * 3; }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    src.connect(f); f.connect(this.buses.ambience);
    src.start();
    this.ambienceNode = src;
  },
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    // Slow moonlit pad: two-note drone cycling through a pentatonic set.
    const notes = [220, 261.6, 293.7, 349.2, 392];
    let step = 0;
    const tickMusic = () => {
      if (!document.hidden && settings.data.music > 0) {
        const rng = R.makeRng(7 + step, 'music');
        const a = notes[Math.floor(rng() * notes.length)];
        const b = notes[Math.floor(rng() * notes.length)] * 2;
        this.tone('music', a, 4.5, { type: 'sine', gain: 0.05 });
        this.tone('music', b, 4.5, { type: 'sine', gain: 0.028, delay: 0.4 });
      }
      step++;
    };
    tickMusic();
    this.musicTimer = setInterval(tickMusic, 4600);
  },
};

/* ========================================================== render */
const TILE_W = 1.0, TILE_H = 0.42, TILE_D = 1.34, GAP = 0.08;
const LAYER_STEP = TILE_H + 0.06;

const render = {
  ok: false,
  three: null, camera: null, scene: null,
  tiles: new Map(), // id -> {mesh, ring}
  tileGeo: null, ringGeo: null,
  faceTex: new Map(),
  marker: null,
  particles: null, particlePool: [],
  camTarget: new THREE.Vector3(), camPos: new THREE.Vector3(),
  camGoal: { pos: new THREE.Vector3(), target: new THREE.Vector3(), moving: false },
  boardCenter: new THREE.Vector3(),
  hintIds: [], hintUntil: 0,
  quality: 'medium',
  theme: C.THEMES[0],

  init() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return false;
      this.three = new THREE.WebGLRenderer({ antialias: settings.data.quality === 'high', powerPreference: 'default' });
    } catch { return false; }
    this.applyQuality(settings.data.quality);
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.toneMapping = THREE.ACESFilmicToneMapping;
    this.three.toneMappingExposure = 1.05;
    $('stage').appendChild(this.three.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    this.tileGeo = new THREE.BoxGeometry(TILE_W, TILE_H, TILE_D);
    // Beveled edge illusion: slightly inset top face via second material slot.
    this.ringGeo = new THREE.RingGeometry(0.42, 0.55, 24);
    this.buildEnvironment();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.ok = true;
    return true;
  },

  applyQuality(q) {
    this.quality = q;
    if (!this.three) return;
    const dprCap = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1;
    this.three.setPixelRatio(Math.min(devicePixelRatio || 1, dprCap));
    this.three.shadowMap.enabled = q !== 'low';
    this.three.shadowMap.type = THREE.PCFShadowMap;
  },

  buildEnvironment() {
    const t = this.theme;
    const s = this.scene;
    s.background = new THREE.Color(t.sky);
    s.fog = new THREE.Fog(t.fog, 30, 90);

    // Key light: the moon.
    const moon = new THREE.DirectionalLight(0xcfe0ff, 1.6);
    moon.position.set(-8, 14, 6);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -12; moon.shadow.camera.right = 12;
    moon.shadow.camera.top = 12; moon.shadow.camera.bottom = -12;
    s.add(moon);
    s.add(new THREE.AmbientLight(t.glow, 0.25));
    const fill = new THREE.HemisphereLight(t.accent, t.ground, 0.35);
    s.add(fill);

    // Ground.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(60, 40),
      new THREE.MeshStandardMaterial({ color: t.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.55;
    ground.receiveShadow = true;
    s.add(ground);

    // Table.
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(9.5, 8.5, 0.5, 40),
      new THREE.MeshStandardMaterial({ color: t.table, roughness: 0.85, metalness: 0.05 }));
    table.position.y = -0.3;
    table.receiveShadow = true;
    s.add(table);

    // Garden props, procedurally placed with a decoration-only stream.
    const rng = R.makeRng(2024, 'decor');
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a4358, roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const r = 0.3 + rng() * 0.9;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), rockMat);
      const ang = rng() * Math.PI * 2;
      const dist = 11 + rng() * 14;
      rock.position.set(Math.cos(ang) * dist, -0.55 + r * 0.5, Math.sin(ang) * dist);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.castShadow = true;
      s.add(rock);
    }
    // Lanterns.
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0x553311, emissive: new THREE.Color(t.glow), emissiveIntensity: 0.9, roughness: 0.6 });
    for (const [x, z] of [[-10, -7], [10.5, -5], [0, 13]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 8),
        new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.9 }));
      pole.position.set(x, 0.75, z);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), lanternMat);
      lamp.position.set(x, 2.2, z);
      const light = new THREE.PointLight(t.glow, 2.5, 9);
      light.position.set(x, 2.3, z);
      s.add(pole, lamp, light);
    }
    // Moon disc in the sky.
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xf4f0e2 }));
    moonDisc.position.set(-26, 26, -34);
    moonDisc.lookAt(0, 4, 0);
    s.add(moonDisc);

    // Selection marker ring.
    this.marker = new THREE.Mesh(this.ringGeo,
      new THREE.MeshBasicMaterial({ color: t.accent, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    s.add(this.marker);

    // Particle pool (bounded, cosmetic; raycast disabled via layers).
    const pGeo = new THREE.BufferGeometry();
    const MAXP = 400;
    pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
    const pMat = new THREE.PointsMaterial({ color: t.accent, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false });
    this.particles = new THREE.Points(pGeo, pMat);
    this.particles.frustumCulled = false;
    this.particleData = [];
    this.scene.add(this.particles);
  },

  setTheme(theme) {
    this.theme = theme;
    if (!this.scene) return;
    document.body.dataset.theme = theme.id;
    const s = this.scene;
    s.clear();
    this.tiles.clear();
    this.faceTex.clear();
    this.buildEnvironment();
    if (session.state) this.syncBoard(session.state);
  },

  faceTexture(face) {
    if (this.faceTex.has(face)) return this.faceTex.get(face);
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 168;
    const g = cv.getContext('2d');
    const t = this.theme;
    const ceramic = '#' + new THREE.Color(t.tile).getHexString();
    const edge = '#' + new THREE.Color(t.tileEdge).getHexString();
    g.fillStyle = ceramic;
    g.fillRect(0, 0, 128, 168);
    g.strokeStyle = edge; g.lineWidth = 6;
    g.strokeRect(5, 5, 118, 158);
    // Family color band (color reinforced by glyph shape + name in DOM).
    const famColors = PALETTES[settings.data.palette] || PALETTES.standard;
    const fam = face.split('-')[0];
    g.fillStyle = famColors[fam] || '#557';
    g.fillRect(10, 138, 108, 16);
    g.fillStyle = '#1a2030';
    g.font = '72px serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(R.faceGlyph(face), 64, 78);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.faceTex.set(face, tex);
    return tex;
  },

  worldPos(tile) {
    return new THREE.Vector3(
      (tile.x - this.boardSpan.cx) * (TILE_W / 2 + GAP),
      tile.z * LAYER_STEP + TILE_H / 2,
      (tile.y - this.boardSpan.cy) * (TILE_D / 2 + GAP));
  },
  boardSpan: { cx: 0, cy: 0, w: 1, h: 1 },

  syncBoard(state) {
    if (!this.ok) return;
    // Board span for centering.
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const t of state.tiles) {
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    }
    this.boardSpan = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX + 2, h: maxY - minY + 2 };

    const seen = new Set();
    const free = new Set(R.freeTiles(state).map(t => t.id));
    for (const tile of state.tiles) {
      seen.add(tile.id);
      let entry = this.tiles.get(tile.id);
      if (tile.removed) {
        if (entry) { entry.mesh.visible = false; if (entry.ring) entry.ring.visible = false; }
        continue;
      }
      if (!entry) {
        const mat = new THREE.MeshStandardMaterial({
          map: this.faceTexture(tile.face), roughness: 0.35, metalness: 0.02,
        });
        const mesh = new THREE.Mesh(this.tileGeo, mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.tileId = tile.id;
        const ring = new THREE.Mesh(this.ringGeo,
          new THREE.MeshBasicMaterial({ color: this.theme.accent, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.visible = false;
        this.scene.add(mesh, ring);
        entry = { mesh, ring };
        this.tiles.set(tile.id, entry);
      }
      // Face can change after a shuffle.
      if (entry.mesh.material.map !== this.faceTexture(tile.face)) {
        entry.mesh.material.map = this.faceTexture(tile.face);
        entry.mesh.material.needsUpdate = true;
      }
      const p = this.worldPos(tile);
      const selected = state.selected === tile.id;
      const hinted = this.hintIds.includes(tile.id) && performance.now() < this.hintUntil;
      entry.mesh.visible = true;
      entry.mesh.position.set(p.x, p.y + (selected ? 0.16 : 0), p.z);
      entry.ring.position.set(p.x, tile.z * LAYER_STEP + 0.02, p.z);
      entry.ring.visible = free.has(tile.id) && !selected;
      entry.mesh.material.emissive = new THREE.Color(
        selected ? this.theme.accent : hinted ? this.theme.glow : 0x000000);
      entry.mesh.material.emissiveIntensity = selected ? 0.5 : hinted ? 0.35 : 0;
      entry.mesh.userData.free = free.has(tile.id);
    }
    // Hide meshes for tiles no longer in state (defensive).
    for (const [id, entry] of this.tiles) {
      if (!seen.has(id)) { this.scene.remove(entry.mesh, entry.ring); this.tiles.delete(id); }
    }
    // Marker under selection.
    if (state.selected != null) {
      const tile = state.tiles.find(t => t.id === state.selected);
      if (tile && !tile.removed) {
        const p = this.worldPos(tile);
        this.marker.position.set(p.x, tile.z * LAYER_STEP + 0.02, p.z);
        this.marker.visible = true;
      } else this.marker.visible = false;
    } else this.marker.visible = false;

    this.frameCamera();
  },

  frameCamera() {
    const w = this.boardSpan.w * (TILE_W / 2 + GAP);
    const h = this.boardSpan.h * (TILE_D / 2 + GAP);
    const r = Math.max(w, h) / 2 + 2.5;
    const aspect = innerWidth / Math.max(1, innerHeight);
    const dist = r / Math.tan((this.camera.fov * Math.PI / 180) / 2) / Math.min(aspect, 1.4);
    this.camGoal.pos.set(0, dist * 0.85, dist * 0.62);
    this.camGoal.target.set(0, 0, 0);
    if (!this.camGoal.moving) {
      this.camera.position.copy(this.camGoal.pos);
      this.camera.lookAt(this.camGoal.target);
    }
  },

  resetCamera() {
    this.camGoal.moving = false;
    this.frameCamera();
    audio.event('select');
  },

  burst(x, y, z) {
    if (settings.data.reducedMotion || this.quality === 'low') return;
    const rng = R.makeRng(Math.floor(x * 97 + z * 131 + performance.now() % 1000), 'vfx');
    const cap = this.quality === 'high' ? 60 : 30;
    for (let i = 0; i < cap && this.particleData.length < 400; i++) {
      this.particleData.push({
        x, y, z,
        vx: (rng() - 0.5) * 2.4, vy: rng() * 2.4 + 0.8, vz: (rng() - 0.5) * 2.4,
        life: 1,
      });
    }
  },

  updateParticles(dt) {
    if (!this.particles) return;
    const pos = this.particles.geometry.attributes.position;
    const arr = pos.array;
    let n = 0;
    for (const p of this.particleData) {
      p.life -= dt * 1.4;
      if (p.life <= 0) continue;
      p.vy -= dt * 3;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      arr[n * 3] = p.x; arr[n * 3 + 1] = p.y; arr[n * 3 + 2] = p.z;
      this.particleData[n] = p;
      n++;
    }
    this.particleData.length = n;
    pos.needsUpdate = true;
    this.particles.geometry.setDrawRange(0, n);
  },

  // Critically damped, interruptible camera motion — never cumulative lerp.
  updateCamera(dt) {
    if (!this.camGoal.moving) return;
    const k = settings.data.reducedMotion ? 1e9 : 4.5;
    const f = 1 - Math.exp(-k * dt);
    this.camera.position.lerp(this.camGoal.pos, f);
    this.camTarget.lerp(this.camGoal.target, f);
    this.camera.lookAt(this.camTarget);
    if (this.camera.position.distanceTo(this.camGoal.pos) < 0.01) this.camGoal.moving = false;
  },

  project(tile) {
    // Shared layout model: DOM mirror buttons align to projected 3D targets.
    const p = this.worldPos(tile);
    const v = p.clone().project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * innerWidth,
      y: (-v.y * 0.5 + 0.5) * innerHeight,
    };
  },

  pick(nx, ny) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const meshes = [];
    for (const entry of this.tiles.values()) if (entry.mesh.visible) meshes.push(entry.mesh);
    const hits = ray.intersectObjects(meshes, false);
    return hits.length ? hits[0].object.userData.tileId : null;
  },

  resize() {
    if (!this.three) return;
    this.three.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / Math.max(1, innerHeight);
    this.camera.updateProjectionMatrix();
    if (session.state) this.frameCamera();
  },

  frame(dt) {
    this.updateCamera(dt);
    this.updateParticles(dt);
    if (this.marker.visible && !settings.data.reducedMotion) {
      this.marker.material.opacity = 0.7 + 0.25 * Math.sin(performance.now() / 240);
    }
    this.three.render(this.scene, this.camera);
  },
};

/** Color-vision-safe family palettes (shape + label remain primary cues). */
const PALETTES = {
  standard:     { moon: '#5a6fa8', petal: '#a85a7a', wave: '#4a8a8a', stone: '#7a6a4a', wind: '#8a5aa8', star: '#a89a4a', lantern: '#a85a4a' },
  deuteranopia: { moon: '#4a6fd8', petal: '#d8b04a', wave: '#4aa8d8', stone: '#8a8a8a', wind: '#7a5ad8', star: '#d8d84a', lantern: '#b87a2a' },
  protanopia:   { moon: '#4a6fd8', petal: '#c8a84a', wave: '#4a9ad8', stone: '#8a8a8a', wind: '#6a5ad8', star: '#d8d84a', lantern: '#a8822a' },
  tritanopia:   { moon: '#4a8a9a', petal: '#c85a6a', wave: '#4ac8b8', stone: '#9a7a6a', wind: '#a85a8a', star: '#c8c8c8', lantern: '#c84a4a' },
};

/* =========================================================== session */
const session = {
  state: null,
  config: null,
  commands: [],          // ordered input log for replay validation
  commandIds: new Set(), // idempotent duplicate rejection
  sessionId: null,
  screenBefore: 'title',
  mode: null,
  contentRef: null,      // lesson/stage/challenge reference
  lastTickAt: 0,

  start(config, contentRef = null) {
    this.config = config;
    this.contentRef = contentRef;
    this.state = R.init(config);
    this.commands = [];
    this.commandIds.clear();
    this.sessionId = uuid();
    this.lastTickAt = performance.now();
    render.hintIds = [];
    ui.show('play');
    this.syncAll();
    ui.announce(`${config.mode} round started. ${this.state.tiles.length} tiles.`);
    analytics.push('start', { mode: config.mode, tier: config.tier });
    platform.activity('start');
    saveSnapshot();
  },

  /** All simulation mutation goes through here. */
  command(cmd) {
    if (!this.state) return { error: 'no-round' };
    if (cmd.id && this.commandIds.has(cmd.id)) return { error: 'duplicate' }; // idempotent
    if (cmd.id) this.commandIds.add(cmd.id);
    const r = R.apply(this.state, cmd);
    this.commands.push(cmd);
    this.handleEvents(r.events || []);
    if (r.error) this.explainError(r.error);
    this.syncAll();
    saveSnapshot();
    return r;
  },

  handleEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'select': audio.event('select'); input.haptic(8); break;
        case 'deselect': audio.event('deselect'); break;
        case 'remove': {
          audio.event('remove'); input.haptic(20);
          if (render.ok) {
            for (const id of e.ids) {
              const t = this.state.tiles.find(x => x.id === id);
              if (t && render.ok) { const p = render.worldPos(t); render.burst(p.x, p.y + 0.3, p.z); }
            }
          }
          ui.announce(`Removed pair ${R.faceName(e.face)}. ${this.state.pairsRemoved} pairs gone, streak ${e.streak}.`);
          break;
        }
        case 'invalid': audio.event('invalid'); input.haptic([30, 30, 30]); break;
        case 'hint': audio.event('hint'); render.hintIds = e.ids; render.hintUntil = performance.now() + 2200; break;
        case 'undo': audio.event('undo'); break;
        case 'shuffle': audio.event('shuffle'); break;
        case 'won': audio.event('won'); this.finish(); break;
        case 'lost': audio.event('lost'); this.finish(); break;
      }
    }
  },

  explainError(err) {
    const msg = {
      [R.ERR.NOT_FREE]: 'That tile is covered or blocked on both sides.',
      [R.ERR.MISMATCH]: 'Those faces do not match.',
      [R.ERR.NOT_FOUND]: 'That tile is already gone.',
      [R.ERR.NO_UNDO]: 'Undo is not available here.',
      [R.ERR.NO_SHUFFLE]: 'Shuffle is not available here.',
      [R.ERR.NO_HINT]: 'No hint available.',
      [R.ERR.MOVE_LIMIT]: 'Move limit reached.',
      [R.ERR.TIME_LIMIT]: 'Time is up.',
    }[err];
    if (msg) { ui.toast(msg); ui.alert(msg); }
  },

  /** Advance authoritative elapsed time in quantized units. */
  tick(now) {
    if (!this.state || this.state.status !== 'active') { this.lastTickAt = now; return; }
    const dt = now - this.lastTickAt;
    if (dt >= 250) {
      this.lastTickAt = now;
      const before = this.state.status;
      this.command({ t: 'tick', ms: Math.floor(dt) });
      if (before === 'active' && this.state.status === 'lost') this.finish();
    }
    ui.updateHud();
  },

  finish() {
    const s = this.state;
    analytics.push('round-end', { mode: s.config.mode, won: s.status === 'won', score: R.totalScore(s) });
    platform.activity('end');
    clearSnapshot();
    if (s.status === 'won') {
      progress.data.stats.wins++;
      const score = R.totalScore(s);
      progress.data.stats.bestScore = Math.max(progress.data.stats.bestScore, score);
      progress.data.stats.pairsTotal += s.pairsRemoved;
      checkAchievements(s);
      if (this.contentRef?.stageId) progress.data.journey[this.contentRef.stageId] = { score, ms: s.elapsedMs };
      if (s.config.mode === 'daily' && s.config.dateIso) progress.data.dailies[s.config.dateIso] = { score };
      progress.save();
      this.submitScore();
    }
    progress.data.stats.rounds++;
    progress.save();
    ui.showResults();
  },

  async submitScore() {
    const s = this.state;
    const entry = {
      name: progress.data.name || 'Guest',
      sessionId: this.sessionId,
      board: s.config.mode === 'daily' ? 'daily' : 'global',
      date: s.config.dateIso || null,
      score: R.totalScore(s),
      components: R.scoreBreakdown(s),
      ruleset: R.RULES_VERSION,
      contentVersion: s.config.contentVersion,
      seed: s.config.seed,
      tier: s.config.tier,
      assists: { hints: s.hints, shuffles: s.shuffles, undos: s.undos },
      durationMs: s.elapsedMs,
      config: s.config,
      commands: this.commands,
    };
    const res = await platform.submitScore(entry);
    if (!res.ok || res.local) localBoard.add(entry);
    else if (res.label === 'casual') ui.toast('Score recorded on the casual board.');
  },
};

/* --------------------------------------------- local round snapshot */
function saveSnapshot() {
  if (!session.state || session.state.status === 'won' || session.state.status === 'lost') return;
  try {
    localStorage.setItem('qm:save:v1', JSON.stringify({
      version: 1, config: session.config, commands: session.commands,
      contentRef: session.contentRef, at: Date.now(),
    }));
  } catch { /* ok */ }
}
function loadSnapshot() {
  try {
    const raw = JSON.parse(localStorage.getItem('qm:save:v1') || 'null');
    if (!raw || raw.version !== 1) return null;
    return raw;
  } catch { return null; }
}
function clearSnapshot() { try { localStorage.removeItem('qm:save:v1'); } catch { /* ok */ } }
function resumeSnapshot() {
  const snap = loadSnapshot();
  if (!snap) return false;
  const { state, errors } = R.replay(snap.config, snap.commands);
  void errors;
  session.config = snap.config;
  session.contentRef = snap.contentRef;
  session.state = state;
  session.commands = [...snap.commands];
  session.sessionId = uuid();
  session.lastTickAt = performance.now();
  ui.show('play');
  session.syncAll();
  ui.toast('Round restored from your last safe snapshot.');
  return true;
}
session.syncAll = function () {
  if (render.ok && this.state) render.syncBoard(this.state);
  ui.syncMirror();
  ui.updateHud();
  ui.updateActions();
};

/* ===================================================== achievements */
function unlock(key) {
  if (progress.data.achievements[key]) return; // idempotent
  progress.data.achievements[key] = Date.now();
  const def = C.ACHIEVEMENTS.find(a => a.key === key);
  ui.toast(`Achievement unlocked: ${def ? def.name : key}`);
  ui.announce(`Achievement unlocked: ${def ? def.name : key}`);
  if (platform.online) platform.api('/api/v1/achievements', { method: 'POST', body: JSON.stringify({ key }) }).catch(() => {});
}
function checkAchievements(s) {
  unlock('first-clear');
  if (s.hints === 0 && s.shuffles === 0 && s.undos === 0) unlock('mechanic-mastery');
  if (s.bestStreak >= 8) unlock('streak-8');
  if (session.contentRef?.mastery) unlock('mastery-stage');
  if (Object.keys(progress.data.journey).length >= C.JOURNEY_STAGES.length) unlock('journey-40');
  if (Object.keys(progress.data.dailies).length >= 7) unlock('daily-7');
  progress.save();
}

/* ============================================================== ui */
const ui = {
  screens: ['title', 'modes', 'setup', 'play', 'pause', 'results', 'help', 'scores', 'profile', 'compat'],
  current: 'title',
  lastFocus: null,
  pendingSetup: null,

  show(name) {
    const overPlay = ['pause', 'results', 'help'].includes(name) && session.state;
    for (const s of this.screens) {
      if (s === 'play') {
        $(`screen-play`).hidden = !(name === 'play' || overPlay) || !session.state;
      } else {
        $(`screen-${s}`).hidden = s !== name;
      }
    }
    this.current = name;
    const first = $(`screen-${name}`).querySelector('button:not([disabled]), input, select, [tabindex]');
    if (first) setTimeout(() => first.focus(), 30);
  },

  announce(msg) { $('live').textContent = msg; },
  alert(msg) { $('live-alert').textContent = msg; },
  toast(msg, ms = 2600) {
    const el = $('hud-message');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), ms);
  },
  caption(text) {
    const el = $('caption');
    el.textContent = `♪ ${text}`;
    clearTimeout(this._capT);
    this._capT = setTimeout(() => { el.textContent = ''; }, 1400);
  },

  updateHud() {
    const s = session.state;
    if (!s) return;
    const total = s.tiles.length / 2;
    $('hud-progress').textContent = `${s.pairsRemoved} / ${total} pairs · streak ${s.streak}`;
    $('hud-timer').textContent = fmtTime(s.elapsedMs);
    $('hud-score').textContent = String(R.totalScore(s));
    let limit = '';
    if (s.config.moveLimit != null) limit = `${Math.max(0, s.config.moveLimit - s.taps)} taps left`;
    if (s.config.timeLimitMs != null) limit = `${fmtTime(Math.max(0, s.config.timeLimitMs - s.elapsedMs))} left`;
    $('hud-limit').textContent = limit;
    $('hud-objective').textContent =
      s.status === 'won' ? 'Board clear!' :
      s.status === 'lost' ? 'Round over' :
      s.config.mode === 'learn' ? (session.contentRef?.text || 'Follow the lesson') :
      'Clear the board';
  },

  updateActions() {
    const s = session.state;
    if (!s) return;
    const acts = R.legalActions(s);
    $('btn-hint').disabled = !acts.hint;
    $('btn-shuffle').disabled = !acts.shuffle;
    $('btn-undo').disabled = !acts.undo;
    $('btn-hint').setAttribute('aria-disabled', String(!acts.hint));
  },

  /** Accessible board mirror: one button per live tile, positioned over its
   * 3D projection; free tiles announced. */
  syncMirror() {
    const s = session.state;
    const host = $('board-mirror');
    if (!s) { host.textContent = ''; this._mirrorSig = null; return; }
    // Rebuild only when the board model actually changes; per-frame ticks
    // just reposition, so keyboard focus is never destroyed mid-round.
    const sig = s.tiles.map(t => (t.removed ? 'x' : t.face)).join('|') + '#' + (s.selected ?? '-');
    const focusId = document.activeElement?.dataset?.tileId;
    if (sig === this._mirrorSig) { this.positionMirror(); return; }
    this._mirrorSig = sig;
    host.textContent = '';
    const free = new Set(R.freeTiles(s).map(t => t.id));
    for (const t of s.tiles) {
      if (t.removed) continue;
      const b = document.createElement('button');
      b.textContent = `${R.faceName(t.face)}${free.has(t.id) ? '' : ' (blocked)'}`;
      b.dataset.tileId = t.id;
      b.dataset.free = String(free.has(t.id));
      b.setAttribute('role', 'gridcell');
      b.setAttribute('aria-pressed', String(s.selected === t.id));
      b.setAttribute('aria-label',
        `${R.faceName(t.face)}, layer ${t.z + 1}${free.has(t.id) ? ', free' : ', blocked'}${s.selected === t.id ? ', selected' : ''}`);
      b.tabIndex = free.has(t.id) ? 0 : -1;
      b.addEventListener('click', () => session.command({ t: 'tap', id: t.id }));
      host.appendChild(b);
      if (focusId != null && Number(focusId) === t.id) b.focus();
    }
    this.positionMirror();
  },
  positionMirror() {
    const s = session.state;
    if (!s || !render.ok) return;
    for (const b of $('board-mirror').children) {
      const t = s.tiles.find(x => x.id === Number(b.dataset.tileId));
      if (!t || t.removed) { b.style.display = 'none'; continue; }
      const p = render.project(t);
      b.style.left = `${p.x}px`;
      b.style.top = `${p.y}px`;
    }
  },

  showResults() {
    const s = session.state;
    $('results-heading').textContent = s.status === 'won' ? 'Board clear' : 'Round over';
    $('results-sub').textContent = {
      cleared: 'Every pair found. The garden is quiet again.',
      'move-limit': 'The move limit was reached.',
      'time-limit': 'Time ran out.',
      'no-moves': 'No legal pairs remained.',
      resigned: 'You left the table early.',
    }[s.reason] || '';
    const tbody = $('results-table').querySelector('tbody');
    tbody.textContent = '';
    for (const c of R.scoreBreakdown(s)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<th scope="row"></th><td></td>`;
      tr.querySelector('th').textContent = c.label;
      tr.querySelector('td').textContent = String(c.value);
      tbody.appendChild(tr);
    }
    $('results-total').textContent = String(R.totalScore(s));
    const statBits = [`Time ${fmtTime(s.elapsedMs)}`, `${s.hints} hints`, `${s.shuffles} shuffles`, `${s.invalid} invalid taps`, `best streak ${s.bestStreak}`];
    $('results-progress').textContent = statBits.join(' · ');
    $('results-achievements').textContent = '';
    const next = this.nextRecommendation();
    $('btn-next').hidden = !next;
    if (next) $('btn-next').textContent = next.label;
    this._next = next;
    this.announce($('results-heading').textContent + '. ' + $('results-sub').textContent +
      ` Total score ${R.totalScore(s)}.`);
    this.show('results');
  },

  nextRecommendation() {
    const ref = session.contentRef;
    if (ref?.stageId) {
      const idx = C.JOURNEY_STAGES.findIndex(st => st.id === ref.stageId);
      if (idx >= 0 && idx + 1 < C.JOURNEY_STAGES.length) {
        const st = C.JOURNEY_STAGES[idx + 1];
        return { label: `Next: ${st.name}`, run: () => setupJourneyStage(st) };
      }
    }
    if (ref?.lessonId) {
      const idx = C.LESSONS.findIndex(l => l.id === ref.lessonId);
      if (idx >= 0 && idx + 1 < C.LESSONS.length) {
        const l = C.LESSONS[idx + 1];
        return { label: `Next lesson: ${l.title}`, run: () => startLesson(l) };
      }
    }
    return null;
  },

  async showScores(board = 'global') {
    for (const tab of document.querySelectorAll('#screen-scores .tab')) {
      tab.setAttribute('aria-selected', String(tab.dataset.board === board));
    }
    const res = await platform.leaderboard(board, platform.utcToday());
    $('scores-note').textContent = res.label === 'casual' || !platform.online
      ? 'Casual board — scores are recorded locally.'
      : 'Validated board — scores verified by replay on the server.';
    const ol = $('scores-list');
    ol.textContent = '';
    for (const e of (res.entries || []).slice(0, 20)) {
      const li = document.createElement('li');
      li.textContent = `${e.name} — ${e.score} (${fmtTime(e.durationMs || 0)})`;
      if (e.name === (progress.data.name || 'Guest')) li.classList.add('me');
      ol.appendChild(li);
    }
    if (!ol.children.length) {
      const li = document.createElement('li');
      li.textContent = 'No scores yet. Finish a board to post one.';
      ol.appendChild(li);
    }
    this.show('scores');
  },

  showProfile() {
    $('profile-name').value = progress.data.name || '';
    const st = progress.data.stats;
    $('profile-stats').textContent =
      `${st.rounds} rounds · ${st.wins} clears · best score ${st.bestScore} · ${st.pairsTotal} pairs total`;
    const ul = $('profile-achievements');
    ul.textContent = '';
    for (const a of C.ACHIEVEMENTS) {
      const li = document.createElement('li');
      const got = !!progress.data.achievements[a.key];
      li.className = got ? '' : 'locked';
      li.textContent = `${got ? '◆' : '◇'} ${a.name} — ${a.description}`;
      ul.appendChild(li);
    }
    this.show('profile');
  },
};

/* ============================================================ input */
const input = {
  focusId: null,
  pointers: new Map(),

  init() {
    const stage = $('stage');
    stage.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: false });
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (Math.hypot(dx, dy) > 12) p.moved = true;
      // Drag orbit (single pointer), never required for core play.
      if (p.moved && render.ok && !settings.data.reducedMotion) {
        render.camGoal.moving = true;
        const ang = dx * 0.004;
        const pos = render.camera.position;
        const r = Math.hypot(pos.x, pos.z);
        const a0 = Math.atan2(pos.z, pos.x) + ang;
        render.camGoal.pos.set(Math.cos(a0) * r, clamp(pos.y - dy * 0.02, 3, 40), Math.sin(a0) * r);
      }
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p || p.moved || performance.now() - p.t > 600) return;
      if (!render.ok || !session.state || session.state.status !== 'active') return;
      const nx = (e.clientX / innerWidth) * 2 - 1;
      const ny = -(e.clientY / innerHeight) * 2 + 1;
      const id = render.pick(nx, ny);
      if (id != null) session.command({ t: 'tap', id });
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId)); // cancel safely on lost capture

    addEventListener('keydown', (e) => this.key(e));
    this.gamepadLoop();
  },

  haptic(pattern) {
    if (settings.data.haptics && navigator.vibrate) navigator.vibrate(pattern);
  },

  /** Directional navigation among legal targets only. */
  freeSorted() {
    if (!session.state) return [];
    return R.freeTiles(session.state).sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  },

  moveFocus(dx, dy) {
    const free = this.freeSorted();
    if (!free.length) return;
    if (this.focusId == null || !free.some(t => t.id === this.focusId)) {
      this.focusId = free[0].id;
    } else {
      const cur = free.find(t => t.id === this.focusId);
      let best = null, bestD = 1e9;
      for (const t of free) {
        if (t.id === cur.id) continue;
        const vx = t.x - cur.x, vy = t.y - cur.y, vz = (t.z - cur.z) * 2;
        if (dx && Math.sign(vx || 0) !== dx && Math.abs(vx) > 0) continue;
        if (dy && Math.sign(vy || 0) !== dy && Math.abs(vy) > 0) continue;
        if (dx && vx === 0) continue;
        if (dy && vy === 0 && vz === 0) continue;
        const d = Math.hypot(vx, vy, vz);
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best) this.focusId = best.id;
      else {
        const i = free.findIndex(t => t.id === cur.id);
        this.focusId = free[(i + 1) % free.length].id;
      }
    }
    const btn = document.querySelector(`#board-mirror [data-tile-id="${this.focusId}"]`);
    if (btn) btn.focus();
  },

  key(e) {
    if (ui.current !== 'play') {
      if (e.key === 'Escape' && (ui.current === 'pause')) sessionResume();
      return;
    }
    const k = settings.data.keys;
    const map = {
      [k.up]: () => this.moveFocus(0, -1),
      [k.down]: () => this.moveFocus(0, 1),
      [k.left]: () => this.moveFocus(-1, 0),
      [k.right]: () => this.moveFocus(1, 0),
      [k.confirm]: () => { if (this.focusId != null) session.command({ t: 'tap', id: this.focusId }); },
      [k.hint]: () => session.command({ t: 'hint' }),
      [k.undo]: () => session.command({ t: 'undo' }),
      [k.shuffle]: () => session.command({ t: 'shuffle' }),
      [k.camera]: () => render.resetCamera(),
    };
    if (e.key === ' ') { e.preventDefault(); if (this.focusId != null) session.command({ t: 'tap', id: this.focusId }); return; }
    if (e.key === 'Escape') { sessionPause(); return; }
    const fn = map[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (fn) { e.preventDefault(); fn(); }
  },

  /** Gamepad: focus navigation, primary/secondary actions, pause.
   * Button mapping lives in settings.data.gamepad. */
  gamepadLoop() {
    const gp = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = [...pads].find(p => p && p.connected);
      if (pad && ui.current === 'play') {
        const m = settings.data.gamepad;
        const press = (i) => pad.buttons[i] && pad.buttons[i].pressed;
        const now = performance.now();
        if (!this._gpAt) this._gpAt = {};
        const once = (name, i, fn, gap = 220) => {
          if (press(i) && now - (this._gpAt[name] || 0) > gap) { this._gpAt[name] = now; fn(); }
        };
        once('confirm', m.confirm, () => this.focusId != null && session.command({ t: 'tap', id: this.focusId }));
        once('cancel', m.cancel, () => sessionPause());
        once('pause', m.pause, () => sessionPause());
        once('shuffle', m.shuffle, () => session.command({ t: 'shuffle' }));
        once('hint', m.hint, () => session.command({ t: 'hint' }));
        once('undo', m.undo, () => session.command({ t: 'undo' }));
        const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
        if (Math.abs(ax) > 0.6 && now - (this._gpAt.ax || 0) > 240) { this._gpAt.ax = now; this.moveFocus(Math.sign(ax), 0); }
        if (Math.abs(ay) > 0.6 && now - (this._gpAt.ay || 0) > 240) { this._gpAt.ay = now; this.moveFocus(0, Math.sign(ay)); }
        if (press(12)) once('u', 12, () => this.moveFocus(0, -1));
        if (press(13)) once('d', 13, () => this.moveFocus(0, 1));
        if (press(14)) once('l', 14, () => this.moveFocus(-1, 0));
        if (press(15)) once('r', 15, () => this.moveFocus(1, 0));
      }
      requestAnimationFrame(gp);
    };
    requestAnimationFrame(gp);
  },
};

/* ==================================================== round control */
function sessionPause() {
  if (!session.state || session.state.status !== 'active') return;
  session.command({ t: 'pause' });
  audio.event('pause');
  ui.show('pause');
}
function sessionResume() {
  if (!session.state || session.state.status !== 'paused') { ui.show('play'); return; }
  session.lastTickAt = performance.now();
  session.command({ t: 'resume' });
  ui.show('play');
}
function sessionLeave() {
  if (session.state && (session.state.status === 'active' || session.state.status === 'paused')) {
    session.command({ t: 'resign' });
  }
  session.state = null;
  clearSnapshot();
  ui.show('title');
}

/* ===================================================== mode setup */
function setupFacts(cfg, extra = []) {
  const facts = [
    ['Rules', 'Remove matching pairs of free tiles'],
    ['Duration', `about ${Math.round(cfg.parMs / 60000)} min (par)`],
    ['Players', '1'],
    ['Assists', [
      cfg.allowHints !== false ? 'hints' : null,
      cfg.allowShuffle !== false ? 'shuffles' : null,
      cfg.allowUndo ? 'undo' : null,
    ].filter(Boolean).join(', ') || 'none'],
    ['Ranked', (cfg.mode === 'daily' || cfg.mode === 'challenge') ? 'yes' : 'no'],
    ...extra,
  ];
  const dl = $('setup-facts');
  dl.textContent = '';
  for (const [k, v] of facts) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
}

function setupPractice() {
  ui.pendingSetup = { kind: 'practice', tier: 'medium' };
  $('setup-heading').textContent = 'Practice';
  $('setup-description').textContent = 'Relaxed play. Undo is allowed, restarts are free, and results never affect ratings.';
  setupFacts({ mode: 'practice', parMs: 8 * 60000, allowHints: true, allowShuffle: true, allowUndo: true });
  const host = $('setup-options');
  host.textContent = '';
  for (const tier of Object.keys(R.LAYOUT_TIERS)) {
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = `<strong>${R.LAYOUT_TIERS[tier].name}</strong><span>${R.LAYOUT_TIERS[tier].pairs} pairs</span>`;
    b.setAttribute('aria-pressed', String(tier === 'medium'));
    b.addEventListener('click', () => {
      ui.pendingSetup.tier = tier;
      for (const o of host.children) o.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
    });
    host.appendChild(b);
  }
  ui.show('modes'); // setup reachable via mode cards
  ui.show('setup');
}

function setupJourney() {
  ui.pendingSetup = { kind: 'journey' };
  $('setup-heading').textContent = 'Journey';
  $('setup-description').textContent = 'Forty authored stages. A new idea appears alone, combines with a known one, then a mastery stage tests both.';
  const host = $('setup-options');
  host.textContent = '';
  const done = progress.data.journey;
  const nextIdx = C.JOURNEY_STAGES.findIndex(st => !done[st.id]);
  for (const st of C.JOURNEY_STAGES) {
    const b = document.createElement('button');
    b.className = 'card';
    const cleared = !!done[st.id];
    b.innerHTML = `<strong>${st.index}. ${st.name}${st.mastery ? ' ◆' : ''}</strong><span>${cleared ? `cleared · ${done[st.id].score}` : R.LAYOUT_TIERS[st.config.tier].name}</span>`;
    b.addEventListener('click', () => setupJourneyStage(st));
    if (st.index === (nextIdx < 0 ? 40 : nextIdx + 1)) b.classList.add('primary');
    host.appendChild(b);
  }
  setupFacts(C.JOURNEY_STAGES[0].config, [['Stages', `${Object.keys(done).length} / 40 cleared`]]);
  ui.show('setup');
}

function setupJourneyStage(st) {
  ui.pendingSetup = { kind: 'journey-stage', stage: st };
  $('setup-heading').textContent = `${st.index}. ${st.name}`;
  $('setup-description').textContent = st.mastery ? 'Mastery stage — no hints, tighter par.' : 'Journey stage.';
  setupFacts(st.config, [['Theme', C.themeById(st.theme).name]]);
  $('setup-options').textContent = '';
  ui.show('setup');
}

function setupChallenge() {
  ui.pendingSetup = { kind: 'challenge' };
  $('setup-heading').textContent = 'Challenge';
  $('setup-description').textContent = 'Constrained goals: move limits, speed targets, restricted tools.';
  const host = $('setup-options');
  host.textContent = '';
  for (const ch of C.CHALLENGES) {
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = `<strong>${ch.name}</strong><span>${ch.description}</span>`;
    b.addEventListener('click', () => {
      ui.pendingSetup = { kind: 'challenge-one', challenge: ch };
      $('setup-heading').textContent = ch.name;
      $('setup-description').textContent = ch.description;
      setupFacts(ch.config, [['Theme', C.themeById(ch.theme).name]]);
      host.textContent = '';
    });
    host.appendChild(b);
  }
  setupFacts(C.CHALLENGES[0].config);
  ui.show('setup');
}

async function setupDaily() {
  const d = await platform.getDaily();
  ui.pendingSetup = { kind: 'daily', daily: d };
  $('setup-heading').textContent = `Daily — ${d.date}`;
  $('setup-description').textContent = d.excluded
    ? 'Today\'s board was marked defective and is excluded from ranking. You can still play it.'
    : 'One shared seed for everyone, synchronized to platform time. Ranked.';
  setupFacts(d.config, [['Seed', String(d.seed)], ['Board', R.LAYOUT_TIERS[d.config.tier].name]]);
  $('setup-options').textContent = '';
  ui.show('setup');
}

function startLesson(lesson) {
  const cfg = {
    mode: 'learn', tier: lesson.tier, seed: lesson.seed,
    allowUndo: true, allowShuffle: true, allowHints: true,
    parMs: 5 * 60000,
  };
  render.setTheme(C.themeById(settings.data.theme));
  session.start(cfg, { lessonId: lesson.id, text: lesson.text, mastery: false });
  ui.toast(lesson.text, 6000);
  analytics.push('tutorial-step', { lesson: lesson.id });
}

function startPending() {
  const p = ui.pendingSetup;
  if (!p) return;
  let cfg = null, ref = null;
  if (p.kind === 'practice') {
    cfg = { mode: 'practice', tier: p.tier, seed: (Math.random() * 0xffffffff) >>> 0,
      allowUndo: true, allowShuffle: true, allowHints: true, parMs: 8 * 60000 };
  } else if (p.kind === 'journey-stage') {
    cfg = { ...p.stage.config };
    ref = { stageId: p.stage.id, mastery: p.stage.mastery };
    render.setTheme(C.themeById(p.stage.theme));
  } else if (p.kind === 'challenge-one') {
    cfg = { ...p.challenge.config };
    ref = { challengeId: p.challenge.id };
    render.setTheme(C.themeById(p.challenge.theme));
  } else if (p.kind === 'daily') {
    cfg = { ...p.daily.config };
    ref = { date: p.daily.date };
  }
  if (!cfg) return;
  if (!ref) render.setTheme(C.themeById(settings.data.theme));
  session.start(cfg, ref);
}

/* ============================================================ wire */
function wire() {
  $('btn-play').addEventListener('click', () => { audio.ensure(); ui.show('modes'); });
  $('btn-daily').addEventListener('click', () => { audio.ensure(); setupDaily(); });
  $('btn-journey').addEventListener('click', () => { audio.ensure(); setupJourney(); });
  $('btn-profile').addEventListener('click', () => ui.showProfile());
  for (const b of document.querySelectorAll('#screen-modes .card')) {
    b.addEventListener('click', () => {
      const m = b.dataset.mode;
      if (m === 'learn') startLesson(C.LESSONS[settings.data.tutorialDone ? 1 : 0]);
      else if (m === 'journey') setupJourney();
      else if (m === 'daily') setupDaily();
      else if (m === 'practice') setupPractice();
      else if (m === 'challenge') setupChallenge();
      else if (m === 'scores') ui.showScores('global');
    });
  }
  for (const b of document.querySelectorAll('[data-back]')) {
    b.addEventListener('click', () => {
      if (ui.current === 'help' && session.state) { ui.show('pause'); return; }
      if (ui.current === 'setup') { ui.show('modes'); return; }
      ui.show('title');
    });
  }
  $('btn-start').addEventListener('click', startPending);
  $('btn-pause').addEventListener('click', sessionPause);
  $('btn-resume').addEventListener('click', sessionResume);
  $('btn-leave').addEventListener('click', sessionLeave);
  $('btn-help').addEventListener('click', () => ui.show('help'));
  $('btn-replay-tutorial').addEventListener('click', () => startLesson(C.LESSONS[0]));
  $('btn-hint').addEventListener('click', () => session.command({ t: 'hint' }));
  $('btn-shuffle').addEventListener('click', () => session.command({ t: 'shuffle' }));
  $('btn-undo').addEventListener('click', () => session.command({ t: 'undo' }));
  $('btn-camera').addEventListener('click', () => render.resetCamera());
  $('btn-retry').addEventListener('click', () => {
    analytics.push('retry', { mode: session.config?.mode });
    if (session.config) session.start({ ...session.config }, session.contentRef);
  });
  $('btn-next').addEventListener('click', () => { if (ui._next) ui._next.run(); });
  $('btn-results-home').addEventListener('click', sessionLeave);
  $('btn-compat-continue').addEventListener('click', () => {
    document.body.classList.add('mirror-visible');
    ui.show('title');
  });
  for (const tab of document.querySelectorAll('#screen-scores .tab')) {
    tab.addEventListener('click', () => ui.showScores(tab.dataset.board));
  }
  $('profile-name').addEventListener('change', (e) => {
    progress.data.name = e.target.value.slice(0, 24);
    progress.save();
  });

  // Settings wiring.
  const s = settings.data;
  const bindRange = (id, key) => {
    const el = $(id);
    el.value = s[key];
    el.addEventListener('input', () => {
      s[key] = Number(el.value);
      audio.setBus(key.replace('set-', ''), s[key]);
      settings.save(); analytics.push('settings-change', { key });
    });
  };
  bindRange('set-music', 'music'); bindRange('set-effects', 'effects');
  bindRange('set-ambience', 'ambience'); bindRange('set-voice', 'voice');
  const bindCheck = (id, key, fn) => {
    const el = $(id);
    el.checked = s[key];
    el.addEventListener('change', () => {
      s[key] = el.checked; settings.save();
      if (fn) fn();
      analytics.push('settings-change', { key });
    });
  };
  bindCheck('set-captions', 'captions');
  bindCheck('set-reduced-motion', 'reducedMotion');
  bindCheck('set-high-contrast', 'highContrast', () => document.body.classList.toggle('high-contrast', s.highContrast));
  bindCheck('set-large-text', 'largeText', () => document.body.classList.toggle('large-text', s.largeText));
  bindCheck('set-left-handed', 'leftHanded', () => document.body.classList.toggle('left-handed', s.leftHanded));
  bindCheck('set-hold-toggle', 'holdToggle');
  bindCheck('set-haptics', 'haptics');
  $('set-quality').value = s.quality;
  $('set-quality').addEventListener('change', () => {
    s.quality = $('set-quality').value;
    render.applyQuality(s.quality);
    settings.save();
  });
  const themeSel = $('set-theme');
  for (const t of C.THEMES) {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = t.name;
    themeSel.appendChild(o);
  }
  themeSel.value = s.theme;
  themeSel.addEventListener('change', () => {
    s.theme = themeSel.value;
    render.setTheme(C.themeById(s.theme));
    settings.save();
  });
  $('set-palette').value = s.palette;
  $('set-palette').addEventListener('change', () => {
    s.palette = $('set-palette').value;
    render.faceTex.clear();
    if (session.state) render.syncBoard(session.state);
    settings.save();
  });

  // Backgrounding pauses solo simulation; daily clock continues via
  // wall-clock catch-up on return (authoritative time).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (session.state && session.state.status === 'active' && session.state.config.mode !== 'daily') {
        sessionPause();
      }
    } else if (session.state && session.state.status === 'active') {
      // "While you were away": account for elapsed wall time on daily.
      const away = performance.now() - session.lastTickAt;
      if (session.state.config.mode === 'daily' && away > 2000) {
        session.command({ t: 'tick', ms: Math.floor(away) });
        ui.toast(`While you were away: ${fmtTime(away)} elapsed on the daily clock.`);
      }
      session.lastTickAt = performance.now();
    }
  });
  addEventListener('orientationchange', () => setTimeout(() => { render.resize(); ui.positionMirror(); }, 120));
  addEventListener('resize', () => ui.positionMirror());
}

/* =========================================================== boot */
async function boot() {
  settings.load();
  progress.load();
  document.body.classList.toggle('high-contrast', settings.data.highContrast);
  document.body.classList.toggle('large-text', settings.data.largeText);
  document.body.classList.toggle('left-handed', settings.data.leftHanded);

  $('loading-text').textContent = 'Connecting…';
  $('loading-bar').value = 30;
  await platform.init();

  $('loading-text').textContent = 'Building the garden…';
  $('loading-bar').value = 60;
  const hasGL = render.init();
  if (!hasGL) {
    ui.show('compat');
    $('loading').hidden = true;
    wire();
    input.init();
    return;
  }
  render.setTheme(C.themeById(settings.data.theme));

  wire();
  input.init();

  $('loading-bar').value = 100;
  $('loading').hidden = true;

  const snap = loadSnapshot();
  if (snap) {
    $('title-status').textContent = 'A round is in progress.';
    const b = document.createElement('button');
    b.className = 'primary';
    b.textContent = 'Resume round';
    b.addEventListener('click', () => { audio.ensure(); resumeSnapshot(); });
    $('btn-play').after(b);
  }
  $('title-status').textContent = (platform.online ? 'Connected to StarHermit.' : 'Offline — fully playable, scores kept locally.') +
    (snap ? ' A round is in progress.' : '');

  ui.show('title');

  // Main loop: quantized sim ticks + render with interpolation-ready dt.
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!document.hidden) {
      session.tick(now);
      if (render.ok) {
        render.frame(dt);
        if (session.state) ui.positionMirror();
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((e) => {
  analytics.push('error', { category: 'boot' });
  $('loading-text').textContent = 'Something went wrong while loading. Reload to try again.';
  console.error(e);
});
