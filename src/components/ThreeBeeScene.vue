<template>
  <div ref="mount" class="bee-world" :class="{ 'is-dragging': dragging }" aria-label="Interactive 360 spelling bee landscape">
    <div v-if="splatLoading" class="splat-loading">Loading optional Gaussian splat scene…</div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AdditiveBlending,
  AmbientLight,
  Box3,
  BufferGeometry,
  Clock,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
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

import beeLeftUrl from '../assets/spelling/bee_left.png';
import beeRightUrl from '../assets/spelling/bee_right.png';

const props = defineProps({
  slowDriftEnabled: {
    type: Boolean,
    default: false
  },
  splatEnabled: {
    type: Boolean,
    default: false
  }
});

const BUILD_STAMP = '20260609-233500';
const PANO_URL = `/panoramas/spelling-landscape-pano-4096.webp?v=${BUILD_STAMP}`;
const PANO_FALLBACK_URL = `/panoramas/spelling-landscape-pano-4096.jpg?v=${BUILD_STAMP}`;
const SPLAT_URL = `/splats/ceramic_500k.spz?v=${BUILD_STAMP}`;
const DETAIL_FOCUS = new Vector3(-2.1509, 0.7566, 0.8363);
const DETAIL_ROBUST_SPAN = 102.1;

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
let panoSphere;
let particleSystem;
let beeRoot;
let rareBee;
let splatRoot;
let splatMesh;
let splatRequested = false;
let lastActivity = 0;
let nextRareBeeAt = 18;
let yaw = 0;
let pitch = -0.02;
let targetYaw = 0;
let targetPitch = -0.02;
let fov = 61;
let targetFov = 61;
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
    loaded.needsUpdate = true;
    onLoad?.(loaded);
  }, undefined, onError);
  texture.colorSpace = SRGBColorSpace;
  cleanup.push(() => texture.dispose());
  return texture;
}

function createPanoramaSphere() {
  const geometry = registerDisposable(new SphereGeometry(60, 96, 48));
  // Invert the sphere so the camera sits inside a panoramic surface.
  geometry.scale(-1, 1, 1);

  const material = registerDisposable(new MeshBasicMaterial({ color: '#fce6b6' }));
  panoSphere = new Mesh(geometry, material);
  panoSphere.rotation.y = Math.PI;
  scene.add(panoSphere);

  const applyTexture = (texture) => {
    material.map = texture;
    material.color.set('#ffffff');
    material.needsUpdate = true;
  };

  loadTexture(PANO_URL, applyTexture, () => {
    loadTexture(PANO_FALLBACK_URL, applyTexture);
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
        float wave = sin(uTime * (0.22 + aDrift * 0.18) + aPhase);
        float curl = cos(uTime * (0.17 + aDrift * 0.12) + aPhase * 1.7);
        p.x += wave * 0.14 * aDrift;
        p.y += curl * 0.10 * aDrift + sin(uTime * 0.08 + aPhase) * 0.035;
        p.z += sin(uTime * 0.11 + aPhase * 0.71) * 0.16 * aDrift;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float depthScale = clamp(22.0 / max(1.0, -mvPosition.z), 0.34, 2.8);
        gl_PointSize = aSize * depthScale * uPixelRatio;
        vAlpha = clamp(depthScale * 0.48, 0.18, 0.92);
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
        float core = smoothstep(0.5, 0.0, d);
        float halo = smoothstep(0.5, 0.08, d) * 0.45;
        float flicker = 0.78 + 0.22 * sin(uTime * 1.8 + vColor.r * 7.0 + vColor.g * 3.0);
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

  for (let i = 0; i < 420; i += 1) {
    addPoint({
      radius: MathUtils.randFloat(4, 24),
      theta: MathUtils.randFloat(0.62, 1.76),
      phi: MathUtils.randFloat(-Math.PI, Math.PI),
      color: [1.0, MathUtils.randFloat(0.78, 0.95), MathUtils.randFloat(0.26, 0.58)],
      size: MathUtils.randFloat(2.2, 6.8),
      drift: MathUtils.randFloat(0.4, 1.35)
    });
  }

  for (let i = 0; i < 18; i += 1) {
    addPoint({
      radius: MathUtils.randFloat(5.5, 15),
      theta: MathUtils.randFloat(0.76, 1.42),
      phi: MathUtils.randFloat(-Math.PI, Math.PI),
      color: [MathUtils.randFloat(0.52, 0.78), MathUtils.randFloat(0.9, 1.0), 1.0],
      size: MathUtils.randFloat(15, 34),
      drift: MathUtils.randFloat(0.75, 1.6)
    });
  }

  const geometry = registerDisposable(new BufferGeometry());
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aDrift', new Float32BufferAttribute(drifts, 1));

  const points = new Points(geometry, createParticleMaterial());
  scene.add(points);
  animated.push({ type: 'particles', object: points });
}

function setBeeDirection(sprite, direction) {
  const texture = direction === 'left' ? sprite.userData.leftTexture : sprite.userData.rightTexture;
  sprite.material.map = texture;
  const aspect = texture.image?.width && texture.image?.height ? texture.image.width / texture.image.height : 1;
  const height = sprite.userData.height || 0.58;
  sprite.scale.set(height * aspect, height, 1);
  sprite.material.needsUpdate = true;
}

function createBee({ direction = 'right', height = 0.52, rare = false, radius = 6.4, theta = 1.22, phi = -0.7 }) {
  let sprite;
  const left = loadTexture(`${beeLeftUrl}?asset=left&v=${BUILD_STAMP}`, () => sprite && setBeeDirection(sprite, direction));
  const right = loadTexture(`${beeRightUrl}?asset=right&v=${BUILD_STAMP}`, () => sprite && setBeeDirection(sprite, direction));
  const material = registerDisposable(new SpriteMaterial({
    map: direction === 'left' ? left : right,
    transparent: true,
    opacity: 0.94,
    depthWrite: false
  }));
  sprite = new Sprite(material);
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
  createBee({ direction: 'right', height: 0.5, radius: 7.6, theta: 1.05, phi: -0.92 });
  createBee({ direction: 'left', height: 0.46, radius: 8.2, theta: 0.98, phi: 0.9 });
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
  if (box && !box.isEmpty()) {
    splatRoot.userData.box = box;
  }
}

function updateSplatVisibility() {
  ensureSplat();
  if (splatRoot) splatRoot.visible = props.splatEnabled;
  if (!props.splatEnabled) splatLoading.value = false;
}

function createScene() {
  scene = new Scene();
  scene.background = new Color('#ffe6b4');

  camera = new PerspectiveCamera(fov, 1, 0.03, 180);
  camera.position.set(0, 0, 0);

  scene.add(new HemisphereLight('#fff3cf', '#7d6135', 1.05));
  scene.add(new AmbientLight('#fff3d5', 0.8));
  const key = new DirectionalLight('#ffffff', 1.2);
  key.position.set(-3, 4, 6);
  scene.add(key);

  createPanoramaSphere();
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

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, aspect < 0.7 ? 1.35 : 1.6));
  renderer.setSize(viewWidth, viewHeight, false);
  camera.aspect = aspect;
  targetFov = aspect < 0.72 ? 72 : aspect > 1.9 ? 54 : 61;
  camera.fov = targetFov;
  camera.updateProjectionMatrix();

  uniforms.forEach((u) => {
    if (u.uPixelRatio) u.uPixelRatio.value = renderer.getPixelRatio();
  });
}

function updateCamera(delta) {
  const drift = props.slowDriftEnabled ? 0.015 : 0.0018;
  targetYaw += delta * drift;

  yaw = MathUtils.lerp(yaw, targetYaw, 0.085);
  pitch = MathUtils.lerp(pitch, targetPitch, 0.09);
  fov = MathUtils.lerp(fov, targetFov, 0.07);
  camera.fov = fov;
  camera.updateProjectionMatrix();

  const direction = new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  );
  camera.lookAt(direction);
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

  updateCamera(delta);

  for (const item of animated) {
    if (item.type === 'particles') {
      item.object.rotation.y = elapsed * 0.006;
      item.object.rotation.x = Math.sin(elapsed * 0.07) * 0.008;
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
  targetPitch = MathUtils.clamp(pitchStart + dy * 0.0028, -0.72, 0.52);
}

function endPointer(event) {
  if (event?.pointerId && event.pointerId !== pointerId) return;
  pointerDown = false;
  dragging.value = false;
  pointerId = null;
}

function handleWheel(event) {
  event.preventDefault();
  targetFov = MathUtils.clamp(targetFov + Math.sign(event.deltaY) * 3.5, 42, 78);
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
  renderer.setClearColor(0xffe6b4, 1);
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
