// The look per graphics level. The engine's level (levelSettings()) owns the
// engine effects: shadow on/off and map size, AO, bloom, grade, anti-aliasing,
// the texture cap, and how far the sparks and fireflies scale within the tier
// (the level's particle budget over the tier's anchor level, at most 2×). The
// art stays the browser build's four presets (js/gfx.js, each tuned to hold 60
// FPS), keyed by the level's quality tier. The runtime owns the rest of what
// the old Graphics panel did: Auto and the level choice, render scale and the
// pixel-ratio cap, adaptive resolution, the frame-rate limit and readout. The
// old panel's per-effect overrides are not offered.
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
}
interface Art {
  /** Room-environment reflections on tiles and the table. */
  reflections: boolean;
  /** Rounded clear-coated tiles, textured stone, stars, moon halo, lantern caps, rough rocks. */
  detailed: boolean;
  particles: "off" | "low" | "high";
  /** Fireflies, lantern flicker and the title orbit. */
  animated: boolean;
}
export interface Look extends Art {
  preset: QualityTier;
  /** Moon shadow map, the level's size (0 = off). */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** Bloom's resolution, the level's (null = off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  budget: Budget;
}

const ART: Record<QualityTier, Art> = {
  low: { reflections: false, detailed: false, particles: "off", animated: false },
  balanced: { reflections: true, detailed: true, particles: "low", animated: true },
  high: { reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { reflections: true, detailed: true, particles: "high", animated: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", face: 128, bevel: 1, stone: 256, sparks: 40, fireflies: 24, stars: 180 },
  balanced: { material: "standard", face: 256, bevel: 2, stone: 256, sparks: 50, fireflies: 32, stars: 260 },
  high: { material: "physical", face: 256, bevel: 3, stone: 512, sparks: 70, fireflies: 42, stars: 360 },
  ultra: { material: "physical", face: 512, bevel: 4, stone: 1024, sparks: 100, fireflies: 64, stars: 600 },
};
export const SPARK_MAX = 200;
export const FIREFLY_MAX = 128;
export const PARTICLE_POOL = 800;
const PARTICLE_SHARE = { off: 0, low: 3 / 7, high: 1 };
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level's settings. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  const b = BUDGETS[preset];
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: {
      ...b,
      stone: Math.min(b.stone, s.maxTextureSize),
      sparks: Math.min(SPARK_MAX, Math.round(b.sparks * k)),
      fireflies: Math.min(FIREFLY_MAX, Math.round(b.fireflies * k)),
    },
  };
}
/** gfx.js burstSize: sparks per match burst. */
export function burstSize(look: Look): number {
  return Math.round(look.budget.sparks * PARTICLE_SHARE[look.particles]);
}
