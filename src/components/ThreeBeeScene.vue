<template>
  <div ref="mount" class="bee-world" :class="{ 'is-dragging': dragging }" aria-label="Vector panorama spelling bee landscape">
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
  CylinderGeometry,
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

import beeLeftUrl from '../assets/spelling/bee_left.png';
import beeRightUrl from '../assets/spelling/bee_right.png';

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

const BUILD_STAMP = '20260609-235842';
const LAYER_ASPECT = 1774 / 887;
const VECTOR_PANORAMA_URL = `/panoramas/vector/spelling-hills-vector.svg?v=${BUILD_STAMP}`;
const SPLAT_URL = `/splats/ceramic_500k.spz?v=${BUILD_STAMP}`;
const DETAIL_FOCUS = new Vector3(-2.1509, 0.7566, 0.8363);
const DETAIL_ROBUST_SPAN = 102.1;
const VECTOR_PANORAMA = {
  radius: 46,
  opacity: 1,
  verticalOffset: -0.92,
  renderOrder: 1
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
let rareBee;
let splatRoot;
let splatMesh;
let splatRequested = false;
let lastActivity = 0;
let nextRareBeeAt = 18;
let yaw = -0.03;
let pitch = -0.64;
let targetYaw = -0.03;
let targetPitch = -0.64;
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

function getVectorTextureSize() {
  const maxTextureSize = renderer?.capabilities?.maxTextureSize || 4096;
  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  const viewportDrivenWidth = Math.ceil(Math.max(viewWidth || window.innerWidth || 1440, 1440) * deviceScale * 3.2);
  const width = Math.min(maxTextureSize, Math.max(4096, viewportDrivenWidth));
  return {
    width,
    height: Math.round(width / LAYER_ASPECT)
  };
}

async function rasterizeSvgToTexture(url, material) {
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    if (disposed) return;

    const { width, height } = getVectorTextureSize();
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
    console.warn('Could not load vector panorama', error);
  }
}

function createVectorPanorama() {
  panoramaRoot = new Group();
  panoramaRoot.name = 'vector-panorama-root';
  scene.add(panoramaRoot);

  const height = (Math.PI * 2 * VECTOR_PANORAMA.radius) / LAYER_ASPECT;
  const geometry = registerDisposable(new CylinderGeometry(VECTOR_PANORAMA.radius, VECTOR_PANORAMA.radius, height, 256, 1, true));
  const material = registerDisposable(new MeshBasicMaterial({
    color: '#ffffff',
    transparent: false,
    opacity: VECTOR_PANORAMA.opacity,
    depthWrite: false,
    depthTest: false,
    side: BackSide
  }));

  const mesh = new Mesh(geometry, material);
  mesh.name = 'vector-panorama-cylinder';
  mesh.renderOrder = VECTOR_PANORAMA.renderOrder;
  mesh.position.y = VECTOR_PANORAMA.verticalOffset;
  mesh.rotation.y = Math.PI;
  mesh.userData = {
    baseRotationY: Math.PI,
    baseY: VECTOR_PANORAMA.verticalOffset,
    breathe: 0.004
  };

  panoramaRoot.add(mesh);
  panoramaLayers.push(mesh);
  rasterizeSvgToTexture(VECTOR_PANORAMA_URL, material);
  return mesh;
}

function createLayeredPanorama() {
  createVectorPanorama();
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

  const addPoint = ({ radius, theta, phi, color, size, drift }) => {
    const p = sphericalToWorld(radius, theta, phi);
    positions.push(p.x, p.y, p.z);
    colors.push(color[0], color[1], color[2]);
    sizes.push(size);
    phases.push(Math.random() * Math.PI * 2);
    drifts.push(drift);
  };

  for (let i = 0; i < 560; i += 1) {
    addPoint({
      radius: MathUtils.randFloat(4.5, 20),
      theta: MathUtils.randFloat(0.86, 1.92),
      phi: MathUtils.randFloat(-Math.PI, Math.PI),
      color: [1.0, MathUtils.randFloat(0.76, 0.94), MathUtils.randFloat(0.20, 0.58)],
      size: MathUtils.randFloat(1.8, 5.8),
      drift: MathUtils.randFloat(0.35, 1.25)
    });
  }

  for (let i = 0; i < 24; i += 1) {
    addPoint({
      radius: MathUtils.randFloat(5.5, 13),
      theta: MathUtils.randFloat(0.95, 1.62),
      phi: MathUtils.randFloat(-Math.PI, Math.PI),
      color: [MathUtils.randFloat(0.48, 0.74), MathUtils.randFloat(0.9, 1.0), 1.0],
      size: MathUtils.randFloat(13, 30),
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
  particleSystem.renderOrder = 10;
  scene.add(particleSystem);
  animated.push({ type: 'particles', object: particleSystem });
}

function setBeeDirection(sprite, direction) {
  const texture = direction === 'left' ? sprite.userData.leftTexture : sprite.userData.rightTexture;
  sprite.material.map = texture;
  const aspect = texture.image?.width && texture.image?.height ? texture.image.width / texture.image.height : 1;
  const height = sprite.userData.height || 0.58;
  sprite.scale.set(height * aspect, height, 1);
  sprite.material.needsUpdate = true;
}

function createBee({ direction = 'right', height = 0.52, rare = false, radius = 8.2, theta = 1.22, phi = -0.7 }) {
  let sprite;
  const left = loadTexture(`${beeLeftUrl}?asset=left&v=${BUILD_STAMP}`, () => sprite && setBeeDirection(sprite, direction));
  const right = loadTexture(`${beeRightUrl}?asset=right&v=${BUILD_STAMP}`, () => sprite && setBeeDirection(sprite, direction));
  const material = registerDisposable(new SpriteMaterial({
    map: direction === 'left' ? left : right,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    depthTest: false
  }));
  sprite = new Sprite(material);
  sprite.renderOrder = rare ? 13 : 12;
  sprite.userData = { leftTexture: left, rightTexture: right, height, radius, theta, phi, active: false, lastX: 0 };
  sprite.position.copy(sphericalToWorld(radius, theta, phi));
  setBeeDirection(sprite, direction);
  beeRoot.add(sprite);
  animated.push({ type: rare ? 'rareBee' : 'bee', sprite, base: sprite.position.clone(), phase: Math.random() * 10, speed: MathUtils.randFloat(0.42, 0.86) });
  return sprite;
}

function createBees() {
  beeRoot = new Group();
  scene.add(beeRoot);
  createBee({ direction: 'right', height: 0.5, radius: 8.8, theta: 1.05, phi: -0.92 });
  createBee({ direction: 'left', height: 0.46, radius: 9.4, theta: 0.98, phi: 0.9 });
  rareBee = createBee({ direction: 'right', height: 0.44, rare: true, radius: 7.2, theta: 1.18, phi: -1.6 });
  rareBee.visible = false;
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
}

function createScene() {
  scene = new Scene();
  scene.background = new Color('#fff0c8');

  camera = new PerspectiveCamera(fov, 1, 0.03, 220);
  camera.position.set(0, -0.24, 0.2);

  scene.add(new HemisphereLight('#fff5d9', '#7d6135', 1.05));
  scene.add(new AmbientLight('#fff3d5', 0.8));
  const key = new DirectionalLight('#ffffff', 1.16);
  key.position.set(-3, 4, 6);
  scene.add(key);

  createLayeredPanorama();
  createParticlePoints();
  createBees();

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

  const orbitOffset = props.slowDriftEnabled ? 0.24 : 0.08;
  camera.position.set(
    Math.sin(yaw * 0.54) * orbitOffset,
    -0.30 + Math.sin(elapsed * 0.08) * 0.015,
    Math.cos(yaw * 0.48) * orbitOffset
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
  rareBee.userData.startPhi = fromLeft ? -1.42 : 1.42;
  rareBee.userData.endPhi = -rareBee.userData.startPhi;
  rareBee.userData.theta = MathUtils.randFloat(1.0, 1.22);
  rareBee.userData.radius = MathUtils.randFloat(5.4, 7.4);
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
      item.object.rotation.y = elapsed * 0.004;
      item.object.rotation.x = Math.sin(elapsed * 0.07) * 0.006;
    }

    if (item.type === 'bee') {
      const t = elapsed * item.speed + item.phase;
      const data = item.sprite.userData;
      const phi = data.phi + Math.sin(t * 0.55) * 0.12;
      const theta = data.theta + Math.cos(t * 0.9) * 0.035;
      item.sprite.position.copy(sphericalToWorld(data.radius, theta, phi));
      item.sprite.rotation.z = Math.sin(t * 1.4) * 0.08;
      const dx = item.sprite.position.x - data.lastX;
      if (Math.abs(dx) > 0.002) setBeeDirection(item.sprite, dx > 0 ? 'right' : 'left');
      data.lastX = item.sprite.position.x;
    }

    if (item.type === 'rareBee' && item.sprite.userData.active) {
      const data = item.sprite.userData;
      const p = Math.min(1, (elapsed - data.start) / data.duration);
      const eased = 0.5 - Math.cos(p * Math.PI) * 0.5;
      const phi = MathUtils.lerp(data.startPhi, data.endPhi, eased);
      const theta = data.theta + Math.sin(p * Math.PI * 5) * 0.04;
      item.sprite.position.copy(sphericalToWorld(data.radius, theta, phi));
      item.sprite.rotation.z = Math.sin(elapsed * 7.0) * 0.08;
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
  targetPitch = MathUtils.clamp(pitchStart + dy * 0.0028, -1.03, 0.22);
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
