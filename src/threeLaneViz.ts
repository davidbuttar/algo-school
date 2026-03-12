/**
 * Three-lane sorting visualisation — orchestrator.
 *
 * Wires together scene setup, lane building, F1 countdown lights, and
 * the per-frame render loop.  All domain-specific logic (bars, colours,
 * op application) lives in dedicated modules for reuse.
 */
import type { Op } from "./algorithms";
import * as THREE from "three";
import { COLORS, MAX_BAR_HEIGHT } from "./constants";
import { createScene } from "./sceneSetup";
import {
  type Lane,
  type LaneName,
  setBarColor,
  applyValuesToLane,
  createLanes,
  updateCounter,
} from "./laneBuilder";
import { createF1Lights } from "./f1Lights";
import { soundCompare, soundSwap, soundOverwrite, soundPivot, soundDone } from "./audio";

export type { LaneName };

export function createThreeLaneViz(
  container: HTMLDivElement,
  initial: number[],
  size = 48
) {
  // Scene, camera, post-processing
  const { scene, renderer, composer, resize } =
    createScene(container);

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // Lanes
  const lanes = createLanes(scene, initial, size);

  // F1 Countdown Lights
  const f1 = createF1Lights(scene);

  // Render loop
  let raf = 0;
  function renderLoop() {
    raf = requestAnimationFrame(renderLoop);
    composer.render();
  }
  renderLoop();

  // Highlight helpers
  const activeHighlights = new Map<Lane, number[]>();

  function clearHighlights(lane: Lane) {
    lane.bars.forEach((b) => setBarColor(b, COLORS.normal));
    lane.activePivot = -1;
  }

  function highlight(lane: Lane, idxs: number[], color: THREE.Color) {
    const prev = activeHighlights.get(lane);
    if (prev) {
      for (const i of prev) {
        if (i === lane.activePivot) {
          setBarColor(lane.bars[i], COLORS.pivot);
        } else if (lane.bars[i]) {
          setBarColor(lane.bars[i], COLORS.normal);
        }
      }
    }
    idxs.forEach((i) => {
      if (lane.bars[i]) setBarColor(lane.bars[i], color);
    });
    activeHighlights.set(lane, idxs);
  }

  // Op application
  function applyOpCore(lane: Lane, op: Op, silent: boolean) {
    if (op.type !== "done" && op.type !== "markPivot") {
      lane.opCount++;
      updateCounter(lane);
    }
    switch (op.type) {
      case "compare":
        highlight(lane, [op.i, op.j], COLORS.compare);
        if (!silent) soundCompare(lane.values[op.i], lane.values[op.j], size);
        break;
      case "swap": {
        const { i, j } = op;
        [lane.values[i], lane.values[j]] = [lane.values[j], lane.values[i]];
        for (const k of [i, j]) {
          const v = lane.values[k];
          const h = 1 + (v / size) * MAX_BAR_HEIGHT;
          const bar = lane.bars[k];
          bar.scale.y = h;
          bar.position.y = h / 2;
        }
        highlight(lane, [i, j], COLORS.swap);
        if (!silent) soundSwap(lane.values[i], lane.values[j], size);
        break;
      }
      case "overwrite": {
        lane.values[op.i] = op.value;
        const v = lane.values[op.i];
        const h = 1 + (v / size) * MAX_BAR_HEIGHT;
        const bar = lane.bars[op.i];
        bar.scale.y = h;
        bar.position.y = h / 2;
        highlight(lane, [op.i], COLORS.overwrite);
        if (!silent) soundOverwrite(op.value, size);
        break;
      }
      case "markPivot":
        if (lane.activePivot >= 0 && lane.bars[lane.activePivot]) {
          setBarColor(lane.bars[lane.activePivot], COLORS.normal);
        }
        lane.activePivot = op.i;
        if (lane.bars[op.i]) setBarColor(lane.bars[op.i], COLORS.pivot);
        if (!silent) soundPivot(lane.values[op.i], size);
        break;
      case "unmarkPivot":
        if (lane.bars[op.i]) setBarColor(lane.bars[op.i], COLORS.normal);
        lane.activePivot = -1;
        break;
      case "done":
        activeHighlights.delete(lane);
        lane.bars.forEach((b) => setBarColor(b, COLORS.done));
        if (!silent) soundDone();
        break;
    }
  }

  function applyOp(lane: Lane, op: Op) {
    applyOpCore(lane, op, false);
  }

  // Timing helpers
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  let paused = false;

  function waitWhilePaused(): Promise<void> {
    if (!paused) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const check = () => {
        if (!paused) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
  }

  // Run a single lane through its op stream
  async function runLane(
    lane: Lane,
    ops: AsyncGenerator<Op>,
    speedMultiplier: number,
    abortSignal: () => boolean
  ) {
    lane.running = true;
    clearHighlights(lane);

    while (true) {
      if (abortSignal()) break;
      await waitWhilePaused();
      if (abortSignal()) break;

      const { value, done } = await ops.next();
      if (done || !value) break;

      applyOp(lane, value);

      const delay = Math.max(1, lane.baseDelayMs * speedMultiplier);
      await sleep(delay);
    }

    lane.running = false;
  }

  // External control API
  let runGeneration = 0;

  function reset(newValues: number[]) {
    runGeneration++;
    lanes.forEach((lane) => {
      lane.values = newValues.slice();
      applyValuesToLane(lane, size);
      lane.running = false;
      lane.opCount = 0;
      updateCounter(lane);
    });
  }

  function destroy() {
    runGeneration++;
    cancelAnimationFrame(raf);
    ro.disconnect();
    f1.dispose();
    renderer.dispose();
    composer.dispose();
    container.removeChild(renderer.domElement);
  }

  return {
    lanes,
    reset,
    destroy,
    getCanvas: () => renderer.domElement,
    runCountdown: (beepFn?: (freq: number, dur: number) => void) =>
      f1.runCountdown(beepFn),
    getCountdownScript: (fps: number) => f1.getCountdownScript(fps),
    pause: () => { paused = true; },
    resume: () => { paused = false; },
    isPaused: () => paused,

    runAll: async (
      bubbleOps: AsyncGenerator<Op>,
      mergeOps: AsyncGenerator<Op>,
      quickOps: AsyncGenerator<Op>,
      speedMultiplier: number
    ) => {
      const gen = ++runGeneration;
      const abortSignal = () => gen !== runGeneration;

      await Promise.all([
        runLane(lanes[0], bubbleOps, speedMultiplier, abortSignal),
        runLane(lanes[1], mergeOps, speedMultiplier, abortSignal),
        runLane(lanes[2], quickOps, speedMultiplier, abortSignal),
      ]);
    },

    isRunning: () => lanes.some((l) => l.running),

    /**
     * Offline frame-by-frame export.
     * Renders the F1 countdown first, then steps through all sorting ops
     * deterministically.  Each frame is rendered via the bloom composer
     * and yielded so the caller can capture the canvas.
     */
    exportFrames: async function* (
      allOps: [import("./algorithms").Op[], import("./algorithms").Op[], import("./algorithms").Op[]],
      framesPerOp: number,
      fps: number
    ): AsyncGenerator<{ phase: "countdown" | "sorting"; frame: number }> {
      cancelAnimationFrame(raf);

      lanes.forEach((lane) => {
        lane.opCount = 0;
        updateCounter(lane);
        clearHighlights(lane);
      });

      let globalFrame = 0;

      // ── Phase 1: F1 countdown ──────────────────────────
      const { events, totalFrames: countdownFrames } = f1.getCountdownScript(fps);

      for (let f = 0; f < countdownFrames; f++) {
        // Apply any events that fire on this frame
        for (const ev of events) {
          if (ev.atFrame === f) f1.applyEvent(ev);
        }
        composer.render();
        yield { phase: "countdown", frame: globalFrame++ };
      }
      // Ensure lights are hidden after countdown
      f1.applyEvent({ atFrame: 0, action: "hide" });

      // ── Phase 2: sorting ops ───────────────────────────
      const maxLen = Math.max(...allOps.map((o) => o.length));

      for (let tick = 0; tick < maxLen; tick++) {
        for (let li = 0; li < 3; li++) {
          if (tick < allOps[li].length) {
            applyOpCore(lanes[li], allOps[li][tick], true);
          }
        }

        for (let f = 0; f < framesPerOp; f++) {
          composer.render();
          yield { phase: "sorting", frame: globalFrame++ };
        }
      }

      renderLoop();
    },
  };
}
