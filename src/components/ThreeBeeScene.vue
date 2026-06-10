<template>
  <div ref="mount" class="bee-world" :class="{ 'is-dragging': dragging }" aria-label="Gaussian splat spelling bee scene">
    <div v-if="splatLoading" class="splat-loading">Loading Gaussian splat scene…</div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferGeometry,
  Clock,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LinearFilter,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer
} from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

import beeRightUrl from '../assets/spelling/bee_right.png';
import beeLeftUrl from '../assets/spelling/bee_left.png';
import butterflyGoldUrl from '../assets/spelling/butterfly_gold.png';
import butterflyTealUrl from '../assets/spelling/butterfly_teal.png';
import butterflyYellowUrl from '../assets/spelling/butterfly_yellow.png';

const props = defineProps({
  slowDriftEnabled: {
    type: Boolean,
    default: true
  },
  splatEnabled: {
    type: Boolean,
    default: true
  }
});

const BUILD_STAMP = '20260610-071500';
const SPLAT_URL = `/splats/gaussians.ply?v=${BUILD_STAMP}`;
const SKYBOX_URL = `/skyboxes/final-sky.jpg?v=${BUILD_STAMP}`;
const GROUND_UNDERLAY_URL = `/underlays/gaussian-hole-cover.png?v=${BUILD_STAMP}`;

const mount = ref(null);
const dragging = ref(false);
const splatLoading = ref(false);

let renderer;
let sparkRenderer;
let scene;
let camera;
let resizeObserver;
let frameHandle;
let disposed = false;
let viewWidth = 1;
let viewHeight = 1;
let skybox;
let overlayRoot;
let splatRoot;
let splatMesh;
let particleSystem;
let groundUnderlay;
let pointerDown = false;
let pointerId = null;
let pointerStartX = 0;
let pointerStartY = 0;
let manualYawOffset = 0;
let manualPitchOffset = 0;
let yawStart = 0;
let pitchStart = 0;
let targetFov = 58;
let fov = 58;
let lastActivity = 0;

const fixedYaw = 0;
const fixedPitch = -0.012;
const CAMERA_HOME = new Vector3(0.0, 0.04, 1.86);
const CAMERA_SIDE = new Vector3(1.0, 0.0, 0.0);
const SCENE_LOOP_SECONDS = 54;
const UNDERLAY_CENTER_Z = 3.35;
const UNDERLAY_FLOOR_Y = -0.7;
const GAUSSIAN_CAMERA_TRAJECTORY = [
  { t: 0, position: [0.0, 0.04, 1.86], yaw: 0.0, pitch: -0.012, fovOffset: 0 },
  { t: 0.18, position: [-0.14, 0.055, 2.24], yaw: 0.034, pitch: -0.018, fovOffset: -0.4 },
  { t: 0.4, position: [0.11, 0.028, 2.92], yaw: -0.026, pitch: -0.007, fovOffset: 0.2 },
  { t: 0.63, position: [0.18, 0.036, 3.48], yaw: -0.05, pitch: 0.002, fovOffset: 0.8 },
  { t: 0.82, position: [-0.08, 0.054, 2.48], yaw: 0.02, pitch: -0.016, fovOffset: -0.2 },
  { t: 1, position: [0.0, 0.04, 1.86], yaw: 0.0, pitch: -0.012, fovOffset: 0 }
];
const clock = new Clock();
const loader = new TextureLoader();
const cleanup = [];
const uniforms = [];
const flyingActors = [];
const cameraPathPosition = new Vector3();
const cameraPathTargetPosition = new Vector3();
let cameraPathYaw = fixedYaw;
let cameraPathPitch = fixedPitch;
let cameraPathFovOffset = 0;

function registerDisposable(item) {
  cleanup.push(() => item?.dispose?.());
  return item;
}

function registerTexture(texture) {
  cleanup.push(() => texture?.dispose?.());
  return texture;
}

function disposeTree(object) {
  object?.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose?.());
    }
  });
}

function createSkybox() {
  const geometry = registerDisposable(new SphereGeometry(220, 128, 64));
  const material = registerDisposable(new MeshBasicMaterial({
    color: '#ffffff',
    side: BackSide,
    depthWrite: false,
    depthTest: false
  }));
  skybox = new Mesh(geometry, material);
  skybox.name = 'spelling-bee-pattern-skybox';
  skybox.renderOrder = -100;
  scene.add(skybox);

  const texture = registerTexture(loader.load(SKYBOX_URL, (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 4, 8);
    loaded.minFilter = LinearFilter;
    loaded.magFilter = LinearFilter;
    loaded.needsUpdate = true;
    material.map = loaded;
    material.needsUpdate = true;
  }));
  texture.colorSpace = SRGBColorSpace;
}

function createParticleMaterial() {
  const matUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uOpacity: { value: 1 }
  };
  uniforms.push(matUniforms);

  const material = new ShaderMaterial({
    uniforms: matUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    vertexColors: true,
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      attribute float aDrift;
      varying vec3 vColor;
      varying float vAlpha;
      uniform float uTime;
      uniform float uPixelRatio;

      void main() {
        vColor = color;
        vec3 p = position;
        float wave = sin(uTime * (0.22 + aDrift * 0.16) + aPhase);
        float curl = cos(uTime * (0.18 + aDrift * 0.13) + aPhase * 1.7);
        p.x += wave * 0.12 * aDrift;
        p.y += curl * 0.08 * aDrift;
        p.z += sin(uTime * 0.14 + aPhase * 0.71) * 0.14 * aDrift;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float depthScale = clamp(10.0 / max(0.8, -mvPosition.z), 0.38, 2.8);
        gl_PointSize = aSize * depthScale * uPixelRatio;
        vAlpha = clamp(depthScale * 0.52, 0.18, 0.9);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vColor;
      varying float vAlpha;
      uniform float uTime;
      uniform float uOpacity;

      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p);
        float core = smoothstep(0.46, 0.0, d);
        float halo = smoothstep(0.50, 0.08, d) * 0.55;
        float flicker = 0.78 + 0.22 * sin(uTime * 1.35 + vColor.r * 7.0 + vColor.g * 3.0);
        float alpha = (core + halo) * vAlpha * flicker * uOpacity;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  });
  cleanup.push(() => material.dispose());
  return material;
}

function createParticlePoints() {
  const positions = [];
  const colors = [];
  const sizes = [];
  const phases = [];
  const drifts = [];

  const addPoint = ({ x, y, z, color, size, drift }) => {
    positions.push(x, y, z);
    colors.push(color[0], color[1], color[2]);
    sizes.push(size);
    phases.push(Math.random() * Math.PI * 2);
    drifts.push(drift);
  };

  for (let i = 0; i < 340; i += 1) {
    addPoint({
      x: MathUtils.randFloatSpread(5.4),
      y: MathUtils.randFloat(-1.0, 1.45),
      z: MathUtils.randFloat(0.2, 3.3),
      color: [1.0, MathUtils.randFloat(0.78, 0.96), MathUtils.randFloat(0.22, 0.58)],
      size: MathUtils.randFloat(1.6, 4.2),
      drift: MathUtils.randFloat(0.35, 1.25)
    });
  }

  for (let i = 0; i < 18; i += 1) {
    addPoint({
      x: MathUtils.randFloatSpread(4.2),
      y: MathUtils.randFloat(-0.4, 1.15),
      z: MathUtils.randFloat(0.05, 2.55),
      color: [MathUtils.randFloat(0.45, 0.72), MathUtils.randFloat(0.9, 1.0), 1.0],
      size: MathUtils.randFloat(5.5, 10.5),
      drift: MathUtils.randFloat(0.7, 1.5)
    });
  }

  const geometry = registerDisposable(new BufferGeometry());
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aDrift', new Float32BufferAttribute(drifts, 1));

  particleSystem = new Points(geometry, createParticleMaterial());
  particleSystem.name = 'foreground-pollen-and-wisps';
  particleSystem.renderOrder = 20;
  scene.add(particleSystem);
}


function createSealedUnderlayGeometry({ width = 4.9, depth = 3.2, floorSegmentsX = 32, floorSegmentsZ = 26 } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const rimLift = 0.42;
  const wallTop = 0.78;
  const wallLean = 0.26;

  const pushVertex = (x, y, z, u, v) => {
    positions.push(x, y, z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  for (let zIndex = 0; zIndex <= floorSegmentsZ; zIndex += 1) {
    const vz = zIndex / floorSegmentsZ;
    const nz = vz * 2 - 1;

    for (let xIndex = 0; xIndex <= floorSegmentsX; xIndex += 1) {
      const ux = xIndex / floorSegmentsX;
      const nx = ux * 2 - 1;
      const edge = Math.max(Math.abs(nx), Math.abs(nz));
      const lift = Math.pow(MathUtils.smoothstep(edge, 0.58, 1), 1.85) * rimLift;
      pushVertex(nx * halfWidth, lift, nz * halfDepth, ux, vz);
    }
  }

  for (let zIndex = 0; zIndex < floorSegmentsZ; zIndex += 1) {
    for (let xIndex = 0; xIndex < floorSegmentsX; xIndex += 1) {
      const row = floorSegmentsX + 1;
      const a = zIndex * row + xIndex;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const addWallStrip = ({ side, segments }) => {
    const start = positions.length / 3;

    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const n = t * 2 - 1;
      const curvedTop = wallTop - Math.sin(t * Math.PI) * 0.08;

      if (side === 'left' || side === 'right') {
        const sign = side === 'left' ? -1 : 1;
        const z = n * halfDepth;
        pushVertex(sign * halfWidth, rimLift, z, t, 0);
        pushVertex(sign * (halfWidth - wallLean), curvedTop, z, t, 1);
      } else {
        const sign = side === 'front' ? -1 : 1;
        const x = n * halfWidth;
        pushVertex(x, rimLift, sign * halfDepth, t, 0);
        pushVertex(x, curvedTop, sign * (halfDepth - wallLean), t, 1);
      }
    }

    for (let index = 0; index < segments; index += 1) {
      const a = start + index * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  };

  addWallStrip({ side: 'left', segments: floorSegmentsZ });
  addWallStrip({ side: 'right', segments: floorSegmentsZ });
  addWallStrip({ side: 'front', segments: floorSegmentsX });
  addWallStrip({ side: 'back', segments: floorSegmentsX });

  const geometry = registerDisposable(new BufferGeometry());
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createGroundUnderlay() {
  const geometry = createSealedUnderlayGeometry();
  const material = registerDisposable(new MeshBasicMaterial({
    color: '#ffffff',
    side: DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true
  }));

  groundUnderlay = new Mesh(geometry, material);
  groundUnderlay.name = 'gaussian-surface-sealed-underlay';
  groundUnderlay.position.set(0, UNDERLAY_FLOOR_Y, UNDERLAY_CENTER_Z);
  groundUnderlay.renderOrder = -12;
  scene.add(groundUnderlay);

  const texture = registerTexture(loader.load(GROUND_UNDERLAY_URL, (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 4, 8);
    loaded.minFilter = LinearFilter;
    loaded.magFilter = LinearFilter;
    loaded.wrapS = RepeatWrapping;
    loaded.wrapT = RepeatWrapping;
    loaded.repeat.set(1.0, 1.0);
    loaded.needsUpdate = true;
    material.map = loaded;
    material.needsUpdate = true;
  }));
  texture.colorSpace = SRGBColorSpace;
}

function createFlyingSpriteActor({
  textureUrl,
  position,
  scale,
  center = [0.5, 0.5],
  bob = 0.04,
  sway = 0.08,
  depth = 0.06,
  speed = 0.3,
  flutter = 0.1,
  opacity = 1,
  rotation = 0,
  phase = Math.random() * Math.PI * 2,
  loops = 1,
  renderOrder = 40,
  depthTest = false
}) {
  const material = registerDisposable(new SpriteMaterial({
    color: '#ffffff',
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest,
    alphaTest: 0.02
  }));

  const texture = registerTexture(loader.load(textureUrl, (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 4, 8);
    loaded.minFilter = LinearFilter;
    loaded.magFilter = LinearFilter;
    loaded.needsUpdate = true;
    material.map = loaded;
    material.needsUpdate = true;
  }));
  texture.colorSpace = SRGBColorSpace;

  const sprite = new Sprite(material);
  sprite.center.set(center[0], center[1]);
  sprite.position.set(position[0], position[1], position[2]);
  sprite.scale.set(scale[0], scale[1], 1);
  sprite.material.rotation = rotation;
  sprite.renderOrder = renderOrder;
  overlayRoot.add(sprite);

  flyingActors.push({
    sprite,
    basePosition: sprite.position.clone(),
    baseScale: { x: scale[0], y: scale[1] },
    bob,
    sway,
    depth,
    speed,
    flutter,
    phase,
    opacity,
    rotation,
    loops
  });
}

function createFlyingActors() {
  overlayRoot = new Group();
  overlayRoot.name = 'splat-overlays';
  scene.add(overlayRoot);


  const bees = [
    { textureUrl: beeRightUrl, position: [-2.06, -0.23, 2.08], scale: [0.105, 0.114], center: [0.5, 0.42], bob: 0.026, sway: 0.105, depth: 0.045, speed: 0.31, flutter: 0.075, phase: 0.35, loops: 1, renderOrder: 46 },
    { textureUrl: beeLeftUrl, position: [-1.42, -0.12, 2.42], scale: [0.098, 0.108], center: [0.5, 0.42], bob: 0.022, sway: 0.082, depth: 0.038, speed: 0.28, flutter: 0.07, phase: 1.65, loops: 1, renderOrder: 46 },
    { textureUrl: beeRightUrl, position: [-0.36, -0.3, 2.96], scale: [0.092, 0.102], center: [0.5, 0.42], bob: 0.024, sway: 0.075, depth: 0.036, speed: 0.27, flutter: 0.07, phase: 3.15, loops: 1, renderOrder: 46 },
    { textureUrl: beeLeftUrl, position: [1.34, -0.26, 3.74], scale: [0.102, 0.112], center: [0.5, 0.42], bob: 0.025, sway: 0.088, depth: 0.04, speed: 0.29, flutter: 0.072, phase: 4.35, loops: 1, renderOrder: 46 },
    { textureUrl: beeRightUrl, position: [2.04, -0.12, 4.28], scale: [0.095, 0.104], center: [0.5, 0.42], bob: 0.021, sway: 0.07, depth: 0.034, speed: 0.26, flutter: 0.065, phase: 5.15, loops: 1, renderOrder: 46 }
  ];

  const butterflies = [
    { textureUrl: butterflyTealUrl, position: [-1.42, 0.02, 2.2], scale: [0.15, 0.085], center: [0.5, 0.44], bob: 0.036, sway: 0.056, depth: 0.028, speed: 0.18, flutter: 0.15, rotation: -0.08, phase: 2.2, loops: 1, renderOrder: 42 },
    { textureUrl: butterflyGoldUrl, position: [0.18, 0.08, 2.58], scale: [0.132, 0.091], center: [0.5, 0.45], bob: 0.032, sway: 0.052, depth: 0.03, speed: 0.17, flutter: 0.13, rotation: 0.04, phase: 0.95, loops: 1, renderOrder: 42 },
    { textureUrl: butterflyYellowUrl, position: [1.24, 0.02, 3.2], scale: [0.118, 0.112], center: [0.5, 0.45], bob: 0.028, sway: 0.046, depth: 0.025, speed: 0.16, flutter: 0.135, rotation: 0.07, phase: 5.1, loops: 1, renderOrder: 42 }
  ];

  const surfaceButterflies = [
    { textureUrl: butterflyGoldUrl, position: [-2.2, -0.34, 1.92], scale: [0.071, 0.049], rotation: -0.14, phase: 0.1 },
    { textureUrl: butterflyTealUrl, position: [-1.92, -0.27, 2.28], scale: [0.076, 0.043], rotation: 0.09, phase: 0.72 },
    { textureUrl: butterflyYellowUrl, position: [-1.54, -0.18, 2.04], scale: [0.068, 0.064], rotation: -0.05, phase: 1.15 },
    { textureUrl: butterflyGoldUrl, position: [-1.12, -0.32, 2.68], scale: [0.061, 0.042], rotation: 0.1, phase: 1.72 },
    { textureUrl: butterflyTealUrl, position: [-0.78, -0.2, 2.38], scale: [0.069, 0.039], rotation: -0.12, phase: 2.05 },
    { textureUrl: butterflyYellowUrl, position: [-0.44, -0.36, 2.96], scale: [0.058, 0.055], rotation: 0.12, phase: 2.44 },
    { textureUrl: butterflyGoldUrl, position: [-0.08, -0.18, 2.76], scale: [0.066, 0.045], rotation: -0.06, phase: 2.95 },
    { textureUrl: butterflyTealUrl, position: [0.34, -0.28, 3.18], scale: [0.071, 0.04], rotation: 0.08, phase: 3.3 },
    { textureUrl: butterflyYellowUrl, position: [0.72, -0.14, 3.02], scale: [0.062, 0.059], rotation: -0.1, phase: 3.76 },
    { textureUrl: butterflyGoldUrl, position: [1.08, -0.32, 3.58], scale: [0.074, 0.051], rotation: 0.04, phase: 4.1 },
    { textureUrl: butterflyTealUrl, position: [1.42, -0.2, 3.84], scale: [0.068, 0.039], rotation: -0.07, phase: 4.45 },
    { textureUrl: butterflyYellowUrl, position: [1.82, -0.3, 4.1], scale: [0.064, 0.061], rotation: 0.13, phase: 4.9 },
    { textureUrl: butterflyGoldUrl, position: [2.18, -0.18, 4.54], scale: [0.059, 0.041], rotation: -0.04, phase: 5.36 },
    { textureUrl: butterflyTealUrl, position: [1.68, 0.02, 4.68], scale: [0.073, 0.041], rotation: 0.06, phase: 5.82 },
    { textureUrl: butterflyYellowUrl, position: [0.98, 0.04, 4.42], scale: [0.056, 0.053], rotation: -0.13, phase: 6.14 }
  ].map((actor) => ({
    center: [0.5, 0.45],
    bob: 0.018,
    sway: 0.028,
    depth: 0.015,
    speed: 0.12,
    flutter: 0.105,
    opacity: 0.86,
    loops: 1,
    renderOrder: 41,
    ...actor
  }));

  [...bees, ...butterflies, ...surfaceButterflies].forEach(createFlyingSpriteActor);
}

function updateFlyingActors(loopTime) {
  if (!flyingActors.length) return;

  const loopProgress = loopTime / SCENE_LOOP_SECONDS;

  flyingActors.forEach((actor) => {
    const t = loopProgress * Math.PI * 2 * actor.loops + actor.phase;
    const driftX = Math.sin(t) * actor.sway + Math.sin(t * 2) * actor.sway * actor.speed;
    const driftY = Math.sin(t * 2) * actor.bob + Math.cos(t) * actor.bob * 0.35;
    const driftZ = Math.cos(t) * actor.depth;
    const flutter = 1 + Math.sin(t * 9.0) * actor.flutter;
    const squeeze = 1 + Math.cos(t * 7.0) * actor.flutter * 0.22;

    actor.sprite.position.set(
      actor.basePosition.x + driftX,
      actor.basePosition.y + driftY,
      actor.basePosition.z + driftZ
    );
    actor.sprite.scale.set(actor.baseScale.x * flutter, actor.baseScale.y * squeeze, 1);
    actor.sprite.material.opacity = actor.opacity * (0.9 + Math.sin(t * 2) * 0.08);
  });
}

function createSplatScene() {
  splatLoading.value = true;
  splatRoot = new Group();
  splatRoot.name = 'gaussian-splat-root-at-origin';
  splatRoot.position.set(0, 0, 0);
  splatRoot.scale.setScalar(3.85);
  splatRoot.rotation.set(0, 0, Math.PI);
  scene.add(splatRoot);

  splatMesh = new SplatMesh({
    url: SPLAT_URL,
    lod: true,
    enableLod: true,
    lodScale: 1.25,
    maxSplats: 160000,
    onLoad: () => {
      if (disposed) return;
      splatLoading.value = false;
    },
    onProgress: () => null
  });
  splatMesh.position.set(0, 0, 0);
  splatMesh.quaternion.set(0, 0, 0, 1);
  splatRoot.add(splatMesh);
  cleanup.push(() => splatMesh?.dispose?.());
}

function createScene() {
  scene = new Scene();
  scene.background = new Color('#fff0c8');

  camera = new PerspectiveCamera(fov, 1, 0.015, 220);
  camera.position.copy(CAMERA_HOME);

  scene.add(new HemisphereLight('#fff6dd', '#7d6135', 1.1));
  scene.add(new AmbientLight('#fff0d2', 0.92));

  createSkybox();
  createParticlePoints();
  createGroundUnderlay();
  createSplatScene();
  createFlyingActors();

  sparkRenderer = new SparkRenderer({
    renderer,
    clock,
    maxPixelRadius: 260,
    minPixelRadius: 0.15,
    minAlpha: 0.5 / 255,
    onDirty: () => null
  });
  scene.add(sparkRenderer);
  updateSplatVisibility();
}

function updateSplatVisibility() {
  if (splatRoot) splatRoot.visible = props.splatEnabled;
  if (overlayRoot) overlayRoot.visible = props.splatEnabled;
  splatLoading.value = Boolean(props.splatEnabled && splatMesh && !splatMesh.isInitialized);
}

function updateResponsive() {
  if (!mount.value || !renderer || !camera) return;
  const rect = mount.value.getBoundingClientRect();
  viewWidth = Math.max(320, rect.width || window.innerWidth);
  viewHeight = Math.max(320, rect.height || window.innerHeight);
  const aspect = viewWidth / Math.max(viewHeight, 1);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, aspect < 0.7 ? 1.3 : 1.55));
  renderer.setSize(viewWidth, viewHeight, false);
  camera.aspect = aspect;
  targetFov = aspect < 0.72 ? 66 : aspect > 1.9 ? 54 : 58;
  camera.fov = targetFov;
  camera.updateProjectionMatrix();

  uniforms.forEach((u) => {
    if (u.uPixelRatio) u.uPixelRatio.value = renderer.getPixelRatio();
  });
}

function sampleGaussianCameraTrajectory(progress) {
  const normalizedProgress = ((progress % 1) + 1) % 1;

  for (let index = 0; index < GAUSSIAN_CAMERA_TRAJECTORY.length - 1; index += 1) {
    const current = GAUSSIAN_CAMERA_TRAJECTORY[index];
    const next = GAUSSIAN_CAMERA_TRAJECTORY[index + 1];

    if (normalizedProgress >= current.t && normalizedProgress <= next.t) {
      const span = Math.max(next.t - current.t, 0.0001);
      const localProgress = MathUtils.smoothstep((normalizedProgress - current.t) / span, 0, 1);

      cameraPathPosition.set(current.position[0], current.position[1], current.position[2]);
      cameraPathTargetPosition.set(next.position[0], next.position[1], next.position[2]);
      cameraPathPosition.lerp(cameraPathTargetPosition, localProgress);
      cameraPathYaw = MathUtils.lerp(current.yaw, next.yaw, localProgress);
      cameraPathPitch = MathUtils.lerp(current.pitch, next.pitch, localProgress);
      cameraPathFovOffset = MathUtils.lerp(current.fovOffset, next.fovOffset, localProgress);
      return;
    }
  }

  const first = GAUSSIAN_CAMERA_TRAJECTORY[0];
  cameraPathPosition.set(first.position[0], first.position[1], first.position[2]);
  cameraPathYaw = first.yaw;
  cameraPathPitch = first.pitch;
  cameraPathFovOffset = first.fovOffset;
}

function fixedViewDirection(baseYaw = fixedYaw, basePitch = fixedPitch) {
  const yaw = baseYaw + manualYawOffset;
  const pitch = MathUtils.clamp(basePitch + manualPitchOffset, -0.38, 0.25);
  return new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch)
  ).normalize();
}

function updateCamera(delta, elapsed) {
  const loopTime = elapsed % SCENE_LOOP_SECONDS;
  const loopProgress = props.slowDriftEnabled ? loopTime / SCENE_LOOP_SECONDS : 0;
  sampleGaussianCameraTrajectory(loopProgress);

  fov = MathUtils.lerp(fov, targetFov + cameraPathFovOffset, 0.07);
  camera.fov = fov;
  camera.updateProjectionMatrix();

  const sideSway = props.slowDriftEnabled ? Math.sin(loopProgress * Math.PI * 2) * 0.01 : 0;
  const verticalBreath = props.slowDriftEnabled ? Math.sin(loopProgress * Math.PI * 4) * 0.004 : 0;

  camera.position.copy(cameraPathPosition)
    .addScaledVector(CAMERA_SIDE, sideSway);
  camera.position.y += verticalBreath;
  const direction = fixedViewDirection(cameraPathYaw, cameraPathPitch);
  camera.lookAt(camera.position.clone().add(direction));

  if (skybox) skybox.position.copy(camera.position);

  if (particleSystem) {
    particleSystem.position.x = camera.position.x * 0.45;
    particleSystem.position.y = camera.position.y * 0.28;
    particleSystem.position.z = camera.position.z * 0.62;
    particleSystem.rotation.y = Math.sin(loopProgress * Math.PI * 2) * 0.018;
  }

  if (groundUnderlay) {
    groundUnderlay.position.x = 0;
    groundUnderlay.position.y = UNDERLAY_FLOOR_Y;
    groundUnderlay.position.z = UNDERLAY_CENTER_Z;
  }

  updateFlyingActors(loopTime);
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  uniforms.forEach((u) => {
    if (u.uTime) u.uTime.value = elapsed;
  });

  updateCamera(delta, elapsed);
  renderer.render(scene, camera);
  frameHandle = window.requestAnimationFrame(animate);
}

function handlePointerDown(event) {
  if (!mount.value) return;
  pointerDown = true;
  dragging.value = true;
  pointerId = event.pointerId;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  yawStart = manualYawOffset;
  pitchStart = manualPitchOffset;
  lastActivity = clock.elapsedTime;
  mount.value.setPointerCapture?.(event.pointerId);
}

function handlePointerMove(event) {
  if (!pointerDown || event.pointerId !== pointerId) return;
  const dx = event.clientX - pointerStartX;
  const dy = event.clientY - pointerStartY;
  manualYawOffset = MathUtils.clamp(yawStart - dx * 0.0012, -0.18, 0.18);
  manualPitchOffset = MathUtils.clamp(pitchStart + dy * 0.0011, -0.16, 0.16);
}

function endPointer(event) {
  if (event?.pointerId && event.pointerId !== pointerId) return;
  pointerDown = false;
  dragging.value = false;
  pointerId = null;
}

function handleWheel(event) {
  event.preventDefault();
  targetFov = MathUtils.clamp(targetFov + Math.sign(event.deltaY) * 2.0, 46, 72);
  lastActivity = clock.elapsedTime;
}

function handleActivity() {
  lastActivity = clock.elapsedTime;
}

watch(() => props.splatEnabled, updateSplatVisibility);

onMounted(() => {
  disposed = false;
  renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0xfff0c8, 1);
  mount.value.appendChild(renderer.domElement);

  createScene();
  updateResponsive();

  resizeObserver = new ResizeObserver(updateResponsive);
  resizeObserver.observe(mount.value);
  window.addEventListener('resize', updateResponsive);
  mount.value.addEventListener('pointerdown', handlePointerDown);
  mount.value.addEventListener('pointermove', handlePointerMove);
  mount.value.addEventListener('pointerup', endPointer);
  mount.value.addEventListener('pointercancel', endPointer);
  mount.value.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('bee-meter-activity', handleActivity);
  frameHandle = window.requestAnimationFrame(animate);
});

onBeforeUnmount(() => {
  disposed = true;
  if (frameHandle) window.cancelAnimationFrame(frameHandle);
  resizeObserver?.disconnect();
  window.removeEventListener('resize', updateResponsive);
  if (mount.value) {
    mount.value.removeEventListener('pointerdown', handlePointerDown);
    mount.value.removeEventListener('pointermove', handlePointerMove);
    mount.value.removeEventListener('pointerup', endPointer);
    mount.value.removeEventListener('pointercancel', endPointer);
    mount.value.removeEventListener('wheel', handleWheel);
  }
  window.removeEventListener('bee-meter-activity', handleActivity);
  flyingActors.length = 0;
  cleanup.splice(0).forEach((fn) => fn());
  disposeTree(scene);
  sparkRenderer?.dispose?.();
  renderer?.dispose();
});
</script>
