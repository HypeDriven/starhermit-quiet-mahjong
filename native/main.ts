// Quiet Mahjong on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js) and the content
// (js/content.js) are the browser build's, unchanged; this module is what
// js/main.js did around them — the screens' flow (title → modes → setup →
// play ⇄ pause → results, help, score chase, profile), the session (every
// mutation through rules.apply, the ordered command log, the one-second
// clock ticks, the local snapshot offered back on the title), keyboard and
// gamepad focus over the free tiles, the pointer's tap-to-select and drag
// orbit, lessons, progression, achievements, the local board and posting to
// the high-score board, announcements, toasts and sound captions, and the
// lifecycle (a hidden window pauses a solo round; the Daily's clock keeps
// running and catches up, as visibilitychange did). Screens are drawn by
// screens.ts (starhermit:ui), the garden by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps at 60 Hz: an active round's clock sends
// the rules a 1000 ms tick every 60 steps (the browser build sent one per
// wall-clock second), so pauses and slow frames never cost time and play
// scripts replay exactly.
import "./i18n.ts";
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, player, requestSignIn } from "starhermit:platform";
import { C, R, type Command, type Config, type ContentRef, type Lesson, type RulesEvent, type Stage, type State, type Challenge, type BoardEntry } from "./game.ts";
import * as audio from "./audio.ts";
import { N, S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export type Screen = "title" | "modes" | "setup" | "play" | "pause" | "results" | "help" | "scores" | "profile";
export type Pending =
  | { kind: "practice"; tier: string }
  | { kind: "journey" }
  | { kind: "journey-stage"; stage: Stage }
  | { kind: "challenge" }
  | { kind: "challenge-one"; challenge: Challenge }
  | { kind: "daily"; date: string; config: Config };
export interface Toast { text: string; until: number }

export const MODE_NAMES: Record<string, string> = { learn: N("Learn"), journey: N("Journey"), daily: N("Daily"), practice: N("Practice"), challenge: N("Challenge") };
const FAMILY_NAMES: Record<string, string> = { moon: N("moon"), petal: N("petal"), wave: N("wave"), stone: N("stone"), wind: N("wind"), star: N("star"), lantern: N("lantern") };
export const faceLabel = (face: string): string => { const [fam, r] = String(face).split("-"); return FAMILY_NAMES[fam!] ? `${T(FAMILY_NAMES[fam!]!)} ${r}` : R.faceName(face); };
const CAPTIONS: Record<string, string> = {
  select: N("select"), deselect: N("deselect"), remove: N("remove"), invalid: N("invalid"), hint: N("hint"),
  undo: N("undo"), shuffle: N("shuffle"), won: N("won"), lost: N("lost"), pause: N("pause"),
};

export const app = {
  screen: "title" as Screen,
  /** Frame the screen opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  focusNext: null as string | null,
  pending: null as Pending | null,
  /** Help or Settings opened from the pause sheet (or Settings' Help) go back to it. */
  helpFromSettings: false,
  /** Keyboard / gamepad focus over the free tiles. */
  focusId: null as number | null,
  /** The focus was moved by keys or a pad (the focus ring shows only then). */
  keyFocus: false,
  toast: null as Toast | null,
  appToast: null as Toast | null,
  caption: null as Toast | null,
  scoresBoard: "global" as "global" | "daily" | "friends",
  scores: null as { entries: { name: string; score: number; durationMs: number; mine: boolean }[]; note: string } | "loading" | null,
  lb: null as platform.Posted | "posting" | null,
  nameDraft: "",
};
export const session = {
  state: null as State | null,
  config: null as Config | null,
  commands: [] as Command[],
  sessionId: "",
  contentRef: null as ContentRef | null,
  finished: false,
  newUnlocks: [] as string[],
};
const now = (): number => frame().time;
const reduced = (): boolean => preferences().reducedMotion;
const newId = (): string => { try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2, 12); } };

// ------------------------------------------------------------------ helpers
let lastAnnouncement = "";
/** The live region (repeated text gets a trailing space so screen readers say it again). */
export function announce(text: string, assertive = false): void {
  if (!text) return;
  if (text === lastAnnouncement) text += " ";
  lastAnnouncement = text;
  try { ui.announce(text.slice(0, 600), { politeness: assertive ? "assertive" : "polite" }); } catch { /* one a frame */ }
}
/** The round's message line (#hud-message, 2.6 s). */
export function toast(text: string, seconds = 2.6): void { app.toast = { text, until: now() + seconds }; }
/** The toast seen on every screen (#app-toast, 3.2 s). */
export function appToast(text: string, seconds = 3.2): void { app.appToast = { text, until: now() + seconds }; }
/** A sound with its caption (Captions: "♪ …" for 1.4 s). */
export function sfx(event: string): void {
  const cap = audio.play(event);
  if (cap && platform.options.captions) app.caption = { text: `♪ ${T(CAPTIONS[cap] ?? cap)}`, until: now() + 1.4 };
}
function haptic(ms: number): void { try { vibrate(ms); } catch { /* not here */ } }
export function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function show(screen: Screen, focus: string | null = "first"): void {
  if (screen !== "help" && screen !== "pause") app.helpFromSettings = false;
  app.screen = screen;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  ui.setFocus(null);
}
const pendingActs: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built (state changes mid-build would break later widgets). */
export function later(fn: () => void): void { pendingActs.push(fn); }
export const inRound = (): boolean => !!session.state;

// ------------------------------------------------------------------ session
function themeFor(ref: ContentRef | null): void {
  let id = platform.options.theme;
  if (ref?.stageId) id = C.JOURNEY_STAGES.find((s) => s.id === ref.stageId)?.theme ?? id;
  else if (ref?.challengeId) id = C.CHALLENGES.find((c) => c.id === ref.challengeId)?.theme ?? id;
  render.setTheme(C.themeById(id));
}

let tickSteps = 0;
export function startRound(config: Config, contentRef: ContentRef | null = null): void {
  themeFor(contentRef);
  session.config = config;
  session.contentRef = contentRef;
  session.state = R.init(config);
  session.commands = [];
  session.sessionId = newId();
  session.finished = false;
  session.newUnlocks = [];
  app.focusId = null;
  app.lb = null;
  tickSteps = 0;
  render.clearHint();
  show("play", null);
  syncAll();
  announce(T("{mode} round started. {n} tiles.", { mode: T(MODE_NAMES[config.mode] ?? config.mode), n: session.state.tiles.length }));
  saveSnapshot();
}

/** All simulation mutation goes through here. */
export function command(cmd: Command): { error?: string } {
  if (!session.state) return { error: "no-round" };
  const r = R.apply(session.state, cmd);
  session.commands.push(cmd);
  handleEvents(r.events || []);
  if (r.error) explainError(r.error);
  syncAll();
  saveSnapshot();
  return r;
}
function handleEvents(events: RulesEvent[]): void {
  const st = session.state!;
  for (const e of events) {
    switch (e.type) {
      case "select": sfx("select"); haptic(8); break;
      case "deselect": sfx("deselect"); break;
      case "remove":
        sfx("remove"); haptic(20);
        for (const id of e.ids ?? []) { const t = st.tiles.find((x) => x.id === id); if (t) render.burstAt(t); }
        announce(T("Removed pair {face}. {n} pairs gone, streak {streak}.", { face: faceLabel(e.face!), n: st.pairsRemoved, streak: e.streak! }));
        break;
      case "invalid": sfx("invalid"); haptic(30); break;
      case "hint": sfx("hint"); render.showHint(e.ids ?? []); break;
      case "undo": sfx("undo"); break;
      case "shuffle": sfx("shuffle"); break;
      case "won": sfx("won"); queueMicrotask(finish); break;
      case "lost": sfx("lost"); queueMicrotask(finish); break;
    }
  }
}
function explainError(err: string): void {
  const msg = {
    [R.ERR.NOT_FREE!]: N("That tile is covered or blocked on both sides."),
    [R.ERR.MISMATCH!]: N("Those faces do not match."),
    [R.ERR.NOT_FOUND!]: N("That tile is already gone."),
    [R.ERR.NO_UNDO!]: N("Undo is not available here."),
    [R.ERR.NO_SHUFFLE!]: N("Shuffle is not available here."),
    [R.ERR.NO_HINT!]: N("No hint available."),
    [R.ERR.MOVE_LIMIT!]: N("Move limit reached."),
    [R.ERR.TIME_LIMIT!]: N("Time is up."),
  }[err];
  if (msg) { toast(T(msg)); announce(T(msg), true); }
}
function syncAll(): void {
  if (session.state) render.syncBoard(session.state);
  if (app.focusId != null && !R.freeTiles(session.state!).some((t) => t.id === app.focusId)) app.focusId = null;
}

function saveSnapshot(): void {
  const st = session.state;
  if (!st || st.status === "won" || st.status === "lost") return;
  platform.device.saveSnapshot(session.config!, session.commands, session.contentRef, platform.nowMs());
}
/** The title's Resume round: the interrupted round replayed from its command log. */
export function hasSnapshot(): boolean { return platform.device.loadSnapshot() != null; }
export function resumeSnapshot(): void {
  const snap = platform.device.loadSnapshot();
  if (!snap) return;
  themeFor(snap.contentRef);
  const { state } = R.replay(snap.config, snap.commands);
  session.config = snap.config;
  session.contentRef = snap.contentRef;
  session.state = state;
  session.commands = [...snap.commands];
  session.sessionId = newId();
  session.finished = false;
  session.newUnlocks = [];
  app.focusId = null;
  app.lb = null;
  tickSteps = 0;
  render.clearHint();
  show("play", null);
  syncAll();
  toast(T("Round restored from your last safe snapshot."));
}

/** The authoritative clock: a 1000 ms tick every 60 fixed steps while the round is active and shown. */
function tickStep(): void {
  const st = session.state;
  if (!st || st.status !== "active" || app.screen !== "play") { tickSteps = 0; return; }
  if (++tickSteps < 60) return;
  tickSteps = 0;
  command({ t: "tick", ms: 1000 });
}

function finish(): void {
  if (session.finished || !session.state) return; // terminal events fire once per round
  session.finished = true;
  const s = session.state;
  const p = platform.progress();
  platform.device.clearSnapshot();
  if (s.status === "won") {
    p.stats.wins++;
    const score = R.totalScore(s);
    p.stats.bestScore = Math.max(p.stats.bestScore, score);
    p.stats.pairsTotal += s.pairsRemoved;
    checkAchievements(s);
    if (session.contentRef?.stageId) p.journey[session.contentRef.stageId] = { score, ms: s.elapsedMs };
    if (s.config.mode === "daily" && s.config.dateIso) p.dailies[s.config.dateIso] = { score };
    addLocalEntry(s);
  }
  p.stats.rounds++;
  platform.saveNow();
  if (s.reason !== "resigned") showResults();
  postToLeaderboard();
}
function addLocalEntry(s: State): void {
  const entry: BoardEntry = {
    name: displayName(), sessionId: session.sessionId, board: s.config.mode === "daily" ? "daily" : "global", date: s.config.dateIso ?? null,
    score: R.totalScore(s), durationMs: s.elapsedMs, seed: s.config.seed, tier: s.config.tier, ruleset: R.RULES_VERSION,
    contentVersion: s.config.contentVersion ?? 1, assists: { hints: s.hints, shuffles: s.shuffles, undos: s.undos }, at: platform.nowMs(),
  };
  platform.device.addBoardEntry(entry);
}
// Signed in only: Journey, Daily and Challenge rounds (not Learn or Practice, not a resigned round) post their total to the high-score board.
function postToLeaderboard(): void {
  const s = session.state!;
  app.lb = null;
  if (!platform.signedIn() || ["learn", "practice"].includes(s.config.mode) || s.reason === "resigned") return;
  app.lb = "posting";
  void platform.postScore(R.totalScore(s)).then((r) => { if (session.state === s) app.lb = r; });
}
export function leaderboardLine(): string | null {
  const r = app.lb;
  if (!r) return null;
  if (r === "posting") return S("lbPosting");
  return !r.posted ? S("lbNotPosted") : r.rank ? S("lbRank", { rank: r.rank }) : S("lbPosted");
}
function unlock(key: string): boolean {
  const p = platform.progress();
  if (p.achievements[key]) return false; // idempotent
  p.achievements[key] = platform.nowMs();
  const def = C.ACHIEVEMENTS.find((a) => a.key === key);
  const msg = T("Achievement unlocked: {name}", { name: def ? T(def.name) : key });
  toast(msg);
  announce(msg);
  return true;
}
function checkAchievements(s: State): void {
  const p = platform.progress();
  session.newUnlocks = [];
  const got = (key: string): void => { if (unlock(key)) session.newUnlocks.push(key); };
  got("first-clear");
  if (s.hints === 0 && s.shuffles === 0 && s.undos === 0) got("mechanic-mastery");
  if (s.bestStreak >= 8) got("streak-8");
  if (session.contentRef?.mastery) got("mastery-stage");
  // as in the browser build, the round being finished is recorded after this check (Known limitations in spec.md)
  if (Object.keys(p.journey).length >= C.JOURNEY_STAGES.length) got("journey-40");
  if (Object.keys(p.dailies).length >= 7) got("daily-7");
}
function showResults(): void {
  const s = session.state!;
  announce(`${s.status === "won" ? T("Board clear") : T("Round over")}. ${resultsSub(s)} ${T("Total score {n}.", { n: R.totalScore(s) })}`, true);
  show("results", "btn-retry");
}
export function resultsSub(s: State): string {
  const sub = ({
    cleared: N("Every pair found. The garden is quiet again."), "move-limit": N("The move limit was reached."), "time-limit": N("Time ran out."),
    "no-moves": N("No legal pairs remained."), resigned: N("You left the table early."),
  } as Record<string, string>)[s.reason ?? ""];
  return sub ? T(sub) : "";
}
export function nextRecommendation(): { label: string; run: () => void } | null {
  const ref = session.contentRef;
  if (ref?.stageId) {
    const idx = C.JOURNEY_STAGES.findIndex((st) => st.id === ref.stageId);
    if (idx >= 0 && idx + 1 < C.JOURNEY_STAGES.length) {
      const st = C.JOURNEY_STAGES[idx + 1]!;
      return { label: T("Next: {name}", { name: T(st.name) }), run: () => setupJourneyStage(st) };
    }
  }
  if (ref?.lessonId) {
    const idx = C.LESSONS.findIndex((l) => l.id === ref.lessonId);
    if (idx >= 0 && idx + 1 < C.LESSONS.length) {
      const l = C.LESSONS[idx + 1]!;
      return { label: T("Next lesson: {name}", { name: T(l.title) }), run: () => startLesson(l) };
    }
  }
  return null;
}
export function retry(): void {
  if (!session.config) return;
  const config = { ...session.config }, ref = session.contentRef;
  leaveTable();
  startRound(config, ref);
}

// ------------------------------------------------------------------ round control
export function pauseRound(): void {
  const st = session.state;
  if (!st || st.status !== "active") return;
  command({ t: "pause" });
  sfx("pause");
  show("pause", "btn-resume");
}
export function resumeRound(): void {
  if (!session.state) { show("title"); return; } // Settings opened from the title
  if (session.state.status !== "paused") { show("play", null); return; }
  tickSteps = 0;
  command({ t: "resume" });
  show("play", null);
}
function leaveTable(): void {
  session.state = null;
  session.config = null;
  session.contentRef = null;
  app.focusId = null;
  render.clearBoard();
}
/** Leave round (and Home on the results): a live round is resigned (counted, not posted), then the title. */
export function leaveRound(): void {
  const st = session.state;
  if (st && (st.status === "active" || st.status === "paused")) {
    command({ t: "resign" });
    finish();
  }
  leaveTable();
  platform.device.clearSnapshot();
  show("title");
}
export function tapTile(id: number): void {
  const st = session.state;
  if (!st || st.status !== "active" || app.screen !== "play") return;
  command({ t: "tap", id });
}
export const hint = (): void => { if (app.screen === "play") command({ t: "hint" }); };
export const shuffle = (): void => { if (app.screen === "play") command({ t: "shuffle" }); };
export const undo = (): void => { if (app.screen === "play") command({ t: "undo" }); };
export function resetCamera(): void { render.resetCamera(); sfx("select"); }

// ------------------------------------------------------------------ mode setup
export function startLesson(lesson: Lesson): void {
  const cfg: Config = { mode: "learn", tier: lesson.tier, seed: lesson.seed, allowUndo: true, allowShuffle: true, allowHints: true, parMs: 5 * 60000 };
  startRound(cfg, { lessonId: lesson.id, text: lesson.text, mastery: false });
  toast(T(lesson.text), 6);
}
export function openMode(m: string): void {
  if (m === "learn") startLesson(C.LESSONS[platform.options.tutorialDone ? 1 : 0]!);
  else if (m === "journey") setupJourney();
  else if (m === "daily") setupDaily();
  else if (m === "practice") setupPractice();
  else if (m === "challenge") setupChallenge();
  else if (m === "scores") showScores("global");
}
export function setupPractice(tier = "medium"): void { app.pending = { kind: "practice", tier }; show("setup"); }
export function setupJourney(): void { app.pending = { kind: "journey" }; show("setup"); }
export function setupJourneyStage(stage: Stage): void { app.pending = { kind: "journey-stage", stage }; show("setup", "btn-start"); }
export function setupChallenge(): void { app.pending = { kind: "challenge" }; show("setup"); }
export function setupChallengeOne(challenge: Challenge): void { app.pending = { kind: "challenge-one", challenge }; app.openedFrame = frame().frame; app.focusNext = "btn-start"; }
export function setupDaily(): void {
  const date = platform.utcToday();
  const seed = R.dailySeed(date);
  app.pending = { kind: "daily", date, config: C.dailyConfig(date, seed) };
  show("setup", "btn-start");
}
export function startPending(): void {
  const p = app.pending;
  if (!p) return;
  let cfg: Config | null = null, ref: ContentRef | null = null;
  if (p.kind === "practice") {
    cfg = { mode: "practice", tier: p.tier, seed: (Math.random() * 0xffffffff) >>> 0, allowUndo: true, allowShuffle: true, allowHints: true, parMs: 8 * 60000 };
  } else if (p.kind === "journey" || p.kind === "journey-stage") {
    // the list screen's Start continues at the first uncleared stage
    const done = platform.progress().journey;
    const st = p.kind === "journey-stage" ? p.stage : C.JOURNEY_STAGES.find((s) => !done[s.id]) ?? C.JOURNEY_STAGES[0]!;
    cfg = { ...st.config };
    ref = { stageId: st.id, mastery: st.mastery };
  } else if (p.kind === "challenge" || p.kind === "challenge-one") {
    const ch = p.kind === "challenge-one" ? p.challenge : C.CHALLENGES[0]!;
    cfg = { ...ch.config };
    ref = { challengeId: ch.id };
  } else if (p.kind === "daily") {
    cfg = { ...p.config };
    ref = { date: p.date };
  }
  if (cfg) startRound(cfg, ref);
}

// ------------------------------------------------------------------ score chase, profile, account
export function displayName(): string {
  const me = player();
  if (me) return me.displayName || T("Player {id}", { id: me.userId.slice(0, 6) });
  return platform.progress().name || T("Guest");
}
export function showScores(board: "global" | "daily" | "friends"): void {
  app.scoresBoard = board;
  if (app.screen !== "scores") show("scores");
  const p = platform.progress();
  const local = (): { name: string; score: number; durationMs: number; mine: boolean }[] =>
    platform.device.board(board, p.friends, p.name).map((e) => ({ name: e.name, score: e.score, durationMs: e.durationMs || 0, mine: e.name === displayName() }));
  if (!platform.signedIn()) { app.scores = { entries: local(), note: T("Casual board — scores are recorded locally.") }; return; }
  if (board === "daily") { app.scores = { entries: local(), note: T("Daily records are kept on this device; global and friends boards are platform-wide.") }; return; }
  app.scores = "loading";
  void platform.onlineBoard(board === "friends").then((rows) => {
    if (app.scoresBoard !== board) return;
    if (!rows) { app.scores = { entries: local(), note: T("No platform board for this game yet — showing local records.") }; return; }
    app.scores = {
      entries: rows.map((r) => ({ name: r.name, score: r.score, durationMs: 0, mine: r.mine })),
      note: board === "friends" ? T("Platform friends board.") : T("Platform board. Personal bests are kept in your profile."),
    };
  });
}
export function showProfile(): void { app.nameDraft = platform.progress().name; show("profile"); }
export function setGuestName(name: string): void {
  if (platform.signedIn()) return; // a signed-in name comes from the account
  platform.progress().name = name.slice(0, 24);
  platform.saveNow();
}
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); appToast(S("inviteCopied")); } catch { appToast(S("inviteLink", { url: link }), 8); }
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }

// ------------------------------------------------------------------ keyboard / gamepad focus
function freeSorted(): { id: number; x: number; y: number; z: number }[] {
  if (!session.state) return [];
  return R.freeTiles(session.state).sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}
/** Directional navigation among legal targets only (main.js moveFocus). */
export function moveFocus(dx: number, dy: number): void {
  const free = freeSorted();
  if (!free.length) return;
  app.keyFocus = true;
  const cur = free.find((t) => t.id === app.focusId);
  if (!cur) app.focusId = free[0]!.id;
  else {
    let best: typeof cur | null = null, bestD = 1e9;
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
    if (best) app.focusId = best.id;
    else {
      const i = free.findIndex((t) => t.id === cur.id);
      app.focusId = free[(i + 1) % free.length]!.id;
    }
  }
  const t = session.state!.tiles.find((x) => x.id === app.focusId)!;
  announce(tileLabel(t, true, session.state!.selected === t.id));
}
/** The tile's accessible name (the board mirror's aria-label). */
export function tileLabel(t: { face: string; z: number }, free: boolean, selected: boolean): string {
  const key = free ? (selected ? N("{face}, layer {z}, free, selected") : N("{face}, layer {z}, free"))
    : (selected ? N("{face}, layer {z}, blocked, selected") : N("{face}, layer {z}, blocked"));
  return T(key, { face: faceLabel(t.face), z: t.z + 1 });
}

// ------------------------------------------------------------------ input
const MOVES: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
onAction((e) => {
  if (!e.pressed) return;
  if (frame().frame === app.openedFrame || ui.capturingKeys()) return;
  if (app.screen !== "play") {
    if (e.action === "pause" && app.screen === "pause") resumeRound();
    return;
  }
  switch (e.action) {
    case "pause": pauseRound(); break;
    case "hint": hint(); break;
    case "undo": undo(); break;
    case "shuffle": shuffle(); break;
    case "camera": resetCamera(); break;
    case "left": case "right": case "up": case "down": {
      // board focus, not the UI's: arrows must not also walk the HUD buttons
      ui.setFocus(null);
      const [dx, dy] = MOVES[e.action]!;
      moveFocus(dx, dy);
      break;
    }
    case "select":
      // a focused HUD button takes Enter / Space itself
      if (app.focusId != null && ui.focused() == null) tapTile(app.focusId);
      break;
  }
});

/** HUD rectangles (window pixels) where a press belongs to the UI, set by screens.ts each frame. */
export const hudRects: { x: number; y: number; width: number; height: number }[] = [];
const onHud = (x: number, y: number): boolean => hudRects.some((r) => x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height);
type PEvent = { kind: "down" | "move" | "up" | "cancel"; x: number; y: number; id: number; t: number };
const pevents: PEvent[] = [];
let lastTouch = -1e9;
onTouch((e) => {
  lastTouch = now();
  if (e.control) return;
  const kind = e.phase === "start" ? "down" : e.phase === "move" ? "move" : e.phase === "end" ? "up" : "cancel";
  pevents.push({ kind, x: e.x, y: e.y, id: e.id, t: now() });
});
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  pevents.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y, id: -1, t: now() });
});
onPointerMove((x, y) => { if (now() - lastTouch >= 0.6) pevents.push({ kind: "move", x, y, id: -1, t: now() }); });
let downAt: (PEvent & { moved: boolean }) | null = null;
/** The stage's pointer handling, decided once the frame's UI is built: a short still press picks a tile; a drag past 12 px orbits. */
function pointerInput(): void {
  const sc = ui.preferences().scale;
  const live = app.screen === "play" && session.state?.status === "active";
  for (const ev of pevents.splice(0)) {
    if (ev.kind === "down") {
      downAt = live && !onHud(ev.x, ev.y) ? { ...ev, moved: false } : null;
      if (downAt) { ui.setFocus(null); app.keyFocus = false; }
      continue;
    }
    const d = downAt;
    if (!d || d.id !== ev.id) continue;
    if (ev.kind === "move") {
      const dx = (ev.x - d.x) / sc, dy = (ev.y - d.y) / sc;
      if (Math.hypot(dx, dy) > 12) d.moved = true;
      if (d.moved) render.orbit(dx, dy);
      continue;
    }
    downAt = null;
    if (ev.kind === "cancel" || d.moved || ev.t - d.t > 0.6 || !live) continue;
    const id = render.pick(ev.x, ev.y);
    if (id != null) tapTile(id);
  }
}

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}

onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(reduced());
  render.setPalette(platform.options.palette);
  render.setTheme(C.themeById(platform.options.theme));
  applyLook();
  show("title");
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(() => {
  render.setPalette(platform.options.palette);
  if (!session.state) render.setTheme(C.themeById(platform.options.theme));
  else themeFor(session.contentRef);
});
platform.onPlayer((on) => { if (!on) appToast(S("signedOut")); });
onSessionEnded(() => appToast(S("signedOut"))); // keep playing locally
let hidden = false;
let hiddenAt = 0;
onSuspend(() => {
  hidden = true;
  hiddenAt = Date.now();
  platform.flush();
  // backgrounding pauses a solo round; the Daily's clock keeps running (caught up on return)
  if (session.state?.status === "active" && session.state.config.mode !== "daily" && app.screen === "play") pauseRound();
  audio.setSuspended(true);
});
onResume(() => {
  hidden = false;
  audio.setSuspended(false);
  const st = session.state;
  if (st?.status === "active" && st.config.mode === "daily") {
    const away = Date.now() - hiddenAt;
    if (away > 2000) {
      command({ t: "tick", ms: Math.floor(away) });
      toast(T("While you were away: {time} elapsed on the daily clock.", { time: fmtTime(away) }));
    }
  }
});

onFixedUpdate(() => {
  if (hidden) return;
  tickStep();
});
onUpdate(() => {
  applyLook();
  applyTokens(ui.preferences().highContrast);
  audio.update();
  const t = now();
  if (app.toast && app.toast.until <= t) app.toast = null;
  if (app.appToast && app.appToast.until <= t) app.appToast = null;
  if (app.caption && app.caption.until <= t) app.caption = null;
});
onRender(() => {
  hudRects.length = 0;
  render.update();
  drawScreens();
  for (const fn of pendingActs.splice(0)) fn();
  pointerInput();
});
