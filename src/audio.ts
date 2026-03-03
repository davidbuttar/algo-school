/**
 * Lightweight Web Audio sound engine for sorting visualisation.
 *
 * Maps bar values (1..N) to musical frequencies on a pentatonic scale
 * so simultaneous tones from the three lanes sound harmonious rather
 * than dissonant.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;

/** Lazily create the AudioContext (must be called from a user gesture). */
function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.18; // keep it gentle
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** Map a value (1..size) to a frequency using a pentatonic scale. */
function valueToFreq(value: number, size: number): number {
  // Pentatonic intervals in semitones: 0, 2, 4, 7, 9 (repeating across octaves)
  const penta = [0, 2, 4, 7, 9];
  const baseNote = 48; // C3 in MIDI
  // Spread values across ~3 octaves of pentatonic notes
  const totalNotes = Math.ceil(size * 1.1);
  const noteIndex = Math.round(((value - 1) / (size - 1)) * (totalNotes - 1));
  const octave = Math.floor(noteIndex / penta.length);
  const degree = noteIndex % penta.length;
  const midi = baseNote + octave * 12 + penta[degree];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Play a short sine tone at a given frequency. */
function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  gainMul = 1.0
) {
  if (muted) return;
  const ac = ensureCtx();
  if (!masterGain) return;

  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;

  const env = ac.createGain();
  const now = ac.currentTime;
  env.gain.setValueAtTime(0.001, now);
  env.gain.linearRampToValueAtTime(gainMul, now + 0.005);
  env.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(env);
  env.connect(masterGain);

  osc.start(now);
  osc.stop(now + duration);
}

// ── Public API ─────────────────────────────────────────

export function initAudio() {
  ensureCtx();
}

export function setMuted(m: boolean) {
  muted = m;
}

export function isMuted() {
  return muted;
}

/** Compare: two soft, short sine tones at the compared values' pitches. */
export function soundCompare(vi: number, vj: number, size: number) {
  if (muted) return;
  const d = 0.06;
  playTone(valueToFreq(vi, size), d, "sine", 0.5);
  playTone(valueToFreq(vj, size), d, "sine", 0.5);
}

/** Swap: slightly louder triangle tones. */
export function soundSwap(vi: number, vj: number, size: number) {
  if (muted) return;
  const d = 0.09;
  playTone(valueToFreq(vi, size), d, "triangle", 0.7);
  playTone(valueToFreq(vj, size), d, "triangle", 0.7);
}

/** Overwrite: single square-ish blip. */
export function soundOverwrite(v: number, size: number) {
  if (muted) return;
  playTone(valueToFreq(v, size), 0.07, "square", 0.25);
}

/** Pivot selected: deeper tone. */
export function soundPivot(v: number, size: number) {
  if (muted) return;
  playTone(valueToFreq(v, size) * 0.5, 0.15, "sine", 0.6);
}

/** Lane finished: quick ascending arpeggio. */
export function soundDone() {
  if (muted) return;
  const notes = [60, 64, 67, 72]; // C-E-G-C
  notes.forEach((midi, idx) => {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    setTimeout(() => playTone(freq, 0.18, "sine", 0.5), idx * 80);
  });
}

/** Return the live AudioContext (or null before init). */
export function getAudioContext() {
  return ctx;
}

/** Return the master gain node (or null before init). */
export function getMasterGain() {
  return masterGain;
}

export function destroyAudio() {
  if (ctx) {
    ctx.close();
    ctx = null;
    masterGain = null;
  }
}
