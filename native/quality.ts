// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU its
// Auto gave it) keyed by the runtime's quality tier (frame().quality), with
// the sparks and fireflies scaled within the tier by the level
// (frame().levelIndex, at most 2×), as the browser build scaled them by its
// hardware level. The runtime owns the rest of what the old Graphics panel
// did: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and readout. The old panel's
// per-effect overrides are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Tile and garden shading: Lambert (Low), Standard (Balanced), clear-coated Physical tiles (High, Ultra; Detail on). */
  material: "lambert" | "standard" | "physical";
  /** Tile face canvas width in px (height 400/256 of it). */
  face: number;
  /** Rounded-tile bevel segments (Detail on). */
  bevel: number;
  /** Table stone texture size in px (gravel ground: half; Detail on). */
  stone: number;
  /** Sparks per match burst at Particles "high" (low: 3/7). */
  sparks: number;
  /** Drifting fireflies (Background animated). */
  fireflies: number;
  /** Sky stars (Detail on). */
  stars: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  /** Moon shadow map size (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  /** Room-environment reflections on tiles and the table. */
  reflections: boolean;
  /** Rounded clear-coated tiles, textured stone, stars, moon halo, lantern caps, rough rocks. */
  detailed: boolean;
  particles: "off" | "low" | "high";
  /** Fireflies, lantern flicker and the title orbit. */
  animated: boolean;
  budget: Budget;
}

const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "off", reflections: false, detailed: false, particles: "off", animated: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, detailed: true, particles: "low", animated: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, detailed: true, particles: "high", animated: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", face: 128, bevel: 1, stone: 256, sparks: 40, fireflies: 24, stars: 180, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", face: 256, bevel: 2, stone: 256, sparks: 50, fireflies: 32, stars: 260, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", face: 256, bevel: 3, stone: 512, sparks: 70, fireflies: 42, stars: 360, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", face: 512, bevel: 4, stone: 1024, sparks: 100, fireflies: 64, stars: 600, bloomRes: 1, aoRes: 1 },
};
export const SPARK_MAX = 200;
export const FIREFLY_MAX = 128;
export const PARTICLE_POOL = 800;
const PARTICLE_SHARE = { off: 0, low: 3 / 7, high: 1 };
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // levels are about 1.64× apart in GPU throughput: particle counts grow with the level above the tier's first, at most 2×
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  b.fireflies = Math.min(FIREFLY_MAX, Math.round(b.fireflies * k));
  return { preset, ...TABLE[preset], budget: b };
}
/** gfx.js burstSize: sparks per match burst. */
export function burstSize(look: Look): number {
  return Math.round(look.budget.sparks * PARTICLE_SHARE[look.particles]);
}
