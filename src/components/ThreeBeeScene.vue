<template>
  <div ref="mount" class="bee-world" aria-hidden="true">
    <div v-if="loading" class="splat-loading">Loading Gaussian splat scene…</div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AdditiveBlending,
  AmbientLight,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  BufferGeometry,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

import beeLeftUrl from '../assets/spelling/bee_left.png';
import beeRightUrl from '../assets/spelling/bee_right.png';

const props = defineProps({
  orbitEnabled: {
    type: Boolean,
    default: false
  }
});

const BUILD_STAMP = '20260609-232008';
const SPLAT_URL = `/splats/ceramic_500k.spz?v=${BUILD_STAMP}`;

const mount = ref(null);
const loading = ref(true);

let renderer;
let sparkRenderer;
let scene;
let camera;
let resizeObserver;
let splatRoot;
let splatMesh;
let atmosphereRoot;
let beeRoot;
let loadedBox;
let frameHandle;
let viewWidth = 1;
let viewHeight = 1;
let orbitAngle = -0.26;
let cameraDistance = 6.4;
let cameraTarget = new Vector3(0, 0.05, 0);
let lastActivity = 0;
let nextRareBeeAt = 16;
let rareBee;
let disposed = false;

const clock = new Clock();
const loader = new TextureLoader();
const cleanup = [];
const animated = [];
const uniforms = [];
const pointerTarget = new Vector2(0, 0);
const pointerLerp = new Vector2(0, 0);

function cacheUrl(url) {
  return `${url}${url.includes('?') ? '&' : '?'}v=${BUILD_STAMP}`;
}

function registerDisposable(item) {
  cleanup.push(() => item?.dispose?.());
  return item;
}

function loadTexture(url, onLoad) {
  const texture = loader.load(cacheUrl(url), (loaded) => {
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 4, 8);
    onLoad?.(loaded);
  });
  texture.colorSpace = SRGBColorSpace;
  cleanup.push(() => texture.dispose());
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

function makeBackdropMaterial() {
  const matUniforms = {
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uLoaded: { value: 0 }
  };
  uniforms.push(matUniforms);

  const material = new ShaderMaterial({
    uniforms: matUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      uniform float uAspect;
      uniform float uLoaded;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float circle(vec2 p, vec2 c, float r, float soft) {
        return smoothstep(r + soft, r - soft, length(p - c));
      }

      float ring(vec2 p, vec2 c, float r, float w) {
        return smoothstep(w, 0.0, abs(length(p - c) - r));
      }

      void main() {
        vec2 uv = vUv;
        vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
        float vignette = smoothstep(0.96, 0.18, length(p));
        float breathe = 0.5 + 0.5 * sin(uTime * 0.22);
        float honey = circle(uv, vec2(0.28 + sin(uTime * 0.07) * 0.03, 0.72), 0.36, 0.2);
        float cream = circle(uv, vec2(0.78, 0.34 + cos(uTime * 0.05) * 0.035), 0.42, 0.22);
        float arcs = ring(fract(uv * vec2(3.0, 2.0) + vec2(uTime * 0.008, 0.0)), vec2(0.5), 0.42, 0.012) * 0.11;
        vec2 grid = fract(uv * vec2(10.0, 6.0));
        float motes = step(0.988, hash(floor(uv * vec2(84.0, 44.0)))) * (0.35 + breathe * 0.35);
        vec3 base = mix(vec3(1.0, 0.88, 0.57), vec3(1.0, 0.98, 0.78), vignette);
        base = mix(base, vec3(1.0, 0.78, 0.38), honey * 0.22);
        base = mix(base, vec3(1.0, 0.98, 0.86), cream * 0.2);
        base += vec3(1.0, 0.86, 0.35) * motes * 0.05;
        base -= arcs * vec3(0.12, 0.08, 0.03);
        float alpha = 0.9 + uLoaded * 0.06;
        gl_FragColor = vec4(base, alpha);
      }
    `
  });
  cleanup.push(() => material.dispose());
  return material;
}

function createAtmosphere() {
  atmosphereRoot = new Group();
  scene.add(atmosphereRoot);

  const backdrop = new Mesh(new PlaneGeometry(36, 24), makeBackdropMaterial());
  backdrop.position.set(0, 0, -8);
  atmosphereRoot.add(backdrop);
  cleanup.push(() => disposeTree(backdrop));

  const positions = [];
  for (let i = 0; i < 220; i += 1) {
    positions.push(MathUtils.randFloatSpread(12), MathUtils.randFloatSpread(6), MathUtils.randFloat(-1.8, 1.2));
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const mat = new PointsMaterial({
    size: 0.025,
    color: '#fff1a2',
    transparent: true,
    opacity: 0.46,
    blending: AdditiveBlending,
    depthWrite: false
  });
  const pollen = new Points(geo, mat);
  pollen.position.z = -0.6;
  atmosphereRoot.add(pollen);
  cleanup.push(() => disposeTree(pollen));
  animated.push({ type: 'pollen', object: pollen, phase: 0 });
}

function setBeeDirection(sprite, direction) {
  const texture = direction === 'left' ? sprite.userData.leftTexture : sprite.userData.rightTexture;
  sprite.material.map = texture;
  const aspect = texture.image?.width && texture.image?.height ? texture.image.width / texture.image.height : 1;
  const height = sprite.userData.height || 0.62;
  sprite.scale.set(height * aspect, height, 1);
  sprite.material.needsUpdate = true;
}

function createBee({ x, y, z, direction = 'right', height = 0.58, rare = false }) {
  let sprite;
  const left = loadTexture(beeLeftUrl, () => sprite && setBeeDirection(sprite, direction));
  const right = loadTexture(beeRightUrl, () => sprite && setBeeDirection(sprite, direction));
  const material = registerDisposable(new SpriteMaterial({
    map: direction === 'left' ? left : right,
    transparent: true,
    opacity: 0.96,
    depthWrite: false
  }));
  sprite = new Sprite(material);
  sprite.position.set(x, y, z);
  sprite.userData = { leftTexture: left, rightTexture: right, height, active: false };
  setBeeDirection(sprite, direction);
  beeRoot.add(sprite);
  animated.push({ type: rare ? 'rareBee' : 'bee', sprite, base: sprite.position.clone(), phase: Math.random() * 10, speed: MathUtils.randFloat(0.5, 0.85) });
  return sprite;
}

function createBees() {
  beeRoot = new Group();
  scene.add(beeRoot);
  createBee({ x: -2.6, y: 1.7, z: 1.2, direction: 'right', height: 0.52 });
  createBee({ x: 2.72, y: 1.86, z: 1.2, direction: 'left', height: 0.48 });
  rareBee = createBee({ x: -8, y: 1.0, z: 1.4, direction: 'right', height: 0.43, rare: true });
  rareBee.visible = false;
}

function createSplatScene() {
  splatRoot = new Group();
  scene.add(splatRoot);

  splatMesh = new SplatMesh({
    url: SPLAT_URL,
    lod: 'quality',
    enableLod: true,
    maxSplats: 500000,
    onLoad: () => {
      if (disposed) return;
      loading.value = false;
      uniforms.forEach((u) => { if (u.uLoaded) u.uLoaded.value = 1; });
      fitSplatToViewport();
    },
    onProgress: (event) => {
      if (event?.lengthComputable && event.total) {
        const progress = MathUtils.clamp(event.loaded / event.total, 0, 1);
        uniforms.forEach((u) => { if (u.uLoaded) u.uLoaded.value = progress; });
      }
    }
  });

  // Spark's reference examples rotate SPZ splats with this quaternion; it corrects the common SPZ up-axis orientation.
  splatMesh.quaternion.set(1, 0, 0, 0);
  splatMesh.position.set(0, -0.05, 0);
  splatRoot.add(splatMesh);
  cleanup.push(() => splatMesh?.dispose?.());
}

function createScene() {
  scene = new Scene();
  scene.background = new Color('#f7dfb3');

  camera = new PerspectiveCamera(43, 1, 0.01, 1000);
  camera.position.set(0, 1.4, 5.8);
  camera.lookAt(cameraTarget);

  scene.add(new HemisphereLight('#fff7d3', '#9c6b33', 1.24));
  scene.add(new AmbientLight('#ffeec0', 0.75));
  const key = new DirectionalLight('#ffffff', 1.65);
  key.position.set(-3.4, 4.8, 5.5);
  const fill = new DirectionalLight('#ffd46f', 0.65);
  fill.position.set(3.8, 2.0, 2.5);
  scene.add(key, fill);

  createAtmosphere();
  createSplatScene();
  createBees();

  sparkRenderer = new SparkRenderer({
    renderer,
    clock,
    maxPixelRadius: 360,
    minPixelRadius: 0.18,
    minAlpha: 0.5 / 255,
    onDirty: () => null
  });
  scene.add(sparkRenderer);
}

function fitSplatToViewport() {
  if (!splatMesh || !splatRoot || !camera) return;

  try {
    loadedBox = splatMesh.getBoundingBox?.(true);
  } catch {
    loadedBox = null;
  }

  const box = loadedBox && Number.isFinite(loadedBox.min.x) ? loadedBox : new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);

  const largest = Math.max(size.x, size.y, size.z, 0.001);
  const aspect = viewWidth / Math.max(viewHeight, 1);
  const desired = aspect < 0.72 ? 2.7 : aspect < 1.05 ? 3.3 : 4.25;
  const scale = desired / largest;

  splatRoot.scale.setScalar(scale);
  splatRoot.position.set(-center.x * scale, -center.y * scale - (aspect < 0.72 ? 0.24 : 0.06), -center.z * scale);

  cameraTarget.set(0, aspect < 0.72 ? 0.08 : 0.02, 0);
  cameraDistance = aspect < 0.72 ? 5.75 : aspect < 1.05 ? 5.35 : 5.05;
  updateCamera(0, true);
}

function updateResponsive() {
  if (!mount.value || !renderer || !camera) return;
  const rect = mount.value.getBoundingClientRect();
  viewWidth = Math.max(320, rect.width || window.innerWidth);
  viewHeight = Math.max(320, rect.height || window.innerHeight);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(viewWidth, viewHeight, false);
  camera.aspect = viewWidth / viewHeight;
  camera.fov = camera.aspect < 0.7 ? 49 : camera.aspect > 1.9 ? 39 : 43;
  camera.updateProjectionMatrix();

  uniforms.forEach((u) => { if (u.uAspect) u.uAspect.value = camera.aspect; });
  fitSplatToViewport();
}

function updateCamera(delta, instant = false) {
  const aspect = viewWidth / Math.max(viewHeight, 1);
  const targetOrbit = props.orbitEnabled ? 1 : 0;
  const speed = props.orbitEnabled ? 0.014 : 0.002;
  orbitAngle += delta * speed;

  pointerLerp.lerp(pointerTarget, instant ? 1 : 0.025);
  const parallaxX = props.orbitEnabled ? 0 : pointerLerp.x * (aspect < 0.72 ? 0.16 : 0.26);
  const parallaxY = props.orbitEnabled ? 0 : pointerLerp.y * 0.12;

  const orbitRadius = cameraDistance;
  const activeAngle = -0.26 + orbitAngle * targetOrbit + parallaxX * 0.18;
  const y = cameraTarget.y + (aspect < 0.72 ? 1.15 : 1.05) + Math.sin(activeAngle * 0.8) * 0.08 + parallaxY;
  camera.position.set(
    cameraTarget.x + Math.sin(activeAngle) * orbitRadius,
    y,
    cameraTarget.z + Math.cos(activeAngle) * orbitRadius
  );
  camera.lookAt(cameraTarget.x, cameraTarget.y + parallaxY * 0.25, cameraTarget.z);
}

function scheduleRareBee(now) {
  nextRareBeeAt = now + MathUtils.randFloat(16, 28);
}

function triggerRareBee(now) {
  if (!rareBee || rareBee.visible) return;
  const fromLeft = Math.random() > 0.5;
  const aspect = viewWidth / Math.max(viewHeight, 1);
  rareBee.visible = true;
  rareBee.userData.active = true;
  rareBee.userData.start = now;
  rareBee.userData.duration = MathUtils.randFloat(7.5, 10.5);
  rareBee.userData.startX = (fromLeft ? -1 : 1) * (aspect < 0.72 ? 2.9 : 4.2);
  rareBee.userData.endX = -rareBee.userData.startX;
  rareBee.userData.baseY = MathUtils.randFloat(0.9, 1.9);
  rareBee.position.set(rareBee.userData.startX, rareBee.userData.baseY, 1.6);
  setBeeDirection(rareBee, fromLeft ? 'right' : 'left');
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  uniforms.forEach((u) => { if (u.uTime) u.uTime.value = elapsed; });
  updateCamera(delta);

  for (const item of animated) {
    if (item.type === 'pollen') {
      item.object.rotation.z = elapsed * 0.014;
      item.object.position.y = Math.sin(elapsed * 0.22 + item.phase) * 0.05;
    }

    if (item.type === 'bee') {
      const t = elapsed * item.speed + item.phase;
      item.sprite.position.x = item.base.x + Math.sin(t * 0.64) * 0.24;
      item.sprite.position.y = item.base.y + Math.cos(t * 1.06) * 0.13;
      item.sprite.rotation.z = Math.sin(t * 1.3) * 0.09;
    }

    if (item.type === 'rareBee' && item.sprite.userData.active) {
      const data = item.sprite.userData;
      const p = Math.min(1, (elapsed - data.start) / data.duration);
      const eased = 0.5 - Math.cos(p * Math.PI) * 0.5;
      item.sprite.position.x = MathUtils.lerp(data.startX, data.endX, eased);
      item.sprite.position.y = data.baseY + Math.sin(p * Math.PI * 4) * 0.22 + Math.sin(p * Math.PI) * 0.16;
      item.sprite.rotation.z = Math.sin(elapsed * 6.5) * 0.08;
      if (p >= 1) {
        item.sprite.visible = false;
        item.sprite.userData.active = false;
        scheduleRareBee(elapsed);
      }
    }
  }

  if (elapsed > nextRareBeeAt && elapsed - lastActivity > 9) triggerRareBee(elapsed);

  renderer.render(scene, camera);
  frameHandle = window.requestAnimationFrame(animate);
}

function handlePointerMove(event) {
  pointerTarget.set(
    MathUtils.clamp((event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1, -1, 1),
    MathUtils.clamp(-((event.clientY / Math.max(window.innerHeight, 1)) * 2 - 1), -1, 1)
  );
}

function handleActivity() {
  lastActivity = clock.elapsedTime;
  scheduleRareBee(lastActivity + 4);
}

watch(() => props.orbitEnabled, () => {
  lastActivity = clock.elapsedTime;
});

onMounted(() => {
  disposed = false;
  renderer = new WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  mount.value.appendChild(renderer.domElement);

  createScene();
  updateResponsive();
  scheduleRareBee(0);

  resizeObserver = new ResizeObserver(updateResponsive);
  resizeObserver.observe(mount.value);
  window.addEventListener('resize', updateResponsive);
  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  window.addEventListener('bee-meter-activity', handleActivity);
  frameHandle = window.requestAnimationFrame(animate);
});

onBeforeUnmount(() => {
  disposed = true;
  if (frameHandle) window.cancelAnimationFrame(frameHandle);
  resizeObserver?.disconnect();
  window.removeEventListener('resize', updateResponsive);
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('bee-meter-activity', handleActivity);
  cleanup.splice(0).forEach((fn) => fn());
  disposeTree(atmosphereRoot);
  disposeTree(beeRoot);
  sparkRenderer?.dispose?.();
  renderer?.dispose();
});
</script>
