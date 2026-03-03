/**
 * Reusable F1-style countdown lights for Three.js scenes.
 *
 * Creates a row of 5 bulb assemblies (housing + lens + glow disc +
 * point light) that can be toggled on/off individually and driven
 * through the classic F1 countdown sequence.
 *
 * Usage:
 *   const lights = createF1Lights(scene);
 *   await lights.runCountdown((freq, dur) => beep(freq, dur));
 *   lights.dispose();
 */
import * as THREE from "three";

// ── Configuration ────────────────────────────────────────

export interface F1LightsOptions {
  /** Number of bulbs (default 5). */
  count?: number;
  /** Horizontal spacing between bulb centres (default 4.2). */
  spacing?: number;
  /** Bulb lens radius (default 1.0). */
  bulbRadius?: number;
  /** Housing outer radius (default 1.25). */
  housingRadius?: number;
  /** Housing depth (default 1.2). */
  housingDepth?: number;
  /** World-space position of the light bar group. */
  position?: THREE.Vector3;
}

const DEFAULTS: Required<F1LightsOptions> = {
  count: 5,
  spacing: 4.2,
  bulbRadius: 1.0,
  housingRadius: 1.25,
  housingDepth: 1.2,
  position: new THREE.Vector3(0, 22, 5),
};

// ── Colour presets ───────────────────────────────────────

const LENS_ON = new THREE.Color(1.0, 0.08, 0.02);
const LENS_HDR = new THREE.Color(3.5, 0.3, 0.08);
const LENS_OFF = new THREE.Color(0.08, 0.02, 0.02);

// ── Types ────────────────────────────────────────────────

interface Bulb {
  lensMesh: THREE.Mesh;
  pointLight: THREE.PointLight;
  glowMesh: THREE.Mesh;
}

export interface F1Lights {
  /** The Three.js group — add it to your scene yourself if you prefer. */
  group: THREE.Group;
  /** Toggle a single bulb on or off. */
  setBulb: (index: number, on: boolean) => void;
  /** Run the full F1 countdown sequence (5 lights on, then all off). */
  runCountdown: (beepFn?: (freq: number, dur: number) => void) => Promise<void>;
  /** Clean up geometries and materials. */
  dispose: () => void;
}

// ── Factory ──────────────────────────────────────────────

export function createF1Lights(
  scene: THREE.Scene,
  options: F1LightsOptions = {}
): F1Lights {
  const cfg = { ...DEFAULTS, ...options };

  // Ambient light so MeshStandardMaterial housings are visible even when
  // bulbs are off.  (MeshBasicMaterial objects are unaffected.)
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);

  const group = new THREE.Group();
  group.position.copy(cfg.position);
  group.visible = false;
  scene.add(group);

  // ── Build bulb assemblies ──────────────────────────────
  const bulbs: Bulb[] = [];

  for (let i = 0; i < cfg.count; i++) {
    const x = (i - (cfg.count - 1) / 2) * cfg.spacing;
    const bulbGroup = new THREE.Group();
    bulbGroup.position.set(x, 0, 0);
    group.add(bulbGroup);

    // Housing (cup / bezel)
    const housingMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      metalness: 0.8,
      roughness: 0.25,
    });
    const housingGeom = new THREE.CylinderGeometry(
      cfg.housingRadius,
      cfg.housingRadius * 0.9,
      cfg.housingDepth,
      24
    );
    const housingMesh = new THREE.Mesh(housingGeom, housingMat);
    housingMesh.rotation.x = Math.PI / 2;
    housingMesh.position.z = -cfg.housingDepth / 2;
    bulbGroup.add(housingMesh);

    // Housing edge outline
    const housingEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(housingGeom, 30),
      new THREE.LineBasicMaterial({ color: 0x999999, linewidth: 1 })
    );
    housingEdges.rotation.copy(housingMesh.rotation);
    housingEdges.position.copy(housingMesh.position);
    bulbGroup.add(housingEdges);

    // Reflector ring
    const reflectorMat = new THREE.MeshStandardMaterial({
      color: 0xaaaaaa,
      metalness: 0.9,
      roughness: 0.1,
    });
    const reflectorMesh = new THREE.Mesh(
      new THREE.TorusGeometry(cfg.bulbRadius + 0.1, 0.08, 8, 24),
      reflectorMat
    );
    reflectorMesh.position.z = 0.02;
    bulbGroup.add(reflectorMesh);

    // Lens (hemisphere facing the viewer)
    const lensMat = new THREE.MeshStandardMaterial({
      color: LENS_OFF.clone(),
      emissive: LENS_OFF.clone(),
      emissiveIntensity: 0.3,
      roughness: 0.2,
      metalness: 0.0,
      transparent: true,
      opacity: 0.92,
    });
    const lensMesh = new THREE.Mesh(
      new THREE.SphereGeometry(
        cfg.bulbRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2
      ),
      lensMat
    );
    lensMesh.rotation.x = -Math.PI / 2;
    lensMesh.position.z = 0.05;
    bulbGroup.add(lensMesh);

    // Glow disc (bloom halo)
    const glowMat = new THREE.MeshBasicMaterial({
      color: LENS_OFF.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const glowMesh = new THREE.Mesh(
      new THREE.CircleGeometry(cfg.bulbRadius * 1.3, 32),
      glowMat
    );
    glowMesh.position.z = 0.15;
    bulbGroup.add(glowMesh);

    // Point light (illuminates housing when on)
    const ptLight = new THREE.PointLight(0xff1100, 0, 6, 2);
    ptLight.position.set(0, 0, 0.5);
    bulbGroup.add(ptLight);

    bulbs.push({ lensMesh, pointLight: ptLight, glowMesh });
  }

  // ── setBulb ────────────────────────────────────────────

  function setBulb(index: number, on: boolean) {
    const { lensMesh, pointLight, glowMesh } = bulbs[index];
    const lensMat = lensMesh.material as THREE.MeshStandardMaterial;
    const glowMat = glowMesh.material as THREE.MeshBasicMaterial;

    if (on) {
      lensMat.color.copy(LENS_ON);
      lensMat.emissive.copy(LENS_ON);
      lensMat.emissiveIntensity = 2.5;
      glowMat.color.copy(LENS_HDR);
      glowMat.opacity = 0.85;
      pointLight.intensity = 3.0;
    } else {
      lensMat.color.copy(LENS_OFF);
      lensMat.emissive.copy(LENS_OFF);
      lensMat.emissiveIntensity = 0.3;
      glowMat.color.copy(LENS_OFF);
      glowMat.opacity = 0;
      pointLight.intensity = 0;
    }
    lensMat.needsUpdate = true;
    glowMat.needsUpdate = true;
  }

  // ── runCountdown ───────────────────────────────────────

  async function runCountdown(
    beepFn?: (freq: number, dur: number) => void
  ): Promise<void> {
    for (let i = 0; i < cfg.count; i++) setBulb(i, false);
    group.visible = true;

    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    for (let i = 0; i < cfg.count; i++) {
      await wait(1000);
      setBulb(i, true);
      beepFn?.(440, 0.15);
    }

    await wait(1000);
    for (let i = 0; i < cfg.count; i++) setBulb(i, false);
    beepFn?.(880, 0.3);

    await wait(300);
    group.visible = false;
  }

  // ── dispose ────────────────────────────────────────────

  function dispose() {
    scene.remove(ambient);
    scene.remove(group);
    group.traverse((obj: THREE.Object3D) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          (obj.material as THREE.Material[]).forEach((m: THREE.Material) => m.dispose());
        } else {
          (obj.material as THREE.Material).dispose();
        }
      }
      if (obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }

  return { group, setBulb, runCountdown, dispose };
}
