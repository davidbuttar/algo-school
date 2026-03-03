/**
 * Session-based video-export server (zero npm deps — pure Node stdlib).
 *
 * The client renders frames offline and streams them here, then ffmpeg
 * encodes the final H.264 + AAC MP4 with no frame-drops.
 *
 * Endpoints:
 *   POST /api/export/start          → { sessionId }
 *   POST /api/export/frames/:id     → binary: [4-byte LE len][JPEG]…
 *   POST /api/export/audio/:id      → raw WAV body
 *   POST /api/export/finish/:id     → returns MP4 binary
 *
 * Usage:  node server/server.mjs
 */

import { createServer } from "node:http";
import { mkdtemp, rm, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const run = promisify(execFile);
const PORT = 3044;

/** @type {Map<string, {dir:string, ffmpeg:import("node:child_process").ChildProcess, videoPath:string, audioPath:string, mp4Path:string, hasAudio:boolean, framesWritten:number}>} */
const sessions = new Map();

/** Collect full request body as a Buffer. */
function bodyBuf(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const server = createServer(async (req, res) => {
  // ── CORS ──────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  try {
    // ── POST /api/export/start ────────────────────────────
    if (req.method === "POST" && req.url === "/api/export/start") {
      const { width, height, fps } = JSON.parse((await bodyBuf(req)).toString());
      const dir = await mkdtemp(join(tmpdir(), "sort-export-"));
      const videoPath = join(dir, "video_only.mp4");
      const audioPath = join(dir, "audio.wav");
      const mp4Path   = join(dir, "output.mp4");

      // Spawn ffmpeg: read JPEG stream from stdin → H.264 MP4
      const ffmpeg = spawn("ffmpeg", [
        "-y",
        "-f", "image2pipe",
        "-framerate", String(fps),
        "-c:v", "mjpeg",
        "-i", "pipe:0",
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        videoPath,
      ], { stdio: ["pipe", "pipe", "pipe"] });

      ffmpeg.stderr.on("data", (d) => process.stderr.write(d));

      const sessionId = randomUUID();
      sessions.set(sessionId, {
        dir, ffmpeg, videoPath, audioPath, mp4Path,
        hasAudio: false, framesWritten: 0,
      });

      console.log(`🎬 Export session ${sessionId} started (${width}×${height} @ ${fps}fps)`);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ sessionId }));
    }

    // ── POST /api/export/frames/:id ───────────────────────
    const framesMatch = req.url?.match(/^\/api\/export\/frames\/([a-f0-9-]+)$/);
    if (req.method === "POST" && framesMatch) {
      const session = sessions.get(framesMatch[1]);
      if (!session) { res.writeHead(404); return res.end("Session not found"); }

      const buf = await bodyBuf(req);
      // Binary protocol: [Uint32LE length][JPEG bytes] repeated
      let offset = 0;
      while (offset + 4 <= buf.length) {
        const len = buf.readUInt32LE(offset);
        offset += 4;
        if (offset + len > buf.length) break;
        const jpeg = buf.subarray(offset, offset + len);
        session.ffmpeg.stdin.write(jpeg);
        session.framesWritten++;
        offset += len;
      }

      res.writeHead(200);
      return res.end();
    }

    // ── POST /api/export/audio/:id ────────────────────────
    const audioMatch = req.url?.match(/^\/api\/export\/audio\/([a-f0-9-]+)$/);
    if (req.method === "POST" && audioMatch) {
      const session = sessions.get(audioMatch[1]);
      if (!session) { res.writeHead(404); return res.end("Session not found"); }

      const buf = await bodyBuf(req);
      await writeFile(session.audioPath, buf);
      session.hasAudio = true;
      console.log(`   🔊 Audio received (${(buf.length / 1048576).toFixed(1)} MB)`);

      res.writeHead(200);
      return res.end();
    }

    // ── POST /api/export/finish/:id ───────────────────────
    const finishMatch = req.url?.match(/^\/api\/export\/finish\/([a-f0-9-]+)$/);
    if (req.method === "POST" && finishMatch) {
      const session = sessions.get(finishMatch[1]);
      if (!session) { res.writeHead(404); return res.end("Session not found"); }

      console.log(`   ⏳ Closing stdin (${session.framesWritten} frames written)…`);
      session.ffmpeg.stdin.end();

      // Wait for ffmpeg to finish encoding
      await new Promise((resolve, reject) => {
        session.ffmpeg.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
        );
        session.ffmpeg.on("error", reject);
      });

      // Mux audio if present
      if (session.hasAudio) {
        console.log("   🔊 Muxing audio…");
        await run("ffmpeg", [
          "-y",
          "-i", session.videoPath,
          "-i", session.audioPath,
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "192k",
          "-shortest",
          session.mp4Path,
        ]);
      } else {
        await rename(session.videoPath, session.mp4Path);
      }

      const out = await readFile(session.mp4Path);
      sessions.delete(finishMatch[1]);
      console.log(`   ✅ Done — MP4 is ${(out.length / 1048576).toFixed(1)} MB`);

      // Cleanup temp dir
      await rm(session.dir, { recursive: true, force: true }).catch(() => {});

      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="sorting-race.mp4"',
        "Content-Length": out.length,
      });
      return res.end(out);
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    console.error("Server error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n🎬  Export server ready on http://localhost:${PORT}`);
  console.log("    POST /api/export/start   → begin session");
  console.log("    POST /api/export/frames   → stream JPEG frames");
  console.log("    POST /api/export/audio    → send WAV");
  console.log("    POST /api/export/finish   → get MP4\n");
});
