// The browser build's DOM shell (index.html + css/style.css) as starhermit:ui,
// built every frame over the 3D garden: the title panel, the mode cards, the
// setup panel (facts, practice sizes, Journey stages, challenges), the play
// HUD (objective and progress, timer and limit, score, pause; Hint, Shuffle,
// Undo and Camera; the message line and sound captions; the free tiles'
// outlines, accessibility targets over every live tile and the keyboard focus
// ring), the pause / settings sheet, results, help, score chase and profile.
// The browser's media queries are layouts picked by the window's logical
// size: wide (≥ 1024 px: the actions at the bottom right), portrait phone
// (≤ 700 px wide, portrait: a full-width thumb tray) and short landscape
// (≤ 480 px tall: a narrow status rail at the left, the actions in a column
// at the right).
import { frame, openMenu } from "starhermit:engine";
import { bindingLabel, primaryPointer, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { C, R, Store, type State } from "./game.ts";
import { N, S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import { token } from "./style.ts";
import {
  app, copyInvite, displayName, fmtTime, hasSnapshot, hint, hudRects, inRound, later, leaderboardLine, leaveRound,
  nextRecommendation, openMode, pauseRound, resetCamera, resultsSub, resumeRound, resumeSnapshot, retry, session, setGuestName,
  setupChallengeOne, setupJourneyStage, setupPractice, show, showProfile, showScores, shuffle, signIn, startLesson, startPending,
  tileLabel, undo,
} from "./main.ts";

// ------------------------------------------------------------------ layout and helpers
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; phone: boolean; short: boolean; wide: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, ox: sa.left, oy: sa.top, phone: lw <= 700 && lh >= lw, short: lh <= 480 && lw > lh, wide: lw >= 1024 };
}
const fresh = (n = 0): boolean => frame().frame - app.openedFrame <= n;
const tw = (text: string, style: string, kind?: "button" | "heading"): number =>
  ui.measureText(text, { ...(kind ? { kind } : {}), style }).width / ui.preferences().scale;
let firstId: string | null = null;

/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "p", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (tw(text, cls) <= width) u.label(text);
  else u.paragraph(text, width);
}
function heading(cls: string, text: string, width: number): void {
  if (tw(text, cls, "heading") <= width) ui.style(cls).heading(text);
  else ui.style(cls).paragraph(text, width);
}
interface Btn { id: string; text: string; cls?: string; disabled?: boolean; selected?: boolean; act: () => void }
const btnW = (b: Btn): number => tw(b.text, b.cls ?? "btn", "button");
/** A button `width` wide (null: its text's); a label wider than that wraps. */
function button(b: Btn, width: number | null = null): boolean {
  const cls = b.cls ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected) opts.selected = true;
  if (width != null && btnW(b) > width) {
    const inner = Math.max(20, width - (btnW(b) - tw(b.text, cls)));
    opts.content = () => { ui.style(cls, { background: "#00000000", border: { width: 0 }, padding: 0, minWidth: 0, minHeight: 0 } as ui.Style).paragraph(b.text, inner); };
  }
  if (!firstId && !b.disabled) firstId = b.id;
  const hit = ui.style(cls, width != null ? { width } : {}).id(b.id).button(b.text, opts);
  if (hit && !fresh(0)) later(b.act);
  return hit;
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap), centred or start-aligned. */
function flow(label: string, list: Btn[], width: number, gap = 8, center = false): void {
  const rows: Btn[][] = [];
  let used = 0, row: Btn[] = [];
  for (const b of list) {
    const bw = Math.min(width, btnW(b));
    if (row.length && used + gap + bw > width) { rows.push(row); used = 0; row = []; }
    used += (row.length ? gap : 0) + bw;
    row.push(b);
  }
  if (row.length) rows.push(row);
  ui.column(label, () => {
    rows.forEach((r, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of r) button(b, btnW(b) > width ? width : null);
    }, { spacing: gap, align: "center", ...(center ? { width, justify: "center" } : {}) }));
  }, { spacing: gap, width });
}
/** A grid of `min`-wide cells (CSS repeat(auto-fit, minmax(min, 1fr))). */
function cardGrid(id: string, w: number, min: number, n: number, cell: (i: number, cw: number) => void, gap = 10): void {
  const cols = Math.max(1, Math.min(n, Math.floor((w + gap) / (min + gap))));
  const cw = (w - gap * (cols - 1)) / cols;
  ui.grid(id, () => { for (let i = 0; i < n; i++) cell(i, cw); }, { columns: cols, gap, width: w, align: "stretch" });
}
/** .card: a button with a bold title and a muted line. */
function card(id: string, title: string, sub: string, cw: number, act: () => void, opts: { primary?: boolean; selected?: boolean } = {}): void {
  const cls = opts.primary ? "card-primary" : "card";
  const inner = cw - 34;
  if (!firstId) firstId = id;
  const hit = ui.style(cls, { width: cw }).id(id).button(`${title}. ${sub}`, {
    ...(opts.selected ? { selected: true } : {}),
    content: () => {
      ui.column(`${id}-face`, () => {
        const titleStyle = opts.primary ? ["card-title", { text: { color: "$on-accent" } }] : ["card-title"];
        if (tw(title, "card-title") <= inner) ui.style(...(titleStyle as [string])).label(title);
        else ui.style(...(titleStyle as [string])).paragraph(title, inner);
        if (sub) {
          const subStyle = opts.primary ? ["card-sub", { text: { color: "$on-accent" } }] : ["card-sub"];
          if (tw(sub, "card-sub") <= inner) ui.style(...(subStyle as [string])).label(sub);
          else ui.style(...(subStyle as [string])).paragraph(sub, inner);
        }
      }, { spacing: 4, width: inner });
    },
  });
  if (hit && !fresh(0)) later(act);
}
/** A check box with a wrapping label (the settings' <label><input type=checkbox> rows). */
function checkRow(id: string, label: string, checked: boolean, w: number, toggle: () => void): void {
  ui.row(`${id}-row`, () => {
    const r = ui.id(id).widget(label, {
      role: "checkbox", checked, size: { width: 22, height: 22 },
      draw: (rc, st) => {
        const k = st.scale;
        draw.box(rc.x, rc.y, rc.width, rc.height, { background: checked ? token("accent-strong") : token("field"), radius: 4, border: { width: 1.5, color: checked ? token("accent-strong") : token("muted") } } as ui.Style);
        if (checked) {
          draw.line(rc.x + 5 * k, rc.y + 11 * k, rc.x + 9 * k, rc.y + 16 * k, token("on-accent"), 2.5);
          draw.line(rc.x + 9 * k, rc.y + 16 * k, rc.x + 17 * k, rc.y + 6 * k, token("on-accent"), 2.5);
        }
      },
    });
    if (!firstId) firstId = id;
    if (r.activated && !fresh(0)) later(toggle);
    para(label, w - 34, "p");
  }, { width: w, spacing: 12, align: "center" });
}
function selectRow(id: string, label: string, index: number, options: string[], w: number, pickFn: (i: number) => void): void {
  const cw = Math.min(260, w * 0.55);
  ui.row(`${id}-row`, () => {
    para(label, w - cw - 12, "p");
    ui.spacer();
    const i = ui.id(id).select(label, index, options, { width: cw } as ui.WidgetOptions);
    if (i !== index && !fresh(0)) later(() => pickFn(i));
  }, { width: w, spacing: 12, align: "center" });
}
/** A binding as the browser build's keyLabel showed it (arrows as ↑ ↓ ← →, Escape as Esc). */
const SHORT: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
const keyText = (action: string): string => {
  let label = "";
  try { label = bindingLabel(action, "keyboard"); } catch { /* none */ }
  return label ? label.split(/(\s*[,/]\s*)/).map((p) => SHORT[p] ?? p).join("") : "—";
};
/** The effective keyboard bindings (bindingsChanged: "Up ↑ · Down ↓ · …"). */
function keysLine(): string {
  const order = ["up", "down", "left", "right", "select", "pause", "hint", "undo", "shuffle", "camera"];
  return order.map((a) => `${S("act_" + a)} ${keyText(a)}`).join(" · ");
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  firstId = null;
  const s = app.screen;
  if (session.state && (s === "play" || s === "pause" || s === "results" || s === "help")) playView(L, s === "play");
  if (s !== "play") page(s, L);
  appToast(L);
  if (app.focusNext) {
    const age = frame().frame - app.openedFrame;
    const target = app.focusNext === "first" ? (primaryPointer() === "coarse" ? null : firstId) : app.focusNext;
    if (age >= 1 && target) ui.setFocus(target);
    if (age >= 3) app.focusNext = null;
  }
}

const lastSize = new Map<string, number>();
const BUILDERS: Record<string, (w: number, L: Layout) => void> = {
  title: titleScreen, modes: modesScreen, setup: setupScreen, pause: pauseScreen, results: resultsScreen, help: helpScreen,
  scores: scoresScreen, profile: profileScreen,
};
const OVERLAYS = new Set(["pause", "results", "help", "scores", "profile"]);
/** .screen > .panel: a centred panel at most 70ch wide, 12 px from the edges, scrolling when taller. */
function page(key: string, L: Layout): void {
  const f = frame();
  if (OVERLAYS.has(key)) {
    // .screen.overlay dims the scene; it also keeps presses off the board
    ui.place("scrim", { anchor: "top-start", x: 0, y: 0 }, () => {
      ui.style("scrim").widget("scrim", { role: "none", size: { width: f.width / L.sc, height: f.height / L.sc } });
    });
  }
  const pad = L.wide ? 34 : L.phone ? 18 : 24;
  const padV = L.wide ? 28 : 20;
  const maxW = key === "setup" || key === "help" ? 640 : 560;
  const outer = Math.min(maxW + 2 * pad, L.lw - 24);
  const avail = L.lh - 24;
  const h = lastSize.get(key) ?? 0;
  const scroll = h + 2 * padV + 2 > avail;
  const inner = outer - 2 * pad - 2 - (scroll ? 14 : 0);
  const build = BUILDERS[key] ?? titleScreen;
  const top = scroll ? 12 : Math.max(12, (L.lh - h - 2 * padV) / 2);
  ui.place(`page-${key}`, { anchor: "top", y: top }, () => {
    ui.style("panel", { padding: { top: padV, bottom: padV, start: pad, end: pad } } as ui.Style).column(`${key}-panel`, () => {
      const body = (): void => {
        const r = ui.column(`${key}-col`, () => build(inner, L), { width: inner, spacing: 12 });
        lastSize.set(key, r.height / L.sc);
      };
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner + 14, height: avail - 2 * padV - 2 }, body, fresh(6) ? { scrollTo: { top: 0 } } : undefined);
      else body();
    }, { width: outer });
  });
}

// ------------------------------------------------------------------ title
function titleScreen(w: number): void {
  centered("title-h1", w, () => heading("h1", "Quiet Mahjong", w));
  centered("title-tag", w, () => para(T("A moonlit garden of ceramic pairs."), w, "tagline"));
  ui.row("play-row", () => {
    button({ id: "btn-play", cls: "big", text: T("Play"), act: () => show("modes") });
  }, { width: w, justify: "center" });
  if (hasSnapshot()) {
    ui.row("resume-row", () => {
      button({ id: "btn-resume-round", cls: "primary", text: T("Resume round"), act: resumeSnapshot });
    }, { width: w, justify: "center" });
  }
  const list: Btn[] = [
    { id: "btn-daily", cls: "ghost", text: T("Daily challenge"), act: () => openMode("daily") },
    { id: "btn-journey", cls: "ghost", text: T("Journey"), act: () => openMode("journey") },
    { id: "btn-profile", cls: "ghost", text: T("Profile"), act: showProfile },
    { id: "btn-settings", cls: "ghost", text: T("Settings"), act: () => show("pause") },
  ];
  if (platform.inviteLink()) list.push({ id: "btn-invite", cls: "ghost", text: S("invite"), act: copyInvite });
  flow("title-secondary", list, w, 8, true);
  if (!platform.signedIn()) {
    ui.row("signin-row", () => { button({ id: "btn-signin", cls: "ghost", text: S("signIn"), act: signIn }); }, { width: w, justify: "center" });
  }
  const status = (platform.signedIn() ? T("Signed in as {name}.", { name: displayName() }) : T("Offline — fully playable, scores kept locally."))
    + (hasSnapshot() ? " " + T("A round is in progress.") : "");
  centered("title-status-row", w, () => para(status, w, "muted-center", "title-status"));
}
function centered(id: string, w: number, build: () => void): void { ui.row(id, build, { width: w, justify: "center" }); }

// ------------------------------------------------------------------ modes
function modesScreen(w: number): void {
  heading("h2", T("Choose a mode"), w);
  const cards: [string, string, string][] = [
    ["learn", N("Learn"), N("Short interactive lessons, one rule at a time.")],
    ["journey", N("Journey"), N("40 authored stages with growing depth.")],
    ["daily", N("Daily"), N("One shared board per UTC day. Ranked.")],
    ["practice", N("Practice"), N("Pick a size, restart freely, undo allowed. Unranked.")],
    ["challenge", N("Challenge"), N("Move limits, speed targets, restricted tools.")],
    ["scores", N("Score chase"), N("Compare with global and friends boards.")],
  ];
  cardGrid("mode-cards", w, 180, cards.length, (i, cw) => {
    const [m, title, sub] = cards[i]!;
    card(`mode-${m}`, T(title), T(sub), cw, () => openMode(m));
  });
  backButton(w);
}
function backButton(w: number): void {
  ui.row("back-row", () => { button({ id: "btn-back", cls: "ghost", text: T("Back"), act: back }); }, { width: w });
}
/** [data-back]: Help goes back to the pause sheet over a round (or from Settings), Setup to the modes, the rest to the title. */
function back(): void {
  if (app.screen === "help" && (inRound() || app.helpFromSettings)) { show("pause", "btn-help"); app.helpFromSettings = !inRound(); return; }
  if (app.screen === "setup") { show("modes"); return; }
  if (app.screen === "results") { leaveRound(); return; }
  show("title");
}

// ------------------------------------------------------------------ setup
function facts(w: number, cfg: { mode: string; parMs: number; allowHints?: boolean; allowShuffle?: boolean; allowUndo?: boolean }, extra: [string, string][] = []): void {
  const rows: [string, string][] = [
    [T("Rules"), T("Remove matching pairs of free tiles")],
    [T("Duration"), T("about {n} min (par)", { n: Math.round(cfg.parMs / 60000) })],
    [T("Players"), "1"],
    [T("Assists"), [cfg.allowHints !== false ? T("hints") : null, cfg.allowShuffle !== false ? T("shuffles") : null, cfg.allowUndo ? T("undo") : null].filter(Boolean).join(", ") || T("none")],
    [T("Ranked"), (cfg.mode === "daily" || cfg.mode === "challenge" || cfg.mode === "journey") ? (platform.signedIn() ? T("platform board") : T("local records")) : T("no")],
    ...extra.map(([k, v]) => [T(k), v] as [string, string]),
  ];
  const kw = Math.min(w * 0.4, Math.max(...rows.map(([k]) => tw(k, "fact-key"))) + 14);
  ui.column("facts", () => {
    rows.forEach(([k, v], i) => ui.row(`fact-${i}`, () => {
      ui.style("fact-key", { width: kw }).label(k);
      para(v, w - kw, "fact-val");
    }, { width: w, spacing: 0 }));
  }, { spacing: 4, width: w });
}
function setupScreen(w: number): void {
  const p = app.pending;
  if (!p) { backButton(w); return; }
  const done = platform.progress().journey;
  if (p.kind === "practice") {
    heading("h2", T("Practice"), w);
    para(T("Relaxed play. Undo is allowed, restarts are free, and results never affect ratings."), w);
    facts(w, { mode: "practice", parMs: 8 * 60000, allowHints: true, allowShuffle: true, allowUndo: true });
    const tiers = Object.keys(R.LAYOUT_TIERS);
    cardGrid("tier-cards", w, 140, tiers.length, (i, cw) => {
      const tier = tiers[i]!;
      card(`tier-${tier}`, T(R.LAYOUT_TIERS[tier]!.name), T("{n} pairs", { n: R.LAYOUT_TIERS[tier]!.pairs }), cw, () => setupPractice(tier), { selected: tier === p.tier });
    });
  } else if (p.kind === "journey") {
    heading("h2", T("Journey"), w);
    para(T("Forty authored stages. A new idea appears alone, combines with a known one, then a mastery stage tests both."), w);
    facts(w, C.JOURNEY_STAGES[0]!.config, [[N("Stages"), T("{n} / 40 cleared", { n: Object.keys(done).length })]]);
    const nextIdx = C.JOURNEY_STAGES.findIndex((st) => !done[st.id]);
    cardGrid("stage-cards", w, 140, C.JOURNEY_STAGES.length, (i, cw) => {
      const st = C.JOURNEY_STAGES[i]!;
      const rec = done[st.id];
      card(`stage-${st.index}`, `${st.index}. ${T(st.name)}${st.mastery ? " ◆" : ""}`, rec ? T("cleared · {score}", { score: rec.score }) : T(R.LAYOUT_TIERS[st.config.tier]!.name),
        cw, () => setupJourneyStage(st), { primary: st.index === (nextIdx < 0 ? 40 : nextIdx + 1) });
    });
  } else if (p.kind === "journey-stage") {
    heading("h2", `${p.stage.index}. ${T(p.stage.name)}`, w);
    para(p.stage.mastery ? T("Mastery stage — no hints, tighter par.") : T("Journey stage."), w);
    facts(w, p.stage.config, [[N("Theme"), T(C.themeById(p.stage.theme).name)]]);
  } else if (p.kind === "challenge") {
    heading("h2", T("Challenge"), w);
    para(T("Constrained goals: move limits, speed targets, restricted tools."), w);
    facts(w, C.CHALLENGES[0]!.config);
    cardGrid("challenge-cards", w, 180, C.CHALLENGES.length, (i, cw) => {
      const ch = C.CHALLENGES[i]!;
      card(`challenge-${ch.id}`, T(ch.name), T(ch.description), cw, () => setupChallengeOne(ch));
    });
  } else if (p.kind === "challenge-one") {
    heading("h2", T(p.challenge.name), w);
    para(T(p.challenge.description), w);
    facts(w, p.challenge.config, [[N("Theme"), T(C.themeById(p.challenge.theme).name)]]);
  } else if (p.kind === "daily") {
    heading("h2", T("Daily — {date}", { date: p.date }), w);
    para(platform.signedIn()
      ? T("One shared seed for everyone (UTC day). Scores are kept as local records and also posted to the platform-wide board.")
      : T("One shared seed for everyone (UTC day). Scores are kept as local records on this device."), w);
    facts(w, p.config, [[N("Seed"), String(p.config.seed)], [N("Board"), T(R.LAYOUT_TIERS[p.config.tier]!.name)]]);
  }
  ui.row("setup-actions", () => {
    button({ id: "btn-start", cls: "primary", text: T("Start"), act: startPending });
    button({ id: "btn-back", cls: "ghost", text: T("Back"), act: back });
  }, { spacing: 10, align: "center" });
}

// ------------------------------------------------------------------ pause / settings
const PALETTE_NAMES: Record<string, string> = { standard: N("Standard"), deuteranopia: N("Deuteranopia-safe"), protanopia: N("Protanopia-safe"), tritanopia: N("Tritanopia-safe") };
function pauseScreen(w: number): void {
  const round = inRound();
  const o = platform.options;
  heading("h2", round ? T("Paused") : T("Settings"), w);
  if (round) ui.row("resume-row", () => { button({ id: "btn-resume", cls: "primary", text: T("Resume"), act: resumeRound }); }, { width: w });
  // the runtime's Options: volumes, graphics, language, larger text, high contrast, reduced motion, haptics
  heading("h3", T("Audio"), w);
  para(T("Volumes, graphics quality, language, larger text, high contrast, reduced motion and vibration are in the StarHermit Options."), w, "small");
  ui.row("options-row", () => { button({ id: "btn-options", cls: "btn", text: T("Open Options"), act: () => openMenu() }); }, { width: w });
  checkRow("set-captions", T("Captions for audio cues"), o.captions, w, () => platform.setOption("captions", !o.captions));
  heading("h3", T("Graphics"), w);
  const themes = Store.THEME_IDS;
  selectRow("set-theme", T("Theme"), Math.max(0, themes.indexOf(o.theme)), themes.map((id) => T(C.themeById(id).name)), w, (i) => platform.setOption("theme", themes[i]!));
  heading("h3", T("Controls & accessibility"), w);
  checkRow("set-left-handed", T("Left-handed controls"), o.leftHanded, w, () => platform.setOption("leftHanded", !o.leftHanded));
  const pals = Store.PALETTES;
  selectRow("set-palette", T("Color palette"), Math.max(0, pals.indexOf(o.palette)), pals.map((p) => T(PALETTE_NAMES[p]!)), w, (i) => platform.setOption("palette", pals[i]!));
  para(`${S("keyboard")}: ${keysLine()}`, w, "kbd-line", "settings-keys");
  ui.row("rebind-row", () => { button({ id: "btn-rebind", cls: "btn", text: T("Change controls"), act: () => requestRebind() }); }, { width: w });
  heading("h3", T("Help"), w);
  flow("help-buttons", [
    { id: "btn-help", cls: "ghost", text: T("How to play"), act: () => { app.helpFromSettings = true; show("help"); } },
    { id: "btn-replay-tutorial", cls: "ghost", text: T("Replay tutorial"), act: () => { if (inRound()) leaveRound(); startLesson(C.LESSONS[0]!); } },
  ], w);
  if (round) ui.row("leave-row", () => { button({ id: "btn-leave", cls: "danger", text: T("Leave round"), act: leaveRound }); }, { width: w });
  else backButton(w);
}

// ------------------------------------------------------------------ results
function resultsScreen(w: number): void {
  const s = session.state;
  if (!s) { backButton(w); return; }
  heading("h2", s.status === "won" ? T("Board clear") : T("Round over"), w);
  para(resultsSub(s), w, "muted", "results-sub");
  const rows = R.scoreBreakdown(s);
  ui.id("results-table").column(T("Score breakdown"), () => {
    for (const c of rows) scoreRow(T(c.label), String(c.value), w, "row-line", "cell");
    scoreRow(T("Total"), String(R.totalScore(s)), w, "row-total", "cell-total");
  }, { width: w, spacing: 0 });
  para(T("Time {time} · {hints} hints · {shuffles} shuffles · {invalid} invalid taps · best streak {streak}",
    { time: fmtTime(s.elapsedMs), hints: s.hints, shuffles: s.shuffles, invalid: s.invalid, streak: s.bestStreak }), w, "muted", "results-progress");
  if (session.newUnlocks.length) {
    para(T("Achievements: {list}", { list: session.newUnlocks.map((k) => { const a = C.ACHIEVEMENTS.find((x) => x.key === k); return a ? T(a.name) : k; }).join(" · ") }), w, "p", "results-achievements");
  }
  const lb = leaderboardLine();
  if (lb) para(lb, w, "muted", "results-lb");
  const next = nextRecommendation();
  const list: Btn[] = [{ id: "btn-retry", cls: "primary", text: T("Play again"), act: retry }];
  if (next) list.push({ id: "btn-next", cls: "ghost", text: next.label, act: next.run });
  list.push({ id: "btn-results-home", cls: "ghost", text: T("Home"), act: leaveRound });
  flow("results-actions", list, w, 10);
}
function scoreRow(k: string, v: string, width: number, cls: string, cell: string): void {
  ui.style(cls, { width }).row(`row-${k}`, () => {
    ui.style(cell).label(k);
    ui.spacer();
    ui.style(cell, { text: { numerals: "tabular" } } as ui.Style).label(v);
  }, { width, align: "center" });
}

// ------------------------------------------------------------------ help
function helpScreen(w: number): void {
  heading("h2", T("How to play"), w);
  const cards: [string, string][] = [
    [T("Goal"), T("Remove matching pairs of free tiles until the table is empty.")],
    [T("Free tiles"), T("A tile is free when no tile covers it and its left or right side is open. Free tiles glow softly.")],
    [T("Select"), T("Tap or click a free tile, then tap a matching free tile. A second tap on the same tile deselects it.")],
    [T("Stuck"), T("Hint shows a legal pair; Shuffle re-deals the remaining tiles. Both cost score.")],
    [T("Controls"), keysLine()],
    [T("Score"), T("Pairs and streaks add points; hints, shuffles, undos and invalid taps subtract. Finishing under par adds a time bonus.")],
  ];
  cardGrid("rule-cards", w, 220, cards.length, (i, cw) => {
    const [title, text] = cards[i]!;
    ui.style("rule-card", { width: cw }).column(`rule-${i}`, () => {
      heading("h3", title, cw - 30);
      para(text, cw - 30, "muted");
    }, { width: cw, spacing: 6 });
  });
  backButton(w);
}

// ------------------------------------------------------------------ score chase
function scoresScreen(w: number): void {
  heading("h2", T("Leaderboards"), w);
  const boards = ["global", "daily", "friends"] as const;
  const names: Record<string, string> = { global: N("Global"), daily: N("Daily"), friends: N("Friends") };
  ui.row("tabs", () => {
    for (const b of boards) button({ id: `tab-${b}`, cls: "tab", text: T(names[b]!), selected: app.scoresBoard === b, act: () => showScores(b) });
  }, { spacing: 10, align: "center" });
  const sc = app.scores;
  if (sc === "loading" || !sc) para("…", w, "muted");
  else {
    para(sc.note, w, "muted", "scores-note");
    ui.id("scores-list").column(T("Leaderboards"), () => {
      if (!sc.entries.length) para(T("No scores yet. Finish a board to post one."), w, "list-item");
      sc.entries.slice(0, 20).forEach((e, i) => {
        const text = `${i + 1}. ${e.name} — ${e.score}` + (e.durationMs ? ` (${fmtTime(e.durationMs)})` : "");
        para(text, w, e.mine ? "list-me" : "list-item");
      });
    }, { width: w, spacing: 6 });
  }
  backButton(w);
}

// ------------------------------------------------------------------ profile
function profileScreen(w: number): void {
  const p = platform.progress();
  heading("h2", T("Profile"), w);
  para(T("Display name"), w, "p");
  if (platform.signedIn()) {
    para(displayName(), w, "p", "profile-name");
    para(T("Signed in with your StarHermit account; the name comes from your account profile."), w, "muted");
  } else {
    const next = ui.style("field").id("profile-name").textField("profile-name", app.nameDraft, { maxChars: 24, width: Math.min(w, 320), placeholder: T("Guest") });
    if (next !== app.nameDraft) { app.nameDraft = next; later(() => setGuestName(next)); }
  }
  const sync = platform.syncState();
  const SYNC: Record<string, string> = {
    local: N("Progress is stored on this device only."), synced: N("Cloud save synced to your account."), saving: N("Syncing progress to your account…"),
    error: N("Cloud sync failed — progress is safe locally and will retry on the next change."),
  };
  para(T(SYNC[sync]!), w, "muted", "profile-sync");
  para(T("{rounds} rounds · {wins} clears · best score {best} · {pairs} pairs total", { rounds: p.stats.rounds, wins: p.stats.wins, best: p.stats.bestScore, pairs: p.stats.pairsTotal }), w, "muted", "profile-stats");
  heading("h3", T("Achievements"), w);
  ui.id("profile-achievements").column(T("Achievements"), () => {
    for (const a of C.ACHIEVEMENTS) {
      const got = !!p.achievements[a.key];
      ui.style("list-row", { width: w }).row(`ach-${a.key}`, () => {
        para(`${got ? "◆" : "◇"} ${T(a.name)} — ${T(a.description)}`, w, got ? "list-item" : "list-locked");
      }, { width: w });
    }
  }, { width: w, spacing: 0 });
  backButton(w);
}

// ------------------------------------------------------------------ the play view
function playView(L: Layout, live: boolean): void {
  const st = session.state!;
  const f = frame();
  const sc = L.sc;
  // #hud-top: objective and progress, timer and limit, score, pause
  const topH = L.short ? 0 : 64;
  if (!L.short) {
    draw.box(0, 0, f.width, L.oy + topH * sc, "hud-top");
    hudRects.push({ x: 0, y: 0, width: f.width, height: L.oy + topH * sc });
  }
  const total = st.tiles.length / 2;
  let limit = "";
  if (st.config.moveLimit != null) limit = T("{n} taps left", { n: Math.max(0, st.config.moveLimit - st.taps) });
  if (st.config.timeLimitMs != null) limit = T("{time} left", { time: fmtTime(Math.max(0, st.config.timeLimitMs - st.elapsedMs)) });
  const objective = st.status === "won" ? T("Board clear!") : st.status === "lost" ? T("Round over")
    : st.config.mode === "learn" ? (session.contentRef?.text ? T(session.contentRef.text) : T("Follow the lesson")) : T("Clear the board");
  const progressText = T("{n} / {total} pairs · streak {streak}", { n: st.pairsRemoved, total, streak: st.streak });
  const pad = L.wide ? 24 : 12;
  const pauseBtn = (): void => {
    const hit = ui.style("icon").id("btn-pause").button(T("Pause"), {
      disabled: !live || st.status !== "active",
      content: () => { ui.widget("pause-glyph", { role: "none", size: { width: 12, height: 14 }, draw: (r) => {
        const bw = r.width * 0.32, ink = token("text");
        draw.rect(r.x, r.y, bw, r.height, ink);
        draw.rect(r.x + r.width - bw, r.y, bw, r.height, ink);
      } }); },
    });
    if (hit && !fresh(0)) later(pauseRound);
  };
  if (L.short) {
    // landscape phone: a narrow status rail at the left
    const r = ui.place("hud-rail", { anchor: "top-start", x: pad, y: 8 }, () => {
      ui.column("hud-col", () => {
        para(objective, 150, "objective", "hud-objective");
        para(progressText, 150, "progress", "hud-progress");
        ui.row("hud-nums", () => {
          ui.style("timer", { text: { numerals: "tabular" } } as ui.Style).id("hud-timer").label(fmtTime(st.elapsedMs));
          ui.style("score", { text: { numerals: "tabular" } } as ui.Style).id("hud-score").label(String(R.totalScore(st)));
          pauseBtn();
        }, { spacing: 10, align: "center" });
        if (limit) ui.style("limit").id("hud-limit").label(limit);
      }, { spacing: 4, width: 160 });
    });
    hudRects.push(r);
  } else {
    ui.place("hud-top", { anchor: "top-start", x: pad, y: 8 }, () => {
      ui.row("hud-row", () => {
        const right = 160 + (limit ? 0 : 0);
        ui.column("hud-obj", () => {
          para(objective, L.lw - 2 * pad - right - 20, "objective", "hud-objective");
          ui.style("progress").id("hud-progress").label(progressText);
        }, { spacing: 2 });
        ui.spacer();
        ui.column("hud-time", () => {
          ui.style("timer", { text: { numerals: "tabular" } } as ui.Style).id("hud-timer").label(fmtTime(st.elapsedMs));
          if (limit) ui.style("limit").id("hud-limit").label(limit);
        }, { spacing: 2, align: "end" });
        ui.style("score", { text: { numerals: "tabular" } } as ui.Style).id("hud-score").label(String(R.totalScore(st)));
        pauseBtn();
      }, { width: L.lw - 2 * pad, spacing: L.phone ? 8 : 16, align: "start" });
    });
  }
  boardOverlay(st, live, L);
  actions(L, st, live);
  // #hud-message and #caption
  if (app.toast) {
    const w = Math.min(616, L.lw - 32);
    const y = L.short ? 8 : L.phone ? 96 : 84;
    const placeAt = L.short ? { anchor: "bottom-start" as const, x: 8, y } : { anchor: "bottom" as const, y };
    const tw2 = L.short ? 160 : w;
    ui.place("hud-message", placeAt, () => {
      ui.style("toast").row("toast-box", () => { para(app.toast!.text, tw2 - 30, "toast-text", "hud-message-text"); });
    });
  }
  if (app.caption) {
    ui.place("caption", { anchor: "top", y: 64 }, () => {
      ui.style("caption").row("caption-box", () => { ui.style("caption-text").id("sound-caption").label(app.caption!.text); });
    });
  }
}

/** The board mirror: an accessibility target over every live tile (screen readers and play scripts find each tile by its name),
 *  the soft outline of each free tile, the selection's outline and the keyboard focus ring with the tile's name. */
function boardOverlay(st: State, live: boolean, L: Layout): void {
  const free = new Set(R.freeTiles(st).map((t) => t.id));
  const sc = L.sc;
  for (const t of st.tiles) {
    if (t.removed) continue;
    const r = render.tileRect(t.id);
    if (!r) continue;
    const isFree = free.has(t.id), sel = st.selected === t.id;
    if (live) ui.target(isFree ? tileLabel(t, true, sel) : tileLabel(t, false, sel), r, { role: "button" });
    // #board-mirror button: 44 px square at the tile's centre; free tiles' borders show faintly, the selected one in the accent
    if (isFree || sel) {
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const s = Math.max(44 * sc, Math.min(r.width, r.height) * 0.6);
      draw.box(cx - s / 2, cy - s / 2, s, s, { radius: 8, border: { width: 2, color: sel ? token("accent") : "#9fc4ff40" } } as ui.Style);
    }
  }
  const fid = app.focusId;
  if (fid != null && live && app.keyFocus) {
    const t = st.tiles.find((x) => x.id === fid);
    const r = render.tileRect(fid);
    if (t && r) {
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const s = Math.max(44 * sc, Math.min(r.width, r.height) * 0.6);
      draw.box(cx - s / 2, cy - s / 2, s, s, { radius: 8, border: { width: 3, color: token("focus") } } as ui.Style);
      const label = faceText(t.face);
      const lw = (ui.measureText(label, { style: "toast-text" }).width) + 16 * sc;
      draw.box(cx - lw / 2, cy + s / 2 + 4 * sc, lw, 24 * sc, { background: "#000000a0", radius: 6 } as ui.Style);
      draw.text(label, cx, cy + s / 2 + 7 * sc, { size: 12.8 * sc, align: "center", color: token("text") });
    }
  }
}
const faceText = (face: string): string => tileLabel({ face, z: 0 }, true, false).split(",")[0]!;

/** #hud-actions: Hint, Shuffle, Undo and Camera (row-reversed for left-handed controls). */
function actions(L: Layout, st: State, live: boolean): void {
  const f = frame();
  const acts = R.legalActions(st);
  const list: { id: string; text: string; ok: boolean; act: () => void; aria?: string }[] = [
    { id: "btn-hint", text: T("Hint"), ok: acts.hint, act: hint },
    { id: "btn-shuffle", text: T("Shuffle"), ok: acts.shuffle, act: shuffle },
    { id: "btn-undo", text: T("Undo"), ok: acts.undo, act: undo },
    { id: "btn-camera", text: T("Camera"), ok: true, act: resetCamera, aria: T("Reset camera") },
  ];
  const items = platform.options.leftHanded ? [...list].reverse() : list;
  const pad = L.wide ? 24 : 12;
  const one = (b: (typeof list)[number], width: number | null): void => {
    const hit = ui.style("action", width != null ? { width, minWidth: 0, padding: { start: 4, end: 4, top: 10, bottom: 10 } } as ui.Style : {}).id(b.id)
      .button(b.aria ?? b.text, { disabled: !live || !b.ok || st.status !== "active", ...(b.aria ? { content: () => { ui.style("action", { background: "#00000000", border: { width: 0 }, padding: 0, minWidth: 0, minHeight: 0 } as ui.Style).label(b.text); } } : {}) });
    if (hit && !fresh(0)) later(b.act);
  };
  if (L.short) {
    const r = ui.place("hud-actions", { anchor: platform.options.leftHanded ? "start" : "end", x: pad, y: 0 }, () => {
      ui.column("actions", () => { for (const b of items) one(b, null); }, { spacing: 8, align: "end" });
    });
    hudRects.push(r);
    return;
  }
  const h = 64;
  draw.box(0, f.height - (h + 8) * L.sc, f.width, (h + 8) * L.sc, "hud-bottom");
  if (L.phone) {
    // portrait phone: a full-width thumb tray
    const gap = 8, w = L.lw - 2 * pad, bw = (w - gap * (items.length - 1)) / items.length;
    const r = ui.place("hud-actions", { anchor: "bottom", y: 10 }, () => {
      ui.row("actions", () => { for (const b of items) one(b, bw); }, { spacing: gap, align: "center" });
    });
    hudRects.push(r);
    return;
  }
  const anchor = L.wide ? (platform.options.leftHanded ? "bottom-start" : "bottom-end") : "bottom";
  const r = ui.place("hud-actions", { anchor, x: pad, y: 10 }, () => {
    ui.row("actions", () => { for (const b of items) one(b, null); }, { spacing: 8, align: "center" });
  });
  hudRects.push(r);
}

/** #app-toast: account notices on every screen. */
function appToast(L: Layout): void {
  const t = app.appToast;
  if (!t) return;
  const w = Math.min(616, L.lw - 32);
  ui.place("app-toast", { anchor: "bottom", y: L.short ? 8 : 24 }, () => {
    ui.style("toast").row("app-toast-box", () => { para(t.text, w - 30, "toast-text", "app-toast-text"); });
  });
}
