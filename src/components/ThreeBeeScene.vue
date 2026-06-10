<template>
  <div ref="mount" class="bee-world" :class="{ 'is-dragging': dragging }" aria-label="Animated panorama spelling bee landscape">
    <div v-if="splatLoading" class="splat-loading">Loading optional Gaussian splat scene…</div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  Box3,
  BufferGeometry,
  Clock,
  Color,
  CanvasTexture,
  DirectionalLight,
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
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
  CylinderGeometry
} from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

import beeLeftUrl from '../assets/spelling/bee_left.png';
import beeRightUrl from '../assets/spelling/bee_right.png';
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
    default: false
  }
});

const BUILD_STAMP = '20260610-002500';
const PANORAMA_URL = `/panoramas/custom/spelling-hills-user-pano.svg?v=${BUILD_STAMP}`;
const SPLAT_URL = `/splats/ceramic_500k.spz?v=${BUILD_STAMP}`;
const DETAIL_FOCUS = new Vector3(-2.1509, 0.7566, 0.8363);
const DETAIL_ROBUST_SPAN = 102.1;
const PANORAMA = {
  radius: 46,
  opacity: 1,
  verticalOffset: -0.88,
  renderOrder: 1,
  aspect: 2
};

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
let panoramaRoot;
let particleSystem;
let beeRoot;
let butterflyRoot;
let rareBee;
let splatRoot;
let splatMesh;
let splatRequested = false;
let lastActivity = 0;
let nextRareBeeAt = 18;
let yaw = -0.02;
let pitch = -0.48;
let targetYaw = -0.02;
let targetPitch = -0.48;
let fov = 118;
let targetFov = 118;
let pointerDown = false;
let pointerId = null;
let pointerStartX = 0;
let pointerStartY = 0;
let yawStart = 0;
let pitchStart = 0;

const clock = new Clock();
const loader = new TextureLoader();
const cleanup = [];
const animated = [];
const uniforms = [];
const panoramaLayers = [];

function registerDisposable(item) {
  cleanup.push(() => item?.dispose?.());
  return item;
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

function loadTexture(url, onLoad, onError) {
  const texture = loader.load(url, (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 4, 8);
    loaded.minFilter = LinearFilter;
    loaded.magFilter = LinearFilter;
    loaded.needsUpdate = true;
    onLoad?.(loaded);
  }, undefined, onError);
  texture.colorSpace = SRGBColorSpace;
  cleanup.push(() => texture.dispose());
  return texture;
}

function getPanoramaTextureSize() {
  const maxTextureSize = renderer?.capabilities?.maxTextureSize || 4096;
  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  const viewportDrivenWidth = Math.ceil(Math.max(viewWidth || window.innerWidth || 1440, 1440) * deviceScale * 3);
  const width = Math.min(maxTextureSize, Math.max(4096, viewportDrivenWidth));
  return { width, height: Math.round(width / PANORAMA.aspect) };
}

async function applyPanoramaTexture(material) {
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = PANORAMA_URL;
    await image.decode();
    if (disposed) return;

    const { width, height } = getPanoramaTextureSize();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#feecc4';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 4, 8);
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    cleanup.push(() => texture.dispose());

    material.map = texture;
    material.needsUpdate = true;
  } catch (error) {
    console.warn('Could not load SVG panorama texture', error);
  }
}

function createPanorama() {
  panoramaRoot = new Group();
  panoramaRoot.name = 'panorama-root';
  scene.add(panoramaRoot);

  const height = (Math.PI * 2 * PANORAMA.radius) / PANORAMA.aspect;
  const geometry = registerDisposable(new CylinderGeometry(PANORAMA.radius, PANORAMA.radius, height, 256, 1, true));
  const material = registerDisposable(new MeshBasicMaterial({
    color: '#ffffff',
    transparent: false,
    opacity: PANORAMA.opacity,
    depthWrite: false,
    depthTest: false,
    side: BackSide
  }));

  const mesh = new Mesh(geometry, material);
  mesh.name = 'panorama-cylinder';
  mesh.renderOrder = PANORAMA.renderOrder;
  mesh.position.y = PANORAMA.verticalOffset;
  mesh.userData = {
    baseRotationY: 0,
    baseY: PANORAMA.verticalOffset,
    breathe: 0.0035
  };

  panoramaRoot.add(mesh);
  panoramaLayers.push(mesh);
  applyPanoramaTexture(material);
  return mesh;
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
    depthTest: false,
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
        float wave = sin(uTime * (0.18 + aDrift * 0.12) + aPhase);
        float curl = cos(uTime * (0.14 + aDrift * 0.11) + aPhase * 1.7);
        p.x += wave * 0.20 * aDrift;
        p.y += curl * 0.12 * aDrift + sin(uTime * 0.08 + aPhase) * 0.06;
        p.z += sin(uTime * 0.10 + aPhase * 0.71) * 0.18 * aDrift;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float depthScale = clamp(26.0 / max(1.0, -mvPosition.z), 0.34, 3.2);
        gl_PointSize = aSize * depthScale * uPixelRatio;
        vAlpha = clamp(depthScale * 0.42, 0.16, 0.88);
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
        float core = smoothstep(0.50, 0.0, d);
        float halo = smoothstep(0.50, 0.08, d) * 0.52;
        float flicker = 0.80 + 0.20 * sin(uTime * 1.55 + vColor.r * 7.0 + vColor.g * 3.0);
        float alpha = (core + halo) * vAlpha * flicker * uOpacity;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  });
  cleanup.push(() => material.dispose());
  return material;
}

function sphericalToWorld(radius, theta, phi) {
  return new Vector3(
    radius * Math.sin(theta) * Math.cos(phi),
    radius * Math.cos(theta),
    radius * Math.sin(theta) * Math.sin(phi)
  );
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

  for (let i = 0; i < 650; i += 1) {
    addPoint({
      x: MathUtils.randFloatSpread(14),
      y: MathUtils.randFloat(-1.8, 1.55),
      z: MathUtils.randFloat(-2.4, -7.6),
      color: [1.0, MathUtils.randFloat(0.76, 0.96), MathUtils.randFloat(0.22, 0.60)],
      size: MathUtils.randFloat(2.2, 7.2),
      drift: MathUtils.randFloat(0.45, 1.35)
    });
  }

  for (let i = 0; i < 34; i += 1) {
    addPoint({
      x: MathUtils.randFloatSpread(11),
      y: MathUtils.randFloat(-0.95, 1.15),
      z: MathUtils.randFloat(-2.1, -5.2),
      color: [MathUtils.randFloat(0.46, 0.75), MathUtils.randFloat(0.90, 1.0), 1.0],
      size: MathUtils.randFloat(15, 34),
      drift: MathUtils.randFloat(0.8, 1.6)
    });
  }

  const geometry = registerDisposable(new BufferGeometry());
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aDrift', new Float32BufferAttribute(drifts, 1));

  particleSystem = new Points(geometry, createParticleMaterial());
  particleSystem.renderOrder = 10;
  scene.add(particleSystem);
  animated.push({ type: 'particles', object: particleSystem });
}

function setSpriteTexture(sprite, texture, height) {
  sprite.material.map = texture;
  const aspect = texture.image?.width && texture.image?.height ? texture.image.width / texture.image.height : 1;
  sprite.scale.set(height * aspect, height, 1);
  sprite.userData.baseScale = { x: height * aspect, y: height };
  sprite.material.needsUpdate = true;
}

function setBeeDirection(sprite, direction) {
  const texture = direction === 'left' ? sprite.userData.leftTexture : sprite.userData.rightTexture;
  setSpriteTexture(sprite, texture, sprite.userData.height || 0.58);
}

function createFlyingSpriteMaterial(initialTexture, opacity = 0.96) {
  return registerDisposable(new SpriteMaterial({
    map: initialTexture,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false
  }));
}

function createBee({
  direction = 'right',
  height = 0.52,
  rare = false,
  origin = new Vector3(0, 0.5, -7),
  amp = new Vector3(0.8, 0.25, 0.6)
}) {
  let sprite;
  const left = loadTexture(`${beeLeftUrl}?asset=left&v=${BUILD_STAMP}`, () => sprite && setBeeDirection(sprite, direction));
  const right = loadTexture(`${beeRightUrl}?asset=right&v=${BUILD_STAMP}`, () => sprite && setBeeDirection(sprite, direction));
  const material = createFlyingSpriteMaterial(direction === 'left' ? left : right, rare ? 0.98 : 0.94);
  sprite = new Sprite(material);
  sprite.renderOrder = rare ? 13 : 12;
  sprite.position.copy(origin);
  sprite.userData = {
    leftTexture: left,
    rightTexture: right,
    height,
    origin: origin.clone(),
    amp: amp.clone(),
    active: false,
    lastX: origin.x,
    baseScale: { x: 1, y: 1 }
  };
  setBeeDirection(sprite, direction);
  beeRoot.add(sprite);
  animated.push({ type: rare ? 'rareBee' : 'bee', sprite, phase: Math.random() * 10, speed: MathUtils.randFloat(0.42, 0.86) });
  return sprite;
}

function createButterfly(textureUrl, { height = 0.42, origin = new Vector3(0, 0.2, -8), amp = new Vector3(0.6, 0.18, 0.35), opacity = 0.88 } = {}) {
  let sprite;
  const texture = loadTexture(`${textureUrl}?v=${BUILD_STAMP}`, () => sprite && setSpriteTexture(sprite, texture, height));
  const material = createFlyingSpriteMaterial(texture, opacity);
  sprite = new Sprite(material);
  sprite.renderOrder = 11;
  sprite.position.copy(origin);
  sprite.userData = {
    height,
    origin: origin.clone(),
    amp: amp.clone(),
    lastX: origin.x,
    baseScale: { x: 1, y: 1 }
  };
  setSpriteTexture(sprite, texture, height);
  butterflyRoot.add(sprite);
  animated.push({ type: 'butterfly', sprite, phase: Math.random() * 10, speed: MathUtils.randFloat(0.36, 0.72) });
  return sprite;
}

function createBees() {
  beeRoot = new Group();
  scene.add(beeRoot);

  createBee({ direction: 'right', height: 0.56, origin: new Vector3(-3.6, 0.72, -4.35), amp: new Vector3(0.72, 0.20, 0.18) });
  createBee({ direction: 'left', height: 0.50, origin: new Vector3(3.65, 0.55, -4.75), amp: new Vector3(0.62, 0.18, 0.16) });
  createBee({ direction: 'right', height: 0.46, origin: new Vector3(-5.2, -0.95, -3.9), amp: new Vector3(0.48, 0.11, 0.10) });
  rareBee = createBee({ direction: 'right', height: 0.50, rare: true, origin: new Vector3(-6, 0.72, -4.2), amp: new Vector3(0.18, 0.10, 0.06) });
  rareBee.visible = false;
}

function createButterflies() {
  butterflyRoot = new Group();
  scene.add(butterflyRoot);

  createButterfly(butterflyGoldUrl, { height: 0.58, origin: new Vector3(-2.65, -0.92, -3.8), amp: new Vector3(0.38, 0.11, 0.10), opacity: 0.9 });
  createButterfly(butterflyTealUrl, { height: 0.48, origin: new Vector3(2.75, -0.64, -4.15), amp: new Vector3(0.32, 0.14, 0.10), opacity: 0.88 });
  createButterfly(butterflyYellowUrl, { height: 0.54, origin: new Vector3(5.2, 0.40, -4.8), amp: new Vector3(0.30, 0.16, 0.08), opacity: 0.9 });
}

function ensureSplat() {
  if (!props.splatEnabled || splatRequested || disposed) return;
  splatRequested = true;
  splatLoading.value = true;

  splatRoot = new Group();
  splatRoot.visible = true;
  scene.add(splatRoot);

  splatMesh = new SplatMesh({
    url: SPLAT_URL,
    lod: 'quality',
    enableLod: true,
    maxSplats: 500000,
    onLoad: () => {
      if (disposed) return;
      splatLoading.value = false;
      fitSplatLayer();
    },
    onProgress: () => null
  });
  splatMesh.quaternion.set(1, 0, 0, 0);
  splatRoot.add(splatMesh);
  cleanup.push(() => splatMesh?.dispose?.());
}

function fitSplatLayer() {
  if (!splatRoot || !splatMesh) return;
  let box;
  try {
    box = splatMesh.getBoundingBox?.(true);
  } catch {
    box = new Box3();
  }
  const transformedFocus = DETAIL_FOCUS.clone().applyQuaternion(splatMesh.quaternion);
  const scale = 3.3 / DETAIL_ROBUST_SPAN;
  splatRoot.scale.setScalar(scale);
  splatRoot.position.set(
    -transformedFocus.x * scale,
    -transformedFocus.y * scale - 0.62,
    -7.2 - transformedFocus.z * scale
  );
  if (box && !box.isEmpty()) splatRoot.userData.box = box;
}

function updateSplatVisibility() {
  ensureSplat();
  if (splatRoot) splatRoot.visible = props.splatEnabled;
  if (!props.splatEnabled) splatLoading.value = false;
  if (panoramaRoot) panoramaRoot.visible = !props.splatEnabled;
  if (beeRoot) beeRoot.visible = !props.splatEnabled;
  if (butterflyRoot) butterflyRoot.visible = !props.splatEnabled;
}

function createScene() {
  scene = new Scene();
  scene.background = new Color('#fff0c8');

  camera = new PerspectiveCamera(fov, 1, 0.03, 220);
  camera.position.set(0, -0.18, 0.18);

  scene.add(new HemisphereLight('#fff5d9', '#7d6135', 1.05));
  scene.add(new AmbientLight('#fff3d5', 0.8));
  const key = new DirectionalLight('#ffffff', 1.16);
  key.position.set(-3, 4, 6);
  scene.add(key);

  createPanorama();
  createParticlePoints();
  createBees();
  createButterflies();

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

function updateResponsive() {
  if (!mount.value || !renderer || !camera) return;
  const rect = mount.value.getBoundingClientRect();
  viewWidth = Math.max(320, rect.width || window.innerWidth);
  viewHeight = Math.max(320, rect.height || window.innerHeight);
  const aspect = viewWidth / Math.max(viewHeight, 1);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, aspect < 0.7 ? 1.3 : 1.55));
  renderer.setSize(viewWidth, viewHeight, false);
  camera.aspect = aspect;
  targetFov = aspect < 0.72 ? 122 : aspect > 1.9 ? 116 : 118;
  camera.fov = targetFov;
  camera.updateProjectionMatrix();

  uniforms.forEach((u) => {
    if (u.uPixelRatio) u.uPixelRatio.value = renderer.getPixelRatio();
  });
}

function updateCamera(delta, elapsed) {
  const drift = props.slowDriftEnabled ? 0.0032 : 0;
  targetYaw += delta * drift;

  yaw = MathUtils.lerp(yaw, targetYaw, 0.085);
  pitch = MathUtils.lerp(pitch, targetPitch, 0.09);
  fov = MathUtils.lerp(fov, targetFov, 0.07);
  camera.fov = fov;
  camera.updateProjectionMatrix();

  const orbitOffset = props.slowDriftEnabled ? 0.18 : 0.06;
  camera.position.set(
    Math.sin(yaw * 0.42) * orbitOffset,
    -0.22 + Math.sin(elapsed * 0.08) * 0.012,
    Math.cos(yaw * 0.36) * orbitOffset
  );

  const direction = new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  );
  camera.lookAt(camera.position.clone().add(direction));

  panoramaLayers.forEach((layer) => {
    const data = layer.userData;
    layer.rotation.y = data.baseRotationY;
    layer.position.y = data.baseY + Math.sin(elapsed * 0.035) * data.breathe;
  });
}

function scheduleRareBee(now) {
  nextRareBeeAt = now + MathUtils.randFloat(18, 32);
}

function triggerRareBee(now) {
  if (!rareBee || rareBee.visible) return;
  const fromLeft = Math.random() > 0.5;
  rareBee.visible = true;
  rareBee.userData.active = true;
  rareBee.userData.start = now;
  rareBee.userData.duration = MathUtils.randFloat(8.5, 12.5);
  rareBee.userData.fromLeft = fromLeft;
  rareBee.userData.startX = fromLeft ? -6.4 : 6.4;
  rareBee.userData.endX = -rareBee.userData.startX;
  setBeeDirection(rareBee, fromLeft ? 'right' : 'left');
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  uniforms.forEach((u) => {
    if (u.uTime) u.uTime.value = elapsed;
  });

  updateCamera(delta, elapsed);

  for (const item of animated) {
    if (item.type === 'particles') {
      item.object.rotation.y = Math.sin(elapsed * 0.03) * 0.02;
      item.object.rotation.x = Math.sin(elapsed * 0.07) * 0.004;
    }

    if (item.type === 'bee') {
      const t = elapsed * item.speed + item.phase;
      const data = item.sprite.userData;
      item.sprite.position.set(
        data.origin.x + Math.sin(t * 0.7) * data.amp.x,
        data.origin.y + Math.cos(t * 1.15) * data.amp.y,
        data.origin.z + Math.sin(t * 0.52) * data.amp.z
      );
      item.sprite.material.rotation = 0;
      data.lastX = item.sprite.position.x;
    }

    if (item.type === 'butterfly') {
      const t = elapsed * item.speed + item.phase;
      const data = item.sprite.userData;
      item.sprite.position.set(
        data.origin.x + Math.sin(t * 0.9) * data.amp.x,
        data.origin.y + Math.cos(t * 1.4) * data.amp.y,
        data.origin.z + Math.sin(t * 0.65) * data.amp.z
      );
      const scalePulse = 1 + Math.sin(t * 8.0) * 0.08;
      item.sprite.scale.set(data.baseScale.x * scalePulse, data.baseScale.y * scalePulse, 1);
      item.sprite.material.rotation = Math.sin(t * 3.4) * 0.22;
    }

    if (item.type === 'rareBee' && item.sprite.userData.active) {
      const data = item.sprite.userData;
      const p = Math.min(1, (elapsed - data.start) / data.duration);
      const eased = 0.5 - Math.cos(p * Math.PI) * 0.5;
      item.sprite.position.set(
        MathUtils.lerp(data.startX, data.endX, eased),
        0.86 + Math.sin(p * Math.PI * 3.5) * 0.18,
        -3.85 + Math.sin(p * Math.PI * 2.0) * 0.10
      );
      item.sprite.material.rotation = 0;
      if (p >= 1) {
        item.sprite.visible = false;
        item.sprite.userData.active = false;
        scheduleRareBee(elapsed);
      }
    }
  }

  if (splatRoot?.visible) {
    splatRoot.rotation.y += delta * (props.slowDriftEnabled ? 0.018 : 0.004);
  }

  if (elapsed > nextRareBeeAt && elapsed - lastActivity > 9) triggerRareBee(elapsed);

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
  yawStart = targetYaw;
  pitchStart = targetPitch;
  lastActivity = clock.elapsedTime;
  mount.value.setPointerCapture?.(event.pointerId);
}

function handlePointerMove(event) {
  if (!pointerDown || event.pointerId !== pointerId) return;
  const dx = event.clientX - pointerStartX;
  const dy = event.clientY - pointerStartY;
  targetYaw = yawStart - dx * 0.0032;
  targetPitch = MathUtils.clamp(pitchStart + dy * 0.0028, -0.98, 0.18);
}

function endPointer(event) {
  if (event?.pointerId && event.pointerId !== pointerId) return;
  pointerDown = false;
  dragging.value = false;
  pointerId = null;
}

function handleWheel(event) {
  event.preventDefault();
  targetFov = MathUtils.clamp(targetFov + Math.sign(event.deltaY) * 3.5, 82, 124);
  lastActivity = clock.elapsedTime;
}

function handleActivity() {
  lastActivity = clock.elapsedTime;
  scheduleRareBee(lastActivity + 4);
}

watch(() => props.slowDriftEnabled, () => {
  lastActivity = clock.elapsedTime;
});

watch(() => props.splatEnabled, updateSplatVisibility);

onMounted(() => {
  disposed = false;
  renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0xfff0c8, 1);
  mount.value.appendChild(renderer.domElement);

  createScene();
  updateResponsive();
  scheduleRareBee(0);

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
  cleanup.splice(0).forEach((fn) => fn());
  disposeTree(scene);
  sparkRenderer?.dispose?.();
  renderer?.dispose();
});
</script>
