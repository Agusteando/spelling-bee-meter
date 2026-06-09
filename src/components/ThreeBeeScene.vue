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
  Sprite,
  SpriteMaterial,
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
const pointerTarget = new Vector2(0, 0);
const cameraDrift = new Vector2(0, 0);

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

function createBillboard({
  url,
  width,
  height,
  x = 0,
  y = 0,
  z = 0,
  opacity = 1,
  depthTest = false,
  renderOrder = 0,
  visible = true,
  sizeAttenuation = true
}) {
  const texture = makeTexture(url);
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest,
    alphaTest: 0.01,
    sizeAttenuation
  });
  const sprite = new Sprite(material);
  sprite.position.set(x, y, z);
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = renderOrder;
  sprite.visible = visible;
  scene.add(sprite);
  cleanup.push(() => {
    material.dispose();
    texture.dispose();
  });
  return sprite;
}

function createColorPlane({
  width,
  height,
  x = 0,
  y = 0,
  z = 0,
  color = '#2f7d37',
  opacity = 1,
  renderOrder = 0
}) {
  const geometry = new PlaneGeometry(width, height);
  const material = new MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.renderOrder = renderOrder;
  scene.add(mesh);
  cleanup.push(() => {
    geometry.dispose();
    material.dispose();
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
    orbitY: options.orbitY ?? 0,
    parallax: options.parallax ?? 0
  });
}

function addParticleField() {
  const count = 128;
  const positions = [];
  const spread = new Vector2(13.8, 6.2);
  for (let i = 0; i < count; i += 1) {
    positions.push(
      (Math.random() - 0.5) * spread.x,
      (Math.random() - 0.5) * spread.y + 0.05,
      Math.random() * 2.8 - 0.15
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const texture = makeTexture(pollenGlowUrl);
  const material = new PointsMaterial({
    map: texture,
    transparent: true,
    opacity: 0.56,
    size: 0.13,
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

function createDancingFlower({
  url,
  x,
  baseY,
  z,
  size,
  stemHeight,
  stemColor = '#2d7e3e',
  phase = 0,
  swing = 0.12,
  speed = 1,
  tilt = 0,
  order = 90,
  opacity = 1
}) {
  const stemWidth = Math.max(0.035, size * 0.085);
  const stem = createColorPlane({
    width: stemWidth,
    height: stemHeight,
    x,
    y: baseY + stemHeight / 2,
    z,
    color: stemColor,
    opacity: 0.92,
    renderOrder: order
  });
  const head = createBillboard({
    url,
    width: size,
    height: size * 1.08,
    x,
    y: baseY + stemHeight,
    z: z + 0.035,
    opacity,
    depthTest: false,
    renderOrder: order + 2
  });
  const leafLeft = createColorPlane({
    width: stemWidth * 4.8,
    height: stemWidth * 1.9,
    x: x - stemWidth * 2.2,
    y: baseY + stemHeight * 0.42,
    z: z + 0.015,
    color: '#4f983f',
    opacity: 0.82,
    renderOrder: order + 1
  });
  const leafRight = createColorPlane({
    width: stemWidth * 4.4,
    height: stemWidth * 1.75,
    x: x + stemWidth * 2.15,
    y: baseY + stemHeight * 0.58,
    z: z + 0.012,
    color: '#78a843',
    opacity: 0.78,
    renderOrder: order + 1
  });

  leafLeft.rotation.z = -0.62;
  leafRight.rotation.z = 0.58;

  animated.push({
    flowerDance: true,
    head,
    stem,
    leafLeft,
    leafRight,
    baseX: x,
    baseY,
    z,
    stemHeight,
    stemWidth,
    baseSize: size,
    phase,
    swing,
    speed,
    tilt,
    baseOpacity: opacity
  });

  return head;
}

function addFlowerField() {
  const flowerTextures = [
    flowerRedUrl,
    flowerYellowUrl,
    flowerOrangeUrl,
    flowerRedMidUrl,
    flowerYellowMidUrl,
    flowerOrangeMidUrl
  ];

  const foregroundGarden = [
    [-6.55, -3.18, 5.15, 0.62, 1.04, 0, -0.08],
    [-6.16, -3.2, 5.12, 0.42, 0.72, 3, 0.09],
    [-5.76, -3.13, 5.18, 0.58, 0.96, 2, -0.06],
    [-5.28, -3.18, 5.18, 0.36, 0.62, 4, 0.07],
    [-4.82, -3.2, 5.08, 0.46, 0.82, 0, -0.04],
    [-4.28, -3.16, 4.95, 0.36, 0.66, 5, 0.05],
    [-3.52, -3.18, 4.82, 0.36, 0.62, 1, -0.06],
    [-2.84, -3.16, 4.76, 0.3, 0.5, 4, 0.04],
    [2.38, -3.16, 4.78, 0.34, 0.58, 2, -0.05],
    [3.02, -3.17, 4.84, 0.4, 0.76, 3, 0.08],
    [3.62, -3.13, 5.0, 0.58, 0.98, 1, -0.08],
    [4.12, -3.2, 5.06, 0.36, 0.62, 5, 0.05],
    [4.68, -3.14, 5.16, 0.5, 0.9, 0, -0.07],
    [5.16, -3.2, 5.22, 0.44, 0.72, 4, 0.09],
    [5.66, -3.12, 5.26, 0.62, 1.05, 2, -0.06],
    [6.14, -3.18, 5.28, 0.42, 0.7, 3, 0.08],
    [6.54, -3.16, 5.3, 0.58, 0.94, 1, -0.04]
  ];

  const midGarden = [
    [-6.36, -2.84, 4.36, 0.34, 0.72, 0, 0.05],
    [-5.62, -2.74, 4.18, 0.28, 0.54, 4, -0.05],
    [-4.74, -2.84, 4.1, 0.32, 0.62, 5, 0.06],
    [-3.82, -2.82, 3.94, 0.26, 0.5, 1, -0.06],
    [-2.22, -2.88, 3.86, 0.24, 0.42, 2, 0.04],
    [-0.88, -2.94, 3.82, 0.2, 0.36, 4, -0.04],
    [0.72, -2.94, 3.84, 0.22, 0.38, 5, 0.06],
    [2.08, -2.88, 3.9, 0.26, 0.48, 1, -0.05],
    [3.18, -2.82, 4.0, 0.28, 0.54, 3, 0.07],
    [4.18, -2.76, 4.22, 0.32, 0.62, 0, -0.06],
    [5.16, -2.78, 4.3, 0.36, 0.72, 2, 0.06],
    [6.04, -2.86, 4.42, 0.34, 0.62, 4, -0.04]
  ];

  [...foregroundGarden, ...midGarden].forEach(([x, baseY, z, size, stemHeight, textureIndex, tilt], index) => {
    createDancingFlower({
      url: flowerTextures[textureIndex % flowerTextures.length],
      x,
      baseY,
      z,
      size,
      stemHeight,
      tilt,
      order: 82 + index,
      phase: index * 0.43,
      speed: 0.86 + (index % 7) * 0.09,
      swing: 0.11 + (index % 5) * 0.018,
      stemColor: index % 3 === 0 ? '#2c8a42' : index % 3 === 1 ? '#5f9d3d' : '#1d8177'
    });
  });

  const driftingPetals = [
    [-1.7, -2.55, 4.9, 0.18, 0],
    [-0.25, -2.44, 4.8, 0.14, 1],
    [1.4, -2.6, 4.86, 0.16, 2],
    [2.72, -2.38, 4.9, 0.14, 3],
    [-4.92, -2.18, 4.7, 0.2, 4],
    [4.9, -2.12, 4.76, 0.18, 5]
  ];

  driftingPetals.forEach(([x, y, z, size, textureIndex], index) => {
    const petal = createBillboard({
      url: textureIndex % 2 === 0 ? dotYellowUrl : flowerTextures[textureIndex % flowerTextures.length],
      width: size,
      height: size,
      x,
      y,
      z,
      opacity: 0.82,
      depthTest: false,
      renderOrder: 118 + index
    });
    addBreathingLayer(petal, {
      floatX: 0.18 + index * 0.02,
      floatY: 0.12,
      orbitX: 0.18,
      orbitY: 0.08,
      scale: 0.08,
      rotate: 0.4,
      speed: 0.72 + index * 0.13,
      phase: index * 0.9
    });
  });
}

function addRareBeeTraffic() {
  const rightFlyingBee = createBillboard({
    url: beeRightUrl,
    width: 1.18,
    height: 1.3,
    z: 5.05,
    opacity: 0.98,
    depthTest: false,
    renderOrder: 150,
    visible: false
  });
  const leftFlyingBee = createBillboard({
    url: beeLeftUrl,
    width: 1.18,
    height: 1.3,
    z: 5.05,
    opacity: 0.98,
    depthTest: false,
    renderOrder: 150,
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
    z: 5.05,
    start: 0,
    duration: 11,
    direction: 1
  };
}

function markUserActivity() {
  lastUserActivity = performance.now() * 0.001;
  nextRareBeeAt = lastUserActivity + 17 + Math.random() * 24;
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
  rareBee.fromX = direction > 0 ? -8.65 : 8.65;
  rareBee.toX = direction > 0 ? 8.65 : -8.65;
  rareBee.y = 1.55 + Math.random() * 1.55;
  rareBee.z = 5.0 + Math.random() * 0.25;
  rareBee.start = t;
  rareBee.duration = 11.5 + Math.random() * 5.5;
  rareBee.mesh = direction > 0 ? rareBee.rightFlyingBee : rareBee.leftFlyingBee;
  rareBee.rightFlyingBee.visible = direction > 0;
  rareBee.leftFlyingBee.visible = direction < 0;
  rareBee.mesh.position.set(rareBee.fromX, rareBee.y, rareBee.z);
  rareBee.mesh.rotation.z = direction > 0 ? -0.05 : 0.05;
  rareBee.mesh.scale.set(1, 1, 1);
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
  const bob = Math.sin(progress * Math.PI * 3.4) * 0.24 + Math.sin(t * 8.5) * 0.06;
  const arc = Math.sin(progress * Math.PI) * 0.42;
  const wingPulse = 1 + Math.sin(t * 18) * 0.045;

  mesh.position.x = rareBee.fromX + (rareBee.toX - rareBee.fromX) * ease;
  mesh.position.y = rareBee.y + bob + arc;
  mesh.position.z = rareBee.z + Math.sin(progress * Math.PI) * 0.3;
  mesh.rotation.z = (rareBee.direction > 0 ? -0.08 : 0.08) + Math.sin(t * 7) * 0.045;
  mesh.scale.set(1 + Math.sin(t * 11) * 0.02, wingPulse, 1);

  if (progress >= 1) {
    rareBee.active = false;
    rareBee.rightFlyingBee.visible = false;
    rareBee.leftFlyingBee.visible = false;
    nextRareBeeAt = t + 22 + Math.random() * 36;
  }
}

function buildScene() {
  createPlane({ url: backgroundPanelUrl, width: 13.4, height: 7.55, y: 0.25, z: -3.2, transparent: false, depthWrite: true, renderOrder: 0 });

  const topLogo = createPlane({ url: iedisLogoUrl, width: 3.52, height: 1.47, x: 0, y: 2.72, z: -0.1, opacity: 0.96, renderOrder: 8 });
  addBreathingLayer(topLogo, { floatY: 0.025, scale: 0.006, rotate: 0.004, speed: 0.35, parallax: 0.04 });

  const eventLogo = createPlane({ url: eventLogoUrl, width: 3.78, height: 1.13, x: 0.2, y: -0.94, z: 1.4, opacity: 0.96, renderOrder: 24 });
  addBreathingLayer(eventLogo, { floatY: 0.04, scale: 0.01, rotate: 0.006, speed: 0.55, parallax: 0.08 });

  const hillsBack = createPlane({ url: hillsUrl, width: 15.2, height: 3.43, x: -0.1, y: -3.02, z: 0.15, opacity: 0.94, renderOrder: 16 });
  addBreathingLayer(hillsBack, { floatY: 0.045, scale: 0.008, rotate: 0.003, speed: 0.42, parallax: 0.06 });

  const hillsFront = createPlane({ url: hillsUrl, width: 15.9, height: 3.59, x: 0.2, y: -3.32, z: 2.05, opacity: 0.86, renderOrder: 30 });
  addBreathingLayer(hillsFront, { floatY: 0.04, scale: 0.012, rotate: 0.002, speed: 0.36, phase: 1.8, parallax: 0.12 });

  const leftTree = createPlane({ url: treeLeftUrl, width: 2.44, height: 5.93, x: -5.96, y: -0.78, z: 0.92, opacity: 0.97, renderOrder: 20 });
  leftTree.rotation.z = -0.025;
  addBreathingLayer(leftTree, { floatY: 0.03, scale: 0.012, rotate: 0.026, speed: 0.62, parallax: 0.1 });

  const leftPlant = createPlane({ url: plantButterflyUrl, width: 1.28, height: 2.46, x: -5.24, y: -2.12, z: 2.28, opacity: 0.95, renderOrder: 34 });
  leftPlant.rotation.z = -0.075;
  addBreathingLayer(leftPlant, { floatY: 0.075, floatX: 0.025, scale: 0.018, rotate: 0.04, speed: 0.82, parallax: 0.16 });

  const rightTree = createPlane({ url: treeOrangeUrl, width: 2.12, height: 3.92, x: 5.82, y: -1.05, z: 0.96, opacity: 0.98, renderOrder: 20 });
  rightTree.rotation.z = 0.035;
  addBreathingLayer(rightTree, { floatY: 0.035, scale: 0.01, rotate: 0.027, speed: 0.58, phase: 2.2, parallax: 0.1 });

  const goldTree = createPlane({ url: treeGoldUrl, width: 1.48, height: 3.22, x: -6.62, y: -1.86, z: 2.38, opacity: 0.9, renderOrder: 32 });
  goldTree.rotation.z = 0.04;
  addBreathingLayer(goldTree, { floatY: 0.04, scale: 0.012, rotate: 0.028, speed: 0.68, phase: 0.6, parallax: 0.16 });

  const leftBee = createBillboard({ url: beeRightUrl, width: 1.68, height: 1.85, x: -5.34, y: 2.1, z: 3.35, opacity: 0.98, depthTest: false, renderOrder: 140 });
  leftBee.rotation.z = -0.06;
  addBreathingLayer(leftBee, { floatY: 0.34, floatX: 0.42, scale: 0.035, rotate: 0.12, speed: 1.22, orbitX: 0.34, orbitY: 0.14, parallax: 0.2 });

  const rightBee = createBillboard({ url: beeLeftUrl, width: 1.58, height: 1.73, x: 5.48, y: 2.78, z: 3.38, opacity: 0.98, depthTest: false, renderOrder: 140 });
  rightBee.rotation.z = 0.03;
  addBreathingLayer(rightBee, { floatY: 0.28, floatX: 0.36, scale: 0.03, rotate: 0.11, speed: 1.12, phase: 1.7, orbitX: 0.3, orbitY: 0.16, parallax: 0.2 });

  addFlowerField();

  const butterflyA = createBillboard({ url: butterflyYellowUrl, width: 0.54, height: 0.5, x: -4.62, y: -1.8, z: 4.6, opacity: 0.9, depthTest: false, renderOrder: 125 });
  addBreathingLayer(butterflyA, { floatY: 0.25, floatX: 0.25, scale: 0.04, rotate: 0.2, speed: 1.35, orbitX: 0.25, orbitY: 0.18, parallax: 0.24 });

  const butterflyB = createBillboard({ url: butterflyTealUrl, width: 0.46, height: 0.26, x: 5.2, y: -1.85, z: 4.62, opacity: 0.9, depthTest: false, renderOrder: 125 });
  addBreathingLayer(butterflyB, { floatY: 0.22, floatX: 0.24, scale: 0.035, rotate: 0.17, speed: 1.18, phase: 2.2, orbitX: 0.28, orbitY: 0.12, parallax: 0.24 });

  const butterflyC = createBillboard({ url: butterflyGoldUrl, width: 0.38, height: 0.26, x: -2.35, y: -2.0, z: 4.64, opacity: 0.84, depthTest: false, renderOrder: 125 });
  addBreathingLayer(butterflyC, { floatY: 0.2, floatX: 0.18, scale: 0.036, rotate: 0.18, speed: 1.08, phase: 1.1, orbitX: 0.18, orbitY: 0.1, parallax: 0.24 });

  addParticleField();
  addRareBeeTraffic();
}

function animate(time = 0) {
  const t = time * 0.001;

  cameraDrift.x += (pointerTarget.x - cameraDrift.x) * 0.035;
  cameraDrift.y += (pointerTarget.y - cameraDrift.y) * 0.035;
  camera.position.x = cameraDrift.x * 0.2;
  camera.position.y = 0.15 + cameraDrift.y * 0.12;
  camera.lookAt(cameraDrift.x * 0.05, 0.08 + cameraDrift.y * 0.04, 0);

  animated.forEach(item => {
    if (item.particleField) {
      item.mesh.rotation.z = Math.sin(t * item.speed + item.phase) * 0.05;
      item.mesh.position.y = item.basePosition.y + Math.sin(t * 0.34 + item.phase) * 0.08;
      return;
    }

    if (item.flowerDance) {
      const wave = Math.sin(t * item.speed + item.phase);
      const quick = Math.sin(t * item.speed * 2.2 + item.phase * 0.7);
      const angle = item.tilt + wave * item.swing;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const stemMidX = item.baseX + sin * item.stemHeight * 0.5;
      const stemMidY = item.baseY + cos * item.stemHeight * 0.5;
      const headX = item.baseX + sin * item.stemHeight + quick * 0.025;
      const headY = item.baseY + cos * item.stemHeight + Math.abs(wave) * 0.045;
      const leafWave = Math.sin(t * item.speed * 1.4 + item.phase);
      const pulse = 1 + wave * 0.07 + quick * 0.015;

      item.stem.position.x = stemMidX;
      item.stem.position.y = stemMidY;
      item.stem.rotation.z = -angle;
      item.head.position.x = headX;
      item.head.position.y = headY;
      item.head.rotation.z = wave * 0.24 + quick * 0.05;
      item.head.scale.set(item.baseSize * pulse, item.baseSize * 1.08 * (1 + wave * 0.045), 1);
      item.leafLeft.position.x = item.baseX - item.stemWidth * 2.2 + sin * item.stemHeight * 0.38;
      item.leafLeft.position.y = item.baseY + cos * item.stemHeight * 0.42;
      item.leafLeft.rotation.z = -0.62 - angle * 0.35 + leafWave * 0.07;
      item.leafRight.position.x = item.baseX + item.stemWidth * 2.15 + sin * item.stemHeight * 0.54;
      item.leafRight.position.y = item.baseY + cos * item.stemHeight * 0.58;
      item.leafRight.rotation.z = 0.58 - angle * 0.28 - leafWave * 0.06;
      return;
    }

    const wave = Math.sin(t * item.speed + item.phase);
    const orbit = Math.cos(t * item.speed * 0.64 + item.phase);
    const parallaxX = cameraDrift.x * item.parallax;
    const parallaxY = cameraDrift.y * item.parallax * 0.6;
    item.mesh.position.x = item.basePosition.x + wave * item.floatX + orbit * item.orbitX - parallaxX;
    item.mesh.position.y = item.basePosition.y + wave * item.floatY + Math.sin(t * item.speed * 1.4 + item.phase) * item.orbitY - parallaxY;
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
  camera.position.z = width < 760 ? 12.8 : 10.6;
  camera.fov = width < 760 ? 47 : 39;
  camera.updateProjectionMatrix();
}

function trackPointer(event) {
  const width = window.innerWidth || 1;
  const height = window.innerHeight || 1;
  pointerTarget.x = ((event.clientX / width) - 0.5) * 2;
  pointerTarget.y = -(((event.clientY / height) - 0.5) * 2);
}

onMounted(() => {
  scene = new Scene();
  camera = new PerspectiveCamera(39, 1, 0.1, 100);
  camera.position.set(0, 0.15, 10.6);

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
  window.addEventListener('pointermove', trackPointer);
  window.addEventListener('pointerdown', markUserActivity);
  window.addEventListener('keydown', markUserActivity);
  window.addEventListener('bee-meter-activity', markUserActivity);
  frameId = requestAnimationFrame(animate);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frameId);
  window.removeEventListener('resize', resize);
  window.removeEventListener('pointermove', trackPointer);
  window.removeEventListener('pointerdown', markUserActivity);
  window.removeEventListener('keydown', markUserActivity);
  window.removeEventListener('bee-meter-activity', markUserActivity);
  resizeObserver?.disconnect();
  cleanup.forEach(dispose => dispose());
  renderer?.dispose();
  renderer?.domElement?.remove();
});
</script>
