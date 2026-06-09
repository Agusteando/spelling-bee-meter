<template>
  <div ref="mount" class="bee-world" aria-hidden="true"></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  WebGLRenderer
} from 'three';

import backgroundPanelUrl from '../assets/spelling/background_panel.jpg';
import beeLeftUrl from '../assets/spelling/bee_left.png';
import beeRightUrl from '../assets/spelling/bee_right.png';
import hillsUrl from '../assets/spelling/hills.png';
import treeLeftUrl from '../assets/spelling/tree_left_flowers.png';
import treeOrangeUrl from '../assets/spelling/tree_orange_spots.png';
import treeGoldUrl from '../assets/spelling/tree_gold_flowers.png';
import plantButterflyUrl from '../assets/spelling/plant_butterfly.png';
import iedisLogoUrl from '../assets/spelling/iedis_logo.png';
import eventLogoUrl from '../assets/spelling/event_logo_2026.png';
import flowerRedUrl from '../assets/spelling/flower_red_large.png';
import flowerRedMidUrl from '../assets/spelling/flower_red_mid.png';
import flowerYellowUrl from '../assets/spelling/flower_yellow_large.png';
import flowerYellowMidUrl from '../assets/spelling/flower_yellow_mid.png';
import flowerOrangeUrl from '../assets/spelling/flower_orange_large.png';
import flowerOrangeMidUrl from '../assets/spelling/flower_orange_mid.png';
import dotYellowUrl from '../assets/spelling/dot_yellow_large.png';
import butterflyYellowUrl from '../assets/spelling/butterfly_yellow.png';
import butterflyTealUrl from '../assets/spelling/butterfly_teal.png';
import butterflyGoldUrl from '../assets/spelling/butterfly_gold.png';
import pollenGlowUrl from '../assets/spelling/pollen_glow.png';

const mount = ref(null);

let renderer;
let scene;
let camera;
let frameId;
let resizeObserver;
let rareBee;
let lastUserActivity = 0;
let nextRareBeeAt = 0;

const animated = [];
const cleanup = [];
const textureLoader = new TextureLoader();

function makeTexture(url) {
  const texture = textureLoader.load(url);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createPlane({
  url,
  width,
  height,
  x = 0,
  y = 0,
  z = 0,
  opacity = 1,
  transparent = true,
  depthWrite = false,
  depthTest = true,
  renderOrder = 0,
  visible = true
}) {
  const texture = makeTexture(url);
  const material = new MeshBasicMaterial({
    map: texture,
    transparent,
    opacity,
    depthWrite,
    depthTest,
    alphaTest: transparent ? 0.01 : 0,
    side: DoubleSide
  });
  const geometry = new PlaneGeometry(width, height);
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.renderOrder = renderOrder;
  mesh.visible = visible;
  scene.add(mesh);
  cleanup.push(() => {
    geometry.dispose();
    material.dispose();
    texture.dispose();
  });
  return mesh;
}

function addBreathingLayer(mesh, options = {}) {
  animated.push({
    mesh,
    basePosition: mesh.position.clone(),
    baseRotationZ: mesh.rotation.z,
    baseScale: mesh.scale.clone(),
    phase: options.phase ?? Math.random() * Math.PI * 2,
    floatX: options.floatX ?? 0,
    floatY: options.floatY ?? 0.08,
    scale: options.scale ?? 0.02,
    rotate: options.rotate ?? 0.02,
    speed: options.speed ?? 0.75,
    driftX: options.driftX ?? 0,
    driftY: options.driftY ?? 0,
    orbitX: options.orbitX ?? 0,
    orbitY: options.orbitY ?? 0
  });
}

function addParticleField() {
  const count = 88;
  const positions = [];
  const spread = new Vector2(12, 5.8);
  for (let i = 0; i < count; i += 1) {
    positions.push(
      (Math.random() - 0.5) * spread.x,
      (Math.random() - 0.5) * spread.y + 0.1,
      Math.random() * 2.2 - 0.2
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const texture = makeTexture(pollenGlowUrl);
  const material = new PointsMaterial({
    map: texture,
    transparent: true,
    opacity: 0.55,
    size: 0.12,
    blending: AdditiveBlending,
    depthWrite: false
  });
  const points = new Points(geometry, material);
  points.position.z = 2.6;
  points.renderOrder = 12;
  scene.add(points);
  animated.push({
    mesh: points,
    particleField: true,
    basePosition: points.position.clone(),
    baseRotationZ: 0,
    baseScale: points.scale.clone(),
    phase: Math.random() * Math.PI,
    speed: 0.18
  });
  cleanup.push(() => {
    geometry.dispose();
    material.dispose();
    texture.dispose();
  });
}

function addFlowerField() {
  const flowerTextures = [
    flowerRedUrl,
    flowerYellowUrl,
    flowerOrangeUrl,
    flowerRedMidUrl,
    flowerYellowMidUrl,
    flowerOrangeMidUrl,
    dotYellowUrl
  ];

  const flowerPositions = [
    [-5.72, -2.55, 3.46, 0.52, 0],
    [-5.12, -2.86, 3.58, 0.34, 1],
    [-4.54, -2.73, 3.64, 0.44, 2],
    [-3.76, -2.98, 3.66, 0.38, 3],
    [-2.72, -2.83, 3.56, 0.33, 4],
    [-1.42, -2.9, 3.6, 0.28, 5],
    [2.28, -2.78, 3.58, 0.43, 0],
    [2.88, -2.52, 3.7, 0.32, 1],
    [3.66, -2.83, 3.74, 0.38, 3],
    [4.36, -2.58, 3.78, 0.34, 4],
    [5.24, -2.8, 3.82, 0.46, 0],
    [5.96, -2.55, 3.86, 0.48, 1],
    [6.48, -2.82, 3.9, 0.36, 2],
    [-6.35, -2.9, 3.9, 0.42, 2],
    [-0.18, -3.02, 3.86, 0.25, 6],
    [1.06, -2.96, 3.88, 0.24, 6]
  ];

  flowerPositions.forEach(([x, y, z, size, textureIndex], index) => {
    const flower = createPlane({
      url: flowerTextures[textureIndex % flowerTextures.length],
      width: size,
      height: size * 1.05,
      x,
      y,
      z,
      opacity: 0.99,
      depthTest: false,
      renderOrder: 42 + index
    });
    flower.rotation.z = (index % 2 ? -1 : 1) * (0.04 + (index % 4) * 0.012);
    addBreathingLayer(flower, {
      floatY: 0.09 + (index % 3) * 0.025,
      floatX: 0.02 + (index % 2) * 0.018,
      scale: 0.06,
      rotate: 0.16 + (index % 4) * 0.025,
      speed: 0.78 + index * 0.045,
      phase: index * 0.58
    });
  });
}

function addRareBeeTraffic() {
  const rightFlyingBee = createPlane({
    url: beeRightUrl,
    width: 1.18,
    height: 1.3,
    z: 4.8,
    opacity: 0.98,
    depthTest: false,
    renderOrder: 86,
    visible: false
  });
  const leftFlyingBee = createPlane({
    url: beeLeftUrl,
    width: 1.18,
    height: 1.3,
    z: 4.8,
    opacity: 0.98,
    depthTest: false,
    renderOrder: 86,
    visible: false
  });

  rareBee = {
    active: false,
    rightFlyingBee,
    leftFlyingBee,
    mesh: rightFlyingBee,
    fromX: -8.3,
    toX: 8.3,
    y: 2.1,
    z: 4.8,
    start: 0,
    duration: 11,
    direction: 1
  };
}

function markUserActivity() {
  lastUserActivity = performance.now() * 0.001;
  nextRareBeeAt = lastUserActivity + 18 + Math.random() * 28;
  if (rareBee?.active) return;
  if (rareBee) {
    rareBee.rightFlyingBee.visible = false;
    rareBee.leftFlyingBee.visible = false;
  }
}

function startRareBeeFlight(t) {
  if (!rareBee) return;
  const direction = Math.random() > 0.5 ? 1 : -1;
  rareBee.direction = direction;
  rareBee.fromX = direction > 0 ? -8.4 : 8.4;
  rareBee.toX = direction > 0 ? 8.4 : -8.4;
  rareBee.y = 1.45 + Math.random() * 1.35;
  rareBee.z = 4.65 + Math.random() * 0.35;
  rareBee.start = t;
  rareBee.duration = 10.5 + Math.random() * 4.5;
  rareBee.mesh = direction > 0 ? rareBee.rightFlyingBee : rareBee.leftFlyingBee;
  rareBee.rightFlyingBee.visible = direction > 0;
  rareBee.leftFlyingBee.visible = direction < 0;
  rareBee.mesh.position.set(rareBee.fromX, rareBee.y, rareBee.z);
  rareBee.mesh.rotation.z = direction > 0 ? -0.05 : 0.05;
  rareBee.mesh.scale.setScalar(1);
  rareBee.active = true;
}

function updateRareBeeFlight(t) {
  if (!rareBee) return;

  const idleSeconds = t - lastUserActivity;
  if (!rareBee.active) {
    if (idleSeconds > 14 && t >= nextRareBeeAt) {
      startRareBeeFlight(t);
    }
    return;
  }

  const progress = Math.min(1, (t - rareBee.start) / rareBee.duration);
  const ease = progress < 0.5
    ? 2 * progress * progress
    : 1 - ((-2 * progress + 2) ** 2) / 2;
  const mesh = rareBee.mesh;
  const bob = Math.sin(progress * Math.PI * 3.4) * 0.22 + Math.sin(t * 8.5) * 0.055;
  const arc = Math.sin(progress * Math.PI) * 0.36;
  const wingPulse = 1 + Math.sin(t * 18) * 0.035;

  mesh.position.x = rareBee.fromX + (rareBee.toX - rareBee.fromX) * ease;
  mesh.position.y = rareBee.y + bob + arc;
  mesh.position.z = rareBee.z + Math.sin(progress * Math.PI) * 0.28;
  mesh.rotation.z = (rareBee.direction > 0 ? -0.07 : 0.07) + Math.sin(t * 7) * 0.04;
  mesh.scale.set(1 + Math.sin(t * 11) * 0.018, wingPulse, 1);

  if (progress >= 1) {
    rareBee.active = false;
    rareBee.rightFlyingBee.visible = false;
    rareBee.leftFlyingBee.visible = false;
    nextRareBeeAt = t + 24 + Math.random() * 42;
  }
}

function buildScene() {
  createPlane({ url: backgroundPanelUrl, width: 12.8, height: 7.2, y: 0.3, z: -3.2, transparent: false, depthWrite: true, renderOrder: 0 });

  const topLogo = createPlane({ url: iedisLogoUrl, width: 3.28, height: 1.37, x: 0, y: 2.78, z: -0.1, opacity: 0.94, renderOrder: 8 });
  addBreathingLayer(topLogo, { floatY: 0.025, scale: 0.006, rotate: 0.004, speed: 0.35 });

  const eventLogo = createPlane({ url: eventLogoUrl, width: 3.75, height: 1.12, x: 0.2, y: -0.96, z: 1.4, opacity: 0.96, renderOrder: 24 });
  addBreathingLayer(eventLogo, { floatY: 0.04, scale: 0.01, rotate: 0.006, speed: 0.55 });

  const hillsBack = createPlane({ url: hillsUrl, width: 14.9, height: 3.36, x: -0.1, y: -3.0, z: 0.2, opacity: 0.94, renderOrder: 16 });
  addBreathingLayer(hillsBack, { floatY: 0.05, scale: 0.008, rotate: 0.003, speed: 0.42 });

  const hillsFront = createPlane({ url: hillsUrl, width: 15.6, height: 3.52, x: 0.2, y: -3.26, z: 2.05, opacity: 0.82, renderOrder: 30 });
  addBreathingLayer(hillsFront, { floatY: 0.045, scale: 0.012, rotate: 0.002, speed: 0.36, phase: 1.8 });

  const leftTree = createPlane({ url: treeLeftUrl, width: 2.15, height: 5.22, x: -5.96, y: -0.95, z: 0.95, opacity: 0.96, renderOrder: 20 });
  leftTree.rotation.z = -0.025;
  addBreathingLayer(leftTree, { floatY: 0.03, scale: 0.012, rotate: 0.026, speed: 0.62 });

  const leftPlant = createPlane({ url: plantButterflyUrl, width: 1.18, height: 2.27, x: -5.35, y: -2.2, z: 2.3, opacity: 0.94, renderOrder: 34 });
  leftPlant.rotation.z = -0.075;
  addBreathingLayer(leftPlant, { floatY: 0.075, floatX: 0.025, scale: 0.018, rotate: 0.04, speed: 0.82 });

  const rightTree = createPlane({ url: treeOrangeUrl, width: 1.86, height: 3.43, x: 5.85, y: -1.2, z: 1.0, opacity: 0.96, renderOrder: 20 });
  rightTree.rotation.z = 0.035;
  addBreathingLayer(rightTree, { floatY: 0.035, scale: 0.01, rotate: 0.027, speed: 0.58, phase: 2.2 });

  const goldTree = createPlane({ url: treeGoldUrl, width: 1.3, height: 2.83, x: -6.62, y: -2.0, z: 2.4, opacity: 0.86, renderOrder: 32 });
  goldTree.rotation.z = 0.04;
  addBreathingLayer(goldTree, { floatY: 0.04, scale: 0.012, rotate: 0.028, speed: 0.68, phase: 0.6 });

  const leftBee = createPlane({ url: beeRightUrl, width: 1.52, height: 1.67, x: -5.35, y: 2.1, z: 3.15, opacity: 0.97, depthTest: false, renderOrder: 78 });
  leftBee.rotation.z = -0.06;
  addBreathingLayer(leftBee, { floatY: 0.34, floatX: 0.42, scale: 0.035, rotate: 0.12, speed: 1.22, orbitX: 0.34, orbitY: 0.14 });

  const rightBee = createPlane({ url: beeLeftUrl, width: 1.42, height: 1.55, x: 5.48, y: 2.78, z: 3.2, opacity: 0.97, depthTest: false, renderOrder: 78 });
  rightBee.rotation.z = 0.03;
  addBreathingLayer(rightBee, { floatY: 0.28, floatX: 0.36, scale: 0.03, rotate: 0.11, speed: 1.12, phase: 1.7, orbitX: 0.3, orbitY: 0.16 });

  addFlowerField();

  const butterflyA = createPlane({ url: butterflyYellowUrl, width: 0.54, height: 0.5, x: -4.62, y: -1.8, z: 3.1, opacity: 0.9, depthTest: false, renderOrder: 70 });
  addBreathingLayer(butterflyA, { floatY: 0.25, floatX: 0.25, scale: 0.04, rotate: 0.2, speed: 1.35, orbitX: 0.25, orbitY: 0.18 });

  const butterflyB = createPlane({ url: butterflyTealUrl, width: 0.46, height: 0.26, x: 5.2, y: -1.85, z: 3.15, opacity: 0.9, depthTest: false, renderOrder: 70 });
  addBreathingLayer(butterflyB, { floatY: 0.22, floatX: 0.24, scale: 0.035, rotate: 0.17, speed: 1.18, phase: 2.2, orbitX: 0.28, orbitY: 0.12 });

  const butterflyC = createPlane({ url: butterflyGoldUrl, width: 0.38, height: 0.26, x: -2.35, y: -2.0, z: 3.2, opacity: 0.84, depthTest: false, renderOrder: 70 });
  addBreathingLayer(butterflyC, { floatY: 0.2, floatX: 0.18, scale: 0.036, rotate: 0.18, speed: 1.08, phase: 1.1, orbitX: 0.18, orbitY: 0.1 });

  addParticleField();
  addRareBeeTraffic();
}

function animate(time = 0) {
  const t = time * 0.001;
  animated.forEach(item => {
    if (item.particleField) {
      item.mesh.rotation.z = Math.sin(t * item.speed + item.phase) * 0.05;
      item.mesh.position.y = item.basePosition.y + Math.sin(t * 0.34 + item.phase) * 0.08;
      return;
    }

    const wave = Math.sin(t * item.speed + item.phase);
    const orbit = Math.cos(t * item.speed * 0.64 + item.phase);
    item.mesh.position.x = item.basePosition.x + wave * item.floatX + orbit * item.orbitX;
    item.mesh.position.y = item.basePosition.y + wave * item.floatY + Math.sin(t * item.speed * 1.4 + item.phase) * item.orbitY;
    item.mesh.position.z = item.basePosition.z + Math.sin(t * item.speed * 0.5 + item.phase) * 0.06;
    item.mesh.rotation.z = item.baseRotationZ + wave * item.rotate;
    const scale = 1 + wave * item.scale;
    item.mesh.scale.set(item.baseScale.x * scale, item.baseScale.y * scale, item.baseScale.z);
  });

  updateRareBeeFlight(t);
  renderer.render(scene, camera);
  frameId = requestAnimationFrame(animate);
}

function resize() {
  if (!mount.value || !renderer || !camera) return;
  const { width, height } = mount.value.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.position.z = width < 760 ? 12.2 : 10.25;
  camera.fov = width < 760 ? 45 : 38;
  camera.updateProjectionMatrix();
}

onMounted(() => {
  scene = new Scene();
  camera = new PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.15, 10.25);

  renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  mount.value.appendChild(renderer.domElement);

  buildScene();
  resize();
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(mount.value);

  markUserActivity();
  window.addEventListener('resize', resize);
  window.addEventListener('pointerdown', markUserActivity);
  window.addEventListener('keydown', markUserActivity);
  window.addEventListener('bee-meter-activity', markUserActivity);
  frameId = requestAnimationFrame(animate);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frameId);
  window.removeEventListener('resize', resize);
  window.removeEventListener('pointerdown', markUserActivity);
  window.removeEventListener('keydown', markUserActivity);
  window.removeEventListener('bee-meter-activity', markUserActivity);
  resizeObserver?.disconnect();
  cleanup.forEach(dispose => dispose());
  renderer?.dispose();
  renderer?.domElement?.remove();
});
</script>
