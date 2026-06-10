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

const BUILD_STAMP = '20260610-194500';
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
let beeRightTexture;
let beeLeftTexture;
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
const CAMERA_HOME = new Vector3(0.0, 0.042, 1.98);
const CAMERA_SIDE = new Vector3(1.0, 0.0, 0.0);
const SCENE_LOOP_SECONDS = 96;
const UNDERLAY_CENTER_Z = 3.22;
const UNDERLAY_FLOOR_Y = -1.32;
const GAUSSIAN_CAMERA_TRAJECTORY = [
  { t: 0, position: [0.0, 0.042, 1.98], yaw: -0.006, pitch: -0.014, fovOffset: 0.0 },
  { t: 0.16, position: [0.048, 0.058, 2.18], yaw: 0.014, pitch: -0.017, fovOffset: -0.1 },
  { t: 0.34, position: [0.088, 0.084, 2.44], yaw: 0.025, pitch: -0.022, fovOffset: -0.2 },
  { t: 0.5, position: [0.028, 0.064, 2.66], yaw: 0.012, pitch: -0.021, fovOffset: -0.26 },
  { t: 0.68, position: [-0.074, 0.08, 2.42], yaw: -0.02, pitch: -0.018, fovOffset: -0.17 },
  { t: 0.86, position: [-0.03, 0.05, 2.12], yaw: -0.01, pitch: -0.015, fovOffset: -0.06 },
  { t: 1, position: [0.0, 0.042, 1.98], yaw: -0.006, pitch: -0.014, fovOffset: 0.0 }
];
const clock = new Clock();
const loader = new TextureLoader();
const cleanup = [];
const uniforms = [];
const butterflyActors = [];
const beeActors = [];
const cameraPathPosition = new Vector3();
const cameraPathTargetPosition = new Vector3();
const cameraLookTarget = new Vector3();
const beeVector = new Vector3();
const beeSampleVector = new Vector3();
let butterflyUpperWingGeometry;
let butterflyLowerWingGeometry;
let butterflyUpperAccentGeometry;
let butterflyLowerAccentGeometry;
let butterflyBodyGeometry;
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
  const geometry = registerDisposable(new SphereGeometry(260, 96, 48));
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

  for (let i = 0; i < 220; i += 1) {
    addPoint({
      x: MathUtils.randFloatSpread(5.4),
      y: MathUtils.randFloat(-1.0, 1.45),
      z: MathUtils.randFloat(0.2, 3.3),
      color: [1.0, MathUtils.randFloat(0.78, 0.96), MathUtils.randFloat(0.22, 0.58)],
      size: MathUtils.randFloat(1.6, 4.2),
      drift: MathUtils.randFloat(0.35, 1.25)
    });
  }

  for (let i = 0; i < 10; i += 1) {
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


function createSealedUnderlayGeometry({ width = 4.12, depth = 2.58, floorSegmentsX = 24, floorSegmentsZ = 18 } = {}) {
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


const FLOWER_PATCHES = [
  new Vector3(-1.86, -0.5, 2.08),
  new Vector3(-1.38, -0.47, 2.48),
  new Vector3(-0.9, -0.51, 2.94),
  new Vector3(-0.28, -0.48, 3.36),
  new Vector3(0.38, -0.5, 3.78),
  new Vector3(1.02, -0.46, 4.16),
  new Vector3(1.54, -0.43, 4.54),
  new Vector3(0.66, -0.44, 4.72),
  new Vector3(-0.52, -0.46, 4.08)
];

const BUTTERFLY_PALETTE = [
  { top: '#f278a8', bottom: '#ffd55f', accent: '#fff4b8' },
  { top: '#76cfe1', bottom: '#d5f6ff', accent: '#ffffff' },
  { top: '#8d89ff', bottom: '#ddd7ff', accent: '#fff2a2' },
  { top: '#ff9f73', bottom: '#ffe0bf', accent: '#fff6d2' },
  { top: '#8bcf6f', bottom: '#daf4ad', accent: '#fff6c8' },
  { top: '#e77bc0', bottom: '#ffd7ee', accent: '#ffffff' }
];

function createIndexedGeometry(points, indices) {
  const geometry = registerDisposable(new BufferGeometry());
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createBodyGeometry() {
  return createIndexedGeometry([
    -0.012, 0.16, 0,
     0.012, 0.16, 0,
    -0.016, -0.15, 0,
     0.016, -0.15, 0
  ], [0, 2, 1, 1, 2, 3]);
}

function createButterflyWingGeometry(kind = 'upper') {
  if (kind === 'upper') {
    return createIndexedGeometry([
      0.0, 0.0, 0,
      0.065, 0.11, 0,
      0.16, 0.13, 0,
      0.225, 0.05, 0,
      0.185, -0.02, 0,
      0.08, -0.03, 0
    ], [0, 1, 5, 1, 2, 4, 1, 4, 5, 2, 3, 4]);
  }

  return createIndexedGeometry([
    0.0, -0.004, 0,
    0.06, -0.02, 0,
    0.145, -0.06, 0,
    0.13, -0.165, 0,
    0.042, -0.12, 0
  ], [0, 1, 4, 1, 2, 3, 1, 3, 4]);
}

function createButterflyAccentGeometry(kind = 'upper') {
  if (kind === 'upper') {
    return createIndexedGeometry([
      0.025, 0.02, 0,
      0.08, 0.075, 0,
      0.14, 0.065, 0,
      0.12, 0.01, 0,
      0.055, -0.005, 0
    ], [0, 1, 4, 1, 2, 3, 1, 3, 4]);
  }

  return createIndexedGeometry([
      0.02, -0.02, 0,
      0.07, -0.04, 0,
      0.105, -0.11, 0,
      0.048, -0.085, 0
    ], [0, 1, 3, 1, 2, 3]);
}

function configureTexture(texture, repeatX = 1, repeatY = 1) {
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 4, 4);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.needsUpdate = true;
}

function ensureButterflyGeometry() {
  butterflyUpperWingGeometry ??= createButterflyWingGeometry('upper');
  butterflyLowerWingGeometry ??= createButterflyWingGeometry('lower');
  butterflyUpperAccentGeometry ??= createButterflyAccentGeometry('upper');
  butterflyLowerAccentGeometry ??= createButterflyAccentGeometry('lower');
  butterflyBodyGeometry ??= createBodyGeometry();
}

function createButterflyActor({ position, scale = 0.1, palette, phase = 0, bob = 0.012, sway = 0.026, depth = 0.018, flapSpeed = 11.5, wingBias = 0 }) {
  ensureButterflyGeometry();
  const root = new Group();
  root.position.set(position[0], position[1], position[2]);
  root.renderOrder = 42;
  overlayRoot.add(root);

  const makeMaterial = (color, opacity = 0.98) => registerDisposable(new MeshBasicMaterial({
    color,
    side: DoubleSide,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true
  }));

  const createWingSet = (side) => {
    const sign = side === 'left' ? -1 : 1;
    const upperPivot = new Group();
    const lowerPivot = new Group();
    upperPivot.position.set(0, 0.012, 0);
    lowerPivot.position.set(0, -0.005, 0);
    root.add(upperPivot, lowerPivot);

    const upperWing = new Mesh(butterflyUpperWingGeometry, makeMaterial(palette.top));
    const upperAccent = new Mesh(butterflyUpperAccentGeometry, makeMaterial(palette.accent, 0.9));
    const lowerWing = new Mesh(butterflyLowerWingGeometry, makeMaterial(palette.bottom));
    const lowerAccent = new Mesh(butterflyLowerAccentGeometry, makeMaterial(palette.accent, 0.84));

    [upperWing, upperAccent, lowerWing, lowerAccent].forEach((part) => {
      part.scale.x = sign;
      part.renderOrder = 42;
      part.position.z = side === 'left' ? 0.0015 : -0.0015;
    });
    upperAccent.position.z += 0.001;
    lowerAccent.position.z += 0.001;

    upperPivot.add(upperWing, upperAccent);
    lowerPivot.add(lowerWing, lowerAccent);
    return { upperPivot, lowerPivot };
  };

  const left = createWingSet('left');
  const right = createWingSet('right');
  const body = new Mesh(butterflyBodyGeometry, makeMaterial('#4a371f'));
  body.renderOrder = 43;
  body.position.z = 0.003;
  root.add(body);
  root.scale.setScalar(scale);

  butterflyActors.push({
    root,
    body,
    leftUpperPivot: left.upperPivot,
    leftLowerPivot: left.lowerPivot,
    rightUpperPivot: right.upperPivot,
    rightLowerPivot: right.lowerPivot,
    basePosition: root.position.clone(),
    bob,
    sway,
    depth,
    flapSpeed,
    wingBias,
    phase
  });
}

function loadBeeTexture(url) {
  const texture = registerTexture(loader.load(url, (loaded) => configureTexture(loaded)));
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createBeeActor({ route, phase = 0, scale = 0.05, speed = 1, collectRadius = 0.072, travelLift = 0.08, curve = 0.09, bob = 0.018 }) {
  const material = registerDisposable(new SpriteMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
    depthTest: false,
    alphaTest: 0.02,
    map: beeRightTexture
  }));
  const sprite = new Sprite(material);
  sprite.center.set(0.5, 0.42);
  sprite.scale.set(scale, scale * 1.12, 1);
  sprite.renderOrder = 46;
  overlayRoot.add(sprite);

  const startPatch = FLOWER_PATCHES[route[0]].clone();
  sprite.position.copy(startPatch);

  beeActors.push({
    sprite,
    material,
    route,
    phase,
    baseScale: { x: scale, y: scale * 1.12 },
    speed,
    collectRadius,
    travelLift,
    curve,
    bob,
    currentTexture: beeRightTexture,
    lastPosition: startPatch.clone(),
    samplePosition: startPatch.clone(),
    lastDirectionX: 1
  });
}

function createFlyingActors() {
  overlayRoot = new Group();
  overlayRoot.name = 'splat-overlays';
  scene.add(overlayRoot);

  beeRightTexture = loadBeeTexture(beeRightUrl);
  beeLeftTexture = loadBeeTexture(beeLeftUrl);

  const butterflyPlacements = [
    [-1.82, -0.58, 2.18], [-1.42, -0.56, 2.54], [-0.96, -0.54, 2.9],
    [-0.5, -0.57, 3.26], [-0.04, -0.55, 3.62], [0.42, -0.56, 3.96],
    [0.86, -0.52, 4.22], [1.28, -0.49, 4.46], [0.72, -0.53, 4.58],
    [0.08, -0.54, 4.02], [-0.82, -0.52, 3.4], [1.62, -0.47, 4.74]
  ];

  butterflyPlacements.forEach((position, index) => {
    createButterflyActor({
      position,
      scale: 0.084 + (index % 3) * 0.008,
      palette: BUTTERFLY_PALETTE[index % BUTTERFLY_PALETTE.length],
      phase: index * 0.52,
      bob: 0.008 + (index % 4) * 0.0015,
      sway: 0.014 + (index % 4) * 0.003,
      depth: 0.01 + (index % 3) * 0.003,
      flapSpeed: 9.5 + (index % 5) * 0.7,
      wingBias: (index % 2 === 0 ? 1 : -1) * 0.03
    });
  });

  const beeConfigs = [
    { route: [0, 1, 2], phase: 0.02, scale: 0.044, speed: 0.86, collectRadius: 0.058, travelLift: 0.068, curve: 0.08 },
    { route: [1, 2, 4], phase: 0.15, scale: 0.042, speed: 0.93, collectRadius: 0.062, travelLift: 0.072, curve: -0.082 },
    { route: [2, 3, 5], phase: 0.28, scale: 0.043, speed: 0.9, collectRadius: 0.056, travelLift: 0.066, curve: 0.078 },
    { route: [3, 4, 6], phase: 0.39, scale: 0.041, speed: 0.88, collectRadius: 0.058, travelLift: 0.07, curve: -0.076 },
    { route: [4, 5, 7], phase: 0.5, scale: 0.043, speed: 0.95, collectRadius: 0.061, travelLift: 0.076, curve: 0.086 },
    { route: [5, 6, 7], phase: 0.61, scale: 0.04, speed: 0.9, collectRadius: 0.056, travelLift: 0.068, curve: -0.078 },
    { route: [0, 2, 8], phase: 0.74, scale: 0.042, speed: 0.91, collectRadius: 0.06, travelLift: 0.072, curve: 0.082 },
    { route: [8, 3, 1], phase: 0.83, scale: 0.041, speed: 0.87, collectRadius: 0.054, travelLift: 0.069, curve: -0.084 },
    { route: [2, 5, 6], phase: 0.91, scale: 0.04, speed: 0.97, collectRadius: 0.053, travelLift: 0.074, curve: 0.078 },
    { route: [1, 4, 7], phase: 0.08, scale: 0.042, speed: 0.89, collectRadius: 0.058, travelLift: 0.072, curve: -0.082 }
  ];

  beeConfigs.forEach(createBeeActor);
}

function updateButterflies(loopTime) {
  if (!butterflyActors.length || !camera) return;

  butterflyActors.forEach((actor, index) => {
    const t = loopTime * (0.2 + index * 0.002) + actor.phase;
    actor.root.quaternion.copy(camera.quaternion);
    actor.root.rotateZ(Math.sin(t * 0.45) * 0.06);
    actor.root.position.set(
      actor.basePosition.x + Math.sin(t * 0.82) * actor.sway,
      actor.basePosition.y + Math.sin(t * 1.55) * actor.bob,
      actor.basePosition.z + Math.cos(t * 0.68) * actor.depth
    );

    const flap = 0.22 + ((Math.sin(t * actor.flapSpeed) + 1) * 0.5) * 0.72;
    const lowerFlap = flap * 0.56;

    actor.leftUpperPivot.rotation.y = flap + actor.wingBias;
    actor.rightUpperPivot.rotation.y = -flap - actor.wingBias;
    actor.leftLowerPivot.rotation.y = lowerFlap + actor.wingBias * 0.7;
    actor.rightLowerPivot.rotation.y = -lowerFlap - actor.wingBias * 0.7;
    actor.leftUpperPivot.rotation.z = 0.14;
    actor.rightUpperPivot.rotation.z = -0.14;
    actor.leftLowerPivot.rotation.z = -0.06;
    actor.rightLowerPivot.rotation.z = 0.06;
    actor.body.rotation.z = Math.sin(t * 0.9) * 0.08;
  });
}

function sampleBeeSegment(actor, loopProgress, target) {
  const routeLength = actor.route.length;
  const cycle = (((loopProgress * actor.speed) + actor.phase) % 1 + 1) % 1;
  const scaled = cycle * routeLength;
  const segmentIndex = Math.floor(scaled) % routeLength;
  const local = scaled - Math.floor(scaled);
  const from = FLOWER_PATCHES[actor.route[segmentIndex]];
  const to = FLOWER_PATCHES[actor.route[(segmentIndex + 1) % routeLength]];
  beeVector.subVectors(to, from);
  const flatLength = Math.max(Math.hypot(beeVector.x, beeVector.z), 0.0001);
  const normalX = -beeVector.z / flatLength;
  const normalZ = beeVector.x / flatLength;

  const collectPortion = 0.3;
  const transitEnd = 0.8;

  if (local < collectPortion) {
    const u = local / collectPortion;
    const angle = (u * Math.PI * 2) + actor.phase * Math.PI * 4;
    target.copy(from);
    target.x += Math.cos(angle) * actor.collectRadius;
    target.z += Math.sin(angle * 1.06) * actor.collectRadius * 0.7;
    target.y += Math.sin(angle * 2.0) * actor.bob;
    return target;
  }

  if (local < transitEnd) {
    const u = (local - collectPortion) / (transitEnd - collectPortion);
    const eased = MathUtils.smoothstep(u, 0, 1);
    target.copy(from).lerp(to, eased);
    target.x += Math.sin(u * Math.PI) * actor.curve * normalX;
    target.z += Math.sin(u * Math.PI) * actor.curve * normalZ;
    target.y += Math.sin(u * Math.PI) * actor.travelLift;
    return target;
  }

  const u = (local - transitEnd) / (1 - transitEnd);
  const angle = (u * Math.PI * 2) + actor.phase * Math.PI * 3 + Math.PI * 0.4;
  target.copy(to);
  target.x += Math.cos(angle) * actor.collectRadius * 0.86;
  target.z += Math.sin(angle * 1.1) * actor.collectRadius * 0.64;
  target.y += Math.cos(angle * 2.0) * actor.bob * 0.9;
  return target;
}

function updateBees(loopTime) {
  if (!beeActors.length) return;
  const loopProgress = loopTime / SCENE_LOOP_SECONDS;

  beeActors.forEach((actor) => {
    const position = sampleBeeSegment(actor, loopProgress, actor.samplePosition);
    const velocityX = position.x - actor.lastPosition.x;
    const velocityY = position.y - actor.lastPosition.y;
    const directionX = Math.abs(velocityX) > 0.0005 ? Math.sign(velocityX) : actor.lastDirectionX;

    actor.sprite.position.copy(position);

    const wingPulse = 1 + Math.sin(loopTime * 16 * actor.speed + actor.phase * Math.PI * 4) * 0.12;
    const bodySqueeze = 1 + Math.cos(loopTime * 12 * actor.speed + actor.phase * Math.PI * 3) * 0.08;
    actor.sprite.scale.set(actor.baseScale.x * wingPulse, actor.baseScale.y * bodySqueeze, 1);
    actor.sprite.material.rotation = MathUtils.clamp(velocityY * 3.2, -0.22, 0.22);

    const targetTexture = directionX >= 0 ? beeRightTexture : beeLeftTexture;
    if (actor.currentTexture !== targetTexture) {
      actor.material.map = targetTexture;
      actor.material.needsUpdate = true;
      actor.currentTexture = targetTexture;
    }

    actor.material.opacity = 0.93 + Math.sin(loopTime * 5.0 + actor.phase * Math.PI * 3) * 0.05;
    actor.lastPosition.copy(position);
    actor.lastDirectionX = directionX || actor.lastDirectionX;
  });
}

function updateFlyingActors(loopTime) {
  updateButterflies(loopTime);
  updateBees(loopTime);
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
    lodScale: 1.85,
    maxSplats: 680000,
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
    maxPixelRadius: 220,
    minPixelRadius: 0.22,
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

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, aspect < 0.7 ? 0.95 : 1.2));
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

  const sideSway = props.slowDriftEnabled ? Math.sin(loopProgress * Math.PI * 2) * 0.0028 : 0;
  const verticalBreath = props.slowDriftEnabled ? Math.sin(loopProgress * Math.PI * 4) * 0.002 : 0;

  camera.position.copy(cameraPathPosition)
    .addScaledVector(CAMERA_SIDE, sideSway);
  camera.position.y += verticalBreath;
  const direction = fixedViewDirection(cameraPathYaw, cameraPathPitch);
  cameraLookTarget.copy(camera.position).add(direction);
  camera.lookAt(cameraLookTarget);

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
  renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
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
  butterflyActors.length = 0;
  beeActors.length = 0;
  cleanup.splice(0).forEach((fn) => fn());
  disposeTree(scene);
  sparkRenderer?.dispose?.();
  renderer?.dispose();
});
</script>
