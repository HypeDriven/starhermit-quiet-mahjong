// Sound, as the browser build's js/main.js `audio`: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per logical event, round-robin over
// each event's variants (select, deselect, remove, invalid, hint, shuffle,
// undo, won, lost, pause), the quiet ambience loop (4 s of smoothed noise
// through a 500 Hz lowpass) and the moonlit pad (every 4.6 s two seeded
// pentatonic sine notes of 4.5 s, the second an octave up 0.4 s later, while
// Music is audible). The browser build ran the ambience and the pad live; here
// they are rendered into clips once (createClip, a slice a frame) and played
// by the pad's timer. The runtime has no ambience bus: the loop plays on the
// music bus at the old ambience / music balance (50 / 60). The runtime's
// Options own the volumes, the mute and the voice limit. The procedural
// voices the browser build used while a sample decoded are not ported (a live
// synthesis graph makes clip loads fail on the engine's web runtime): a clip
// still loading is silent. Clips load once the mixer runs (natively at once,
// in a browser after the first press), one at a time. Every event returns its
// sound-caption key (the game's Captions option).
import { frame } from "starhermit:engine";
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { R } from "./game.ts";

const SFX: Record<string, string[]> = {
  select: ["tile-tap-select", "ui-focus-tick"],
  deselect: ["tile-tap-release"],
  remove: ["tile-pair-chime", "tile-pair-clack"],
  invalid: ["invalid-dull-thud"],
  hint: ["hint-glimmer"],
  shuffle: ["tiles-shuffle-swish"],
  undo: ["undo-reverse-tap"],
  won: ["win-garden-chime"],
  lost: ["lose-low-gong"],
  pause: ["pause-soft-knock"],
};
const clips = new Map<string, AudioClip>();
const pick = new Map<string, number>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;

/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }
/** A hidden window: the ambience and pad quiet. */
export function setSuspended(on: boolean): void { suspended = on; }

/** audio.event(name): the event's next authored clip; returns the caption key (the event's name). */
export function play(event: string): string {
  const names = SFX[event];
  if (!names) return "";
  const start = pick.get(event) ?? 0;
  for (let i = 0; i < names.length; i++) {
    const idx = (start + i) % names.length;
    const clip = clips.get(names[idx]!);
    if (!clip) continue;
    pick.set(event, (idx + 1) % names.length);
    try { playClip(clip, { bus: "effects" }); }
    catch { clips.delete(names[idx]!); if (!queue.includes(names[idx]!)) queue.push(names[idx]!); } // a clip the mixer lost: load it again
    break;
  }
  return event;
}

// -- the rendered ambience and pad ----------------------------------------------------------
const RATE = 22050;
// the ambience: 4 s of noise smoothed by last = 0.98 last + 0.02 n (× 3), through a one-pole 500 Hz lowpass, run twice so the loop joins
const AMB_N = RATE * 4;
const amb = new Float32Array(AMB_N);
const ambRng = R.makeRng(99, "ambience");
let ambPos = 0, ambLast = 0, ambY = 0;
function renderAmbience(count: number): boolean {
  const k = 1 - Math.exp((-2 * Math.PI * 500) / RATE);
  const end = Math.min(2 * AMB_N, ambPos + count);
  for (; ambPos < end; ambPos++) {
    const i = ambPos % AMB_N;
    if (ambPos < AMB_N) {
      ambLast = ambLast * 0.98 + (ambRng() * 2 - 1) * 0.02;
      amb[i] = ambLast * 3;
    }
    ambY += k * (amb[i]! - ambY);
    if (ambPos >= AMB_N) amb[i] = ambY;
  }
  return ambPos >= 2 * AMB_N;
}
// the pad's notes: tone(freq, 4.5 s, sine): 12 ms linear attack, exponential fall to 0.0001 at 4.5 s (gain set at play)
const NOTES = [220, 261.6, 293.7, 349.2, 392];
const DUR = 4.5;
function renderNote(freq: number): Float32Array {
  const n = Math.round(RATE * (DUR + 0.05));
  const out = new Float32Array(n);
  const w = (2 * Math.PI * freq) / RATE;
  const fall = Math.log(0.0001) / (DUR - 0.012);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const g = t < 0.012 ? t / 0.012 : t > DUR ? 0 : Math.exp(fall * (t - 0.012));
    out[i] = Math.sin(w * i) * g;
  }
  return out;
}
const FREQS = [...NOTES, ...NOTES.map((f) => f * 2)];
const noteClips = new Map<number, AudioClip>();
let ambClip: AudioClip | null = null;
let ambVoice: Sound | null = null;
let step = 0;
let nextTick = 0;
let delayed: { at: number; freq: number } | null = null;

function note(freq: number, gain: number): void {
  const clip = noteClips.get(freq);
  if (!clip) return;
  try { playClip(clip, { bus: "music", gain }); } catch { /* the mixer restarted */ }
}

/** Each frame: the clips once the mixer runs (one at a time), then the ambience and the pad. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const list of Object.values(SFX)) for (const n of list) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
    }
    return;
  }
  if (loading) return;
  if (!ambClip) {
    if (!renderAmbience(12000)) return;
    try { ambClip = createClip([amb], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); ambPos = 0; }
    return;
  }
  if (!ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: 0, loop: true }); } catch { ambVoice = null; }
    return;
  }
  if (noteClips.size < FREQS.length) {
    const f = FREQS[noteClips.size]!;
    try { noteClips.set(f, createClip([renderNote(f)], RATE)); } catch (e) { console.warn(`audio: ${String(e)}`); }
    return;
  }
  const t = frame().time;
  // the ambience bus's 50 % against music's 60 %
  try { ambVoice.fade(suspended ? 0 : 0.83, 0.3); } catch { /* the mixer restarted */ }
  if (suspended) { nextTick = Math.max(nextTick, t + 1); delayed = null; return; }
  if (delayed && delayed.at <= t) { note(delayed.freq, 0.028); delayed = null; }
  if (t < nextTick) return;
  nextTick = t + 4.6;
  const rng = R.makeRng(7 + step, "music");
  const a = NOTES[Math.floor(rng() * NOTES.length)]!;
  const b = NOTES[Math.floor(rng() * NOTES.length)]! * 2;
  note(a, 0.05);
  delayed = { at: t + 0.4, freq: b };
  step++;
}
