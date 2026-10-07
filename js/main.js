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
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as G from './gfx.js';
import { translator } from './gfx-i18n.js';
import * as R from './rules.js';
import * as C from './content.js';
import { platform, keyLabel } from './platform.js';

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
  gfx: {}, theme: 'moonlit-garden',
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  highContrast: false, largeText: false, leftHanded: false,
  holdToggle: true, haptics: true, palette: 'standard',
  tutorialDone: false,
  gamepad: { confirm: 0, cancel: 1, shuffle: 2, hint: 3, pause: 9, undo: 8 },
};
const settings = {
  data: { ...DEFAULT_SETTINGS },
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem('qm:settings:v1') || '{}');
      delete raw.keys; // legacy key map; bindings now come from the controls API
      this.data = { ...DEFAULT_SETTINGS, ...raw };
    } catch { this.data = { ...DEFAULT_SETTINGS }; }
  },
  save() {
    try { localStorage.setItem('qm:settings:v1', JSON.stringify(this.data)); } catch { /* ok */ }
    platform.scheduleCloud();
    platform.mirrorSettings();
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
    platform.scheduleCloud();
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
// Tile texture layout: the face occupies the top of the canvas, a thin strip
// at the bottom holds the two-tone side (ivory over a coloured backing).
const TEX_W = 256, TEX_H = 400, TEX_FACE_H = 344;
const FACE_V0 = 1 - TEX_FACE_H / TEX_H;

/** Tile geometry whose UVs map the top plane to the face and the sides to the band. */
function makeTileGeometry(rounded) {
  const geo = rounded
    ? new RoundedBoxGeometry(TILE_W, TILE_H, TILE_D, 3, 0.07)
    : new THREE.BoxGeometry(TILE_W, TILE_H, TILE_D);
  const pos = geo.attributes.position, uv = geo.attributes.uv, index = geo.index;
  // BoxGeometry planes (px, nx, py, ny, pz, nz) never share vertices, so each
  // group identifies whether its vertices belong to the top, bottom or a side.
  geo.groups.forEach((grp, plane) => {
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      const v = index ? index.getX(i) : i;
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      if (plane === 2) {
        uv.setXY(v, x / TILE_W + 0.5, FACE_V0 + (0.5 - z / TILE_D) * (1 - FACE_V0));
      } else if (plane === 3) {
        uv.setXY(v, 0.5, 0.01);
      } else {
        uv.setXY(v, 0.5, (y / TILE_H + 0.5) * (FACE_V0 - 0.01) + 0.005);
      }
    }
  });
  uv.needsUpdate = true;
  geo.clearGroups();
  return geo;
}

/** Soft round sprite for stars, fireflies and match sparks. */
function glowSprite() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Procedural stone/gravel texture (seeded, decoration stream only). */
function noiseTexture(base, seed, { size = 256, speck = 0.18, veins = 0 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const c = new THREE.Color(base);
  g.fillStyle = '#' + c.getHexString();
  g.fillRect(0, 0, size, size);
  const rng = R.makeRng(seed, 'decor-tex');
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 2 * speck * 255 * (rng() < 0.08 ? 1.6 : 0.5);
    d[i] = clamp(d[i] + n, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n * 1.05, 0, 255);
  }
  g.putImageData(img, 0, 0);
  // Soft mottling.
  for (let i = 0; i < 70; i++) {
    const x = rng() * size, y = rng() * size, r = 8 + rng() * 40;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.04 + rng() * 0.06;
    grad.addColorStop(0, rng() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.4})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < veins; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.02 + rng() * 0.025})`;
    g.lineWidth = 0.6 + rng();
    g.beginPath();
    let x = rng() * size, y = rng() * size;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 70; y += (rng() - 0.5) * 70; g.lineTo(x, y); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Colour grade + vignette applied before the output transform. Kept gentle:
// gameplay contrast (glyphs on ivory) must never drop.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.26 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      vec3 lc = clamp(c, 0.0, 1.0);
      // Gentle S-curve, a touch more saturation, cool shadows / warm highlights (moonlight + lanterns).
      vec3 s = mix(lc, lc * lc * (3.0 - 2.0 * lc), 0.18);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.95, 0.98, 1.06), vec3(1.03, 1.0, 0.97), smoothstep(0.15, 0.7, l));
      c = mix(c, s + max(c - 1.0, 0.0), uAmount);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

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
  quality: 'balanced',
  theme: C.THEMES[0],
  // Graphics settings state.
  q: null, saved: {}, detected: 'balanced', gpu: '',
  composer: null, postKey: null, postFailed: false,
  pixelRatio: 1, adaptiveScale: 1, frameTimes: [], fps: 0,
  envTex: null, time: 0,
  lanterns: [], fireflies: null, decor: null, titleAngle: 0.6,

  init() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return false;
      // MSAA, when chosen, runs on a multisampled composer target so it can change live.
      this.three = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'default' });
    } catch { return false; }
    this.detectGpu();
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.toneMapping = THREE.ACESFilmicToneMapping;
    this.three.toneMappingExposure = 1.05;
    this.three.shadowMap.type = THREE.PCFShadowMap;
    $('stage').appendChild(this.three.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    this.ringGeo = new THREE.RingGeometry(0.42, 0.55, 24);
    this.spriteTex = glowSprite();
    this.setGraphics(settings.data.gfx);
    this.buildEnvironment();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.ok = true;
    return true;
  },

  detectGpu() {
    let gpu = '';
    try {
      const gl = this.three.getContext();
      // Firefox already unmasks RENDERER and warns about the debug extension.
      const ext = /firefox/i.test(navigator.userAgent) ? null : gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } catch { gpu = ''; }
    this.gpu = gpu;
    const mobile = matchMedia('(pointer: coarse)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    this.detected = G.detectPreset(gpu, { mobile });
  },

  /** Apply saved graphics settings live (no reload). */
  setGraphics(saved) {
    this.saved = saved || {};
    const prev = this.q;
    const g = G.resolve(this.saved, this.detected);
    this.q = g;
    this.quality = g.preset;
    const b = document.body.dataset;
    b.gfxPreset = g.preset;
    b.gfxAuto = String(g.auto);
    for (const cat of Object.keys(G.CATEGORIES)) b['gfx' + cat[0].toUpperCase() + cat.slice(1)] = g[cat];
    this.fpsVisible(g.showFps);
    if (!this.three) return;
    const size = G.SHADOW_MAP[g.shadows];
    const shadowToggled = this.three.shadowMap.enabled !== size > 0;
    this.three.shadowMap.enabled = size > 0;
    this.applyShadow();
    this.adaptiveScale = 1;
    this.frameTimes = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this.postFailed = false;
    if (prev && this.ok && (prev.detail !== g.detail || prev.reflections !== g.reflections)) {
      this.setTheme(this.theme); // geometry, textures and environment differ: rebuild
    } else if (shadowToggled && this.scene) {
      // Materials pick up shadow-map changes on recompile.
      this.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    }
    if (this.fireflies) this.fireflies.visible = g.background === 'animated';
  },

  applyShadow() {
    const moon = this.moon;
    if (!moon || !this.q) return;
    const size = G.SHADOW_MAP[this.q.shadows];
    moon.castShadow = size > 0;
    if (size > 0 && moon.shadow.mapSize.x !== size) {
      moon.shadow.mapSize.set(size, size);
      moon.shadow.map?.dispose();
      moon.shadow.map = null;
    }
    moon.shadow.radius = this.q.shadows === 'low' ? 1 : 2;
  },

  /** Fit the moon's shadow frustum tightly around the play area. */
  fitShadow(radius) {
    const cam = this.moon?.shadow.camera;
    if (!cam) return;
    const r = Math.max(2, radius);
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 4; cam.far = 40;
    cam.updateProjectionMatrix();
  },

  environmentMap() {
    if (this.envTex) return this.envTex;
    const pmrem = new THREE.PMREMGenerator(this.three);
    const room = new RoomEnvironment();
    this.envTex = pmrem.fromScene(room, 0.04).texture;
    room.traverse((o) => { o.geometry?.dispose(); if (o.material) for (const m of [].concat(o.material)) m.dispose(); });
    pmrem.dispose();
    return this.envTex;
  },

  buildEnvironment() {
    const t = this.theme;
    const s = this.scene;
    const g = this.q;
    const detailed = g.detail === 'detailed';
    s.background = new THREE.Color(t.sky);
    s.fog = new THREE.Fog(t.fog, 30, 90);
    s.environment = g.reflections === 'on' ? this.environmentMap() : null;
    s.environmentIntensity = 0.28;
    this.tileGeo?.dispose();
    this.tileGeo = makeTileGeometry(detailed);

    // Key light: the moon, with a shadow frustum fitted to the table/board.
    const moon = new THREE.DirectionalLight(0xcfe0ff, detailed ? 1.7 : 1.6);
    moon.position.set(-8, 14, 6);
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.02;
    this.moon = moon;
    this.applyShadow();
    this.fitShadow(10);
    s.add(moon, moon.target);
    s.add(new THREE.AmbientLight(t.glow, detailed ? 0.18 : 0.25));
    s.add(new THREE.HemisphereLight(t.accent, t.ground, detailed ? 0.5 : 0.35));

    // Ground.
    const groundMat = new THREE.MeshStandardMaterial({ color: t.ground, roughness: 1 });
    if (detailed) {
      groundMat.map = noiseTexture(t.ground, 11, { speck: 0.22 });
      groundMat.map.repeat.set(14, 14);
      groundMat.color.set(0xffffff);
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 40), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.55;
    ground.receiveShadow = true;
    s.add(ground);

    // Table: plain slab, or a textured stone slab with a carved rim.
    const tableMat = new THREE.MeshStandardMaterial({ color: t.table, roughness: 0.85, metalness: 0.05 });
    if (detailed) {
      tableMat.map = noiseTexture(t.table, 7, { size: 512, speck: 0.07, veins: 8 });
      tableMat.map.repeat.set(2, 2);
      tableMat.color.set(0xffffff);
      tableMat.roughness = 0.72;
    }
    const table = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 8.5, 0.5, detailed ? 72 : 40), tableMat);
    table.position.y = -0.3;
    table.receiveShadow = true;
    s.add(table);
    if (detailed) {
      const rimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.table).multiplyScalar(0.7), roughness: 0.6, metalness: 0.1 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.16, 12, 96), rimMat);
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = -0.06;
      rim.receiveShadow = true;
      s.add(rim);
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, 0.6, 40), rimMat);
      pedestal.position.y = -0.8;
      s.add(pedestal);
    }

    // Garden props, procedurally placed with a decoration-only stream.
    const rng = R.makeRng(2024, 'decor');
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a4358, roughness: 1, flatShading: detailed });
    for (let i = 0; i < 14; i++) {
      const r = 0.3 + rng() * 0.9;
      const geo = new THREE.IcosahedronGeometry(r, detailed ? 1 : 0);
      if (detailed) {
        const p = geo.attributes.position;
        for (let k = 0; k < p.count; k++) {
          const f = 0.82 + rng() * 0.3;
          p.setXYZ(k, p.getX(k) * f, p.getY(k) * f * 0.8, p.getZ(k) * f);
        }
        geo.computeVertexNormals();
      }
      const rock = new THREE.Mesh(geo, rockMat);
      const ang = rng() * Math.PI * 2;
      const dist = 11 + rng() * 14;
      rock.position.set(Math.cos(ang) * dist, -0.55 + r * 0.5, Math.sin(ang) * dist);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.castShadow = true;
      s.add(rock);
    }

    // Paper lanterns on dark poles; each owns a warm point light.
    this.lanterns = [];
    const glow = new THREE.Color(t.glow);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.9 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.7 });
    for (const [x, z] of [[-10, -7], [10.5, -5], [0, 13]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 8), poleMat);
      pole.position.set(x, 0.75, z);
      const lampMat = new THREE.MeshStandardMaterial({
        color: 0x553311, emissive: glow, emissiveIntensity: detailed ? 1.6 : 0.9, roughness: 0.6 });
      let lamp;
      if (detailed) {
        lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.62, 20, 1), lampMat);
        lamp.scale.set(1, 1, 1);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.4, 0.14, 20), capMat);
        top.position.set(x, 2.58, z);
        const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.2, 0.1, 20), capMat);
        bot.position.set(x, 1.86, z);
        s.add(top, bot);
      } else {
        lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), lampMat);
      }
      lamp.position.set(x, 2.2, z);
      const light = new THREE.PointLight(t.glow, 2.5, 9);
      light.position.set(x, 2.3, z);
      s.add(pole, lamp, light);
      this.lanterns.push({ lamp, light, base: lampMat.emissiveIntensity, phase: x * 1.7 + z });
    }

    // Moon disc in the sky (bright enough to bloom) with a soft halo.
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf4f0e2).multiplyScalar(detailed ? 1.5 : 1), fog: false }));
    moonDisc.position.set(-26, 26, -34);
    moonDisc.lookAt(0, 4, 0);
    s.add(moonDisc);
    if (detailed) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.spriteTex, color: 0xbfd2ff, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      halo.position.copy(moonDisc.position).multiplyScalar(1.01);
      halo.scale.setScalar(16);
      s.add(halo);
      // Static star field on the upper sky.
      const n = 360;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, e = 0.12 + rng() * 1.3;
        arr[i * 3] = Math.cos(a) * Math.cos(e) * 90;
        arr[i * 3 + 1] = Math.sin(e) * 90;
        arr[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 90;
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const stars = new THREE.Points(sg, new THREE.PointsMaterial({
        map: this.spriteTex, color: 0xdfe8ff, size: 2.2, sizeAttenuation: false,
        transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
      s.add(stars);
    }

    // Fireflies: slow, bounded, cosmetic (never raycast).
    {
      const n = 42;
      const arr = new Float32Array(n * 3);
      const seeds = [];
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, d = 6 + rng() * 12;
        seeds.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y: 0.6 + rng() * 2.6, p: rng() * 10, s: 0.3 + rng() * 0.5 });
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({
        map: this.spriteTex, color: new THREE.Color(t.glow).lerp(new THREE.Color(0xffe27a), 0.7).multiplyScalar(1.5),
        size: 0.14, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.fireflies.userData.seeds = seeds;
      this.fireflies.frustumCulled = false;
      this.fireflies.visible = g.background === 'animated';
      this.updateFireflies(0);
      s.add(this.fireflies);
    }

    // Decorative tiles shown on the table behind the title menu.
    this.decor = new THREE.Group();
    {
      const faces = Object.keys(R.FACE_NAMES);
      const drng = R.makeRng(77, 'decor-title');
      const spots = [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [-0.5, 1, 0], [0.5, 1, 0], [0, 2, 0],
        [-1, 0, 1], [0, 0, 1], [1, 0, 1], [-0.5, 1, 1], [0.5, 1, 1]];
      spots.forEach(([cx, layer, row]) => {
        const face = faces[Math.floor(drng() * faces.length)];
        const mesh = new THREE.Mesh(this.tileGeo, this.tileMaterial(face));
        mesh.position.set(cx * (TILE_W + GAP) + (row ? 0.3 : 0), layer * LAYER_STEP + TILE_H / 2, row * (TILE_D + GAP) - 0.6);
        mesh.rotation.y = (drng() - 0.5) * 0.08;
        mesh.castShadow = mesh.receiveShadow = true;
        this.decor.add(mesh);
      });
    }
    this.decor.visible = !session.state;
    s.add(this.decor);

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
    const pMat = new THREE.PointsMaterial({
      color: new THREE.Color(t.accent).multiplyScalar(detailed ? 1.6 : 1), size: detailed ? 0.16 : 0.09,
      map: detailed ? this.spriteTex : null, transparent: true, opacity: 0.9, depthWrite: false,
      blending: detailed ? THREE.AdditiveBlending : THREE.NormalBlending });
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
    s.traverse((o) => {
      if (o.geometry && o.geometry !== this.tileGeo && o.geometry !== this.ringGeo) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) { if (m.map && m.map !== this.spriteTex && !this.isFaceTex(m.map)) m.map.dispose(); m.dispose(); }
    });
    s.clear();
    this.tiles.clear();
    for (const tex of this.faceTex.values()) tex.dispose();
    this.faceTex.clear();
    this.buildEnvironment();
    if (session.state) this.syncBoard(session.state);
  },

  isFaceTex(tex) {
    for (const t of this.faceTex.values()) if (t === tex) return true;
    return false;
  },

  tileMaterial(face) {
    const map = this.faceTexture(face);
    if (this.q.detail === 'detailed') {
      return new THREE.MeshPhysicalMaterial({
        map, roughness: 0.42, metalness: 0, clearcoat: 0.65, clearcoatRoughness: 0.2,
      });
    }
    return new THREE.MeshStandardMaterial({ map, roughness: 0.35, metalness: 0.02 });
  },

  faceTexture(face) {
    if (this.faceTex.has(face)) return this.faceTex.get(face);
    const cv = document.createElement('canvas');
    cv.width = TEX_W; cv.height = TEX_H;
    const g = cv.getContext('2d');
    const t = this.theme;
    const detailed = this.q?.detail === 'detailed';
    const ceramic = '#' + new THREE.Color(t.tile).getHexString();
    const edge = '#' + new THREE.Color(t.tileEdge).getHexString();
    const FW = TEX_W, FH = TEX_FACE_H;
    g.fillStyle = ceramic;
    g.fillRect(0, 0, FW, FH);
    if (detailed) {
      // Glaze: soft top-left sheen and faint speckle; never over the glyph area's contrast.
      const sheen = g.createLinearGradient(0, 0, FW, FH);
      sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
      sheen.addColorStop(1, 'rgba(0,0,0,0.06)');
      g.fillStyle = sheen;
      g.fillRect(0, 0, FW, FH);
      const rng = R.makeRng(face.length * 131 + face.charCodeAt(0), 'decor-glaze');
      for (let i = 0; i < 220; i++) {
        g.fillStyle = `rgba(90,80,70,${0.04 + rng() * 0.06})`;
        g.fillRect(rng() * FW, rng() * FH, 1.5, 1.5);
      }
    }
    g.strokeStyle = edge; g.lineWidth = 12;
    g.strokeRect(10, 10, FW - 20, FH - 20);
    if (detailed) {
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2;
      g.strokeRect(19, 19, FW - 38, FH - 38);
    }
    // Family color band (color reinforced by glyph shape + name in DOM).
    const famColors = PALETTES[settings.data.palette] || PALETTES.standard;
    const fam = face.split('-')[0];
    g.fillStyle = famColors[fam] || '#557';
    g.fillRect(20, 282, FW - 40, 32);
    g.fillStyle = '#1a2030';
    g.font = '144px serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(R.faceGlyph(face), FW / 2, 150);
    // Side band: ivory body over a coloured backing, like a two-layer tile.
    const back = new THREE.Color(t.glow).lerp(new THREE.Color(t.table), 0.45);
    g.fillStyle = ceramic;
    g.fillRect(0, FH, FW, TEX_H - FH);
    g.fillStyle = '#' + new THREE.Color(t.tileEdge).getHexString();
    g.fillRect(0, FH + 26, FW, 3);
    g.fillStyle = '#' + back.getHexString();
    g.fillRect(0, FH + 29, FW, TEX_H - FH - 29);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = detailed ? 8 : 4;
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
    if (this.decor) this.decor.visible = false;
    // Board span for centering.
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const t of state.tiles) {
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    }
    this.boardSpan = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX + 2, h: maxY - minY + 2 };
    this.fitShadow(Math.hypot(this.boardSpan.w * (TILE_W / 2 + GAP), this.boardSpan.h * (TILE_D / 2 + GAP)) / 2 + 1.5);

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
        const mesh = new THREE.Mesh(this.tileGeo, this.tileMaterial(tile.face));
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
      entry.mesh.material.emissive.setHex(selected ? this.theme.accent : hinted ? this.theme.glow : 0x000000);
      // Detailed tiles are brighter (clear-coat + bloom): a softer glow keeps the glyph readable.
      const soft = this.q.detail === 'detailed';
      entry.mesh.material.emissiveIntensity = selected ? (soft ? 0.1 : 0.5) : hinted ? (soft ? 0.1 : 0.35) : 0;
      entry.mesh.userData.free = free.has(tile.id);
    }
    // Hide meshes for tiles no longer in state (defensive).
    for (const [id, entry] of this.tiles) {
      if (!seen.has(id)) { this.scene.remove(entry.mesh, entry.ring); entry.mesh.material.dispose(); entry.ring.material.dispose(); this.tiles.delete(id); }
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

  /** Drop the board meshes (round left) so the title scene shows again. */
  clearBoard() {
    if (!this.ok) return;
    for (const entry of this.tiles.values()) {
      this.scene.remove(entry.mesh, entry.ring);
      entry.mesh.material.dispose(); entry.ring.material.dispose();
    }
    this.tiles.clear();
    this.marker.visible = false;
    this.fitShadow(10);
    if (this.decor) this.decor.visible = true;
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

  /** Title/menu view: a slow orbit around the garden table. */
  titleCamera(dt) {
    const animate = this.q.background === 'animated' && !settings.data.reducedMotion;
    if (animate) this.titleAngle += dt * 0.05;
    const a = this.titleAngle;
    const aspect = innerWidth / Math.max(1, innerHeight);
    const dist = aspect < 1 ? 27 : 20;
    this.camera.position.set(Math.sin(a) * dist, aspect < 1 ? 9 : 6.5, Math.cos(a) * dist);
    this.camera.lookAt(0, aspect < 1 ? 1.5 : 2.2, 0);
    this.camGoal.moving = false;
  },

  resetCamera() {
    if (!this.ok) return; // 2-D compat mode has no camera
    this.camGoal.moving = false;
    this.frameCamera();
    audio.event('select');
  },

  burst(x, y, z) {
    const cap = G.PARTICLE_BURST[this.q?.particles] || 0;
    if (settings.data.reducedMotion || !cap) return;
    const rng = R.makeRng(Math.floor(x * 97 + z * 131 + performance.now() % 1000), 'vfx');
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

  updateFireflies(time) {
    const f = this.fireflies;
    if (!f) return;
    const arr = f.geometry.attributes.position.array;
    f.userData.seeds.forEach((s, i) => {
      const k = time * s.s + s.p;
      arr[i * 3] = s.x + Math.sin(k * 0.7) * 1.4;
      arr[i * 3 + 1] = s.y + Math.sin(k * 1.3) * 0.5;
      arr[i * 3 + 2] = s.z + Math.cos(k * 0.5) * 1.4;
    });
    f.geometry.attributes.position.needsUpdate = true;
    f.material.opacity = 0.75 + 0.25 * Math.sin(time * 2.1);
  },

  // Gentle ambient motion: lantern flicker and drifting fireflies.
  updateAmbient(dt) {
    const animate = this.q.background === 'animated' && !settings.data.reducedMotion;
    if (this.fireflies) this.fireflies.visible = animate;
    if (!animate) return;
    this.time += dt;
    this.updateFireflies(this.time);
    for (const l of this.lanterns) {
      const k = 1 + 0.06 * Math.sin(this.time * 3.1 + l.phase) + 0.04 * Math.sin(this.time * 7.3 + l.phase * 2);
      l.lamp.material.emissiveIntensity = l.base * k;
      l.light.intensity = 2.5 * k;
    }
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
    this.applySize(true);
    this.camera.aspect = innerWidth / Math.max(1, innerHeight);
    this.camera.updateProjectionMatrix();
    if (session.state) this.frameCamera();
  },

  /** Pixel ratio = min(dpr, preset cap) × preset/render scale × adaptive scale. */
  applySize(force) {
    const g = this.q;
    const ratio = Math.min(3, Math.min(devicePixelRatio || 1, g.dprCap) * g.scale * this.adaptiveScale);
    const w = innerWidth, h = innerHeight;
    if (force || ratio !== this.pixelRatio || w !== this.size?.[0] || h !== this.size?.[1]) {
      this.pixelRatio = ratio;
      this.size = [w, h];
      this.three.setPixelRatio(ratio);
      this.three.setSize(w, h);
    }
  },

  fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  },

  /** What the Graphics panel shows: GPU, auto choice, resolved tiers, cost. */
  graphicsInfo(t) {
    const size = this.size || [innerWidth, innerHeight];
    const px = [Math.round(size[0] * this.pixelRatio), Math.round(size[1] * this.pixelRatio)];
    return {
      gpu: this.gpu || '',
      detected: this.detected,
      resolved: this.q,
      summary: G.describe(this.q, this.three ? px : null, t),
      fps: Math.round(this.fps || 0),
      postFailed: !!this.postFailed,
    };
  },

  postKeyFor() {
    const g = this.q;
    if (!g.post || this.postFailed) return 'none';
    return [g.ao, g.bloom, g.grade, g.antialias, this.size[0], this.size[1], this.pixelRatio].join('|');
  },

  buildPost() {
    const g = this.q;
    this.composer?.dispose();
    this.composer = null;
    if (!g.post || this.postFailed) return;
    const [w, h] = this.size;
    const pr = this.pixelRatio;
    try {
      const target = new THREE.WebGLRenderTarget(w * pr, h * pr, {
        type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new EffectComposer(this.three, target);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, w * pr, h * pr);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // High threshold: only the moon, lanterns, fireflies and highlights bloom.
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.45, 0.92));
      }
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      composer.addPass(new OutputPass());
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass(w * pr, h * pr));
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch {
      // Post-processing is an enhancement: render directly and say so in the panel.
      this.postFailed = true;
      this.composer = null;
      ui.refreshGraphics?.();
    }
  },

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  adapt(dtMs) {
    const f = this.frameTimes;
    f.push(dtMs);
    if (f.length < 90) return;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = `${Math.round(this.fps)} fps · ${Math.round(this.pixelRatio * 100) / 100}×`;
    if (!this.q.adaptive) return;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
  },

  frame(dt) {
    this.adapt(dt * 1000);
    if (!session.state) {
      if (this.decor && !this.decor.visible) this.clearBoard();
      this.titleCamera(dt);
    }
    this.updateCamera(dt);
    this.updateParticles(dt);
    this.updateAmbient(dt);
    if (this.marker.visible && !settings.data.reducedMotion) {
      this.marker.material.opacity = 0.7 + 0.25 * Math.sin(performance.now() / 240);
    }
    this.applySize(false);
    const key = this.postKeyFor();
    if (key !== this.postKey) {
      this.postKey = key;
      this.buildPost();
    }
    if (this.composer) {
      try { this.composer.render(dt); return; } catch {
        this.postFailed = true; this.composer = null; this.postKey = null; ui.refreshGraphics?.();
      }
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
    this.finished = false;
    this.newUnlocks = [];
    this.lastTickAt = performance.now();
    render.hintIds = [];
    // A new round overwrites the saved snapshot; drop the stale resume offer.
    $('btn-resume-round')?.remove();
    ui.show('play');
    this.syncAll();
    ui.announce(`${config.mode} round started. ${this.state.tiles.length} tiles.`);
    analytics.push('start', { mode: config.mode, tier: config.tier });
    saveSnapshot();
  },

  /** All simulation mutation goes through here. */
  command(cmd) {
    if (!this.state) return { error: 'no-round' };
    // Idempotent duplicate rejection uses a dedicated command id (cid) —
    // tap commands carry a tile id in `id`, which must stay repeatable.
    if (cmd.cid && this.commandIds.has(cmd.cid)) return { error: 'duplicate' };
    if (cmd.cid) this.commandIds.add(cmd.cid);
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
    if (dt >= 1000) { // 1 s quantum keeps the replay log compact on long rounds
      this.lastTickAt = now;
      const before = this.state.status;
      this.command({ t: 'tick', ms: Math.floor(dt) });
      if (before === 'active' && this.state.status === 'lost') this.finish();
    }
    ui.updateHud();
  },

  finish() {
    if (this.finished) return; // terminal events fire once per round
    this.finished = true;
    const s = this.state;
    analytics.push('round-end', { mode: s.config.mode, won: s.status === 'won', score: R.totalScore(s) });
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
    this.postToLeaderboard();
  },

  async submitScore() {
    const s = this.state;
    const entry = {
      name: platform.displayName(),
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
    localBoard.add(entry);
  },

  // Hosted only: Journey, Daily and Challenge rounds (not Learn or Practice,
  // not a resigned round) post their total to the platform high-score board;
  // the results screen shows the rank.
  postToLeaderboard() {
    const s = this.state;
    const line = $('results-lb');
    const seq = this.lbSeq = (this.lbSeq || 0) + 1;
    line.hidden = true;
    if (!platform.hosted || ['learn', 'practice'].includes(s.config.mode) || s.reason === 'resigned') return;
    line.hidden = false;
    line.textContent = tr('lbPosting');
    platform.submitScore(R.totalScore(s)).then((r) => {
      if (seq !== this.lbSeq) return;
      line.textContent = !r.posted ? tr('lbNotPosted') : r.rank ? tr('lbRank', { rank: r.rank }) : tr('lbPosted');
    });
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
  session.finished = false;
  session.lastTickAt = performance.now();
  $('btn-resume-round')?.remove();
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
  if (progress.data.achievements[key]) return false; // idempotent
  progress.data.achievements[key] = Date.now();
  const def = C.ACHIEVEMENTS.find(a => a.key === key);
  ui.toast(`Achievement unlocked: ${def ? def.name : key}`);
  ui.announce(`Achievement unlocked: ${def ? def.name : key}`);
  return true;
}
function checkAchievements(s) {
  session.newUnlocks = [];
  const got = (key) => { if (unlock(key)) session.newUnlocks.push(key); };
  got('first-clear');
  if (s.hints === 0 && s.shuffles === 0 && s.undos === 0) got('mechanic-mastery');
  if (s.bestStreak >= 8) got('streak-8');
  if (session.contentRef?.mastery) got('mastery-stage');
  if (Object.keys(progress.data.journey).length >= C.JOURNEY_STAGES.length) got('journey-40');
  if (Object.keys(progress.data.dailies).length >= 7) got('daily-7');
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
    if (name === 'pause') {
      // Opened from the title menu there is no round: show Settings with Back instead.
      const menu = !session.state;
      $('btn-resume').hidden = menu;
      $('btn-leave').hidden = menu;
      $('btn-settings-back').hidden = !menu;
      $('pause-heading').textContent = menu ? tr('settings') : 'Paused';
      this.refreshGraphics?.();
    } else if (name !== 'help') this.helpFromSettings = false;
    const first = [...$(`screen-${name}`).querySelectorAll('button:not([disabled]), input, select, [tabindex]')]
      .find((el) => !el.closest('[hidden]') && !el.closest('details:not([open]) > :not(summary)'));
    if (first) setTimeout(() => first.focus(), 30);
  },

  /** Toast that is visible on every screen (menus included). */
  appToast(msg, ms = 3200) {
    const el = $('app-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._appToastT);
    this._appToastT = setTimeout(() => el.classList.remove('show'), ms);
  },
  /** StarHermit sign-in state: sign-in button when possible, invite when signed in. */
  authChanged(hosted, initial = false) {
    $('btn-signin').hidden = hosted || !platform.canSignIn();
    $('btn-invite').hidden = !hosted;
    if (!initial && !hosted) this.appToast(tr('signedOut'));
    this.titleStatus?.();
    this.syncStatus();
  },
  /** Show the effective keyboard bindings in settings and help. */
  bindingsChanged(b) {
    const order = ['up', 'down', 'left', 'right', 'select', 'pause', 'hint', 'undo', 'shuffle', 'camera'];
    for (const id of ['settings-keys', 'help-controls']) {
      const el = $(id);
      if (!el) continue;
      el.textContent = '';
      if (id === 'settings-keys') el.append(`${tr('keyboard')}: `);
      order.forEach((a, i) => {
        if (i) el.append(' · ');
        el.append(`${tr('act_' + a)} `);
        (b[a] || []).forEach((c, j) => {
          if (j) el.append('/');
          const k = document.createElement('kbd');
          k.textContent = keyLabel(c);
          el.append(k);
        });
      });
    }
  },
  async copyInvite() {
    const url = platform.inviteLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.appToast(tr('inviteCopied'));
    } catch {
      this.appToast(tr('inviteLink', { url }), 8000);
    }
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
    $('btn-shuffle').setAttribute('aria-disabled', String(!acts.shuffle));
    $('btn-undo').setAttribute('aria-disabled', String(!acts.undo));
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
    $('results-achievements').textContent = (session.newUnlocks || []).length
      ? 'Achievements: ' + session.newUnlocks
          .map(k => (C.ACHIEVEMENTS.find(a => a.key === k) || { name: k }).name).join(' · ')
      : '';
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
    $('scores-note').textContent = res.note;
    const ol = $('scores-list');
    ol.textContent = '';
    for (const e of (res.entries || []).slice(0, 20)) {
      const li = document.createElement('li');
      li.textContent = `${e.name} — ${e.score} (${fmtTime(e.durationMs || 0)})`;
      if (e.mine || e.name === platform.displayName()) li.classList.add('me');
      ol.appendChild(li);
    }
    if (!ol.children.length) {
      const li = document.createElement('li');
      li.textContent = 'No scores yet. Finish a board to post one.';
      ol.appendChild(li);
    }
    this.show('scores');
  },

  /** Small cloud-sync line on the profile screen (synced/saving/offline). */
  syncStatus() {
    const el = $('profile-sync');
    if (!el) return;
    if (!platform.hosted) {
      el.textContent = 'Progress is stored on this device only.';
      return;
    }
    el.textContent = {
      synced: 'Cloud save synced to your account.',
      saving: 'Syncing progress to your account…',
      offline: '',
      error: 'Cloud sync failed — progress is safe locally and will retry on the next change.',
    }[platform.cloudState] || '';
  },

  showProfile() {
    const nameEl = $('profile-name');
    nameEl.value = platform.hosted ? platform.displayName() : (progress.data.name || '');
    nameEl.disabled = platform.hosted; // hosted identity comes from the account
    $('profile-name-note').textContent = platform.hosted
      ? 'Signed in with your StarHermit account; the name comes from your account profile.'
      : '';
    this.syncStatus();
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
    // Routed by KeyboardEvent.code through the player's platform bindings.
    const action = platform.actionFor(e.code);
    if (ui.current !== 'play') {
      if (action === 'pause' && ui.current === 'pause') sessionResume();
      return;
    }
    const tap = () => { if (this.focusId != null) session.command({ t: 'tap', id: this.focusId }); };
    const map = {
      up: () => this.moveFocus(0, -1),
      down: () => this.moveFocus(0, 1),
      left: () => this.moveFocus(-1, 0),
      right: () => this.moveFocus(1, 0),
      select: tap,
      pause: () => sessionPause(),
      hint: () => session.command({ t: 'hint' }),
      undo: () => session.command({ t: 'undo' }),
      shuffle: () => session.command({ t: 'shuffle' }),
      camera: () => render.resetCamera(),
    };
    const fn = action && map[action];
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
  if (!session.state) { ui.show('title'); return; } // settings opened from the title menu
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
    ['Ranked', (cfg.mode === 'daily' || cfg.mode === 'challenge' || cfg.mode === 'journey')
      ? (platform.hosted ? 'platform board' : 'local records')
      : 'no'],
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
    : platform.hosted
      ? 'One shared seed for everyone (UTC day). Scores are kept as local records and also posted to the platform-wide board.'
      : 'One shared seed for everyone (UTC day). Scores are kept as local records on this device.';
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
  } else if (p.kind === 'journey') {
    // List screen: Start continues at the first uncleared stage.
    const done = progress.data.journey;
    const st = C.JOURNEY_STAGES.find(s => !done[s.id]) || C.JOURNEY_STAGES[0];
    cfg = { ...st.config };
    ref = { stageId: st.id, mastery: st.mastery };
    render.setTheme(C.themeById(st.theme));
  } else if (p.kind === 'journey-stage') {
    cfg = { ...p.stage.config };
    ref = { stageId: p.stage.id, mastery: p.stage.mastery };
    render.setTheme(C.themeById(p.stage.theme));
  } else if (p.kind === 'challenge') {
    // List screen: Start runs the first challenge.
    const ch = C.CHALLENGES[0];
    cfg = { ...ch.config };
    ref = { challengeId: ch.id };
    render.setTheme(C.themeById(ch.theme));
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

/* ================================================== graphics panel */
const tr = translator(navigator.language);
const gfxUI = {
  saved() { return settings.data.gfx || {}; },
  tierLabel(t) { return ['fxaa', 'smaa', 'msaa'].includes(t) ? t.toUpperCase() : tr(t); },

  init() {
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = tr(el.dataset.i18n);
    if (!render.q) render.setGraphics(this.saved()); // 2-D compat mode still stores choices
    const host = $('gfx-categories');
    for (const [cat, tiers] of Object.entries(G.CATEGORIES)) {
      const row = document.createElement('div');
      row.className = 'gfx-row';
      const lab = document.createElement('label');
      lab.htmlFor = `set-gfx-${cat}`;
      lab.textContent = tr('cat_' + cat);
      const sel = document.createElement('select');
      sel.id = `set-gfx-${cat}`;
      sel.dataset.gfxCat = cat;
      for (const v of ['preset', ...tiers]) {
        const o = document.createElement('option');
        o.value = v;
        sel.append(o);
      }
      sel.addEventListener('change', () => this.update(G.setOverride(this.saved(), cat, sel.value)));
      row.append(lab, sel);
      host.append(row);
    }
    $('set-quality').addEventListener('change', (e) => this.update(G.choosePreset(this.saved(), e.target.value)));
    const rs = $('set-render-scale');
    rs.addEventListener('input', () => {
      $('set-render-scale-value').textContent = `${rs.value}%`;
      this.update({ ...this.saved(), render_scale: Number(rs.value) / 100 });
    });
    $('set-gfx-adaptive').addEventListener('change', (e) => this.update({ ...this.saved(), adaptive: e.target.checked }));
    $('set-gfx-fps').addEventListener('change', (e) => this.update({ ...this.saved(), show_fps: e.target.checked }));
    ui.refreshGraphics = () => this.refresh();
    this.refresh();
  },

  update(next) {
    settings.data.gfx = next;
    settings.save();
    render.setGraphics(next);
    analytics.push('settings-change', { key: 'graphics' });
    this.refresh();
  },

  refresh() {
    const saved = this.saved();
    const r = render.q;
    const q = $('set-quality');
    for (const o of q.options) o.textContent = o.value === 'auto' ? tr('auto', { tier: tr(render.detected) }) : tr(o.value);
    q.value = G.PRESETS.includes(saved.preset) ? saved.preset : 'auto';
    for (const [cat, tiers] of Object.entries(G.CATEGORIES)) {
      const sel = $(`set-gfx-${cat}`);
      for (const o of sel.options) {
        o.textContent = o.value === 'preset'
          ? tr('fromPreset', { tier: this.tierLabel(G.presetTier(r.preset, cat)) })
          : this.tierLabel(o.value);
      }
      sel.value = tiers.includes(saved[cat]) ? saved[cat] : 'preset';
    }
    const pct = Math.round(r.renderScale * 100);
    $('set-render-scale').value = pct;
    $('set-render-scale-value').textContent = `${pct}%`;
    $('set-gfx-adaptive').checked = r.adaptive;
    $('set-gfx-fps').checked = r.showFps;
    const alias = { bloom: 'bloomS', reflections: 'reflectionsS' };
    const info = render.graphicsInfo((k, v, n) => tr(alias[k] || k, { n }));
    $('gfx-summary').textContent = `${info.gpu || tr('unknownGpu')} · ${info.summary}`;
    $('gfx-post-note').hidden = !info.postFailed;
  },
};

/* ============================================================ wire */
function wire() {
  $('btn-play').addEventListener('click', () => { audio.ensure(); ui.show('modes'); });
  $('btn-daily').addEventListener('click', () => { audio.ensure(); setupDaily(); });
  $('btn-journey').addEventListener('click', () => { audio.ensure(); setupJourney(); });
  $('btn-profile').addEventListener('click', () => ui.showProfile());
  $('btn-signin').addEventListener('click', () => platform.signIn());
  $('btn-invite').addEventListener('click', () => ui.copyInvite());
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
      if (ui.current === 'help' && (session.state || ui.helpFromSettings)) { ui.show('pause'); return; }
      if (ui.current === 'setup') { ui.show('modes'); return; }
      ui.show('title');
    });
  }
  $('btn-start').addEventListener('click', startPending);
  $('btn-pause').addEventListener('click', sessionPause);
  $('btn-resume').addEventListener('click', sessionResume);
  $('btn-leave').addEventListener('click', sessionLeave);
  $('btn-help').addEventListener('click', () => { ui.helpFromSettings = true; ui.show('help'); });
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
    if (platform.hosted) return; // hosted identity comes from the account profile
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
  gfxUI.init();
  $('btn-settings').addEventListener('click', () => { audio.ensure(); ui.show('pause'); });
  $('btn-settings-back').addEventListener('click', () => ui.show('title'));
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
function applyBodySettings() {
  document.body.classList.toggle('high-contrast', settings.data.highContrast);
  document.body.classList.toggle('large-text', settings.data.largeText);
  document.body.classList.toggle('left-handed', settings.data.leftHanded);
}

async function boot() {
  settings.load();
  progress.load();
  applyBodySettings();

  $('loading-text').textContent = 'Connecting…';
  $('loading-bar').value = 30;
  platform.bind({
    progress, settings, ui, localBoard, C, R,
    defaultSettings: DEFAULT_SETTINGS,
    hasLocalProgress: () => { try { return !!localStorage.getItem('qm:progress:v1'); } catch { return false; } },
    applySettings: applyBodySettings,
  });
  await platform.init();
  ui.authChanged(platform.hosted, true);
  ui.bindingsChanged(platform.bindings);

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
    b.id = 'btn-resume-round';
    b.className = 'primary';
    b.textContent = 'Resume round';
    b.addEventListener('click', () => { audio.ensure(); resumeSnapshot(); });
    $('btn-play').after(b);
  }
  ui.titleStatus = () => {
    $('title-status').textContent = (platform.hosted
      ? `Signed in as ${platform.displayName()}.`
      : 'Offline — fully playable, scores kept locally.') +
      (loadSnapshot() ? ' A round is in progress.' : '');
  };
  ui.titleStatus();

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
