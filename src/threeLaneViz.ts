import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Op } from "./algorithms";
import { soundCompare, soundSwap, soundOverwrite, soundPivot, soundDone } from "./audio";

export type LaneName = "Bubble Sort" | "Merge Sort" | "Quick Sort";

type Lane = {
  name: LaneName;
  group: THREE.Group;
  bars: THREE.Mesh[];
  values: number[];
  baseDelayMs: number;
  highlightTimeout?: number;
  running: boolean;
  opCount: number;
  activePivot: number;  // -1 when no pivot is active
  counterCanvas?: HTMLCanvasElement;
  counterTexture?: THREE.CanvasTexture;
  counterMesh?: THREE.Mesh;
};

// Neon palette — normal bars are below bloom threshold for a clean look;
// active highlights push above the threshold for a subtle selective glow.
const COLORS = {
  normal: new THREE.Color("#3388ff"),          // vivid blue, no bloom
  compare: new THREE.Color(1.2, 0.95, 0.0),    // warm yellow — gentle bloom
  swap: new THREE.Color(1.2, 0.1, 0.2),         // red-pink — gentle bloom
  overwrite: new THREE.Color(0.0, 1.1, 0.35),   // green — gentle bloom
  pivot: new THREE.Color(0.9, 0.15, 1.2),       // purple — gentle bloom
  done: new THREE.Color("#22cc66"),             // green on completion
};

function makeBarMaterial() {
  return new THREE.MeshBasicMaterial({ color: COLORS.normal.clone() });
}

function setBarColor(bar: THREE.Mesh, c: THREE.Color) {
  const mat = bar.material as THREE.MeshBasicMaterial;
  mat.color.copy(c);
  mat.needsUpdate = true;
}

export function createThreeLaneViz(
  container: HTMLDivElement,
  initial: number[],
  size = 48
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#05060c");

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  // Flat orthographic camera — looking straight at the XY plane
  const frustumHalf = 20;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const camCenterY = 5.75;          // vertical midpoint of content
  camera.position.set(0, camCenterY, 50);
  camera.lookAt(0, camCenterY, 0);

  // Post-processing: UnrealBloomPass for neon glow
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(container.clientWidth || 800, container.clientHeight || 600),
    0.4,  // strength  — gentle glow
    0.25, // radius    — tight halo
    0.75  // threshold — only HDR highlights bloom
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // ── Lanes ──────────────────────────────────────────────
  const laneGap = 20;
  const lanes: Lane[] = [
    { name: "Bubble Sort", group: new THREE.Group(), bars: [], values: initial.slice(), baseDelayMs: 10, running: false, opCount: 0, activePivot: -1 },
    { name: "Merge Sort",  group: new THREE.Group(), bars: [], values: initial.slice(), baseDelayMs: 10, running: false, opCount: 0, activePivot: -1 },
    { name: "Quick Sort",  group: new THREE.Group(), bars: [], values: initial.slice(), baseDelayMs: 10, running: false, opCount: 0, activePivot: -1 },
  ];

  lanes[0].group.position.x = -laneGap;
  lanes[1].group.position.x = 0;
  lanes[2].group.position.x = laneGap;

  scene.add(lanes[0].group, lanes[1].group, lanes[2].group);

  // ── Labels (canvas-texture planes facing camera) ───────
  function makeNameplate(text: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 64px ui-sans-serif, system-ui";
    ctx.fillStyle = "#7799dd";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), mat);
    mesh.position.set(0, 14, 0);
    return mesh;
  }

  lanes.forEach((lane) => lane.group.add(makeNameplate(lane.name)));

  // ── Op-counter labels (below bars) ─────────────────────
  function makeCounterLabel() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    drawCounter(ctx, canvas, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), mat);
    mesh.position.set(0, -2.5, 0);
    return { canvas, tex, mesh };
  }

  function drawCounter(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    count: number
  ) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font =
      "bold 50px ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
    ctx.fillStyle = "#6688aa";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `Ops: ${count.toLocaleString()}`,
      canvas.width / 2,
      canvas.height / 2
    );
  }

  function updateCounter(lane: Lane) {
    if (!lane.counterCanvas || !lane.counterTexture) return;
    const ctx = lane.counterCanvas.getContext("2d")!;
    drawCounter(ctx, lane.counterCanvas, lane.opCount);
    lane.counterTexture.needsUpdate = true;
  }

  lanes.forEach((lane) => {
    const { canvas, tex, mesh } = makeCounterLabel();
    lane.counterCanvas = canvas;
    lane.counterTexture = tex;
    lane.counterMesh = mesh;
    lane.group.add(mesh);
  });

  // ── Bars (flat PlaneGeometry rectangles) ───────────────
  const barWidth = 0.28;
  const barGap = 0.06;
  const maxBarHeight = 10;

  function buildLaneBars(lane: Lane) {
    lane.bars.forEach((b) => lane.group.remove(b));
    lane.bars = [];

    const geom = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < size; i++) {
      const mat = makeBarMaterial();
      const mesh = new THREE.Mesh(geom, mat);

      const x = (i - (size - 1) / 2) * (barWidth + barGap);
      mesh.position.set(x, 0.5, 0);
      mesh.scale.set(barWidth, 1, 1);
      lane.group.add(mesh);
      lane.bars.push(mesh);
    }
    applyValuesToLane(lane);
  }

  function applyValuesToLane(lane: Lane) {
    for (let i = 0; i < lane.values.length; i++) {
      const v = lane.values[i];
      const h = 1 + (v / size) * maxBarHeight;
      const bar = lane.bars[i];
      bar.scale.y = h;
      bar.position.y = h / 2;
      setBarColor(bar, COLORS.normal);
    }
  }

  lanes.forEach(buildLaneBars);

  // ── F1 Countdown Lights (in Three.js scene) ───────────
  const f1Group = new THREE.Group();
  f1Group.position.set(0, camCenterY, 5); // in front of bars, centered
  f1Group.visible = false;
  scene.add(f1Group);

  // Dark backing panel
  const panelW = 22;
  const panelH = 5;
  const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#111111") });
  const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), panelMat);
  panelMesh.position.z = -0.1;
  f1Group.add(panelMesh);

  // Border
  const borderMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#333333") });
  const borderMesh = new THREE.Mesh(new THREE.PlaneGeometry(panelW + 0.4, panelH + 0.4), borderMat);
  borderMesh.position.z = -0.2;
  f1Group.add(borderMesh);

  // 5 bulbs
  const bulbRadius = 1.2;
  const bulbSpacing = 3.8;
  const bulbOffColor = new THREE.Color("#1a0808");
  const bulbOnColor = new THREE.Color(2.0, 0.15, 0.05); // HDR red — glows through bloom
  const circleGeom = new THREE.CircleGeometry(bulbRadius, 32);

  const f1Bulbs: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: bulbOffColor.clone() });
    const mesh = new THREE.Mesh(circleGeom, mat);
    mesh.position.x = (i - 2) * bulbSpacing;
    f1Group.add(mesh);
    f1Bulbs.push(mesh);
  }

  function setBulb(index: number, on: boolean) {
    const mat = f1Bulbs[index].material as THREE.MeshBasicMaterial;
    mat.color.copy(on ? bulbOnColor : bulbOffColor);
    mat.needsUpdate = true;
  }

  /** Run the F1 countdown sequence inside the Three.js scene.
   *  Returns a promise that resolves when the race should start.
   *  `beepFn` is called for sound effects (ignored during offline export). */
  async function runF1Countdown(beepFn?: (freq: number, dur: number) => void) {
    // Reset bulbs
    for (let i = 0; i < 5; i++) setBulb(i, false);
    f1Group.visible = true;

    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Lights on one by one (1 second apart)
    for (let i = 0; i < 5; i++) {
      await wait(1000);
      setBulb(i, true);
      beepFn?.(440, 0.15);
    }

    // Pause with all 5 lit
    await wait(1000);

    // All lights out — GO!
    for (let i = 0; i < 5; i++) setBulb(i, false);
    beepFn?.(880, 0.3);

    // 300ms dramatic pause
    await wait(300);

    f1Group.visible = false;
  }

  // ── Resize — keep ortho frustum matching aspect ────────
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;

    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);

    const aspect = w / h;
    const halfW = frustumHalf * aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = frustumHalf;
    camera.bottom = -frustumHalf;
    camera.updateProjectionMatrix();
  }
  resize();

  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // ── Render loop (through bloom composer) ───────────────
  let raf = 0;
  function renderLoop() {
    raf = requestAnimationFrame(renderLoop);
    composer.render();
  }
  renderLoop();

  // ── Highlight helpers ──────────────────────────────────
  function clearHighlights(lane: Lane) {
    lane.bars.forEach((b) => setBarColor(b, COLORS.normal));
    lane.activePivot = -1;
  }

  // Track which bar indices are currently highlighted so we can clear them
  const activeHighlights = new Map<Lane, number[]>();

  function highlight(lane: Lane, idxs: number[], color: THREE.Color) {
    // Clear previous highlights immediately
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
    // Apply new highlights
    idxs.forEach((i) => {
      if (lane.bars[i]) setBarColor(lane.bars[i], color);
    });
    activeHighlights.set(lane, idxs);
  }

  // ── Apply a single op to a lane ────────────────────────
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
          const h = 1 + (v / size) * maxBarHeight;
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
        const h = 1 + (v / size) * maxBarHeight;
        const bar = lane.bars[op.i];
        bar.scale.y = h;
        bar.position.y = h / 2;
        highlight(lane, [op.i], COLORS.overwrite);
        if (!silent) soundOverwrite(op.value, size);
        break;
      }
      case "markPivot":
        // Clear any previous pivot first
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

  function sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  // Pause support
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

  // ── External control API ────────────────────────────────
  let runGeneration = 0;

  function reset(newValues: number[]) {
    runGeneration++;
    lanes.forEach((lane) => {
      lane.values = newValues.slice();
      applyValuesToLane(lane);
      lane.running = false;
      lane.opCount = 0;
      updateCounter(lane);
    });
  }

  function destroy() {
    runGeneration++;
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer.dispose();
    composer.dispose();
    container.removeChild(renderer.domElement);
  }

  return {
    lanes,
    reset,
    destroy,
    getCanvas: () => renderer.domElement,
    runCountdown: runF1Countdown,
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
     * Stops the render loop, steps through all ops deterministically,
     * renders each frame via the bloom composer, and yields control
     * to the caller so it can capture the canvas.
     *
     * Sound is NOT played — the caller generates audio offline.
     */
    exportFrames: async function* (
      allOps: [import("./algorithms").Op[], import("./algorithms").Op[], import("./algorithms").Op[]],
      framesPerOp: number
    ): AsyncGenerator<{ tick: number; frame: number }> {
      // Pause real-time render loop
      cancelAnimationFrame(raf);

      // Reset op counters / highlights
      lanes.forEach((lane) => {
        lane.opCount = 0;
        updateCounter(lane);
        clearHighlights(lane);
      });

      const maxLen = Math.max(...allOps.map((o) => o.length));
      let globalFrame = 0;

      for (let tick = 0; tick < maxLen; tick++) {
        // Apply one op per lane (silent — no Web Audio)
        for (let li = 0; li < 3; li++) {
          if (tick < allOps[li].length) {
            applyOpCore(lanes[li], allOps[li][tick], true);
          }
        }

        // Render `framesPerOp` identical frames for this tick
        for (let f = 0; f < framesPerOp; f++) {
          composer.render();
          yield { tick, frame: globalFrame++ };
        }
      }

      // Resume render loop
      renderLoop();
    },
  };
}
