/**
 * Lane construction and visual helpers for the sorting visualisation.
 *
 * Each "lane" is a vertical column of bars representing an array being
 * sorted by one algorithm.  This module handles building, colouring,
 * and labelling those bars.
 */
import * as THREE from "three";
import { COLORS, LANE_GAP, BAR_WIDTH, BAR_GAP, MAX_BAR_HEIGHT } from "./constants";

// ── Types ────────────────────────────────────────────────

export type LaneName = "Bubble Sort" | "Merge Sort" | "Quick Sort";

export interface Lane {
  name: LaneName;
  group: THREE.Group;
  bars: THREE.Mesh[];
  values: number[];
  baseDelayMs: number;
  highlightTimeout?: number;
  running: boolean;
  opCount: number;
  /** Index of the currently highlighted pivot bar (-1 when none). */
  activePivot: number;
  counterCanvas?: HTMLCanvasElement;
  counterTexture?: THREE.CanvasTexture;
  counterMesh?: THREE.Mesh;
}

// ── Material helpers ─────────────────────────────────────

export function makeBarMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: COLORS.normal.clone() });
}

export function setBarColor(bar: THREE.Mesh, c: THREE.Color): void {
  const mat = bar.material as THREE.MeshBasicMaterial;
  mat.color.copy(c);
  mat.needsUpdate = true;
}

// ── Nameplate / counter canvas textures ──────────────────

function makeNameplate(text: string): THREE.Mesh {
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

function drawCounter(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  count: number
): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "bold 50px ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
  ctx.fillStyle = "#6688aa";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `Ops: ${count.toLocaleString()}`,
    canvas.width / 2,
    canvas.height / 2
  );
}

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

export function updateCounter(lane: Lane): void {
  if (!lane.counterCanvas || !lane.counterTexture) return;
  const ctx = lane.counterCanvas.getContext("2d")!;
  drawCounter(ctx, lane.counterCanvas, lane.opCount);
  lane.counterTexture.needsUpdate = true;
}

// ── Lane construction ────────────────────────────────────

function makeLane(name: LaneName, values: number[]): Lane {
  return {
    name,
    group: new THREE.Group(),
    bars: [],
    values: values.slice(),
    baseDelayMs: 10,
    running: false,
    opCount: 0,
    activePivot: -1,
  };
}

/** Apply the current `lane.values` to bar heights and reset colours. */
export function applyValuesToLane(lane: Lane, size: number): void {
  for (let i = 0; i < lane.values.length; i++) {
    const v = lane.values[i];
    const h = 1 + (v / size) * MAX_BAR_HEIGHT;
    const bar = lane.bars[i];
    bar.scale.y = h;
    bar.position.y = h / 2;
    setBarColor(bar, COLORS.normal);
  }
}

/** (Re-)build the bar meshes for a lane. */
export function buildLaneBars(lane: Lane, size: number): void {
  lane.bars.forEach((b) => lane.group.remove(b));
  lane.bars = [];

  const geom = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < size; i++) {
    const mat = makeBarMaterial();
    const mesh = new THREE.Mesh(geom, mat);
    const x = (i - (size - 1) / 2) * (BAR_WIDTH + BAR_GAP);
    mesh.position.set(x, 0.5, 0);
    mesh.scale.set(BAR_WIDTH, 1, 1);
    lane.group.add(mesh);
    lane.bars.push(mesh);
  }
  applyValuesToLane(lane, size);
}

/**
 * Create three sorting lanes, position them in the scene, and attach
 * labels + counters.  Returns the lane array.
 */
export function createLanes(
  scene: THREE.Scene,
  initial: number[],
  size: number
): Lane[] {
  const lanes: Lane[] = [
    makeLane("Bubble Sort", initial),
    makeLane("Merge Sort", initial),
    makeLane("Quick Sort", initial),
  ];

  lanes[0].group.position.x = -LANE_GAP;
  lanes[1].group.position.x = 0;
  lanes[2].group.position.x = LANE_GAP;

  for (const lane of lanes) {
    scene.add(lane.group);

    // Nameplate
    lane.group.add(makeNameplate(lane.name));

    // Op counter
    const { canvas, tex, mesh } = makeCounterLabel();
    lane.counterCanvas = canvas;
    lane.counterTexture = tex;
    lane.counterMesh = mesh;
    lane.group.add(mesh);

    // Bars
    buildLaneBars(lane, size);
  }

  return lanes;
}
