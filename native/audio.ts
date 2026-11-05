// Sound, as the browser build's js/main.js `audio`: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per logical event, a SoundBank taking
// each event's variants in turn (select, deselect, remove, invalid, hint,
// shuffle, undo, won, lost, pause), the quiet ambience loop (4 s of brown noise
// through a lowpass, the old smoothed noise's slope) and the moonlit pad (every
// 4.6 s two seeded pentatonic sine notes of 4.5 s, the second an octave up 0.4 s
// later, while Music is audible). The browser build ran the ambience and the
// pad live; here they are rendered into clips once (OfflineAudioContext) and
// played by the pad's timer. The loop plays on the music bus at the old
// ambience / music balance (50 / 60). The runtime's Options own the volumes, the
// mute and the voice limit. A clip still loading is silent. Everything loads in
// onStart; only starting the ambience and pad waits for the mixer (in a
// browser, the first press). Every event returns its sound-caption key (the
// game's Captions option).
import { frame } from "starhermit:engine";
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, SoundBank, type AudioClip, type Sound } from "starhermit:audio";
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
const banks = new Map<string, SoundBank>();
let suspended = false;

/** A hidden window: the ambience and pad quiet. */
export function setSuspended(on: boolean): void { suspended = on; }

/** audio.event(name): the event's next authored clip; returns the caption key (the event's name). */
export function play(event: string): string {
  if (!SFX[event]) return "";
  try { banks.get(event)?.play(); } catch { /* the mixer is full this frame: skip it */ }
  return event;
}

// -- the rendered ambience and pad ----------------------------------------------------------
const RATE = 22050;
const AMB_SECONDS = 4;
const AMB_GAIN = 0.8; // the old loop's level (rms 0.166)
/** Filtered periodic noise is periodic once settled: no crossfade. */
async function renderAmbience(): Promise<AudioClip> {
  const settle = Math.round(0.5 * RATE);
  const off = new OfflineAudioContext(1, settle + AMB_SECONDS * RATE, RATE);
  const noise = off.createNoise({ color: "brown", seed: 99, seconds: AMB_SECONDS });
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
  const g = off.createGain(); g.gain.value = AMB_GAIN;
  noise.connect(lp).connect(g).connect(off.destination); noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}
// the pad's notes: tone(freq, 4.5 s, sine): 12 ms linear attack, exponential fall to 0.0001 at 4.5 s (gain set at play)
const NOTES = [220, 261.6, 293.7, 349.2, 392];
const DUR = 4.5;
async function renderNote(freq: number): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round(RATE * (DUR + 0.05)), RATE);
  const osc = off.createOscillator(); osc.frequency.value = freq;
  const g = off.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(1, 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, DUR);
  osc.connect(g).connect(off.destination); osc.start(); osc.stop(DUR);
  return createClip(await off.startRendering());
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

/** Loads every clip at once and renders the ambience and the pad's notes (onStart). */
export function loadSfx(): void {
  for (const [event, names] of Object.entries(SFX)) {
    void Promise.all(names.map((n) => loadClip(`sfx/${n}.opus`).catch((e: unknown) => { console.warn(`sfx ${n}: ${String(e)}`); return null; }))).then((loaded) => {
      const list = loaded.filter((c) => c !== null);
      if (list.length) banks.set(event, new SoundBank({ clips: list, order: "sequence", bus: "effects" }));
    });
  }
  const warn = (e: unknown): void => { console.warn(`audio: ${String(e)}`); };
  renderAmbience().then((c) => { ambClip = c; }, warn);
  for (const f of FREQS) renderNote(f).then((c) => { noteClips.set(f, c); }, warn);
}

/** Each frame, once the mixer runs: the ambience and the pad. */
export function update(): void {
  if (context.state !== "running" || !ambClip) return;
  if (!ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: 0, loop: true }); } catch { ambVoice = null; }
    return;
  }
  if (noteClips.size < FREQS.length) return;
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
