/**
 * Three.js scene bootstrapping — renderer, camera, post-processing.
 *
 * Encapsulates the boilerplate so that visualisation modules can focus
 * on domain logic rather than WebGL plumbing.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import {
  SCENE_BG,
  FRUSTUM_HALF,
  CAM_CENTER_Y,
  BLOOM_STRENGTH,
  BLOOM_RADIUS,
  BLOOM_THRESHOLD,
} from "./constants";

export interface SceneContext {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.OrthographicCamera;
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  /** Resize renderer + camera to fill the container. */
  resize: () => void;
}

/**
 * Create a scene with an orthographic camera, bloom post-processing,
 * and ACES filmic tone mapping.  The renderer's canvas is appended to
 * `container` automatically.
 */
export function createScene(container: HTMLDivElement): SceneContext {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_BG);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, CAM_CENTER_Y, 50);
  camera.lookAt(0, CAM_CENTER_Y, 0);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(
      container.clientWidth || 800,
      container.clientHeight || 600
    ),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;

    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);

    const aspect = w / h;
    const halfW = FRUSTUM_HALF * aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = FRUSTUM_HALF;
    camera.bottom = -FRUSTUM_HALF;
    camera.updateProjectionMatrix();
  }

  return { scene, renderer, camera, composer, bloomPass, resize };
}
