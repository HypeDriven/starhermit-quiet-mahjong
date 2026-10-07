/**
 * Quiet Mahjong — platform adapter over the StarHermit SDK (starhermit-sdk.js,
 * loaded as a classic script before the game modules; window.StarHermit).
 *
 * Hosted mode is active while the SDK holds a launch token. It covers:
 * account profile nickname, renewal (SDK), one cloud-save slot
 * (`game:<slug>`, loaded remote-first, debounced, flushed on pagehide),
 * per-player settings KV, keyboard bindings from the controls API,
 * the platform high-score board (post + read) and the invite share link.
 *
 * Without a token the game is fully local and makes no network request at
 * all (device clock, local boards, achievements and records).
 *
 * The game wires its state in with `platform.bind({...})` before init().
 */

const SH = () => globalThis.StarHermit;

/** Keyboard actions (KeyboardEvent.code). Mirrors control.* in starhermit.txt. */
export const DEFAULT_BINDINGS = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  select: ['Enter', 'Space', 'NumpadEnter'],
  pause: ['Escape'],
  hint: ['KeyH'],
  undo: ['KeyU'],
  shuffle: ['KeyS'],
  camera: ['KeyC'],
};

/** Short on-screen label for a KeyboardEvent.code. */
export function keyLabel(code) {
  const named = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc',
    Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter', Backspace: '⌫', Tab: 'Tab' };
  if (named[code]) return named[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\w+)$/.exec(code))) return 'Num ' + m[1];
  return code;
}

export const platform = {
  online: false, // true while hosted (the platform answers)
  hosted: false, // true while a launch token is held
  userId: null,
  gameKey: null, // SDK slug (game_scope claim)
  cloudState: 'offline', // synced | saving | offline | error
  bindings: Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([k, v]) => [k, v.slice()])),
  _name: null,
  _applying: false,
  _sentSettings: {},
  _settingsTimer: null,
  d: null, // bound game state: { progress, settings, ui, localBoard, C, R, applySettings }

  bind(deps) { this.d = deps; return this; },

  async init() {
    const sh = SH();
    if (sh) sh.init(); // reads + strips the launch fragment; idempotent
    if (sh && sh.signedIn) {
      this._enterHosted();
      sh.on('auth', (a) => this._onAuth(a));
      sh.on('saved', (ok) => { this.cloudState = ok ? 'synced' : 'error'; this.d.ui.syncStatus(); });
      addEventListener('pagehide', () => this.flushCloud());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushCloud(); });
      const p = await sh.profile().catch(() => null);
      this._name = p ? p.displayName : null;
      this.cloudState = 'saving';
      await this.loadCloud(); // remote-first; seeds the slot from local when empty
      await this.loadSettings(); // platform KV wins over local defaults
      await this.loadBindings();
      return;
    }
    if (sh) sh.on('auth', (a) => this._onAuth(a));
    await this.loadBindings(); // defaults standalone (the SDK makes no call without a token)
  },
  _enterHosted() {
    const sh = SH();
    this.hosted = true;
    this.online = true;
    this.userId = sh.userId;
    this.gameKey = sh.slug;
  },
  _onAuth(a) {
    if (a && a.signedIn) {
      if (!this.hosted) this._enterHosted();
    } else if (this.hosted) {
      // Renewal refused: keep playing locally; the title offers sign-in again.
      this.hosted = false;
      this.online = false;
      this.cloudState = 'offline';
    }
    this.d.ui.authChanged?.(this.hosted);
  },

  canSignIn() { const sh = SH(); return !!(sh && sh.canSignIn()); },
  signIn() { const sh = SH(); return !!(sh && sh.signIn()); },
  inviteLink() { const sh = SH(); return this.hosted && sh ? sh.inviteLink() : null; },

  now() { return Date.now(); },
  utcToday() { return new Date(this.now()).toISOString().slice(0, 10); },

  /* ---- identity: profile nickname (SDK), "Player <id>" fallback. */
  async profileFor(userId) {
    const sh = SH();
    if (!userId) return 'Player ????????';
    if (!this.hosted || !sh) return `Player ${String(userId).slice(0, 8)}`;
    const p = await sh.profile(userId).catch(() => null);
    return p ? p.displayName : `Player ${String(userId).slice(0, 8)}`;
  },
  displayName() {
    if (this.hosted) return this._name || `Player ${String(this.userId || '').slice(0, 6)}`;
    return this.d.progress.data.name || 'Guest';
  },

  /* ---- cloud save: one slot via the SDK. localStorage stays the offline
     cache; the doc mirrors progress + settings and is loaded remote-first. */
  cloudDoc() {
    return { version: 1, progress: this.d.progress.data, settings: this.d.settings.data };
  },
  async loadCloud() {
    const sh = SH();
    if (!this.hosted || !sh) return;
    const doc = await sh.loadJSON();
    if (doc) {
      this._applyCloudDoc(doc); // conflict: remote wins
      this.cloudState = 'synced';
    } else if (this.d.hasLocalProgress && this.d.hasLocalProgress()) {
      sh.saveJSON(this.cloudDoc(), 0); // empty slot: seed it from the local copy
    } else {
      this.cloudState = 'synced';
    }
    this.d.ui.syncStatus();
  },
  _applyCloudDoc(doc) {
    if (!doc || typeof doc !== 'object') return;
    const { progress, settings } = this.d;
    this._applying = true;
    try {
      if (doc.progress && typeof doc.progress === 'object') {
        progress.data = { ...progress.data, ...doc.progress };
        progress.save();
      }
      if (doc.settings && typeof doc.settings === 'object') {
        settings.data = { ...settings.data, ...doc.settings };
        settings.save();
        this.d.applySettings?.();
      }
    } finally {
      this._applying = false;
    }
  },
  scheduleCloud() {
    const sh = SH();
    if (!this.hosted || this._applying || !sh) return;
    this.cloudState = 'saving';
    this.d.ui.syncStatus();
    sh.saveJSON(this.cloudDoc(), 2000); // debounced checkpoint
  },
  flushCloud() {
    const sh = SH();
    if (this.hosted && sh) sh.flushSave(true);
  },

  /* ---- settings KV: player preferences mirror to the platform. */
  async loadSettings() {
    const sh = SH();
    if (!this.hosted || !sh) return;
    const remote = await sh.getSettings().catch(() => ({}));
    const { settings } = this.d;
    const keys = Object.keys(this.d.defaultSettings || settings.data);
    let changed = false;
    this._applying = true;
    try {
      for (const k of keys) {
        if (remote && Object.prototype.hasOwnProperty.call(remote, k) && remote[k] != null) {
          settings.data[k] = remote[k];
          changed = true;
        }
      }
      if (changed) { settings.save(); this.d.applySettings?.(); }
    } finally { this._applying = false; }
    this._sentSettings = JSON.parse(JSON.stringify(this._settingsSnapshot()));
  },
  _settingsSnapshot() {
    const { settings } = this.d;
    const keys = Object.keys(this.d.defaultSettings || settings.data);
    return Object.fromEntries(keys.map((k) => [k, settings.data[k]]));
  },
  mirrorSettings() {
    const sh = SH();
    if (!this.hosted || this._applying || !sh) return;
    clearTimeout(this._settingsTimer);
    this._settingsTimer = setTimeout(() => {
      const now = this._settingsSnapshot();
      const diff = {};
      for (const [k, v] of Object.entries(now)) {
        if (JSON.stringify(v) !== JSON.stringify(this._sentSettings[k])) diff[k] = v;
      }
      if (!Object.keys(diff).length) return;
      this._sentSettings = JSON.parse(JSON.stringify(now));
      sh.patchSettings(diff);
    }, 600);
  },

  /* ---- controls: platform overrides of the declared bindings. */
  async loadBindings() {
    const sh = SH();
    if (!sh) return this.bindings;
    this.bindings = await sh.loadBindings(DEFAULT_BINDINGS).catch(() => this.bindings);
    this.d.ui.bindingsChanged?.(this.bindings);
    return this.bindings;
  },
  /** Action bound to a KeyboardEvent.code, or null. */
  actionFor(code) {
    for (const [action, codes] of Object.entries(this.bindings)) if (codes.includes(code)) return action;
    return null;
  },

  /* ---- daily: deterministic shared UTC-day seed from the device clock. */
  async getDaily() {
    const { C, R } = this.d;
    const date = this.utcToday();
    return { date, seed: R.dailySeed(date), excluded: false, config: C.dailyConfig(date, R.dailySeed(date)) };
  },

  /* ---- Post a finished round's total to the platform high-score board via
     the game's score script (score-script.js). Resolves { posted, rank }. */
  async submitScore(total) {
    const sh = SH();
    if (!this.hosted || !sh) return { posted: false, rank: null };
    const keys = await sh.submitScores({ 'high-score': total });
    if (!keys.includes('high-score')) return { posted: false, rank: null };
    try {
      const r = await sh.leaderboard('high-score', { pageSize: 100 });
      const me = ((r && r.items) || []).find(i => i.userId === this.userId);
      return { posted: true, rank: me ? me.rank : null };
    } catch { return { posted: true, rank: null }; }
  },

  /* ---- leaderboards: platform boards (hosted only). Local personal
     records always remain. */
  async gameInfo() {
    const sh = SH();
    if (this._gameInfo !== undefined) return this._gameInfo;
    this._gameInfo = sh ? await sh.getGame().catch(() => null) : null;
    return this._gameInfo;
  },
  async leaderboard(board, date) {
    const { localBoard } = this.d;
    const sh = SH();
    if (this.hosted && sh) {
      const info = await this.gameInfo();
      let lbId = info && info.leaderboardId;
      if (!lbId) {
        const boards = await sh.leaderboards().catch(() => []);
        lbId = boards && boards[0] && boards[0].id;
      }
      if (lbId && board !== 'daily') {
        const opts = { page: 1, pageSize: 20 };
        if (board === 'friends') opts.scope = 'friends';
        const data = await sh.leaderboardEntries(lbId, opts);
        const items = Array.isArray(data.items) ? data.items : (Array.isArray(data.entries) ? data.entries : []);
        if (items.length || data.total === 0) {
          const entries = await Promise.all(items.slice(0, 20).map(async (e) => {
            const uid = e.userId ?? e.user_id ?? null;
            return {
              name: await this.profileFor(uid),
              score: e.score ?? 0,
              durationMs: e.elapsedMs ?? e.elapsed_ms ?? e.durationMs ?? 0,
              mine: uid != null && uid === this.userId,
            };
          }));
          return { entries, note: board === 'friends'
            ? 'Platform friends board.'
            : 'Platform board. Personal bests are kept in your profile.' };
        }
      }
      return {
        entries: localBoard.all(board),
        note: lbId
          ? 'Daily records are kept on this device; global and friends boards are platform-wide.'
          : 'No platform board for this game yet — showing local records.',
      };
    }
    return { entries: localBoard.all(board), note: 'Casual board — scores are recorded locally.' };
  },
};
