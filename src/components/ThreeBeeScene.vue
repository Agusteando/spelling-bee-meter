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
import butterflyMaskUrl from '../assets/spelling/butterfly_cropped_mask.png';

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

const BUILD_STAMP = '20260610-111500';
const SPLAT_URL = `/splats/gaussians.ply?v=${BUILD_STAMP}`;
const SKYBOX_URL = `/skyboxes/final-sky.png?v=${BUILD_STAMP}`;
const GROUND_UNDERLAY_URL = `/underlays/gaussian-hole-cover.png?v=${BUILD_STAMP}`;
const SKYBOX_REPEAT_X = 4.05;
const SKYBOX_REPEAT_Y = 3.0;

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
const CAMERA_HOME = new Vector3(0.0, 0.04, 1.76);
const CAMERA_SIDE = new Vector3(1.0, 0.0, 0.0);
const SCENE_LOOP_SECONDS = 78;
const UNDERLAY_CENTER_Z = 3.22;
const UNDERLAY_FLOOR_Y = -1.32;
const GAUSSIAN_CAMERA_TRAJECTORY = [
  { t: 0, position: [0.0, 0.04, 1.76], yaw: 0.0, pitch: -0.012, fovOffset: 0.0 },
  { t: 0.18, position: [0.035, 0.043, 1.9], yaw: 0.018, pitch: -0.012, fovOffset: 0.05 },
  { t: 0.38, position: [-0.075, 0.047, 2.1], yaw: -0.025, pitch: -0.01, fovOffset: -0.05 },
  { t: 0.62, position: [0.105, 0.045, 2.29], yaw: 0.032, pitch: -0.009, fovOffset: -0.1 },
  { t: 0.82, position: [-0.04, 0.042, 2.4], yaw: -0.012, pitch: -0.011, fovOffset: 0.0 },
  { t: 1, position: [0.0, 0.04, 1.76], yaw: 0.0, pitch: -0.012, fovOffset: 0.0 }
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
  const geometry = registerDisposable(new SphereGeometry(260, 160, 80));
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
    loaded.wrapS = RepeatWrapping;
    loaded.wrapT = RepeatWrapping;
    loaded.repeat.set(SKYBOX_REPEAT_X, SKYBOX_REPEAT_Y);
    loaded.offset.set(0.5 - (SKYBOX_REPEAT_X * 0.25), 0.5 - (SKYBOX_REPEAT_Y * 0.5));
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


function createSealedUnderlayGeometry({ width = 4.12, depth = 2.58, floorSegmentsX = 32, floorSegmentsZ = 26 } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const rimLift = 0.12;
  const wallTop = 0.38;
  const wallLean = 0.24;

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
      const lift = Math.pow(MathUtils.smoothstep(edge, 0.64, 1), 2.15) * rimLift;
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
  depthTest = false,
  color = '#ffffff'
}) {
  const material = registerDisposable(new SpriteMaterial({
    color,
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
    { textureUrl: beeRightUrl, position: [-1.82, -0.34, 1.96], scale: [0.071, 0.078], center: [0.5, 0.42], bob: 0.022, sway: 0.08, depth: 0.038, speed: 0.29, flutter: 0.07, phase: 0.35, loops: 1, renderOrder: 46 },
    { textureUrl: beeLeftUrl, position: [-1.48, -0.29, 2.16], scale: [0.066, 0.074], center: [0.5, 0.42], bob: 0.02, sway: 0.068, depth: 0.032, speed: 0.27, flutter: 0.068, phase: 1.65, loops: 1, renderOrder: 46 },
    { textureUrl: beeRightUrl, position: [-1.08, -0.37, 2.34], scale: [0.062, 0.07], center: [0.5, 0.42], bob: 0.02, sway: 0.06, depth: 0.03, speed: 0.26, flutter: 0.066, phase: 3.15, loops: 1, renderOrder: 46 },
    { textureUrl: beeLeftUrl, position: [-0.62, -0.32, 2.56], scale: [0.064, 0.071], center: [0.5, 0.42], bob: 0.021, sway: 0.065, depth: 0.034, speed: 0.27, flutter: 0.067, phase: 4.35, loops: 1, renderOrder: 46 },
    { textureUrl: beeRightUrl, position: [-1.64, -0.18, 2.42], scale: [0.059, 0.067], center: [0.5, 0.42], bob: 0.019, sway: 0.055, depth: 0.028, speed: 0.25, flutter: 0.064, phase: 5.15, loops: 1, renderOrder: 46 }
  ];

  const surfaceButterflies = [
    { position: [-2.04, -0.49, 1.86], scale: [0.038, 0.037], rotation: -0.16, phase: 0.1, color: '#f39ac9' },
    { position: [-1.76, -0.51, 2.18], scale: [0.034, 0.033], rotation: 0.1, phase: 0.72, color: '#7bd6de' },
    { position: [-1.42, -0.46, 2.0], scale: [0.032, 0.031], rotation: -0.04, phase: 1.15, color: '#f3c96d' },
    { position: [-1.12, -0.53, 2.58], scale: [0.029, 0.028], rotation: 0.12, phase: 1.72, color: '#bda4ff' },
    { position: [-0.8, -0.47, 2.34], scale: [0.033, 0.032], rotation: -0.12, phase: 2.05, color: '#ff9b7c' },
    { position: [-0.46, -0.55, 2.86], scale: [0.028, 0.027], rotation: 0.14, phase: 2.44, color: '#8fd27a' },
    { position: [-0.1, -0.45, 2.7], scale: [0.032, 0.031], rotation: -0.06, phase: 2.95, color: '#d89cff' },
    { position: [0.28, -0.53, 3.12], scale: [0.034, 0.033], rotation: 0.08, phase: 3.3, color: '#78c7ff' },
    { position: [0.66, -0.44, 2.98], scale: [0.03, 0.029], rotation: -0.1, phase: 3.76, color: '#f5b86f' },
    { position: [1.02, -0.54, 3.46], scale: [0.036, 0.035], rotation: 0.05, phase: 4.1, color: '#f28fb2' },
    { position: [1.34, -0.47, 3.72], scale: [0.032, 0.031], rotation: -0.07, phase: 4.45, color: '#89d8c6' },
    { position: [1.7, -0.52, 3.98], scale: [0.031, 0.03], rotation: 0.13, phase: 4.9, color: '#efce73' },
    { position: [1.96, -0.43, 4.28], scale: [0.029, 0.028], rotation: -0.04, phase: 5.36, color: '#c8a3ff' },
    { position: [1.52, -0.38, 4.38], scale: [0.035, 0.034], rotation: 0.06, phase: 5.82, color: '#f6a07d' },
    { position: [0.92, -0.4, 4.14], scale: [0.027, 0.026], rotation: -0.13, phase: 6.14, color: '#79dbe8' },
    { position: [-1.88, -0.42, 2.76], scale: [0.027, 0.026], rotation: 0.18, phase: 0.42, color: '#f0a0df' },
    { position: [-0.2, -0.5, 3.48], scale: [0.031, 0.03], rotation: -0.2, phase: 1.94, color: '#a1db7d' },
    { position: [0.48, -0.49, 3.78], scale: [0.028, 0.027], rotation: 0.18, phase: 2.72, color: '#ffc17a' }
  ].map((actor) => ({
    textureUrl: butterflyMaskUrl,
    center: [0.5, 0.5],
    bob: 0.01,
    sway: 0.014,
    depth: 0.008,
    speed: 0.1,
    flutter: 0.075,
    opacity: 0.82,
    loops: 1,
    renderOrder: 41,
    ...actor
  }));

  [...bees, ...surfaceButterflies].forEach(createFlyingSpriteActor);
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

  const sideSway = props.slowDriftEnabled ? Math.sin(loopProgress * Math.PI * 2) * 0.006 : 0;
  const verticalBreath = props.slowDriftEnabled ? Math.sin(loopProgress * Math.PI * 4) * 0.003 : 0;

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
