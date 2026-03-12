/**
 * Offline audio renderer — generates a WAV blob containing all sorting
 * sounds perfectly timed, using OfflineAudioContext.
 *
 * No real-time constraints, so every sound event is sample-accurate.
 */

import type { Op } from "./algorithms";

// ── Pentatonic frequency mapping (mirrors audio.ts) ──────

const PENTA = [0, 2, 4, 7, 9];
const BASE_NOTE = 48; // C3 MIDI

function valueToFreq(value: number, size: number): number {
  const totalNotes = Math.ceil(size * 1.1);
  const noteIndex = Math.round(((value - 1) / (size - 1)) * (totalNotes - 1));
  const octave = Math.floor(noteIndex / PENTA.length);
  const degree = noteIndex % PENTA.length;
  const midi = BASE_NOTE + octave * 12 + PENTA[degree];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ── Schedule a tone into an OfflineAudioContext ──────────

function scheduleTone(
  ctx: OfflineAudioContext,
  dest: AudioNode,
  freq: number,
  startTime: number,
  duration: number,
  type: OscillatorType = "sine",
  gainMul = 1.0
) {
  if (startTime < 0) startTime = 0;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.001, startTime);
  env.gain.linearRampToValueAtTime(gainMul, startTime + 0.005);
  env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.connect(env);
  env.connect(dest);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.01);
}

// ── Schedule the "done" arpeggio ─────────────────────────

function scheduleDone(
  ctx: OfflineAudioContext,
  dest: AudioNode,
  startTime: number
) {
  const notes = [60, 64, 67, 72]; // C-E-G-C
  notes.forEach((midi, idx) => {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    scheduleTone(ctx, dest, freq, startTime + idx * 0.08, 0.18, "sine", 0.5);
  });
}

// ── Main export ──────────────────────────────────────────

export async function renderOfflineAudio(
  allOps: [Op[], Op[], Op[]],
  initialValues: number[],
  size: number,
  framesPerOp: number,
  fps: number,
  /** Number of frames the countdown occupies (0 to skip countdown audio). */
  countdownFrames = 0
): Promise<Blob> {
  const maxOps = Math.max(...allOps.map((o) => o.length));
  const countdownDuration = countdownFrames / fps;
  const sortingDuration = (maxOps * framesPerOp) / fps;
  const duration = countdownDuration + sortingDuration + 2; // +2s safety buffer
  const sampleRate = 44100;

  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(duration * sampleRate),
    sampleRate
  );

  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);

  // ── Countdown beeps ────────────────────────────────────
  // 5 lights: each turns on at 1s intervals starting at t=1s
  // Then all-off beep at t=6s (880 Hz)
  if (countdownFrames > 0) {
    const BULB_COUNT = 5;
    for (let i = 0; i < BULB_COUNT; i++) {
      const t = (i + 1) * 1.0; // 1s, 2s, 3s, 4s, 5s
      scheduleTone(ctx, master, 440, t, 0.15, "sine", 1.5);
    }
    // "Go" beep at 6s
    scheduleTone(ctx, master, 880, (BULB_COUNT + 1) * 1.0, 0.3, "sine", 1.8);
  }

  // ── Sorting sounds (offset by countdown duration) ──────
  for (const ops of allOps) {
    const values = initialValues.slice();

    for (let i = 0; i < ops.length; i++) {
      const time = countdownDuration + (i * framesPerOp) / fps;
      const op = ops[i];

      switch (op.type) {
        case "compare":
          scheduleTone(ctx, master, valueToFreq(values[op.i], size), time, 0.06, "sine", 0.5);
          scheduleTone(ctx, master, valueToFreq(values[op.j], size), time, 0.06, "sine", 0.5);
          break;
        case "swap":
          [values[op.i], values[op.j]] = [values[op.j], values[op.i]];
          scheduleTone(ctx, master, valueToFreq(values[op.i], size), time, 0.09, "triangle", 0.7);
          scheduleTone(ctx, master, valueToFreq(values[op.j], size), time, 0.09, "triangle", 0.7);
          break;
        case "overwrite":
          values[op.i] = op.value;
          scheduleTone(ctx, master, valueToFreq(op.value, size), time, 0.07, "square", 0.25);
          break;
        case "markPivot":
          scheduleTone(ctx, master, valueToFreq(values[op.i], size) * 0.5, time, 0.15, "sine", 0.6);
          break;
        case "done":
          scheduleDone(ctx, master, time);
          break;
        // unmarkPivot — no sound
      }
    }
  }

  const buffer = await ctx.startRendering();
  return audioBufferToWav(buffer);
}

// ── AudioBuffer → WAV Blob ───────────────────────────────

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const bps = 16;
  const numSamples = buffer.length;
  const dataLen = numSamples * numCh * (bps / 8);
  const headerLen = 44;

  const wav = new ArrayBuffer(headerLen + dataLen);
  const v = new DataView(wav);

  // RIFF header
  writeStr(v, 0, "RIFF");
  v.setUint32(4, headerLen + dataLen - 8, true);
  writeStr(v, 8, "WAVE");

  // fmt chunk
  writeStr(v, 12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * (bps / 8), true);
  v.setUint16(32, numCh * (bps / 8), true);
  v.setUint16(34, bps, true);

  // data chunk
  writeStr(v, 36, "data");
  v.setUint32(40, dataLen, true);

  // Interleave channels → 16-bit PCM
  const chData: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chData.push(buffer.getChannelData(c));

  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chData[c][i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }

  return new Blob([wav], { type: "audio/wav" });
}

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
