// The moonlit garden on starhermit:scene, as the browser build's js/main.js
// `render` drew it with three.js r185: the sky and fog, the moon (key light
// with its shadow fitted to the board, a bright disc with a halo), ambient and
// hemisphere fill, the gravel ground, the stone table (a carved rim and a
// pedestal on detailed looks), garden rocks, three paper lanterns on poles
// with warm point lights that flicker, the star field, drifting fireflies, the
// decorative tiles on the table behind the title menu (with a slow orbit),
// a ceramic tile per rules tile (a box, or a rounded clear-coated slab on
// detailed looks) with its face drawn into a canvas texture (glyph, family
// colour band, two-tone side), the soft ring under every free tile, the
// pulsing marker and lift of the selected tile, the selection and hint glow,
// the match sparks and the drag orbit. Rendering reads rules snapshots and
// never writes them.
//
// From three.js r185: punctual light intensities are the page's (minor 23+);
// `new RoomEnvironment()` of r185 is the 900-candela
// room lowered by 3.5, which the engine builds from `new
// RoomEnvironment(renderer)` with `position.y = -3.5`; the post chain
// (GTAOPass, UnrealBloomPass(0.55, 0.45, 0.92), the GradeShader before the
// OutputPass, FXAA / SMAA / MSAA) is renderer.ao / bloom / grade / antialias.
// The canvas filled the window behind the DOM HUD, so the camera uses the
// whole window. Adaptive resolution, the pixel-ratio cap and the frame-rate
// readout are the runtime's. Animation runs on frame().time.
import {
  ACESFilmicToneMapping, AdditiveBlending, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color,
  CylinderGeometry, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight, IcosahedronGeometry, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NormalBlending, PerspectiveCamera, PMREMGenerator, PointLight, Points,
  PointsMaterial, Raycaster, RepeatWrapping, RingGeometry, OrthographicCamera, RoomEnvironment, RoundedBoxGeometry, SRGBColorSpace, SphereGeometry, Sprite, SpriteMaterial,
  TorusGeometry, Vector2, Vector3, renderer, scene, type Material, type Object3D, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, fonts } from "starhermit:canvas";
import { frame } from "starhermit:engine";
import { C, R, type State, type Theme, type Tile } from "./game.ts";
import { FIREFLY_MAX, PARTICLE_POOL, burstSize, type Look } from "./quality.ts";

const PI = Math.PI;
export const TILE_W = 1.0, TILE_H = 0.42, TILE_D = 1.34, GAP = 0.08;
const LAYER_STEP = TILE_H + 0.06;
// Tile texture layout: the face occupies the top of the canvas, a thin strip at the bottom holds the two-tone side.
const TEX_W = 256, TEX_H = 400, TEX_FACE_H = 344; // authored size; drawn at the look's face budget
const FACE_V0 = 1 - TEX_FACE_H / TEX_H;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const hex = (n: number): string => "#" + n.toString(16).padStart(6, "0");
const nowMs = (): number => frame().time * 1000;

/** Colour-vision-safe family palettes (shape + label remain primary cues). */
export const PALETTES: Record<string, Record<string, string>> = {
  standard: { moon: "#5a6fa8", petal: "#a85a7a", wave: "#4a8a8a", stone: "#7a6a4a", wind: "#8a5aa8", star: "#a89a4a", lantern: "#a85a4a" },
  deuteranopia: { moon: "#4a6fd8", petal: "#d8b04a", wave: "#4aa8d8", stone: "#8a8a8a", wind: "#7a5ad8", star: "#d8d84a", lantern: "#b87a2a" },
  protanopia: { moon: "#4a6fd8", petal: "#c8a84a", wave: "#4a9ad8", stone: "#8a8a8a", wind: "#6a5ad8", star: "#d8d84a", lantern: "#a8822a" },
  tritanopia: { moon: "#4a8a9a", petal: "#c85a6a", wave: "#4ac8b8", stone: "#9a7a6a", wind: "#a85a8a", star: "#c8c8c8", lantern: "#c84a4a" },
};

/** Tile geometry whose UVs map the top plane to the face and the sides to the band. */
function makeTileGeometry(rounded: boolean, bevel = 3): BufferGeometry {
  const geo: BufferGeometry = rounded ? new RoundedBoxGeometry(TILE_W, TILE_H, TILE_D, bevel, 0.07) : new BoxGeometry(TILE_W, TILE_H, TILE_D);
  const pos = geo.getAttribute("position") as BufferAttribute, uv = geo.getAttribute("uv") as BufferAttribute, index = geo.index;
  // BoxGeometry planes (px, nx, py, ny, pz, nz) never share vertices, so each group identifies top, bottom or side.
  geo.groups.forEach((grp, plane) => {
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      const v = index ? index.getX(i) : i;
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      if (plane === 2) uv.setXY(v, x / TILE_W + 0.5, FACE_V0 + (0.5 - z / TILE_D) * (1 - FACE_V0));
      else if (plane === 3) uv.setXY(v, 0.5, 0.01);
      else uv.setXY(v, 0.5, (y / TILE_H + 0.5) * (FACE_V0 - 0.01) + 0.005);
    }
  });
  uv.needsUpdate = true;
  geo.clearGroups();
  return geo;
}

/** Soft round sprite for stars, fireflies and match sparks. */
function glowSprite(): Texture {
  const cv = new OffscreenCanvas(64, 64);
  const g = cv.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Procedural stone / gravel texture (seeded, decoration stream only). */
function noiseTexture(base: number, seed: number, { size = 256, speck = 0.18, veins = 0 } = {}): Texture {
  const cv = new OffscreenCanvas(size, size);
  const g = cv.getContext("2d");
  g.fillStyle = hex(base);
  g.fillRect(0, 0, size, size);
  const rng = R.makeRng(seed, "decor-tex");
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 2 * speck * 255 * (rng() < 0.08 ? 1.6 : 0.5);
    d[i] = clamp(d[i]! + n, 0, 255); d[i + 1] = clamp(d[i + 1]! + n, 0, 255); d[i + 2] = clamp(d[i + 2]! + n * 1.05, 0, 255);
  }
  g.putImageData(img, 0, 0);
  // soft mottling
  for (let i = 0; i < 70; i++) {
    const x = rng() * size, y = rng() * size, r = 8 + rng() * 40;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.04 + rng() * 0.06;
    grad.addColorStop(0, rng() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.4})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
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
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// The colour moons, 〰 and ☔ come from the engine's emoji font, which loads on first use: faces are
// redrawn once it is in (a canvas drawn before it arrives leaves them blank).
const EMOJI = "🌑🌒🌓🌔🌕🌖🌗🌘🌝〰☔";
fonts.load("144px serif", EMOJI).then(() => { if (built) rebuild(); }, (e: unknown) => console.warn(`emoji font: ${String(e)}`));

// ---------------------------------------------------------------------------- state
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const camera = new PerspectiveCamera(34, 1, 0.1, 200);
renderer.camera = camera;
const camTarget = new Vector3();
const camGoal = { pos: new Vector3(), target: new Vector3(), moving: false };
let boardSpan = { cx: 0, cy: 0, w: 1, h: 1 };
let hintIds: number[] = [];
let hintUntil = 0;
let theme: Theme = C.THEMES[0]!;
let look: Look | null = null;
let palette = "standard";
let reducedMotion = false;
let titleAngle = 0.6;
let time = 0;
let envTex: Texture | null = null;
const spriteTex = glowSprite();
const ringGeo = new RingGeometry(0.42, 0.55, 24);
let tileGeo: BufferGeometry | null = null;
const world = new Group();
scene.add(world);
interface TileEntry { mesh: Mesh; ring: Mesh; hot: Material | null; free: boolean }
const tiles = new Map<number, TileEntry>();
const faceTex = new Map<string, Texture>();
const tileMats = new Map<string, Material>();
let moon: DirectionalLight | null = null;
let marker: Mesh | null = null;
let decor: Group | null = null;
let fireflies: Points | null = null;
let fireflySeeds: { x: number; z: number; y: number; p: number; s: number }[] = [];
let particles: Points | null = null;
let particleData: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }[] = [];
let lanterns: { lamp: Mesh; light: PointLight; base: number; phase: number }[] = [];
let lastState: State | null = null;
let built = false;
const detailed = (): boolean => !!look?.detailed;
const animated = (): boolean => !!look?.animated && !reducedMotion;

// ---------------------------------------------------------------------------- materials
// Garden shading per the budget: Lambert on Low, Standard above (same colour and emission on every model).
/** Copies Color objects so materials never share one (three copies; the engine keeps the object). */
function own<T>(v: T): T { return v && typeof (v as { clone?: unknown }).clone === "function" ? (v as unknown as { clone(): T }).clone() : v; }
type Surf = { color?: number | Color; roughness?: number; metalness?: number; emissive?: Color; emissiveIntensity?: number; flatShading?: boolean };
function surface(p: Surf): MeshStandardMaterial | MeshLambertMaterial {
  p = { ...p, color: own(p.color), emissive: own(p.emissive) };
  if (look?.budget.material !== "lambert") return new MeshStandardMaterial(p);
  const { roughness: _r, metalness: _m, ...base } = p;
  void _r; void _m;
  return new MeshLambertMaterial(base);
}
// Tile shading: Lambert on Low, Standard on Balanced, clear-coated Physical ceramic on High / Ultra (Detail on).
// Tiles with the same face share one material; a selected or hinted tile gets its own glowing copy while lit.
function sharedTileMaterial(face: string): Material {
  let m = tileMats.get(face);
  if (!m) { m = tileMaterial(face); tileMats.set(face, m); }
  return m;
}
function tileMaterial(face: string): Material {
  const tier = look?.budget.material ?? "standard";
  const m = tier === "lambert" ? new MeshLambertMaterial({})
    : detailed() && tier === "physical" ? new MeshPhysicalMaterial({ roughness: 0.42, metalness: 0, clearcoat: 0.65, clearcoatRoughness: 0.2 })
      : new MeshStandardMaterial({ roughness: 0.35, metalness: 0.02 });
  const gen = worldGen;
  later(() => {
    if (gen !== worldGen) return; // the world was rebuilt meanwhile
    const map = faceTexture(face);
    m.map = map;
    m.color.set(0xffffff);
  }, () => m.color.set(theme.tile));
  return m;
}

// Canvas work: the engine bounds a frame's canvas drawing (200 M units). Ultra's 512 × 800 tile faces and stone textures
// for a whole board do not fit one frame, so textures are drawn as jobs: what fits now, the rest on the next frames
// (a face shows its plain glaze colour until then).
const jobs: (() => void)[] = [];
let jobsDone = 0;
/** Runs `job` now if the frame's canvas work allows, else on a later frame (`meanwhile` runs at once then). */
let jobFrame = -1, jobsThisFrame = 0;
function later(job: () => void, meanwhile?: () => void): void {
  if (!jobs.length && room() && tryJob(job)) return;
  meanwhile?.();
  jobs.push(job);
}
/** At most 8 Ultra-sized textures a frame (a whole board's 512 × 800 faces in one frame would pass the frame's 96 MiB upload bound). */
function room(): boolean {
  const f = frame().frame;
  if (f !== jobFrame) { jobFrame = f; jobsThisFrame = 0; }
  return jobsThisFrame < ((look?.budget.face ?? 256) >= 512 ? 8 : 64);
}
function tryJob(job: () => void): boolean {
  try { job(); jobsDone++; jobsThisFrame++; return true; } catch (e) {
    if (e instanceof RangeError && /canvas work budget/.test(e.message)) return false;
    throw e;
  }
}
function runJobs(): void {
  const before = jobsDone;
  while (jobs.length && room() && tryJob(jobs[0]!)) jobs.shift();
  if (jobsDone !== before && lastState) syncBoard(lastState); // hot copies take the finished faces
}
function faceTexture(face: string): Texture {
  const hit = faceTex.get(face);
  if (hit) return hit;
  const k = (look?.budget.face ?? 256) / TEX_W; // authored at 256 px, drawn into the look's face budget
  const cv = new OffscreenCanvas(Math.round(TEX_W * k), Math.round(TEX_H * k));
  const g = cv.getContext("2d");
  g.scale(k, k);
  const t = theme;
  const det = detailed();
  const ceramic = hex(t.tile);
  const edge = hex(t.tileEdge);
  const FW = TEX_W, FH = TEX_FACE_H;
  g.fillStyle = ceramic;
  g.fillRect(0, 0, FW, FH);
  if (det) {
    // glaze: soft top-left sheen and faint speckle; never over the glyph area's contrast
    const sheen = g.createLinearGradient(0, 0, FW, FH);
    sheen.addColorStop(0, "rgba(255,255,255,0.22)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0)");
    sheen.addColorStop(1, "rgba(0,0,0,0.06)");
    g.fillStyle = sheen;
    g.fillRect(0, 0, FW, FH);
    const rng = R.makeRng(face.length * 131 + face.charCodeAt(0), "decor-glaze");
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(90,80,70,${0.04 + rng() * 0.06})`;
      g.fillRect(rng() * FW, rng() * FH, 1.5, 1.5);
    }
  }
  g.strokeStyle = edge; g.lineWidth = 12;
  g.strokeRect(10, 10, FW - 20, FH - 20);
  if (det) {
    g.strokeStyle = "rgba(255,255,255,0.5)"; g.lineWidth = 2;
    g.strokeRect(19, 19, FW - 38, FH - 38);
  }
  // family colour band (colour reinforced by glyph shape + the tile's name)
  const famColors = PALETTES[palette] ?? PALETTES.standard!;
  const fam = face.split("-")[0]!;
  g.fillStyle = famColors[fam] ?? "#557";
  g.fillRect(20, 282, FW - 40, 32);
  g.fillStyle = "#1a2030";
  g.font = "144px serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(R.faceGlyph(face), FW / 2, 150);
  // side band: ivory body over a coloured backing, like a two-layer tile
  const back = new Color(t.glow).lerp(new Color(t.table), 0.45);
  g.fillStyle = ceramic;
  g.fillRect(0, FH, FW, TEX_H - FH);
  g.fillStyle = edge;
  g.fillRect(0, FH + 26, FW, 3);
  g.fillStyle = "#" + back.getHexString();
  g.fillRect(0, FH + 29, FW, TEX_H - FH - 29);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = det ? 8 : 4;
  faceTex.set(face, tex);
  return tex;
}

function environmentMap(): Texture | null {
  if (envTex) return envTex;
  try {
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment(renderer);
    room.position.y = -3.5;
    envTex = pmrem.fromScene(room, 0.04).texture;
  } catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  return envTex;
}

function fitShadow(radius: number): void {
  if (!moon) return;
  const r = Math.max(2, radius);
  const cam = moon.shadow.camera as OrthographicCamera;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
  cam.near = 4; cam.far = 40;
  cam.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------- the garden
let worldGen = 0;
function disposeWorld(): void {
  jobs.length = 0;
  worldGen++;
  world.traverse((o: Object3D) => {
    const m = o as Mesh;
    if (m.geometry && m.geometry !== tileGeo && m.geometry !== ringGeo) m.geometry.dispose();
    if (m.material) for (const mat of ([] as Material[]).concat(m.material as Material | Material[])) {
      const map = (mat as MeshStandardMaterial).map;
      if (map && map !== spriteTex && ![...faceTex.values()].includes(map)) map.dispose();
      mat.dispose();
    }
  });
  while (world.children.length) world.remove(world.children[0]!);
  tiles.clear();
  for (const m of tileMats.values()) m.dispose();
  tileMats.clear();
  for (const t of faceTex.values()) t.dispose();
  faceTex.clear();
}

function buildEnvironment(): void {
  const t = theme, g = look!, det = g.detailed;
  scene.background = new Color(t.sky);
  scene.fog = new Fog(t.fog, 30, 90);
  scene.environment = g.reflections ? environmentMap() : null;
  scene.environmentIntensity = 0.28;
  tileGeo?.dispose();
  tileGeo = makeTileGeometry(det, g.budget.bevel);

  // key light: the moon, with a shadow fitted to the table / board
  moon = new DirectionalLight(0xcfe0ff, det ? 1.7 : 1.6);
  moon.position.set(-8, 14, 6);
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.02;
  applyShadow();
  fitShadow(10);
  world.add(moon, moon.target);
  world.add(new AmbientLight(t.glow, det ? 0.18 : 0.25));
  world.add(new HemisphereLight(t.accent, t.ground, det ? 0.5 : 0.35));

  // ground
  const groundMat = surface({ color: t.ground, roughness: 1 });
  if (det) later(() => {
    const map = noiseTexture(t.ground, 11, { size: g.budget.stone / 2, speck: 0.22 });
    map.repeat.set(14, 14);
    groundMat.map = map;
    groundMat.color.set(0xffffff);
  });
  const ground = new Mesh(new CircleGeometry(60, 40), groundMat);
  ground.rotation.x = -PI / 2;
  ground.position.y = -0.55;
  ground.receiveShadow = true;
  world.add(ground);

  // table: plain slab, or a textured stone slab with a carved rim
  const tableMat = surface({ color: t.table, roughness: det ? 0.72 : 0.85, metalness: 0.05 });
  if (det) later(() => {
    const map = noiseTexture(t.table, 7, { size: g.budget.stone, speck: 0.07, veins: 8 });
    map.repeat.set(2, 2);
    tableMat.map = map;
    tableMat.color.set(0xffffff);
  });
  const table = new Mesh(new CylinderGeometry(9.5, 8.5, 0.5, det ? 72 : 40), tableMat);
  table.position.y = -0.3;
  table.receiveShadow = true;
  world.add(table);
  if (det) {
    const rimMat = surface({ color: new Color(t.table).multiplyScalar(0.7), roughness: 0.6, metalness: 0.1 });
    const rim = new Mesh(new TorusGeometry(9.5, 0.16, 12, 96), rimMat);
    rim.rotation.x = -PI / 2;
    rim.position.y = -0.06;
    rim.receiveShadow = true;
    world.add(rim);
    const pedestal = new Mesh(new CylinderGeometry(3.2, 4.2, 0.6, 40), rimMat);
    pedestal.position.y = -0.8;
    world.add(pedestal);
  }

  // garden props, procedurally placed with a decoration-only stream
  const rng = R.makeRng(2024, "decor");
  const rockMat = surface({ color: 0x3a4358, roughness: 1, flatShading: det });
  for (let i = 0; i < 14; i++) {
    const r = 0.3 + rng() * 0.9;
    const geo = new IcosahedronGeometry(r, det ? 1 : 0);
    if (det) {
      const p = geo.getAttribute("position") as BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const f = 0.82 + rng() * 0.3;
        p.setXYZ(k, p.getX(k) * f, p.getY(k) * f * 0.8, p.getZ(k) * f);
      }
      geo.computeVertexNormals();
    }
    const rock = new Mesh(geo, rockMat);
    const ang = rng() * PI * 2;
    const dist = 11 + rng() * 14;
    rock.position.set(Math.cos(ang) * dist, -0.55 + r * 0.5, Math.sin(ang) * dist);
    rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    rock.castShadow = true;
    world.add(rock);
  }

  // paper lanterns on dark poles; each owns a warm point light
  lanterns = [];
  const glow = new Color(t.glow);
  const poleMat = surface({ color: 0x222831, roughness: 0.9 });
  const capMat = surface({ color: 0x1a1d24, roughness: 0.7 });
  for (const [x, z] of [[-10, -7], [10.5, -5], [0, 13]] as const) {
    const pole = new Mesh(new CylinderGeometry(0.08, 0.1, 2.6, 8), poleMat);
    pole.position.set(x, 0.75, z);
    const lampMat = surface({ color: 0x553311, emissive: glow, emissiveIntensity: det ? 1.6 : 0.9, roughness: 0.6 });
    let lamp: Mesh;
    if (det) {
      lamp = new Mesh(new CylinderGeometry(0.34, 0.34, 0.62, 20, 1), lampMat);
      const top = new Mesh(new CylinderGeometry(0.16, 0.4, 0.14, 20), capMat);
      top.position.set(x, 2.58, z);
      const bot = new Mesh(new CylinderGeometry(0.38, 0.2, 0.1, 20), capMat);
      bot.position.set(x, 1.86, z);
      world.add(top, bot);
    } else {
      lamp = new Mesh(new SphereGeometry(0.42, 16, 12), lampMat);
    }
    lamp.position.set(x, 2.2, z);
    const light = new PointLight(t.glow, 2.5, 9);
    light.position.set(x, 2.3, z);
    world.add(pole, lamp, light);
    lanterns.push({ lamp, light, base: lampMat.emissiveIntensity, phase: x * 1.7 + z });
  }

  // moon disc in the sky (bright enough to bloom) with a soft halo
  const moonDisc = new Mesh(new CircleGeometry(2.2, 48), new MeshBasicMaterial({ color: new Color(0xf4f0e2).multiplyScalar(det ? 1.5 : 1), fog: false }));
  moonDisc.position.set(-26, 26, -34);
  moonDisc.lookAt(0, 4, 0);
  world.add(moonDisc);
  if (det) {
    const halo = new Sprite(new SpriteMaterial({ map: spriteTex, color: 0xbfd2ff, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, fog: false }));
    halo.position.copy(moonDisc.position).multiplyScalar(1.01);
    halo.scale.setScalar(16);
    world.add(halo);
    // static star field on the upper sky
    const n = g.budget.stars;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * PI * 2, e = 0.12 + rng() * 1.3;
      arr[i * 3] = Math.cos(a) * Math.cos(e) * 90;
      arr[i * 3 + 1] = Math.sin(e) * 90;
      arr[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 90;
    }
    const sg = new BufferGeometry();
    sg.setAttribute("position", new BufferAttribute(arr, 3));
    world.add(new Points(sg, new PointsMaterial({ map: spriteTex, color: 0xdfe8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false, fog: false })));
  }

  // fireflies: slow, bounded, cosmetic (never picked)
  {
    const n = Math.min(FIREFLY_MAX, g.budget.fireflies);
    const arr = new Float32Array(n * 3);
    fireflySeeds = [];
    for (let i = 0; i < n; i++) {
      const a = rng() * PI * 2, d = 6 + rng() * 12;
      fireflySeeds.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y: 0.6 + rng() * 2.6, p: rng() * 10, s: 0.3 + rng() * 0.5 });
    }
    const fg = new BufferGeometry();
    fg.setAttribute("position", new BufferAttribute(arr, 3));
    fireflies = new Points(fg, new PointsMaterial({
      map: spriteTex, color: new Color(t.glow).lerp(new Color(0xffe27a), 0.7).multiplyScalar(1.5),
      size: 0.14, transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    fireflies.frustumCulled = false;
    fireflies.visible = g.animated;
    updateFireflies(0);
    world.add(fireflies);
  }

  // decorative tiles shown on the table behind the title menu
  decor = new Group();
  {
    const faces = Object.keys(R.FACE_NAMES);
    const drng = R.makeRng(77, "decor-title");
    const spots = [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [-0.5, 1, 0], [0.5, 1, 0], [0, 2, 0], [-1, 0, 1], [0, 0, 1], [1, 0, 1], [-0.5, 1, 1], [0.5, 1, 1]] as const;
    for (const [cx, layer, row] of spots) {
      const face = faces[Math.floor(drng() * faces.length)]!;
      const mesh = new Mesh(tileGeo, sharedTileMaterial(face));
      mesh.position.set(cx * (TILE_W + GAP) + (row ? 0.3 : 0), layer * LAYER_STEP + TILE_H / 2, row * (TILE_D + GAP) - 0.6);
      mesh.rotation.y = (drng() - 0.5) * 0.08;
      mesh.castShadow = mesh.receiveShadow = true;
      decor.add(mesh);
    }
  }
  decor.visible = !lastState;
  world.add(decor);

  // selection marker ring
  marker = new Mesh(ringGeo, new MeshBasicMaterial({ color: t.accent, transparent: true, opacity: 0.9, side: DoubleSide }));
  marker.rotation.x = -PI / 2;
  marker.visible = false;
  world.add(marker);

  // particle pool (bounded, cosmetic)
  const pGeo = new BufferGeometry();
  pGeo.setAttribute("position", new BufferAttribute(new Float32Array(PARTICLE_POOL * 3), 3));
  particles = new Points(pGeo, new PointsMaterial({
    color: new Color(t.accent).multiplyScalar(det ? 1.6 : 1), size: det ? 0.16 : 0.09,
    map: det ? spriteTex : null, transparent: true, opacity: 0.9, depthWrite: false, blending: det ? AdditiveBlending : NormalBlending,
  }));
  particles.frustumCulled = false;
  particleData = [];
  pGeo.setDrawRange(0, 0);
  world.add(particles);
}

function applyShadow(): void {
  if (!moon || !look) return;
  const size = look.shadows;
  renderer.shadowMap.enabled = size > 0;
  moon.castShadow = size > 0;
  if (size > 0) moon.shadow.mapSize = size;
  moon.shadow.radius = size === 1024 ? 1 : 2;
}

function rebuild(): void {
  if (!look) return;
  disposeWorld();
  buildEnvironment();
  built = true;
  if (lastState) syncBoard(lastState);
}

/** The graphics level's look (quality.ts): post effects, shadows, reflections, shading, detail, particles, ambience. */
export function applyLook(next: Look): void {
  const prev = look;
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
  look = next;
  const b = next.budget;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.5, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: next.ao === "high" ? 16 : 8, resolution: b.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // high threshold: only the moon, lanterns, fireflies and highlights bloom
  renderer.bloom = next.bloom ? { strength: 0.55, radius: 0.45, threshold: 0.92, resolution: b.bloomRes } : null;
  // main.js GradeShader (linear, before the output): S-curve 0.18, saturation 1.1, cool shadows / warm highlights over 0.15–0.7 luma,
  // the 0.26 vignette from 0.38 to 0.9 with the horizontal axis × 1.1
  renderer.grade = next.grade ? {
    space: "linear", contrastCurve: "s", contrast: 0.18, saturation: 1.1, shadows: [0.95, 0.98, 1.06], highlights: [1.03, 1.0, 0.97], split: [0.15, 0.7],
    vignette: { amount: 0.26, inner: 0.38, outer: 0.9, scale: [1.1, 1] },
    overRange: "keep", // minor 29: mix(c, s + max(c - 1, 0), amount) as the page's grade
  } : null;
  renderer.antialias = next.antialias;
  const assetsChanged = !prev || prev.detailed !== next.detailed || prev.reflections !== next.reflections
    || (["material", "face", "bevel", "stone", "fireflies", "stars"] as const).some((k) => prev.budget[k] !== b[k]);
  if (assetsChanged || !built) rebuild();
  else applyShadow();
  if (fireflies) fireflies.visible = next.animated;
}

export function setTheme(t: Theme): void {
  if (theme === t && built) return;
  theme = t;
  if (look) rebuild();
}
export function themeNow(): Theme { return theme; }
export function setPalette(p: string): void {
  if (palette === p) return;
  palette = p;
  if (look) rebuild();
}
export function setReducedMotion(on: boolean): void { reducedMotion = on; }

// ---------------------------------------------------------------------------- the board
export function worldPos(tile: Tile): Vector3 {
  return new Vector3((tile.x - boardSpan.cx) * (TILE_W / 2 + GAP), tile.z * LAYER_STEP + TILE_H / 2, (tile.y - boardSpan.cy) * (TILE_D / 2 + GAP));
}

/** Show the hint pair glowing for 2.2 s. */
export function showHint(ids: number[]): void { hintIds = ids; hintUntil = nowMs() + 2200; }
export function clearHint(): void { hintIds = []; }

/** Positions, faces, free rings, glow and the selection marker from a snapshot (main.js syncBoard). */
export function syncBoard(state: State): void {
  lastState = state;
  if (!built || !tileGeo) return;
  if (decor) decor.visible = false;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const t of state.tiles) {
    minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
    minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
  }
  boardSpan = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX + 2, h: maxY - minY + 2 };
  fitShadow(Math.hypot(boardSpan.w * (TILE_W / 2 + GAP), boardSpan.h * (TILE_D / 2 + GAP)) / 2 + 1.5);

  const seen = new Set<number>();
  const free = new Set(R.freeTiles(state).map((t) => t.id));
  const now = nowMs();
  const soft = detailed(); // detailed tiles are brighter (clear coat + bloom): a softer glow keeps the glyph readable
  for (const tile of state.tiles) {
    seen.add(tile.id);
    let entry = tiles.get(tile.id);
    if (tile.removed) {
      if (entry) { entry.mesh.visible = false; entry.ring.visible = false; }
      continue;
    }
    if (!entry) {
      const mesh = new Mesh(tileGeo, sharedTileMaterial(tile.face));
      mesh.castShadow = true; mesh.receiveShadow = true;
      const ring = new Mesh(ringGeo, new MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.55, side: DoubleSide }));
      ring.rotation.x = -PI / 2;
      ring.visible = false;
      world.add(mesh, ring);
      entry = { mesh, ring, hot: null, free: false };
      tiles.set(tile.id, entry);
    }
    // the face can change after a shuffle
    const base = sharedTileMaterial(tile.face) as MeshStandardMaterial;
    const p = worldPos(tile);
    const selected = state.selected === tile.id;
    const hinted = hintIds.includes(tile.id) && now < hintUntil;
    entry.mesh.visible = true;
    entry.mesh.position.set(p.x, p.y + (selected ? 0.16 : 0), p.z);
    entry.ring.position.set(p.x, tile.z * LAYER_STEP + 0.02, p.z);
    entry.ring.visible = free.has(tile.id) && !selected;
    let mat: MeshStandardMaterial = base;
    if (selected || hinted) {
      const hot = entry.hot as MeshStandardMaterial | null;
      if (!hot || hot.map !== base.map) { hot?.dispose(); entry.hot = base.clone(); }
      mat = entry.hot as MeshStandardMaterial;
    }
    if (entry.mesh.material !== mat) entry.mesh.material = mat;
    mat.emissive.setHex(selected ? theme.accent : hinted ? theme.glow : 0x000000);
    mat.emissiveIntensity = selected ? (soft ? 0.1 : 0.5) : hinted ? (soft ? 0.1 : 0.35) : 0;
    entry.free = free.has(tile.id);
  }
  for (const [id, entry] of tiles) {
    if (!seen.has(id)) { world.remove(entry.mesh, entry.ring); entry.hot?.dispose(); (entry.ring.material as Material).dispose(); tiles.delete(id); }
  }
  // marker under the selection
  const sel = state.selected != null ? state.tiles.find((t) => t.id === state.selected) : undefined;
  if (marker) {
    if (sel && !sel.removed) {
      const p = worldPos(sel);
      marker.position.set(p.x, sel.z * LAYER_STEP + 0.02, p.z);
      marker.visible = true;
    } else marker.visible = false;
  }
  frameCamera();
}

/** Drop the board meshes (round left) so the title scene shows again. */
export function clearBoard(): void {
  lastState = null;
  hintIds = [];
  for (const entry of tiles.values()) {
    world.remove(entry.mesh, entry.ring);
    entry.hot?.dispose(); (entry.ring.material as Material).dispose();
  }
  tiles.clear();
  if (marker) marker.visible = false;
  particleData = [];
  fitShadow(10);
  if (decor) decor.visible = true;
}

/** Sparks over a removed tile. */
export function burstAt(tile: Tile): void {
  if (!look) return;
  const p = worldPos(tile);
  const x = p.x, y = p.y + 0.3, z = p.z;
  const cap = burstSize(look);
  if (reducedMotion || !cap) return;
  const rng = R.makeRng(Math.floor(x * 97 + z * 131 + nowMs() % 1000), "vfx");
  for (let i = 0; i < cap && particleData.length < PARTICLE_POOL; i++) {
    particleData.push({ x, y, z, vx: (rng() - 0.5) * 2.4, vy: rng() * 2.4 + 0.8, vz: (rng() - 0.5) * 2.4, life: 1 });
  }
}

// ---------------------------------------------------------------------------- camera
const aspectNow = (): number => { const f = frame(); return f.width > 0 && f.height > 0 ? f.width / f.height : 16 / 9; };
function frameCamera(): void {
  const w = boardSpan.w * (TILE_W / 2 + GAP);
  const h = boardSpan.h * (TILE_D / 2 + GAP);
  const r = Math.max(w, h) / 2 + 2.5;
  const aspect = aspectNow();
  const dist = r / Math.tan((camera.fov * PI / 180) / 2) / Math.min(aspect, 1.4);
  camGoal.pos.set(0, dist * 0.85, dist * 0.62);
  camGoal.target.set(0, 0, 0);
  if (!camGoal.moving) {
    camera.position.copy(camGoal.pos);
    camTarget.copy(camGoal.target);
    camera.lookAt(camGoal.target);
  }
}
/** Title / menu view: a slow orbit around the garden table. */
function titleCamera(dt: number): void {
  if (animated()) titleAngle += dt * 0.05;
  const a = titleAngle;
  const aspect = aspectNow();
  const dist = aspect < 1 ? 27 : 20;
  camera.position.set(Math.sin(a) * dist, aspect < 1 ? 9 : 6.5, Math.cos(a) * dist);
  camera.lookAt(0, aspect < 1 ? 1.5 : 2.2, 0);
  camGoal.moving = false;
}
export function resetCamera(): void {
  camGoal.moving = false;
  if (lastState) frameCamera();
}
/** Drag orbit (one pointer, never required for play): dx, dy in CSS pixels since the press. */
export function orbit(dx: number, dy: number): void {
  if (reducedMotion || !lastState) return;
  camGoal.moving = true;
  const pos = camera.position;
  const r = Math.hypot(pos.x, pos.z);
  const a0 = Math.atan2(pos.z, pos.x) + dx * 0.004;
  camGoal.pos.set(Math.cos(a0) * r, clamp(pos.y - dy * 0.02, 3, 40), Math.sin(a0) * r);
}
function updateCamera(dt: number): void {
  if (!camGoal.moving) return;
  const k = reducedMotion ? 1e9 : 4.5;
  const f = 1 - Math.exp(-k * dt);
  camera.position.lerp(camGoal.pos, f);
  camTarget.lerp(camGoal.target, f);
  camera.lookAt(camTarget);
  if (camera.position.distanceTo(camGoal.pos) < 0.01) camGoal.moving = false;
}

const ray = new Raycaster();
/** The live tile under a window point, or null. */
export function pick(x: number, y: number): number | null {
  const f = frame();
  if (!lastState || f.width <= 0 || f.height <= 0) return null;
  camera.updateMatrixWorld();
  ray.setFromCamera(new Vector2((x / f.width) * 2 - 1, -(y / f.height) * 2 + 1), camera);
  const meshes: Mesh[] = [];
  for (const e of tiles.values()) if (e.mesh.visible) meshes.push(e.mesh);
  const hits = ray.intersectObjects(meshes, false);
  if (!hits.length) return null;
  for (const [id, e] of tiles) if (e.mesh === hits[0]!.object) return id;
  return null;
}
/** A live tile's top-face rectangle in window pixels (its accessibility target), or null. */
export function tileRect(id: number): { x: number; y: number; width: number; height: number } | null {
  const e = tiles.get(id);
  const f = frame();
  if (!e || !e.mesh.visible || f.width <= 0) return null;
  camera.updateMatrixWorld();
  const p = e.mesh.position;
  const v = new Vector3();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [dx, dz] of [[-0.46, -0.62], [0.46, -0.62], [-0.46, 0.62], [0.46, 0.62]] as const) {
    v.set(p.x + dx, p.y + TILE_H / 2, p.z + dz).project(camera);
    const x = (v.x + 1) / 2 * f.width, y = (1 - v.y) / 2 * f.height;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
/** A tile's centre in window pixels (main.js project). */
export function tileCenter(id: number): { x: number; y: number } | null {
  const r = tileRect(id);
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
}

// ---------------------------------------------------------------------------- the frame
function updateParticles(dt: number): void {
  if (!particles) return;
  const pos = particles.geometry.getAttribute("position") as BufferAttribute;
  const arr = pos.array as Float32Array;
  let n = 0;
  for (const p of particleData) {
    p.life -= dt * 1.4;
    if (p.life <= 0) continue;
    p.vy -= dt * 3;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    arr[n * 3] = p.x; arr[n * 3 + 1] = p.y; arr[n * 3 + 2] = p.z;
    particleData[n] = p;
    n++;
  }
  particleData.length = n;
  pos.needsUpdate = true;
  particles.geometry.setDrawRange(0, n);
}
function updateFireflies(t: number): void {
  const f = fireflies;
  if (!f) return;
  const attr = f.geometry.getAttribute("position") as BufferAttribute;
  const arr = attr.array as Float32Array;
  fireflySeeds.forEach((s, i) => {
    const k = t * s.s + s.p;
    arr[i * 3] = s.x + Math.sin(k * 0.7) * 1.4;
    arr[i * 3 + 1] = s.y + Math.sin(k * 1.3) * 0.5;
    arr[i * 3 + 2] = s.z + Math.cos(k * 0.5) * 1.4;
  });
  attr.needsUpdate = true;
  (f.material as PointsMaterial).opacity = 0.75 + 0.25 * Math.sin(t * 2.1);
}
/** Gentle ambient motion: lantern flicker and drifting fireflies. */
function updateAmbient(dt: number): void {
  const anim = animated();
  if (fireflies) fireflies.visible = anim;
  if (!anim) return;
  time += dt;
  updateFireflies(time);
  for (const l of lanterns) {
    const k = 1 + 0.06 * Math.sin(time * 3.1 + l.phase) + 0.04 * Math.sin(time * 7.3 + l.phase * 2);
    (l.lamp.material as MeshStandardMaterial).emissiveIntensity = l.base * k;
    l.light.intensity = (2.5 / PI) * k;
  }
}

let lastT = 0;
let lastAspect = 0;
/** main.js render.frame: title orbit, camera motion, sparks, ambience, the marker's pulse, the hint's end. */
export function update(): void {
  const t = nowMs();
  const dt = Math.min(0.1, lastT ? Math.max(0, (t - lastT) / 1000) : 0.016);
  lastT = t;
  const aspect = aspectNow();
  if (aspect !== lastAspect) {
    lastAspect = aspect;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    if (lastState) frameCamera();
  }
  runJobs();
  if (!lastState) titleCamera(dt);
  updateCamera(dt);
  updateParticles(dt);
  updateAmbient(dt);
  if (marker?.visible && !reducedMotion) (marker.material as MeshBasicMaterial).opacity = 0.7 + 0.25 * Math.sin(t / 240);
  // the hint's glow ends after its 2.2 s
  if (hintIds.length && t >= hintUntil && lastState) { hintIds = []; syncBoard(lastState); }
}
