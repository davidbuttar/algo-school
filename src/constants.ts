/**
 * Shared visual constants used across the 3D sorting visualisation.
 *
 * Keeping magic numbers in one place makes it easy to tweak the look
 * of the entire app without hunting through multiple files.
 */
import * as THREE from "three";

// ── Scene ────────────────────────────────────────────────
export const SCENE_BG = "#05060c";
export const FRUSTUM_HALF = 20;
export const CAM_CENTER_Y = 5.75;

// ── Bloom post-processing ────────────────────────────────
export const BLOOM_STRENGTH = 0.4;
export const BLOOM_RADIUS = 0.25;
export const BLOOM_THRESHOLD = 0.75;

// ── Lane layout ──────────────────────────────────────────
export const LANE_GAP = 20;
export const BAR_WIDTH = 0.28;
export const BAR_GAP = 0.06;
export const MAX_BAR_HEIGHT = 10;

// ── Neon colour palette ──────────────────────────────────
// Normal bars sit below the bloom threshold for a clean look;
// active highlights push above it for a subtle selective glow.
export const COLORS = {
  normal: new THREE.Color("#3388ff"),
  compare: new THREE.Color(1.2, 0.95, 0.0),
  swap: new THREE.Color(1.2, 0.1, 0.2),
  overwrite: new THREE.Color(0.0, 1.1, 0.35),
  pivot: new THREE.Color(0.9, 0.15, 1.2),
  done: new THREE.Color("#22cc66"),
} as const;
