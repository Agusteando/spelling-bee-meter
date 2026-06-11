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
  CapsuleGeometry,
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
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer
} from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

import beeRightUrl from '../assets/spelling/bee_right.png';
import beeLeftUrl from '../assets/spelling/bee_left.png';
import butterflyWingUrl from '../assets/spelling/butterfly_wing.png';

const props = defineProps({
  slowDriftEnabled: {
    type: Boolean,
    default: true
  },
  splatEnabled: {
    type: Boolean,
    default: true
  },
  meterRolling: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['scene-ready', 'scene-loading']);

const BUILD_STAMP = '20260611-134500';
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
let beePlaneGeometry;
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
let splatRevealStarted = false;
let sceneReadyEmitted = false;
let activeSplatSource = { url: SPLAT_URL };
let spzModulePromise = null;
let lastLoadingProgress = -1;
let lastLoadingLabel = '';

const fixedYaw = 0;
const fixedPitch = -0.012;
const CAMERA_HOME = new Vector3(0.0, -0.045, 1.82);
const CAMERA_SIDE = new Vector3(1.0, 0.0, 0.0);
const SCENE_LOOP_SECONDS = 101.4;
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
const beeFollowVector = new Vector3();
const butterflyVelocity = new Vector3();
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

function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function lerpAngle(from, to, alpha) {
  return from + shortestAngleDelta(from, to) * alpha;
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
  { top: '#ff91cf', bottom: '#ffe6b5', accent: '#9cf3dc' },
  { top: '#78d4ff', bottom: '#f5f9ff', accent: '#b2faff' },
  { top: '#9f8dff', bottom: '#f2e7ff', accent: '#fff2b0' },
  { top: '#ffab7e', bottom: '#fff0d3', accent: '#ffe6a4' },
  { top: '#8add91', bottom: '#efffe1', accent: '#d1ffe9' },
  { top: '#ff8ad1', bottom: '#fff4f8', accent: '#f8d7ff' }
];

const butterflyWingMaterialSets = new Map();
let butterflyWingTexture;
let butterflyWingGeometry;
let butterflyAbdomenGeometry;
let butterflyThoraxGeometry;
let butterflyHeadGeometry;
let butterflyAbdomenMaterial;
let butterflyThoraxMaterial;
let butterflyHeadMaterial;

function createIndexedGeometry(points, indices, uvs = null) {
  const geometry = registerDisposable(new BufferGeometry());
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  if (uvs) geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createButterflyWingGeometry() {
  const geometry = registerDisposable(new PlaneGeometry(0.42, 0.76, 1, 1));
  geometry.translate(-0.175, 0.08, 0);
  return geometry;
}

function ensureButterflyGeometry() {
  butterflyWingGeometry ??= createButterflyWingGeometry();
  butterflyAbdomenGeometry ??= registerDisposable(new CapsuleGeometry(0.017, 0.165, 5, 8));
  butterflyThoraxGeometry ??= registerDisposable(new SphereGeometry(0.029, 10, 8));
  butterflyHeadGeometry ??= registerDisposable(new SphereGeometry(0.021, 10, 8));

  butterflyAbdomenMaterial ??= registerDisposable(new MeshBasicMaterial({
    color: '#5a3b1f',
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    depthTest: true
  }));
  butterflyThoraxMaterial ??= registerDisposable(new MeshBasicMaterial({
    color: '#6b4828',
    transparent: true,
    opacity: 0.99,
    depthWrite: false,
    depthTest: true
  }));
  butterflyHeadMaterial ??= registerDisposable(new MeshBasicMaterial({
    color: '#3d2b19',
    transparent: true,
    opacity: 0.99,
    depthWrite: false,
    depthTest: true
  }));
}

function getButterflyWingTexture() {
  if (butterflyWingTexture) return butterflyWingTexture;
  butterflyWingTexture = registerTexture(loader.load(butterflyWingUrl));
  configureTexture(butterflyWingTexture);
  butterflyWingTexture.needsUpdate = true;
  return butterflyWingTexture;
}

function getButterflyWingMaterials(paletteIndex) {
  if (butterflyWingMaterialSets.has(paletteIndex)) return butterflyWingMaterialSets.get(paletteIndex);

  const palette = BUTTERFLY_PALETTE[paletteIndex % BUTTERFLY_PALETTE.length];
  const texture = getButterflyWingTexture();

  const baseMaterial = registerDisposable(new MeshBasicMaterial({
    map: texture,
    color: '#ffffff',
    side: DoubleSide,
    transparent: true,
    opacity: 0.84,
    depthWrite: false,
    depthTest: true,
    alphaTest: 0.03
  }));

  const overlayMaterial = registerDisposable(new MeshBasicMaterial({
    map: texture,
    color: palette.top,
    side: DoubleSide,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    depthTest: true,
    alphaTest: 0.03
  }));

  const glowMaterial = registerDisposable(new MeshBasicMaterial({
    map: texture,
    color: palette.bottom,
    side: DoubleSide,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    depthTest: true,
    alphaTest: 0.03,
    blending: AdditiveBlending
  }));

  const sparkleMaterial = registerDisposable(new MeshBasicMaterial({
    map: texture,
    color: palette.accent,
    side: DoubleSide,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    depthTest: true,
    alphaTest: 0.06,
    blending: AdditiveBlending
  }));

  const materials = { baseMaterial, overlayMaterial, glowMaterial, sparkleMaterial };
  butterflyWingMaterialSets.set(paletteIndex, materials);
  return materials;
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

function createButterflyActor({
  route,
  scale = 0.1,
  paletteIndex = 0,
  phase = 0,
  loopDuration = 34,
  flutter = 1,
  drift = 0.018,
  lift = 0.018,
  roll = 0
}) {
  ensureButterflyGeometry();

  const routePoints = route.map(([x, y, z]) => new Vector3(x, y, z));
  const curve = new CatmullRomCurve3(routePoints, true, 'catmullrom', 0.36);
  const root = new Group();
  const initialPosition = curve.getPointAt(phase % 1, new Vector3());
  root.position.copy(initialPosition);
  root.renderOrder = 42;
  overlayRoot.add(root);

  const leftPivot = new Group();
  const rightPivot = new Group();
  leftPivot.position.set(-0.008, 0.018, 0.01);
  rightPivot.position.set(0.008, 0.018, -0.01);
  root.add(leftPivot, rightPivot);

  const { baseMaterial, overlayMaterial, glowMaterial, sparkleMaterial } = getButterflyWingMaterials(paletteIndex);
  const leftWing = new Mesh(butterflyWingGeometry, baseMaterial);
  const rightWing = new Mesh(butterflyWingGeometry, baseMaterial);
  const leftWingOverlay = new Mesh(butterflyWingGeometry, overlayMaterial);
  const rightWingOverlay = new Mesh(butterflyWingGeometry, overlayMaterial);
  const leftWingGlow = new Mesh(butterflyWingGeometry, glowMaterial);
  const rightWingGlow = new Mesh(butterflyWingGeometry, glowMaterial);
  const leftWingSparkle = new Mesh(butterflyWingGeometry, sparkleMaterial);
  const rightWingSparkle = new Mesh(butterflyWingGeometry, sparkleMaterial);

  rightWing.scale.x = -1;
  rightWingOverlay.scale.x = -1;
  rightWingGlow.scale.x = -1;
  rightWingSparkle.scale.x = -1;

  leftWing.position.z = 0.001;
  rightWing.position.z = -0.001;
  leftWingOverlay.position.z = 0.0022;
  rightWingOverlay.position.z = -0.0022;
  leftWingGlow.position.z = 0.0028;
  rightWingGlow.position.z = -0.0028;
  leftWingSparkle.position.z = 0.0034;
  rightWingSparkle.position.z = -0.0034;

  leftWingOverlay.scale.multiplyScalar(1.012);
  rightWingOverlay.scale.multiplyScalar(1.012);
  leftWingGlow.scale.multiplyScalar(1.02);
  rightWingGlow.scale.multiplyScalar(1.02);
  leftWingSparkle.scale.multiplyScalar(1.028);
  rightWingSparkle.scale.multiplyScalar(1.028);

  leftWing.renderOrder = 42;
  rightWing.renderOrder = 42;
  leftWingOverlay.renderOrder = 43;
  rightWingOverlay.renderOrder = 43;
  leftWingGlow.renderOrder = 44;
  rightWingGlow.renderOrder = 44;
  leftWingSparkle.renderOrder = 45;
  rightWingSparkle.renderOrder = 45;

  leftPivot.add(leftWing, leftWingOverlay, leftWingGlow, leftWingSparkle);
  rightPivot.add(rightWing, rightWingOverlay, rightWingGlow, rightWingSparkle);

  const bodyGroup = new Group();
  const abdomen = new Mesh(butterflyAbdomenGeometry, butterflyAbdomenMaterial);
  const thorax = new Mesh(butterflyThoraxGeometry, butterflyThoraxMaterial);
  const head = new Mesh(butterflyHeadGeometry, butterflyHeadMaterial);

  abdomen.position.set(0, -0.05, 0.014);
  abdomen.scale.set(0.82, 1.08, 0.58);
  thorax.position.set(0, 0.045, 0.018);
  thorax.scale.set(0.9, 1.05, 0.68);
  head.position.set(0, 0.107, 0.021);
  head.scale.set(0.88, 1.0, 0.7);

  abdomen.renderOrder = 44;
  thorax.renderOrder = 45;
  head.renderOrder = 45;
  bodyGroup.add(abdomen, thorax, head);
  root.add(bodyGroup);
  root.scale.setScalar(scale);

  butterflyActors.push({
    root,
    leftPivot,
    rightPivot,
    bodyGroup,
    abdomen,
    thorax,
    head,
    curve,
    phase,
    loopDuration,
    flutter,
    drift,
    lift,
    roll,
    bank: 0,
    pitch: 0,
    yaw: 0,
    faceYaw: 0,
    flapMemory: 0,
    samplePosition: initialPosition.clone(),
    lastPosition: initialPosition.clone()
  });
}

function loadBeeTexture(url) {
  const texture = registerTexture(loader.load(url, (loaded) => configureTexture(loaded)));
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function ensureBeeGeometry() {
  if (beePlaneGeometry) return beePlaneGeometry;
  beePlaneGeometry = registerDisposable(new PlaneGeometry(1, 1.18, 1, 1));
  const uv = beePlaneGeometry.attributes.uv;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setY(index, 1 - uv.getY(index));
  }
  uv.needsUpdate = true;
  beePlaneGeometry.translate(0, 0.08, 0);
  return beePlaneGeometry;
}

function createBeeActor({ route, phase = 0, scale = 0.05, speed = 1, collectRadius = 0.072, travelLift = 0.08, curve = 0.09, bob = 0.018 }) {
  const geometry = ensureBeeGeometry();
  const material = registerDisposable(new MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    depthTest: false,
    alphaTest: 0.02,
    side: DoubleSide,
    map: beeRightTexture
  }));
  const sprite = new Mesh(geometry, material);
  sprite.scale.set(scale, scale, 1);
  sprite.renderOrder = 46;
  overlayRoot.add(sprite);

  const startPatch = FLOWER_PATCHES[route[0]].clone();
  sprite.position.copy(startPatch);

  beeActors.push({
    route,
    phase,
    sprite,
    material,
    baseScale: { x: scale, y: scale },
    speed: speed * 0.48,
    collectRadius,
    travelLift,
    curve,
    bob,
    directionSign: 1,
    lastPosition: startPatch.clone(),
    samplePosition: startPatch.clone(),
    targetPosition: startPatch.clone(),
    smoothedVelocity: new Vector3(),
    directionScore: 1,
    lastDirectionX: 1,
    directionCooldownUntil: 0,
    bank: 0,
    tilt: 0,
    visualRotation: 0,
    hoverEnergy: 1,
    dartEnergy: 0.12
  });
}


function createFlyingActors() {
  overlayRoot = new Group();
  overlayRoot.name = 'splat-overlays';
  overlayRoot.visible = false;
  scene.add(overlayRoot);

  beeRightTexture = loadBeeTexture(beeRightUrl);
  beeLeftTexture = loadBeeTexture(beeLeftUrl);

  const butterflyRoutes = [
    [[-1.7, -0.58, 2.15], [-1.2, -0.42, 2.9], [-0.58, -0.54, 3.65], [-0.96, -0.62, 2.55]],
    [[-1.1, -0.5, 2.82], [-0.35, -0.3, 4.05], [0.18, -0.46, 5.25], [-0.7, -0.57, 3.2]],
    [[-0.58, -0.54, 3.48], [0.2, -0.38, 4.36], [0.78, -0.18, 5.86], [-0.14, -0.5, 4.4]],
    [[0.08, -0.5, 4.2], [0.78, -0.28, 5.3], [1.08, 0.02, 6.75], [0.26, -0.44, 5.2]],
    [[0.58, -0.48, 5.02], [1.2, -0.12, 6.38], [0.62, 0.16, 7.55], [0.18, -0.36, 5.96]],
    [[1.02, -0.42, 5.72], [0.5, -0.08, 6.86], [-0.12, 0.12, 7.88], [0.7, -0.36, 6.44]],
    [[0.7, -0.42, 6.38], [-0.04, -0.06, 7.15], [-0.7, 0.12, 8.18], [0.16, -0.38, 7.24]],
    [[0.1, -0.42, 7.12], [-0.58, -0.18, 7.78], [-0.18, 0.28, 8.9], [0.54, -0.22, 7.92]],
    [[-0.54, -0.43, 7.76], [-1.0, -0.08, 8.4], [-0.28, 0.28, 9.22], [0.18, -0.34, 8.22]],
    [[0.32, -0.36, 8.32], [0.9, -0.02, 8.94], [0.34, 0.34, 9.72], [-0.24, -0.2, 8.7]],
    [[0.92, -0.34, 8.92], [0.36, 0.16, 9.46], [-0.42, 0.38, 9.96], [0.12, -0.18, 9.08]],
    [[-0.18, -0.42, 5.96], [-0.76, -0.18, 6.68], [-0.1, 0.05, 7.54], [0.46, -0.34, 6.72]]
  ];

  butterflyRoutes.forEach((route, index) => {
    createButterflyActor({
      route,
      scale: 0.061 + (index % 3) * 0.005,
      paletteIndex: index % BUTTERFLY_PALETTE.length,
      phase: (index * 0.083) % 1,
      loopDuration: 24 + (index % 5) * 4.5,
      flutter: 0.88 + (index % 4) * 0.12,
      drift: 0.012 + (index % 4) * 0.004,
      lift: 0.012 + (index % 3) * 0.005,
      roll: (index % 2 === 0 ? 1 : -1) * 0.026
    });
  });

  const beeConfigs = [
    { route: [0, 1], phase: 0.04, scale: 0.034, speed: 0.64, collectRadius: 0.038, travelLift: 0.038, curve: 0.038, bob: 0.012 },
    { route: [2, 3], phase: 0.19, scale: 0.033, speed: 0.58, collectRadius: 0.036, travelLift: 0.036, curve: -0.034, bob: 0.011 },
    { route: [5, 6], phase: 0.36, scale: 0.035, speed: 0.61, collectRadius: 0.039, travelLift: 0.04, curve: 0.036, bob: 0.012 },
    { route: [7, 8], phase: 0.53, scale: 0.032, speed: 0.56, collectRadius: 0.035, travelLift: 0.034, curve: -0.032, bob: 0.011 },
    { route: [9, 10], phase: 0.7, scale: 0.033, speed: 0.59, collectRadius: 0.035, travelLift: 0.035, curve: 0.03, bob: 0.01 },
    { route: [10, 11], phase: 0.86, scale: 0.032, speed: 0.55, collectRadius: 0.034, travelLift: 0.032, curve: -0.03, bob: 0.01 }
  ];

  beeConfigs.forEach(createBeeActor);
}

function updateButterflies(loopTime) {
  if (!butterflyActors.length || !camera) return;

  const cameraRightX = camera.matrixWorld.elements[0] ?? 1;
  const cameraRightY = camera.matrixWorld.elements[1] ?? 0;
  const cameraRightZ = camera.matrixWorld.elements[2] ?? 0;
  const cameraUpX = camera.matrixWorld.elements[4] ?? 0;
  const cameraUpY = camera.matrixWorld.elements[5] ?? 1;
  const cameraUpZ = camera.matrixWorld.elements[6] ?? 0;

  butterflyActors.forEach((actor, index) => {
    const cycle = (((loopTime / actor.loopDuration) + actor.phase) % 1 + 1) % 1;
    actor.curve.getPointAt(cycle, actor.samplePosition);

    const organic = Math.sin(loopTime * (0.72 + index * 0.015) + actor.phase * Math.PI * 6);
    const burst = MathUtils.smoothstep((organic + 1) * 0.5, 0.34, 0.92);
    const micro = Math.sin(loopTime * (1.9 + index * 0.045) + actor.phase * Math.PI * 11);

    actor.samplePosition.x += Math.sin(loopTime * 0.86 + actor.phase * 8.0) * actor.drift;
    actor.samplePosition.y += Math.sin(loopTime * 1.18 + actor.phase * 6.0) * actor.lift + burst * actor.lift * 0.55;
    actor.samplePosition.z += Math.cos(loopTime * 0.68 + actor.phase * 7.4) * actor.drift * 1.45;

    butterflyVelocity.subVectors(actor.samplePosition, actor.lastPosition);

    const screenVelocityX = (butterflyVelocity.x * cameraRightX)
      + (butterflyVelocity.y * cameraRightY)
      + (butterflyVelocity.z * cameraRightZ);
    const screenVelocityY = (butterflyVelocity.x * cameraUpX)
      + (butterflyVelocity.y * cameraUpY)
      + (butterflyVelocity.z * cameraUpZ);

    const horizontalSpeed = Math.hypot(butterflyVelocity.x, butterflyVelocity.z);
    const travelYaw = horizontalSpeed > 0.00002
      ? Math.atan2(butterflyVelocity.x, butterflyVelocity.z)
      : actor.yaw;
    const cameraYaw = Math.atan2(
      camera.position.x - actor.samplePosition.x,
      camera.position.z - actor.samplePosition.z
    );
    const cameraVisibilityBlend = 0.28 + burst * 0.08;
    const naturalSideSlip = Math.sin(loopTime * 0.64 + actor.phase * 9.0) * 0.22;
    const targetWorldYaw = lerpAngle(travelYaw + naturalSideSlip, cameraYaw, cameraVisibilityBlend);
    const climbPitch = horizontalSpeed > 0.00002
      ? Math.atan2(butterflyVelocity.y, horizontalSpeed) * 0.72
      : 0;
    const targetBank = MathUtils.clamp(-screenVelocityX * 24, -0.58, 0.58);
    const targetPitch = MathUtils.clamp(climbPitch + screenVelocityY * 5.5, -0.36, 0.42);

    actor.bank = MathUtils.lerp(actor.bank, targetBank, 0.085);
    actor.pitch = MathUtils.lerp(actor.pitch, targetPitch, 0.075);
    actor.yaw = lerpAngle(actor.yaw, targetWorldYaw, 0.08);

    actor.root.position.copy(actor.samplePosition);
    actor.root.rotation.set(
      actor.pitch + Math.sin(loopTime * 0.8 + actor.phase * 4) * 0.025,
      actor.yaw,
      actor.roll + actor.bank + micro * 0.05
    );

    const flapRate = actor.flutter * (8.2 + burst * 5.2 + Math.sin(loopTime * 0.55 + actor.phase * 9) * 0.7);
    const flapWave = (Math.sin(loopTime * flapRate + actor.phase * Math.PI * 9) + 1) * 0.5;
    const flap = 0.24 + Math.pow(flapWave, 1.45) * (0.52 + burst * 0.26);
    const wingTwist = Math.sin(loopTime * (flapRate * 0.47) + actor.phase * 5.0) * (0.07 + burst * 0.045);

    actor.leftPivot.rotation.y = flap;
    actor.rightPivot.rotation.y = -flap;
    actor.leftPivot.rotation.x = wingTwist;
    actor.rightPivot.rotation.x = -wingTwist;
    actor.leftPivot.rotation.z = 0.095 + burst * 0.035;
    actor.rightPivot.rotation.z = -0.095 - burst * 0.035;

    actor.bodyGroup.rotation.z = Math.sin(loopTime * 1.25 + actor.phase * 8) * 0.045 + actor.bank * 0.16;
    actor.bodyGroup.rotation.x = -0.045 + actor.pitch * 0.28;
    const bodyPulse = 1 + Math.sin(loopTime * flapRate * 0.5 + actor.phase * Math.PI) * 0.035;
    actor.abdomen.scale.set(0.82 * (1 - burst * 0.04), 1.08 * bodyPulse, 0.58);
    actor.thorax.scale.set(0.9 * (1 + burst * 0.035), 1.05, 0.68);
    actor.head.position.y = 0.107 + Math.sin(loopTime * 1.6 + actor.phase * 6) * 0.0025;

    actor.lastPosition.copy(actor.samplePosition);
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

  const calmFactor = props.meterRolling ? 0.28 : 1;
  const collectPortion = props.meterRolling ? 0.86 : 0.68;
  const transitEnd = props.meterRolling ? 0.94 : 0.86;
  const driftPhase = actor.phase * Math.PI * 8;

  if (local < collectPortion) {
    const u = local / collectPortion;
    const hoverEase = 1 - Math.abs(0.5 - u) * 2;
    const angle = (u * Math.PI * 1.75) + driftPhase;
    const radiusPulse = 0.82 + Math.sin(u * Math.PI * 3 + driftPhase) * 0.08;
    actor.hoverEnergy = 0.84 + hoverEase * 0.16;
    actor.dartEnergy = 0.05 * calmFactor;

    target.copy(from);
    target.x += Math.cos(angle) * actor.collectRadius * radiusPulse * calmFactor;
    target.z += Math.sin(angle * 1.04) * actor.collectRadius * 0.45 * radiusPulse * calmFactor;
    target.y += Math.sin(angle * 1.8) * actor.bob * 0.36 * calmFactor;
    return target;
  }

  if (local < transitEnd) {
    const u = (local - collectPortion) / (transitEnd - collectPortion);
    const eased = 0.5 - Math.cos(u * Math.PI) * 0.5;
    const dart = Math.sin(u * Math.PI);
    const microWeave = Math.sin((u * Math.PI * 2.2) + driftPhase) * (1 - Math.abs(0.5 - u));
    actor.hoverEnergy = Math.max(0.32, 1 - dart * 0.78);
    actor.dartEnergy = (0.12 + dart * 0.32) * calmFactor;

    target.copy(from).lerp(to, eased);
    target.x += (Math.sin(u * Math.PI) * actor.curve + microWeave * 0.01) * normalX * calmFactor;
    target.z += (Math.sin(u * Math.PI) * actor.curve + microWeave * 0.01) * normalZ * calmFactor;
    target.y += Math.sin(u * Math.PI) * actor.travelLift * 0.42 * calmFactor;
    return target;
  }

  const u = (local - transitEnd) / (1 - transitEnd);
  const angle = (u * Math.PI * 1.55) + driftPhase + Math.PI * 0.4;
  const settle = MathUtils.smoothstep(u, 0, 1);
  actor.hoverEnergy = 0.76 + settle * 0.18;
  actor.dartEnergy = 0.07 * calmFactor;

  target.copy(to);
  target.x += Math.cos(angle) * actor.collectRadius * 0.38 * calmFactor;
  target.z += Math.sin(angle * 1.08) * actor.collectRadius * 0.28 * calmFactor;
  target.y += Math.cos(angle * 1.8) * actor.bob * 0.24 * calmFactor;
  return target;
}

function updateBees(loopTime) {
  if (!beeActors.length) return;
  const loopProgress = loopTime / SCENE_LOOP_SECONDS;
  const cameraRightX = camera?.matrixWorld?.elements?.[0] ?? 1;
  const cameraRightY = camera?.matrixWorld?.elements?.[1] ?? 0;
  const cameraRightZ = camera?.matrixWorld?.elements?.[2] ?? 0;
  const cameraUpX = camera?.matrixWorld?.elements?.[4] ?? 0;
  const cameraUpY = camera?.matrixWorld?.elements?.[5] ?? 1;
  const cameraUpZ = camera?.matrixWorld?.elements?.[6] ?? 0;

  beeActors.forEach((actor) => {
    const target = sampleBeeSegment(actor, loopProgress, actor.targetPosition);
    const sceneCalm = props.meterRolling ? 0.35 : 1;
    const followAlpha = (0.024 + actor.dartEnergy * 0.018) * sceneCalm;
    const previousPosition = actor.sprite.position.clone();

    beeFollowVector.subVectors(target, actor.sprite.position);
    actor.sprite.position.addScaledVector(beeFollowVector, followAlpha);

    const hoverBob = (0.0007 + actor.hoverEnergy * 0.0008) * sceneCalm;
    actor.sprite.position.y += Math.sin(loopTime * 4.1 + actor.phase * 13) * hoverBob;

    actor.smoothedVelocity.subVectors(actor.sprite.position, previousPosition);
    actor.smoothedVelocity.multiplyScalar(0.72).addScaledVector(
      beeFollowVector,
      0.28 * followAlpha
    );

    const screenVelocityX = (actor.smoothedVelocity.x * cameraRightX)
      + (actor.smoothedVelocity.y * cameraRightY)
      + (actor.smoothedVelocity.z * cameraRightZ);
    const screenVelocityY = (actor.smoothedVelocity.x * cameraUpX)
      + (actor.smoothedVelocity.y * cameraUpY)
      + (actor.smoothedVelocity.z * cameraUpZ);

    const flipThreshold = 0.00042;
    if (Math.abs(screenVelocityX) > flipThreshold) {
      const candidate = Math.sign(screenVelocityX);
      actor.directionScore = MathUtils.lerp(actor.directionScore, candidate, 0.09 + actor.dartEnergy * 0.035);
    } else {
      actor.directionScore = MathUtils.lerp(actor.directionScore, actor.lastDirectionX, 0.035);
    }

    const wantsDirection = actor.directionScore > 0.72 ? 1 : actor.directionScore < -0.72 ? -1 : actor.lastDirectionX;
    const mayFlip = loopTime > actor.directionCooldownUntil
      && wantsDirection !== actor.lastDirectionX
      && (actor.hoverEnergy > 0.42 || Math.abs(actor.directionScore) > 0.9);

    if (mayFlip) {
      actor.lastDirectionX = wantsDirection;
      actor.directionCooldownUntil = loopTime + 0.75 + actor.hoverEnergy * 0.32;
    }

    const nextDirectionSign = actor.lastDirectionX >= 0 ? 1 : -1;
    if (actor.directionSign !== nextDirectionSign) {
      actor.directionSign = nextDirectionSign;
      actor.bank = 0;
      actor.tilt = 0;
      actor.visualRotation = 0;
    }

    const wingTempo = 15.5 + actor.dartEnergy * 3.0;
    const wingPulse = 1 + Math.sin(loopTime * wingTempo + actor.phase * Math.PI * 4) * (0.045 + actor.dartEnergy * 0.018);
    const bodySqueeze = 1 + Math.cos(loopTime * (10.5 + actor.dartEnergy * 2.5) + actor.phase * Math.PI * 3) * 0.032;
    const hoverPulse = 1 + Math.sin(loopTime * 2.2 + actor.phase * 9) * actor.hoverEnergy * 0.018;
    const scaledX = actor.baseScale.x * wingPulse * hoverPulse;
    actor.sprite.scale.set(
      scaledX * actor.directionSign,
      actor.baseScale.y * bodySqueeze,
      1
    );

    actor.bank = 0;
    actor.tilt = 0;
    actor.visualRotation = 0;

    if (camera) {
      const facingYaw = Math.atan2(
        camera.position.x - actor.sprite.position.x,
        camera.position.z - actor.sprite.position.z
      );
      actor.sprite.rotation.set(0, facingYaw, 0);
    }

    const targetOpacity = props.meterRolling ? 0.38 : 0.68;
    actor.material.opacity = targetOpacity + Math.sin(loopTime * 2.4 + actor.phase * Math.PI * 3) * 0.018;
    actor.lastPosition.copy(actor.sprite.position);
    actor.samplePosition.copy(target);
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

function beginSplatReveal() {
  if (splatRevealStarted || !splatMesh) return;
  splatRevealStarted = true;
  splatRevealStart = clock.elapsedTime;
  splatRevealComplete = false;
  sceneReadyEmitted = false;

  if (overlayRoot) overlayRoot.visible = false;
  if (particleSystem) particleSystem.visible = false;
  splatMesh.opacity = 0;
  splatLoading.value = true;
  emitLoadingState(0.93, 'Shaping the reveal…');
}

function updateSplatReveal(elapsed) {
  if (!splatRoot || !splatMesh || splatRevealComplete) return;

  if (!splatRevealStarted) {
    if (!splatMesh.isInitialized) return;
    beginSplatReveal();
  }

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
    splatRevealStarted = false;
    splatRevealComplete = false;
    sceneReadyEmitted = false;
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
        beginSplatReveal();
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
  splatLoading.value = Boolean(props.splatEnabled && !splatError.value && (!splatMesh || !sceneReadyEmitted));
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
