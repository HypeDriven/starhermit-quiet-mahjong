// The browser build's pure modules, imported unchanged (allowJs) and typed
// here with the shapes this client reads: the deterministic rules engine
// (js/rules.js: seeded streams, layouts, the always-solvable deal, free tiles,
// legal pairs, commands, scoring, terminal states, replay), the versioned
// content (js/content.js: five themes, four lessons, forty Journey stages,
// four challenges, six achievements, the Daily's ruleset) and the player's
// data (js/progress.js: progress and its merge, the game's options, the
// browser build's cloud save, the device store).
import * as RulesJs from "../js/rules.js";
import * as ContentJs from "../js/content.js";
import * as ProgressJs from "../js/progress.js";

export interface Tile { id: number; face: string; x: number; y: number; z: number; removed: boolean }
export interface Config {
  mode: string; tier: string; seed: number; allowUndo?: boolean; allowShuffle?: boolean; allowHints?: boolean;
  moveLimit?: number | null; timeLimitMs?: number | null; parMs: number; contentVersion?: number; dateIso?: string;
}
export interface ScoreParts { pairs: number; streak: number; time: number; completion: number; penalties: number }
export interface State {
  version: number; config: Config & { moveLimit: number | null; timeLimitMs: number | null }; tiles: Tile[]; selected: number | null;
  tick: number; elapsedMs: number; taps: number; invalid: number; hints: number; undos: number; shuffles: number;
  pairsRemoved: number; streak: number; bestStreak: number; score: ScoreParts; history: unknown[];
  status: "active" | "paused" | "won" | "lost"; reason: string | null;
}
export interface RulesEvent { type: string; ids?: number[]; id?: number; other?: number; face?: string; streak?: number; reason?: string }
export interface Command { t: string; id?: number; ms?: number; cid?: string }
export interface ApplyResult { state: State; error?: string; events: RulesEvent[] }
export interface Theme {
  id: string; name: string; sky: number; fog: number; ground: number; table: number; tile: number; tileEdge: number;
  accent: number; glow: number; ambient: string; description: string;
}
export interface Lesson { id: string; title: string; tier: string; seed: number; text: string; goal: string }
export interface Stage { id: string; index: number; name: string; mastery: boolean; theme: string; config: Config }
export interface Challenge { id: string; name: string; theme: string; description: string; config: Config }
export interface Achievement { key: string; name: string; description: string }

interface RulesApi {
  RULES_VERSION: number;
  ERR: Record<string, string>;
  LAYOUT_TIERS: Record<string, { pairs: number; name: string }>;
  FACE_NAMES: Record<string, string>;
  makeRng(seed: number, stream?: string): () => number;
  hashSeed(s: string): number;
  faceGlyph(face: string): string;
  faceName(face: string): string;
  isFree(tile: Tile, tiles: Tile[]): boolean;
  freeTiles(state: State): Tile[];
  legalPairs(state: State): [number, number][];
  legalActions(state: State): { pairs: [number, number][]; tap: number[]; hint: boolean; undo: boolean; shuffle: boolean; resign: boolean };
  init(config: Config): State;
  apply(state: State, cmd: Command): ApplyResult;
  totalScore(state: State): number;
  scoreBreakdown(state: State): { key: string; label: string; value: number }[];
  replay(config: Config, commands: Command[]): { state: State; errors: unknown[] };
  dailySeed(dateIso: string): number;
}
interface ContentApi {
  THEMES: Theme[]; LESSONS: Lesson[]; JOURNEY_STAGES: Stage[]; CHALLENGES: Challenge[]; ACHIEVEMENTS: Achievement[];
  themeById(id: string): Theme;
  dailyConfig(dateIso: string, seed: number): Config;
}

export interface Progress {
  version: number;
  journey: Record<string, { score: number; ms: number }>;
  dailies: Record<string, { score: number }>;
  achievements: Record<string, number>;
  stats: { rounds: number; wins: number; bestScore: number; pairsTotal: number };
  friends: string[];
  name: string;
}
export interface SaveDoc { v: number; progress: Progress }
export interface Options { captions: boolean; theme: string; palette: string; leftHanded: boolean; tutorialDone: boolean }
export interface ContentRef { lessonId?: string; text?: string; stageId?: string; mastery?: boolean; challengeId?: string; date?: string }
export interface Snapshot { version: number; config: Config; commands: Command[]; contentRef: ContentRef | null; at: number }
export interface BoardEntry {
  name: string; sessionId: string; board: string; date: string | null; score: number; durationMs: number; seed: number; tier: string;
  ruleset: number; contentVersion: number; assists: { hints: number; shuffles: number; undos: number }; at?: number;
}
export interface DeviceStore {
  loadSnapshot(): Snapshot | null;
  saveSnapshot(config: Config, commands: Command[], contentRef: ContentRef | null, at: number): void;
  clearSnapshot(): void;
  board(kind: string, friends?: string[], me?: string): BoardEntry[];
  addBoardEntry(entry: BoardEntry): void;
  resetAll(): void;
}
interface ProgressApi {
  SAVE_SCHEMA: number;
  DEFAULT_OPTIONS: Options; OPTION_KEYS: (keyof Options)[]; BROWSER_KEYS: string[]; THEME_IDS: string[]; PALETTES: string[];
  emptyProgress(): Progress;
  normalizeProgress(p: unknown): Progress;
  mergeProgress(a: unknown, b: unknown): Progress;
  sameProgress(a: unknown, b: unknown): boolean;
  normalizeSave(doc: unknown): SaveDoc;
  pickOptions(obj: unknown): Partial<Options>;
  readForeign(text: string): { progress: Progress | null; options: Partial<Options> } | null;
  createStore(backend: { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void }): DeviceStore;
}

export const R = RulesJs as unknown as RulesApi;
export const C = ContentJs as unknown as ContentApi;
export const Store = ProgressJs as unknown as ProgressApi;
