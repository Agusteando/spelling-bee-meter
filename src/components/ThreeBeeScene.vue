<template>
  <div ref="mount" class="bee-world" :class="{ 'is-dragging': dragging }" aria-label="Gaussian splat spelling bee scene">
    <div v-if="splatError" class="splat-loading splat-error">{{ splatError }}</div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AdditiveBlending,
  AmbientLight,
  CanvasTexture,
  BufferGeometry,
  CatmullRomCurve3,
  ClampToEdgeWrapping,
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
  Scene,
  ShaderMaterial,
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

const emit = defineEmits(['scene-ready', 'scene-loading']);

const BUILD_STAMP = '20260611-064000';
const SPLAT_URL = `/splats/gaussians.spz?v=${BUILD_STAMP}`;
const SKY_COLOR = '#fbe2a4';
const SPLAT_REVEAL_SECONDS = 4.8;
const SPLAT_BASE_SCALE = 3.85;

const mount = ref(null);
const dragging = ref(false);
const splatLoading = ref(false);
const splatError = ref('');

let renderer;
let sparkRenderer;
let scene;
let camera;
let resizeObserver;
let frameHandle;
let disposed = false;
let viewWidth = 1;
let viewHeight = 1;
let overlayRoot;
let splatRoot;
let splatMesh;
let particleSystem;
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
let splatRevealStart = 0;
let splatRevealComplete = false;
let sceneReadyEmitted = false;
let activeSplatSource = { url: SPLAT_URL };
let spzModulePromise = null;

const fixedYaw = 0;
const fixedPitch = -0.012;
const CAMERA_HOME = new Vector3(0.0, -0.045, 1.82);
const CAMERA_SIDE = new Vector3(1.0, 0.0, 0.0);
const SCENE_LOOP_SECONDS = 33.8;
const CAMERA_NEAR_Z = CAMERA_HOME.z;
const CAMERA_FAR_Z = 10.48;
const CAMERA_PATH_CURVE = new CatmullRomCurve3([
  CAMERA_HOME.clone(),
  new Vector3(0.0, -0.052, 1.98),
  new Vector3(0.04, -0.195, 2.55),
  new Vector3(0.32, -0.365, 3.62),
  new Vector3(0.84, -0.34, 5.15),
  new Vector3(1.18, -0.06, 6.92),
  new Vector3(0.78, 0.38, 8.42),
  new Vector3(0.32, 0.58, 9.62),
  new Vector3(-0.04, 0.68, 10.28),
  new Vector3(-0.26, 0.67, 10.48),
  new Vector3(-0.44, 0.6, 10.34),
  new Vector3(-0.58, 0.46, 9.92),
  new Vector3(-0.66, 0.27, 9.18),
  new Vector3(-0.65, 0.04, 8.08),
  new Vector3(-0.5, -0.14, 6.72),
  new Vector3(-0.22, -0.285, 4.76),
  new Vector3(0.12, -0.185, 3.12)
], true, 'catmullrom', 0.18);
const clock = new Clock();
const loader = new TextureLoader();
const cleanup = [];
const uniforms = [];
const butterflyActors = [];
const beeActors = [];
const cameraPathPosition = new Vector3();
const cameraPathTargetPosition = new Vector3();
const cameraLookTarget = new Vector3();
const cameraDirection = new Vector3();
const beeVector = new Vector3();
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
      z: MathUtils.randFloat(0.4, 8.6),
      color: [1.0, MathUtils.randFloat(0.78, 0.96), MathUtils.randFloat(0.22, 0.58)],
      size: MathUtils.randFloat(1.6, 4.2),
      drift: MathUtils.randFloat(0.35, 1.25)
    });
  }

  for (let i = 0; i < 10; i += 1) {
    addPoint({
      x: MathUtils.randFloatSpread(4.2),
      y: MathUtils.randFloat(-0.4, 1.15),
      z: MathUtils.randFloat(0.6, 7.2),
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
  particleSystem.visible = false;
  scene.add(particleSystem);
}


const FLOWER_PATCHES = [
  new Vector3(-1.92, -0.52, 2.06),
  new Vector3(-1.42, -0.49, 2.62),
  new Vector3(-0.88, -0.5, 3.18),
  new Vector3(-0.26, -0.47, 3.82),
  new Vector3(0.32, -0.49, 4.46),
  new Vector3(0.92, -0.45, 5.06),
  new Vector3(1.36, -0.42, 5.72),
  new Vector3(0.72, -0.42, 6.38),
  new Vector3(0.04, -0.44, 6.96),
  new Vector3(-0.58, -0.4, 7.54),
  new Vector3(0.24, -0.36, 8.08),
  new Vector3(0.88, -0.33, 8.68)
];

const BUTTERFLY_PALETTE = [
  { top: '#f47caf', bottom: '#ffd861', accent: '#fff6c7' },
  { top: '#6ecbe2', bottom: '#d7f7ff', accent: '#ffffff' },
  { top: '#8f86ff', bottom: '#ded8ff', accent: '#fff0a6' },
  { top: '#ff986d', bottom: '#ffe0c4', accent: '#fff5cf' },
  { top: '#80ca6b', bottom: '#ddf3aa', accent: '#fff7c4' },
  { top: '#e978be', bottom: '#ffd6ef', accent: '#ffffff' }
];

const butterflyWingMaterials = new Map();
let butterflyWingGeometry;
let butterflyBodyGeometry;
let butterflyBodyMaterial;

function createIndexedGeometry(points, indices, uvs = null) {
  const geometry = registerDisposable(new BufferGeometry());
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  if (uvs) geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createButterflyWingGeometry() {
  return createIndexedGeometry([
    0.0, 0.105, 0,
    0.11, 0.155, 0,
    0.235, 0.07, 0,
    0.22, -0.105, 0,
    0.08, -0.155, 0,
    0.0, -0.085, 0
  ], [0, 1, 5, 1, 2, 5, 2, 3, 4, 2, 4, 5], [
    0.0, 0.86,
    0.48, 1.0,
    1.0, 0.72,
    0.94, 0.18,
    0.34, 0.0,
    0.0, 0.28
  ]);
}

function createButterflyBodyGeometry() {
  return createIndexedGeometry([
    -0.012, 0.16, 0,
     0.012, 0.16, 0,
    -0.016, -0.15, 0,
     0.016, -0.15, 0
  ], [0, 2, 1, 1, 2, 3]);
}

function ensureButterflyGeometry() {
  butterflyWingGeometry ??= createButterflyWingGeometry();
  butterflyBodyGeometry ??= createButterflyBodyGeometry();
  butterflyBodyMaterial ??= registerDisposable(new MeshBasicMaterial({
    color: '#4a371f',
    side: DoubleSide,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
    depthTest: true
  }));
}

function createButterflyWingTexture(palette) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);

  const topGradient = ctx.createLinearGradient(8, 10, 120, 70);
  topGradient.addColorStop(0, palette.accent);
  topGradient.addColorStop(0.34, palette.top);
  topGradient.addColorStop(1, palette.bottom);

  ctx.fillStyle = topGradient;
  ctx.beginPath();
  ctx.moveTo(2, 62);
  ctx.bezierCurveTo(18, 18, 74, 0, 124, 35);
  ctx.bezierCurveTo(116, 75, 56, 80, 2, 65);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = palette.bottom;
  ctx.beginPath();
  ctx.moveTo(4, 69);
  ctx.bezierCurveTo(40, 72, 98, 82, 112, 125);
  ctx.bezierCurveTo(62, 126, 22, 104, 2, 72);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.52;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(18, 60);
  ctx.bezierCurveTo(42, 38, 72, 32, 104, 42);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(24, 76);
  ctx.bezierCurveTo(50, 86, 76, 96, 96, 116);
  ctx.stroke();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(78, 40, 10, 6, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(64, 96, 7, 4, 0.45, 0, Math.PI * 2);
  ctx.fill();

  const texture = registerTexture(new CanvasTexture(canvas));
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function getButterflyWingMaterial(paletteIndex) {
  if (butterflyWingMaterials.has(paletteIndex)) return butterflyWingMaterials.get(paletteIndex);
  const palette = BUTTERFLY_PALETTE[paletteIndex % BUTTERFLY_PALETTE.length];
  const material = registerDisposable(new MeshBasicMaterial({
    map: createButterflyWingTexture(palette),
    side: DoubleSide,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    depthTest: true,
    alphaTest: 0.04
  }));
  butterflyWingMaterials.set(paletteIndex, material);
  return material;
}

function configureTexture(texture, repeatX = 1, repeatY = 1) {
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 4, 4);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.needsUpdate = true;
}

function createButterflyActor({ position, scale = 0.1, paletteIndex = 0, phase = 0, bob = 0.012, sway = 0.026, depth = 0.018, flapSpeed = 11.5, roll = 0 }) {
  ensureButterflyGeometry();
  const root = new Group();
  root.position.set(position[0], position[1], position[2]);
  root.renderOrder = 42;
  overlayRoot.add(root);

  const leftPivot = new Group();
  const rightPivot = new Group();
  root.add(leftPivot, rightPivot);

  const material = getButterflyWingMaterial(paletteIndex);
  const leftWing = new Mesh(butterflyWingGeometry, material);
  const rightWing = new Mesh(butterflyWingGeometry, material);
  leftWing.scale.x = -1;
  leftWing.position.z = 0.001;
  rightWing.position.z = -0.001;
  leftWing.renderOrder = 42;
  rightWing.renderOrder = 42;
  leftPivot.add(leftWing);
  rightPivot.add(rightWing);

  const body = new Mesh(butterflyBodyGeometry, butterflyBodyMaterial);
  body.position.z = 0.003;
  body.renderOrder = 43;
  root.add(body);
  root.scale.setScalar(scale);

  butterflyActors.push({
    root,
    leftPivot,
    rightPivot,
    body,
    basePosition: root.position.clone(),
    bob,
    sway,
    depth,
    flapSpeed,
    roll,
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
  sprite.scale.set(scale, scale, 1);
  sprite.renderOrder = 46;
  overlayRoot.add(sprite);

  const startPatch = FLOWER_PATCHES[route[0]].clone();
  sprite.position.copy(startPatch);

  beeActors.push({
    sprite,
    material,
    route,
    phase,
    baseScale: { x: scale, y: scale },
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
  overlayRoot.visible = false;
  scene.add(overlayRoot);

  beeRightTexture = loadBeeTexture(beeRightUrl);
  beeLeftTexture = loadBeeTexture(beeLeftUrl);

  const butterflyPlacements = [
    [-1.78, -0.58, 2.18], [-1.22, -0.56, 2.82], [-0.64, -0.57, 3.54],
    [-0.08, -0.54, 4.24], [0.48, -0.53, 4.98], [1.02, -0.5, 5.72],
    [0.78, -0.49, 6.44], [0.12, -0.47, 7.18], [-0.54, -0.45, 7.82],
    [0.32, -0.4, 8.42], [0.94, -0.37, 8.92], [-0.18, -0.42, 5.96]
  ];

  butterflyPlacements.forEach((position, index) => {
    createButterflyActor({
      position,
      scale: 0.075 + (index % 3) * 0.007,
      paletteIndex: index % BUTTERFLY_PALETTE.length,
      phase: index * 0.58,
      bob: 0.007 + (index % 3) * 0.0015,
      sway: 0.012 + (index % 4) * 0.002,
      depth: 0.008 + (index % 3) * 0.002,
      flapSpeed: 8.6 + (index % 5) * 0.55,
      roll: (index % 2 === 0 ? 1 : -1) * 0.035
    });
  });

  const beeConfigs = [
    { route: [0, 1, 3], phase: 0.02, scale: 0.044, speed: 0.86, collectRadius: 0.058, travelLift: 0.068, curve: 0.08 },
    { route: [1, 2, 4], phase: 0.15, scale: 0.042, speed: 0.93, collectRadius: 0.062, travelLift: 0.072, curve: -0.082 },
    { route: [2, 3, 5], phase: 0.28, scale: 0.043, speed: 0.9, collectRadius: 0.056, travelLift: 0.066, curve: 0.078 },
    { route: [3, 4, 6], phase: 0.39, scale: 0.041, speed: 0.88, collectRadius: 0.058, travelLift: 0.07, curve: -0.076 },
    { route: [4, 5, 7], phase: 0.5, scale: 0.043, speed: 0.95, collectRadius: 0.061, travelLift: 0.076, curve: 0.086 },
    { route: [5, 6, 8], phase: 0.61, scale: 0.04, speed: 0.9, collectRadius: 0.056, travelLift: 0.068, curve: -0.078 },
    { route: [6, 7, 9], phase: 0.74, scale: 0.042, speed: 0.91, collectRadius: 0.06, travelLift: 0.072, curve: 0.082 },
    { route: [7, 8, 10], phase: 0.83, scale: 0.041, speed: 0.87, collectRadius: 0.054, travelLift: 0.069, curve: -0.084 },
    { route: [8, 10, 11], phase: 0.91, scale: 0.04, speed: 0.97, collectRadius: 0.053, travelLift: 0.074, curve: 0.078 },
    { route: [2, 6, 9], phase: 0.08, scale: 0.042, speed: 0.89, collectRadius: 0.058, travelLift: 0.072, curve: -0.082 },
    { route: [1, 5, 8], phase: 0.36, scale: 0.041, speed: 0.9, collectRadius: 0.056, travelLift: 0.07, curve: 0.08 },
    { route: [4, 8, 11], phase: 0.58, scale: 0.04, speed: 0.92, collectRadius: 0.054, travelLift: 0.073, curve: -0.078 }
  ];

  beeConfigs.forEach(createBeeActor);
}

function updateButterflies(loopTime) {
  if (!butterflyActors.length || !camera) return;

  butterflyActors.forEach((actor, index) => {
    const t = loopTime * (0.18 + index * 0.002) + actor.phase;
    actor.root.quaternion.copy(camera.quaternion);
    actor.root.rotateZ(actor.roll + Math.sin(t * 0.42) * 0.035);
    actor.root.position.set(
      actor.basePosition.x + Math.sin(t * 0.78) * actor.sway,
      actor.basePosition.y + Math.sin(t * 1.35) * actor.bob,
      actor.basePosition.z + Math.cos(t * 0.62) * actor.depth
    );

    const flap = 0.28 + ((Math.sin(t * actor.flapSpeed) + 1) * 0.5) * 0.62;
    actor.leftPivot.rotation.y = flap;
    actor.rightPivot.rotation.y = -flap;
    actor.leftPivot.rotation.z = 0.08;
    actor.rightPivot.rotation.z = -0.08;
    actor.body.rotation.z = Math.sin(t * 0.78) * 0.05;
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
    const velocityZ = position.z - actor.lastPosition.z;
    const cameraRightX = camera?.matrixWorld?.elements?.[0] ?? 1;
    const cameraRightY = camera?.matrixWorld?.elements?.[1] ?? 0;
    const cameraRightZ = camera?.matrixWorld?.elements?.[2] ?? 0;
    const screenVelocityX = (velocityX * cameraRightX) + (velocityY * cameraRightY) + (velocityZ * cameraRightZ);
    const directionX = Math.abs(screenVelocityX) > 0.0005 ? Math.sign(screenVelocityX) : actor.lastDirectionX;

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

function markSceneReady() {
  if (sceneReadyEmitted) return;
  sceneReadyEmitted = true;
  splatLoading.value = false;
  emitLoadingState(1, 'Scene ready');
  if (overlayRoot) overlayRoot.visible = props.splatEnabled;
  if (particleSystem) particleSystem.visible = props.splatEnabled;
  emit('scene-ready');
}



function emitLoadingState(progress, label, error = '') {
  const nextProgress = MathUtils.clamp(progress, 0, 1);
  if (Math.abs(nextProgress - lastLoadingProgress) < 0.003 && label === lastLoadingLabel && !error) return;
  lastLoadingProgress = nextProgress;
  lastLoadingLabel = label;
  emit('scene-loading', { progress: nextProgress, label, error });
}

async function readResponseBytes(response, onProgress) {
  const total = Number(response.headers.get('content-length') || 0);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(1);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  let fallbackProgress = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    chunks.push(value);
    received += value.length;
    if (total > 0) {
      onProgress?.(received / total);
    } else {
      fallbackProgress = Math.min(0.96, fallbackProgress + 0.08);
      onProgress?.(fallbackProgress);
    }
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.length;
  });
  onProgress?.(1);
  return bytes;
}

function setSplatLoadError(error) {
  const detail = error?.message || String(error || 'Unknown error');
  splatError.value = 'Missing or invalid Gaussian SPZ. This zip does not include the binary splat; put the full file at public/splats/gaussians.spz before building so production has dist/splats/gaussians.spz. Gzip-wrapped legacy SPZ and raw SPZ v4 are supported.';
  console.error('Gaussian splat load failed:', detail);
  emitLoadingState(1, 'Unable to load the Gaussian splat', splatError.value);
  splatLoading.value = false;
  if (splatRoot) splatRoot.visible = false;
  if (overlayRoot) overlayRoot.visible = false;
  if (particleSystem) particleSystem.visible = false;
}

function hasSpzMagic(bytes) {
  return bytes.length >= 4
    && bytes[0] === 0x4e
    && bytes[1] === 0x47
    && bytes[2] === 0x53
    && bytes[3] === 0x50;
}

function hasGzipMagic(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function getRawSpzVersion(bytes) {
  if (!hasSpzMagic(bytes) || bytes.length < 8) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
}

function looksLikeHtml(bytes) {
  if (bytes.length < 5) return false;
  const prefix = String.fromCharCode(...bytes.slice(0, Math.min(bytes.length, 16))).toLowerCase();
  return prefix.startsWith('<!doctype') || prefix.startsWith('<html') || prefix.startsWith('<head') || prefix.startsWith('<body');
}

function getSpzModule() {
  spzModulePromise ??= import('@adobe/spz').then(({ default: createSpzModule }) => createSpzModule());
  return spzModulePromise;
}

async function gzipBytes(bytes) {
  if (typeof CompressionStream !== 'function') {
    throw new Error('Raw legacy NGSP SPZ detected, but this browser cannot gzip it before Spark loads it. Use a gzip-wrapped SPZ or a browser with CompressionStream support.');
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function convertSpz4ToSparkLegacySpz(bytes) {
  const spz = await getSpzModule();
  const cloud = spz.loadSpzFromBuffer(bytes, { to: spz.CoordinateSystem.RDF });
  if (!cloud?.numPoints) {
    throw new Error('SPZ v4 decoded with no Gaussian points.');
  }

  return spz.saveSpzToBuffer(cloud, {
    version: 3,
    from: spz.CoordinateSystem.UNSPECIFIED,
    sh1Bits: 8,
    shRestBits: 5
  });
}

async function resolveSplatSource() {
  emitLoadingState(0.08, 'Gathering the Gaussian honey…');
  const response = await fetch(SPLAT_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Gaussian SPZ not found at /splats/gaussians.spz (${response.status}).`);
  }

  const bytes = await readResponseBytes(response, (progress) => {
    emitLoadingState(0.08 + (MathUtils.clamp(progress, 0, 1) * 0.58), 'Pouring the honey stream…');
  });
  if (bytes.length < 4) {
    throw new Error('Gaussian SPZ is empty or truncated.');
  }

  if (looksLikeHtml(bytes)) {
    throw new Error('Expected /splats/gaussians.spz, but the browser received HTML. Check the file path, build output, and service worker cache.');
  }

  if (hasGzipMagic(bytes)) {
    emitLoadingState(0.74, 'Gaussian data secured');
    return {
      fileBytes: bytes,
      fileType: 'spz',
      fileName: 'gaussians.spz'
    };
  }

  if (hasSpzMagic(bytes)) {
    const version = getRawSpzVersion(bytes);
    emitLoadingState(0.78, version >= 4 ? 'Refining the splat bloom…' : 'Wrapping the honey payload…');
    const fileBytes = version >= 4
      ? await convertSpz4ToSparkLegacySpz(bytes)
      : await gzipBytes(bytes);

    emitLoadingState(0.9, 'Gaussian bloom decoded');
    return {
      fileBytes,
      fileType: 'spz',
      fileName: 'gaussians.spz'
    };
  }

  throw new Error('Invalid Gaussian SPZ header. Expected gzip-wrapped SPZ, raw legacy NGSP SPZ, or SPZ v4 at /splats/gaussians.spz.');
}

function handleUnhandledSplatRejection(event) {
  const message = String(event.reason?.message || event.reason || '').toLowerCase();
  if (!message.includes('splat') && !message.includes('spz') && !message.includes('gaussian') && !message.includes('gzip')) return;
  event.preventDefault();
  setSplatLoadError(event.reason);
}

function updateSplatReveal(elapsed) {
  if (!splatRoot || !splatMesh || !splatMesh.isInitialized || splatRevealComplete) return;

  const raw = MathUtils.clamp((elapsed - splatRevealStart) / SPLAT_REVEAL_SECONDS, 0, 1);
  emitLoadingState(0.93 + (raw * 0.07), raw < 0.96 ? 'Blooming the scene…' : 'Almost ready…');
  const reveal = MathUtils.smoothstep(raw, 0, 1);
  const shimmer = raw < 1 ? Math.sin(elapsed * 8.0) * 0.012 * (1 - reveal) : 0;

  splatMesh.opacity = MathUtils.clamp(reveal * 1.08, 0, 1);
  splatRoot.scale.setScalar(SPLAT_BASE_SCALE * (0.74 + reveal * 0.26 + shimmer));
  splatRoot.position.y = (1 - reveal) * -0.075;

  if (raw >= 1) {
    splatMesh.opacity = 1;
    splatRoot.scale.setScalar(SPLAT_BASE_SCALE);
    splatRoot.position.y = 0;
    splatRevealComplete = true;
    markSceneReady();
  }
}


async function createSplatScene() {

  splatLoading.value = true;
  splatError.value = '';
  emitLoadingState(0.03, 'Waking the hive…');
  splatRoot = new Group();
  splatRoot.name = 'gaussian-splat-root-at-origin';
  splatRoot.position.set(0, 0, 0);
  splatRoot.scale.setScalar(SPLAT_BASE_SCALE * 0.72);
  splatRoot.rotation.set(0, 0, Math.PI);
  scene.add(splatRoot);

  try {
    activeSplatSource = await resolveSplatSource();
    if (disposed) return;

    splatMesh = new SplatMesh({
      ...activeSplatSource,
      lod: true,
      enableLod: true,
      lodScale: 2.15,
      maxSplats: 440000,
      editable: false,
      raycastable: false,
      onLoad: () => {
        if (disposed) return;
        splatRevealStart = clock.elapsedTime;
        splatRevealComplete = false;
        sceneReadyEmitted = false;
        if (overlayRoot) overlayRoot.visible = false;
        if (particleSystem) particleSystem.visible = false;
        if (splatMesh) splatMesh.opacity = 0;
        splatLoading.value = true;
        emitLoadingState(0.93, 'Shaping the reveal…');
      },
      onError: setSplatLoadError,
      onProgress: () => null
    });
    splatMesh.position.set(0, 0, 0);
    splatMesh.quaternion.set(0, 0, 0, 1);
    splatRoot.add(splatMesh);
    cleanup.push(() => splatMesh?.dispose?.());
  } catch (error) {
    setSplatLoadError(error);
  }
}

function createScene() {
  scene = new Scene();
  scene.background = new Color(SKY_COLOR);

  camera = new PerspectiveCamera(fov, 1, 0.015, 220);
  camera.position.copy(CAMERA_HOME);

  scene.add(new HemisphereLight('#fff6dd', '#7d6135', 1.1));
  scene.add(new AmbientLight('#fff0d2', 0.92));

  createParticlePoints();
  void createSplatScene();
  createFlyingActors();

  sparkRenderer = new SparkRenderer({
    renderer,
    clock,
    maxPixelRadius: 190,
    minPixelRadius: 0.28,
    minAlpha: 0.5 / 255,
    clipXY: 1.12,
    onDirty: () => null
  });
  scene.add(sparkRenderer);
  updateSplatVisibility();
}

function updateSplatVisibility() {
  const visibleContent = Boolean(props.splatEnabled && sceneReadyEmitted);
  if (splatRoot) splatRoot.visible = props.splatEnabled;
  if (overlayRoot) overlayRoot.visible = visibleContent;
  if (particleSystem) particleSystem.visible = visibleContent;
  splatLoading.value = Boolean(props.splatEnabled && !splatError.value && (!splatMesh || !splatMesh.isInitialized || !sceneReadyEmitted));
}

function updateResponsive() {
  if (!mount.value || !renderer || !camera) return;
  const rect = mount.value.getBoundingClientRect();
  viewWidth = Math.max(320, rect.width || window.innerWidth);
  viewHeight = Math.max(320, rect.height || window.innerHeight);
  const aspect = viewWidth / Math.max(viewHeight, 1);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, aspect < 0.7 ? 0.85 : 1.0));
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
  const p = ((progress % 1) + 1) % 1;
  const phase = p * Math.PI * 2;
  CAMERA_PATH_CURVE.getPointAt(p, cameraPathPosition);

  const depthProgress = MathUtils.clamp((cameraPathPosition.z - CAMERA_NEAR_Z) / (CAMERA_FAR_Z - CAMERA_NEAR_Z), 0, 1);
  const neutralIntro = 1 - MathUtils.smoothstep(p, 0.008, 0.035);
  const antViewRise = MathUtils.smoothstep(p, 0.045, 0.11) * (1 - MathUtils.smoothstep(p, 0.36, 0.52));
  const lowSweep = MathUtils.smoothstep(p, 0.12, 0.22) * (1 - MathUtils.smoothstep(p, 0.42, 0.58));
  const highReveal = MathUtils.smoothstep(p, 0.5, 0.64) * (1 - MathUtils.smoothstep(p, 0.76, 0.9));
  const retreatFeather = MathUtils.smoothstep(p, 0.64, 0.77) * (1 - MathUtils.smoothstep(p, 0.88, 0.98));
  const returnAntView = MathUtils.smoothstep(p, 0.83, 0.92) * (1 - MathUtils.smoothstep(p, 0.965, 0.995));
  const sweepGuard = MathUtils.smoothstep(p, 0.075, 0.18);
  const returnGuard = 1 - MathUtils.smoothstep(p, 0.955, 0.995);
  const retreatCalm = 1 - retreatFeather * 0.42;
  const sideLook = -cameraPathPosition.x * 0.17 * retreatCalm;
  const deliberateSweep = Math.sin(phase - 0.48) * 0.066 * Math.sin(p * Math.PI) * sweepGuard * returnGuard * retreatCalm;
  const antCounterLook = (antViewRise + lowSweep * 0.5) * -0.018;
  const topCounterLook = highReveal * 0.021 - retreatFeather * 0.01;

  cameraPathYaw = MathUtils.clamp(
    (sideLook + deliberateSweep + antCounterLook + topCounterLook) * (1 - neutralIntro),
    -0.34,
    0.34
  );
  cameraPathPitch = MathUtils.clamp(
    MathUtils.lerp(0.004, 0.095, depthProgress)
      + antViewRise * 0.104
      + lowSweep * 0.044
      + highReveal * 0.028
      + retreatFeather * 0.018
      + returnAntView * 0.03
      + Math.sin(phase * 0.8 + 0.28) * 0.0055 * sweepGuard * returnGuard * retreatCalm,
    -0.014,
    0.18
  );
  cameraPathFovOffset = MathUtils.lerp(0.42, -1.08, depthProgress)
    - antViewRise * 0.38
    - lowSweep * 0.18
    + highReveal * 0.14
    + retreatFeather * 0.06;
}

function fixedViewDirection(baseYaw = fixedYaw, basePitch = fixedPitch) {
  const yaw = baseYaw + manualYawOffset;
  const pitch = MathUtils.clamp(basePitch + manualPitchOffset, -0.18, 0.16);
  const safeYaw = MathUtils.clamp(yaw, -0.46, 0.46);
  return cameraDirection.set(
    Math.sin(safeYaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(safeYaw) * Math.cos(pitch)
  ).normalize();
}

function updateCamera(delta, elapsed) {
  const loopTime = elapsed % SCENE_LOOP_SECONDS;
  const loopProgress = props.slowDriftEnabled ? loopTime / SCENE_LOOP_SECONDS : 0;
  sampleGaussianCameraTrajectory(loopProgress);

  fov = MathUtils.lerp(fov, targetFov + cameraPathFovOffset, 0.07);
  camera.fov = fov;
  camera.updateProjectionMatrix();

  const sideSway = props.slowDriftEnabled ? Math.sin(loopProgress * Math.PI * 2) * 0.0008 : 0;
  const verticalBreath = props.slowDriftEnabled ? Math.sin(loopProgress * Math.PI * 4) * 0.002 : 0;

  camera.position.copy(cameraPathPosition)
    .addScaledVector(CAMERA_SIDE, sideSway);
  camera.position.y += verticalBreath;
  const direction = fixedViewDirection(cameraPathYaw, cameraPathPitch);
  cameraLookTarget.copy(camera.position).add(direction);
  camera.lookAt(cameraLookTarget);


  if (particleSystem) {
    particleSystem.position.x = camera.position.x * 0.45;
    particleSystem.position.y = camera.position.y * 0.28;
    particleSystem.position.z = camera.position.z * 0.62;
    particleSystem.rotation.y = Math.sin(loopProgress * Math.PI * 2) * 0.018;
  }


  updateSplatReveal(elapsed);
  if (sceneReadyEmitted) updateFlyingActors(loopTime);
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
  manualYawOffset = MathUtils.clamp(yawStart - dx * 0.0012, -0.09, 0.09);
  manualPitchOffset = MathUtils.clamp(pitchStart + dy * 0.0011, -0.08, 0.08);
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
  renderer.setClearColor(0xfbe2a4, 1);
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
  window.addEventListener('unhandledrejection', handleUnhandledSplatRejection);
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
  window.removeEventListener('unhandledrejection', handleUnhandledSplatRejection);
  butterflyActors.length = 0;
  beeActors.length = 0;
  cleanup.splice(0).forEach((fn) => fn());
  disposeTree(scene);
  sparkRenderer?.dispose?.();
  renderer?.dispose();
});
</script>
