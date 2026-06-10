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

const BUILD_STAMP = '20260610-060000';
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
const CAMERA_FORWARD = new Vector3(0.0, 0.0, 1.0);
const CAMERA_SIDE = new Vector3(1.0, 0.0, 0.0);
const clock = new Clock();
const loader = new TextureLoader();
const cleanup = [];
const uniforms = [];
const flyingActors = [];

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
  const geometry = registerDisposable(new SphereGeometry(80, 96, 48));
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


function createGroundUnderlay() {
  const geometry = registerDisposable(new PlaneGeometry(24, 24, 1, 1));
  const material = registerDisposable(new MeshBasicMaterial({
    color: '#ffffff',
    transparent: false,
    depthWrite: true,
    depthTest: true
  }));

  groundUnderlay = new Mesh(geometry, material);
  groundUnderlay.name = 'gaussian-surface-hole-underlay';
  groundUnderlay.rotation.x = -Math.PI / 2;
  groundUnderlay.position.set(0, -0.62, 4.2);
  groundUnderlay.renderOrder = -10;
  scene.add(groundUnderlay);

  const texture = registerTexture(loader.load(GROUND_UNDERLAY_URL, (loaded) => {
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
  phase = Math.random() * Math.PI * 2
}) {
  const material = registerDisposable(new SpriteMaterial({
    color: '#ffffff',
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
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
  sprite.renderOrder = 40;
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
    rotation
  });
}

function createFlyingActors() {
  overlayRoot = new Group();
  overlayRoot.name = 'splat-overlays';
  scene.add(overlayRoot);


  const bees = [
    { textureUrl: beeRightUrl, position: [-1.14, 0.22, 2.48], scale: [0.17, 0.185], center: [0.5, 0.42], bob: 0.032, sway: 0.11, depth: 0.09, speed: 0.31, flutter: 0.08, phase: 0.4 },
    { textureUrl: beeLeftUrl, position: [0.96, 0.16, 2.86], scale: [0.16, 0.176], center: [0.5, 0.42], bob: 0.028, sway: 0.08, depth: 0.07, speed: 0.26, flutter: 0.07, phase: 1.9 },
    { textureUrl: beeRightUrl, position: [-0.22, 0.31, 3.28], scale: [0.155, 0.17], center: [0.5, 0.42], bob: 0.038, sway: 0.09, depth: 0.08, speed: 0.28, flutter: 0.075, phase: 3.6 },
    { textureUrl: beeLeftUrl, position: [1.18, 0.24, 3.62], scale: [0.145, 0.16], center: [0.5, 0.42], bob: 0.025, sway: 0.07, depth: 0.06, speed: 0.24, flutter: 0.065, phase: 4.7 }
  ];

  const butterflies = [
    { textureUrl: butterflyTealUrl, position: [-1.38, 0.16, 2.18], scale: [0.28, 0.158], center: [0.5, 0.44], bob: 0.046, sway: 0.065, depth: 0.035, speed: 0.18, flutter: 0.16, rotation: -0.08, phase: 2.2 },
    { textureUrl: butterflyGoldUrl, position: [0.24, 0.27, 2.56], scale: [0.25, 0.172], center: [0.5, 0.45], bob: 0.04, sway: 0.058, depth: 0.04, speed: 0.17, flutter: 0.13, rotation: 0.04, phase: 0.95 },
    { textureUrl: butterflyYellowUrl, position: [1.28, 0.21, 3.18], scale: [0.24, 0.228], center: [0.5, 0.45], bob: 0.034, sway: 0.05, depth: 0.03, speed: 0.16, flutter: 0.14, rotation: 0.07, phase: 5.1 }
  ];

  [...bees, ...butterflies].forEach(createFlyingSpriteActor);
}

function updateFlyingActors(elapsed) {
  if (!flyingActors.length) return;

  flyingActors.forEach((actor) => {
    const t = elapsed * actor.speed + actor.phase;
    const driftX = Math.sin(t * 1.6) * actor.sway;
    const driftY = Math.sin(t * 2.1) * actor.bob + Math.cos(t * 0.9) * actor.bob * 0.35;
    const driftZ = Math.cos(t * 1.25) * actor.depth;
    const flutter = 1 + Math.sin(t * 9.0) * actor.flutter;
    const squeeze = 1 + Math.cos(t * 7.0) * actor.flutter * 0.22;

    actor.sprite.position.set(
      actor.basePosition.x + driftX,
      actor.basePosition.y + driftY,
      actor.basePosition.z + driftZ
    );
    actor.sprite.scale.set(actor.baseScale.x * flutter, actor.baseScale.y * squeeze, 1);
    actor.sprite.material.opacity = actor.opacity * (0.9 + Math.sin(t * 1.7) * 0.08);
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

function fixedViewDirection() {
  const yaw = fixedYaw + manualYawOffset;
  const pitch = MathUtils.clamp(fixedPitch + manualPitchOffset, -0.38, 0.25);
  return new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch)
  ).normalize();
}

function updateCamera(delta, elapsed) {
  fov = MathUtils.lerp(fov, targetFov, 0.07);
  camera.fov = fov;
  camera.updateProjectionMatrix();

  const travelCycle = props.slowDriftEnabled ? elapsed * 0.010 : 0;
  const pingPong = 0.5 - Math.cos(travelCycle * Math.PI * 2) * 0.5;
  const depth = MathUtils.lerp(0.0, 0.58, pingPong);
  const sideSway = props.slowDriftEnabled ? Math.sin(elapsed * 0.018) * 0.012 : 0;
  const verticalBreath = props.slowDriftEnabled ? Math.sin(elapsed * 0.016) * 0.006 : 0;

  camera.position.copy(CAMERA_HOME)
    .addScaledVector(CAMERA_FORWARD, depth)
    .addScaledVector(CAMERA_SIDE, sideSway);
  camera.position.y += verticalBreath;
  const direction = fixedViewDirection();
  camera.lookAt(camera.position.clone().add(direction));

  if (skybox) skybox.position.copy(camera.position);

  if (particleSystem) {
    particleSystem.position.x = camera.position.x * 0.45;
    particleSystem.position.y = camera.position.y * 0.28;
    particleSystem.position.z = camera.position.z * 0.62;
    particleSystem.rotation.y = Math.sin(elapsed * 0.055) * 0.018;
  }

  if (groundUnderlay) {
    groundUnderlay.position.x = camera.position.x * 0.08;
    groundUnderlay.position.z = 4.2 + camera.position.z * 0.02;
  }

  updateFlyingActors(elapsed);
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
