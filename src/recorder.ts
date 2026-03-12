/**
 * Offline video-export module.
 *
 * Pre-collects all sorting operations, then renders frames one-by-one
 * (no real-time pressure), streams them to the conversion server where
 * ffmpeg produces a perfect H.264 + AAC MP4.
 *
 * Audio is rendered offline via OfflineAudioContext for sample-accurate
 * sync with the visuals.
 */

import type { Op } from "./algorithms";
import { bubbleSortOps, mergeSortOps, quickSortOps } from "./algorithms";
import { renderOfflineAudio } from "./offlineAudio";

const SERVER = "http://localhost:3044";
const FPS = 60;
const BATCH_SIZE = 30; // frames per HTTP request

let exporting = false;
let cancelled = false;

export function isExporting() {
  return exporting;
}

export function cancelExport() {
  cancelled = true;
}

/** Collect every op from an async generator into an array. */
async function collectOps(gen: AsyncGenerator<Op>): Promise<Op[]> {
  const ops: Op[] = [];
  while (true) {
    const { value, done } = await gen.next();
    if (done) break;
    if (value) ops.push(value);
  }
  return ops;
}

/** Convert canvas to a JPEG Blob (quality 95 %). */
function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (b) => resolve(b!),
      "image/jpeg",
      0.95
    );
  });
}

/** Pack multiple JPEG blobs into one ArrayBuffer with length-prefix. */
async function packFrames(blobs: Blob[]): Promise<ArrayBuffer> {
  const parts: ArrayBuffer[] = [];
  for (const blob of blobs) {
    const ab = await blob.arrayBuffer();
    const header = new ArrayBuffer(4);
    new DataView(header).setUint32(0, ab.byteLength, true);
    parts.push(header, ab);
  }
  // Concatenate
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), off);
    off += p.byteLength;
  }
  return out.buffer;
}

// ── Main export function ─────────────────────────────────

export type ExportViz = {
  reset: (values: number[]) => void;
  getCanvas: () => HTMLCanvasElement;
  getCountdownScript: (fps: number) => { events: unknown[]; totalFrames: number };
  exportFrames: (
    allOps: [Op[], Op[], Op[]],
    framesPerOp: number,
    fps: number
  ) => AsyncGenerator<{ phase: string; frame: number }>;
};

export async function exportVideo(
  viz: ExportViz,
  seed: number[],
  speedMultiplier: number,
  size: number,
  onProgress: (fraction: number, phase: string) => void
): Promise<void> {
  if (exporting) return;
  exporting = true;
  cancelled = false;

  try {
    // ── 1. Collect all ops ────────────────────────────────
    onProgress(0, "Collecting operations…");
    const [bubbleOps, mergeOps, quickOps] = await Promise.all([
      collectOps(bubbleSortOps(seed)),
      collectOps(mergeSortOps(seed)),
      collectOps(quickSortOps(seed)),
    ]);

    const allOps: [Op[], Op[], Op[]] = [bubbleOps, mergeOps, quickOps];
    const delay = Math.max(1, 10 * speedMultiplier);
    const framesPerOp = Math.max(1, Math.round((delay * FPS) / 1000));
    const maxOps = Math.max(bubbleOps.length, mergeOps.length, quickOps.length);

    // Calculate countdown frames so total includes them
    const { totalFrames: countdownFrames } = viz.getCountdownScript(FPS);
    const sortingFrames = maxOps * framesPerOp;
    const totalFrames = countdownFrames + sortingFrames;

    if (cancelled) return;

    // ── 2. Render audio offline (with countdown beeps) ────
    onProgress(0, "Rendering audio…");
    const audioBlob = await renderOfflineAudio(
      allOps, seed, size, framesPerOp, FPS, countdownFrames
    );

    if (cancelled) return;

    // ── 3. Start server session ───────────────────────────
    const canvas = viz.getCanvas();
    const resp = await fetch(`${SERVER}/api/export/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        width: canvas.width,
        height: canvas.height,
        fps: FPS,
      }),
    });
    if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
    const { sessionId } = await resp.json();

    if (cancelled) return;

    // ── 4. Send audio ─────────────────────────────────────
    onProgress(0, "Uploading audio…");
    await fetch(`${SERVER}/api/export/audio/${sessionId}`, {
      method: "POST",
      body: audioBlob,
    });

    if (cancelled) return;

    // ── 5. Reset viz and render all frames (countdown + sorting)
    viz.reset(seed);

    let framesSent = 0;
    let batch: Blob[] = [];

    for await (const _info of viz.exportFrames(allOps, framesPerOp, FPS)) {
      if (cancelled) break;

      const blob = await canvasToJpeg(canvas);
      batch.push(blob);

      if (batch.length >= BATCH_SIZE) {
        const packed = await packFrames(batch);
        await fetch(`${SERVER}/api/export/frames/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: packed,
        });
        framesSent += batch.length;
        batch = [];
        onProgress(
          framesSent / totalFrames,
          `Rendering frame ${framesSent} / ${totalFrames}`
        );
      }
    }

    // Flush remaining
    if (batch.length > 0 && !cancelled) {
      const packed = await packFrames(batch);
      await fetch(`${SERVER}/api/export/frames/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: packed,
      });
      framesSent += batch.length;
    }

    if (cancelled) return;

    // ── 6. Finish → download MP4 ──────────────────────────
    onProgress(1, "Encoding MP4…");
    const mp4Resp = await fetch(`${SERVER}/api/export/finish/${sessionId}`, {
      method: "POST",
    });
    if (!mp4Resp.ok) throw new Error(`Finish failed: ${mp4Resp.status}`);

    const mp4Blob = await mp4Resp.blob();
    download(mp4Blob, "sorting-race.mp4");
    onProgress(1, "Done!");
  } finally {
    exporting = false;
    cancelled = false;
  }
}

// ── Helpers ──────────────────────────────────────────────

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
