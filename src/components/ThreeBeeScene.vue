<template>
  <div ref="mount" class="bee-world" aria-hidden="true"></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  Shape,
  ShapeGeometry,
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
let worldRoot;
let lastUserActivity = 0;
let nextRareBeeAt = 0;

const WORLD_WIDTH = 14.2;
const SAFE_CONTENT_HALF_WIDTH = 3.75;
const animated = [];
const cleanup = [];
const textureLoader = new TextureLoader();
const pointerTarget = new Vector2(0, 0);
const cameraDrift = new Vector2(0, 0);

function addToWorld(object, parent) {
  (parent || worldRoot || scene).add(object);
}

function makeTexture(url) {
  const texture = textureLoader.load(url);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeCanvasTexture(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  draw(ctx, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  cleanup.push(() => texture.dispose());
  return texture;
}

function createPlane({
  url,
  texture,
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
  visible = true,
  parent
}) {
  const map = texture || makeTexture(url);
  const material = new MeshBasicMaterial({
    map,
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
  addToWorld(mesh, parent);
  cleanup.push(() => {
    geometry.dispose();
    material.dispose();
    if (!texture) map.dispose();
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
  parent,
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
  addToWorld(sprite, parent);
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
  renderOrder = 0,
  parent
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
  addToWorld(mesh, parent);
  cleanup.push(() => {
    geometry.dispose();
    material.dispose();
  });
  return mesh;
}

function addBreathingLayer(mesh, options = {}) {
  animated.push({
    type: 'breathing',
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
    orbitX: options.orbitX ?? 0,
    orbitY: options.orbitY ?? 0,
    parallax: options.parallax ?? 0
  });
}

function addPatternAnimation(mesh, options = {}) {
  animated.push({
    type: 'pattern',
    mesh,
    basePosition: mesh.position.clone(),
    baseRotationZ: mesh.rotation.z,
    baseOpacity: mesh.material.opacity,
    phase: options.phase ?? 0,
    speed: options.speed ?? 0.2,
    opacityWave: options.opacityWave ?? 0.05,
    driftX: options.driftX ?? 0.02,
    driftY: options.driftY ?? 0.018,
    rotate: options.rotate ?? 0.006,
    parallax: options.parallax ?? 0.05
  });
}

function sampleFrontGround(x) {
  return -2.78 + Math.sin((x + 0.8) * 0.95) * 0.12 + Math.sin(x * 1.9) * 0.045;
}

function sampleMidGround(x) {
  return -2.54 + Math.sin((x - 0.25) * 0.82) * 0.13 + Math.sin(x * 1.25) * 0.035;
}

function sampleBackGround(x) {
  return -2.36 + Math.sin((x + 1.4) * 0.7) * 0.1;
}

function createWavyHill({
  width,
  height,
  x = 0,
  y = 0,
  z = 0,
  color,
  opacity = 1,
  renderOrder = 0,
  amplitude = 0.24,
  frequency = 1,
  phase = 0
}) {
  const shape = new Shape();
  const left = -width / 2;
  const bottom = -height / 2;
  const topBase = height / 2 - 0.45;
  const points = [];
  const segments = 12;
  for (let i = 0; i <= segments; i += 1) {
    const px = left + (width / segments) * i;
    const py = topBase + Math.sin(i * frequency + phase) * amplitude + Math.sin(i * 0.57 + phase) * amplitude * 0.4;
    points.push([px, py]);
  }

  shape.moveTo(left, bottom);
  shape.lineTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    const [prevX, prevY] = points[i - 1];
    const [nextX, nextY] = points[i];
    const midX = (prevX + nextX) / 2;
    const midY = (prevY + nextY) / 2;
    shape.quadraticCurveTo(prevX, prevY, midX, midY);
  }
  const last = points[points.length - 1];
  shape.lineTo(last[0], last[1]);
  shape.lineTo(width / 2, bottom);
  shape.lineTo(left, bottom);

  const geometry = new ShapeGeometry(shape, 48);
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
  addToWorld(mesh);
  cleanup.push(() => {
    geometry.dispose();
    material.dispose();
  });
  return mesh;
}

function createPatternTexture(type, palette) {
  return makeCanvasTexture((ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (type === 'circles') {
      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = 18;
      for (let i = 0; i < 6; i += 1) {
        ctx.beginPath();
        ctx.arc(60 + i * 92, 90 + (i % 2) * 220, 62 + (i % 3) * 18, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (type === 'diagonal') {
      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = 14;
      for (let i = -5; i < 12; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * 70, height + 20);
        ctx.lineTo(i * 70 + 280, -20);
        ctx.stroke();
      }
    }

    if (type === 'dots') {
      ctx.fillStyle = palette.fill;
      for (let y = 58; y < height; y += 62) {
        for (let x = 58; x < width; x += 62) {
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    if (type === 'blocks') {
      ctx.fillStyle = palette.fill;
      for (let y = 0; y < height; y += 168) {
        for (let x = 0; x < width; x += 168) {
          ctx.save();
          ctx.translate(x + 84, y + 84);
          ctx.rotate(((x + y) % 3) * 0.2);
          ctx.fillRect(-52, -52, 104, 104);
          ctx.restore();
        }
      }
    }

    if (type === 'wings') {
      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = 15;
      for (let i = 0; i < 4; i += 1) {
        const ox = 90 + i * 125;
        const oy = 135 + (i % 2) * 190;
        ctx.beginPath();
        ctx.ellipse(ox, oy, 90, 36, -0.35, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(ox + 70, oy + 3, 90, 36, 0.35, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });
}

function addPatternTileGrid() {
  const types = ['circles', 'diagonal', 'dots', 'blocks', 'wings'];
  const palette = {
    stroke: 'rgba(154, 123, 65, 0.2)',
    fill: 'rgba(197, 158, 85, 0.16)'
  };
  const cols = 6;
  const rows = 3;
  const tileWidth = 2.28;
  const tileHeight = 1.72;
  const startX = -((cols - 1) * tileWidth) / 2;
  const startY = 1.52;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const texture = createPatternTexture(types[(row * cols + col) % types.length], palette);
      const tile = createPlane({
        texture,
        width: tileWidth + 0.02,
        height: tileHeight + 0.02,
        x: startX + col * tileWidth,
        y: startY - row * tileHeight,
        z: -2.42 - row * 0.06,
        opacity: 0.32,
        transparent: true,
        depthTest: false,
        renderOrder: 2
      });
      addPatternAnimation(tile, {
        phase: row * 0.7 + col * 0.31,
        speed: 0.13 + ((row + col) % 4) * 0.035,
        opacityWave: 0.05,
        driftX: 0.015 + col * 0.002,
        driftY: 0.012 + row * 0.003,
        rotate: 0.004,
        parallax: 0.035 + row * 0.018
      });
    }
  }
}

function addParticleField() {
  const count = 148;
  const positions = [];
  const spread = new Vector2(13.2, 5.9);
  for (let i = 0; i < count; i += 1) {
    positions.push(
      (Math.random() - 0.5) * spread.x,
      (Math.random() - 0.5) * spread.y + 0.08,
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
    size: 0.12,
    blending: AdditiveBlending,
    depthWrite: false
  });
  const points = new Points(geometry, material);
  points.position.z = 2.72;
  points.renderOrder = 12;
  addToWorld(points);
  animated.push({
    type: 'particles',
    mesh: points,
    basePosition: points.position.clone(),
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
  const root = new Group();
  root.position.set(x, baseY, z);
  root.renderOrder = order;
  addToWorld(root);

  const stemWidth = Math.max(0.035, size * 0.08);
  const stem = createColorPlane({
    width: stemWidth,
    height: stemHeight,
    x: 0,
    y: stemHeight / 2,
    z: 0,
    color: stemColor,
    opacity: 0.94,
    renderOrder: order,
    parent: root
  });

  const leafLeft = createColorPlane({
    width: stemWidth * 5.0,
    height: stemWidth * 1.9,
    x: -stemWidth * 2.1,
    y: stemHeight * 0.38,
    z: 0.015,
    color: '#4f983f',
    opacity: 0.84,
    renderOrder: order + 1,
    parent: root
  });
  const leafRight = createColorPlane({
    width: stemWidth * 4.8,
    height: stemWidth * 1.75,
    x: stemWidth * 2.1,
    y: stemHeight * 0.58,
    z: 0.015,
    color: '#78a843',
    opacity: 0.8,
    renderOrder: order + 1,
    parent: root
  });

  const head = createBillboard({
    url,
    width: size,
    height: size * 1.08,
    x: 0,
    y: stemHeight,
    z: 0.05,
    opacity,
    depthTest: false,
    renderOrder: order + 3,
    parent: root
  });

  leafLeft.rotation.z = -0.68;
  leafRight.rotation.z = 0.62;

  animated.push({
    type: 'flower',
    root,
    head,
    stem,
    leafLeft,
    leafRight,
    basePosition: root.position.clone(),
    baseRotationZ: tilt,
    stemHeight,
    stemWidth,
    baseSize: size,
    phase,
    swing,
    speed,
    baseOpacity: opacity
  });

  return root;
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

  const sideGarden = [
    [-6.62, 'front', 0.54, 0.9, 0, -0.08],
    [-6.22, 'front', 0.36, 0.64, 1, 0.08],
    [-5.78, 'front', 0.48, 0.78, 2, -0.04],
    [-5.34, 'front', 0.34, 0.58, 3, 0.08],
    [-4.86, 'front', 0.43, 0.72, 4, -0.05],
    [-4.28, 'front', 0.32, 0.55, 5, 0.06],
    [4.06, 'front', 0.32, 0.55, 2, -0.06],
    [4.58, 'front', 0.44, 0.74, 0, 0.07],
    [5.04, 'front', 0.34, 0.58, 5, -0.05],
    [5.46, 'front', 0.58, 0.92, 1, 0.08],
    [5.96, 'front', 0.38, 0.62, 3, -0.06],
    [6.44, 'front', 0.54, 0.86, 2, 0.06]
  ];

  const safeCenterGarden = [
    [-3.34, 'mid', 0.26, 0.42, 4, -0.04],
    [-2.54, 'mid', 0.22, 0.36, 5, 0.05],
    [2.42, 'mid', 0.24, 0.38, 3, -0.04],
    [3.24, 'mid', 0.28, 0.45, 0, 0.04],
    [-1.3, 'back', 0.16, 0.25, 1, -0.03],
    [1.16, 'back', 0.16, 0.25, 2, 0.03]
  ];

  [...sideGarden, ...safeCenterGarden].forEach(([x, layer, size, stemHeight, textureIndex, tilt], index) => {
    const ground = layer === 'front'
      ? sampleFrontGround(x)
      : layer === 'mid'
        ? sampleMidGround(x)
        : sampleBackGround(x);
    const z = layer === 'front' ? 5.12 : layer === 'mid' ? 4.38 : 3.68;
    createDancingFlower({
      url: flowerTextures[textureIndex % flowerTextures.length],
      x,
      baseY: ground + 0.02,
      z,
      size,
      stemHeight,
      tilt,
      order: 88 + index,
      phase: index * 0.47,
      speed: 0.84 + (index % 7) * 0.095,
      swing: 0.1 + (index % 5) * 0.018,
      stemColor: index % 3 === 0 ? '#2c8a42' : index % 3 === 1 ? '#5f9d3d' : '#1d8177'
    });
  });

  const driftingPetals = [
    [-4.9, -2.08, 4.7, 0.2, 4],
    [-2.86, -2.24, 4.5, 0.15, 0],
    [0.0, -2.14, 4.48, 0.12, 2],
    [2.82, -2.18, 4.56, 0.15, 5],
    [4.96, -2.02, 4.72, 0.18, 1]
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
      renderOrder: 120 + index
    });
    addBreathingLayer(petal, {
      floatX: 0.16 + index * 0.03,
      floatY: 0.11,
      orbitX: 0.12,
      orbitY: 0.08,
      scale: 0.075,
      rotate: 0.42,
      speed: 0.7 + index * 0.14,
      phase: index * 0.9,
      parallax: 0.18
    });
  });
}

function createAnchoredArt({ url, width, height, x, groundY, z, opacity, renderOrder, rotation = 0, sway = 0.02, phase = 0, parallax = 0.1 }) {
  const root = new Group();
  root.position.set(x, groundY, z);
  addToWorld(root);
  const art = createPlane({
    url,
    width,
    height,
    x: 0,
    y: height / 2,
    z: 0,
    opacity,
    renderOrder,
    depthTest: false,
    parent: root
  });
  animated.push({
    type: 'anchored',
    root,
    mesh: art,
    basePosition: root.position.clone(),
    baseRotationZ: rotation,
    baseScale: root.scale.clone(),
    phase,
    speed: 0.52,
    sway,
    parallax
  });
  return root;
}

function addRareBeeTraffic() {
  const rightFlyingBee = createBillboard({
    url: beeRightUrl,
    width: 1.08,
    height: 1.19,
    z: 5.35,
    opacity: 0.98,
    depthTest: false,
    renderOrder: 160,
    visible: false
  });
  const leftFlyingBee = createBillboard({
    url: beeLeftUrl,
    width: 1.08,
    height: 1.19,
    z: 5.35,
    opacity: 0.98,
    depthTest: false,
    renderOrder: 160,
    visible: false
  });

  rareBee = {
    active: false,
    rightFlyingBee,
    leftFlyingBee,
    mesh: rightFlyingBee,
    fromX: -8.6,
    toX: 8.6,
    y: 2.1,
    z: 5.35,
    start: 0,
    duration: 11,
    direction: 1
  };
}

function markUserActivity() {
  lastUserActivity = performance.now() * 0.001;
  nextRareBeeAt = lastUserActivity + 19 + Math.random() * 24;
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
  rareBee.fromX = direction > 0 ? -8.7 : 8.7;
  rareBee.toX = direction > 0 ? 8.7 : -8.7;
  rareBee.y = 1.45 + Math.random() * 1.65;
  rareBee.z = 5.22 + Math.random() * 0.3;
  rareBee.start = t;
  rareBee.duration = 12 + Math.random() * 5.5;
  rareBee.mesh = direction > 0 ? rareBee.rightFlyingBee : rareBee.leftFlyingBee;
  rareBee.rightFlyingBee.visible = direction > 0;
  rareBee.leftFlyingBee.visible = direction < 0;
  rareBee.mesh.position.set(rareBee.fromX, rareBee.y, rareBee.z);
  rareBee.mesh.rotation.z = direction > 0 ? -0.06 : 0.06;
  rareBee.mesh.scale.set(1, 1, 1);
  rareBee.active = true;
}

function updateRareBeeFlight(t) {
  if (!rareBee) return;

  const idleSeconds = t - lastUserActivity;
  if (!rareBee.active) {
    if (idleSeconds > 15 && t >= nextRareBeeAt) {
      startRareBeeFlight(t);
    }
    return;
  }

  const progress = Math.min(1, (t - rareBee.start) / rareBee.duration);
  const ease = progress < 0.5
    ? 2 * progress * progress
    : 1 - ((-2 * progress + 2) ** 2) / 2;
  const mesh = rareBee.mesh;
  const bob = Math.sin(progress * Math.PI * 3.6) * 0.22 + Math.sin(t * 8.5) * 0.055;
  const arc = Math.sin(progress * Math.PI) * 0.48;
  const wingPulse = 1 + Math.sin(t * 18) * 0.045;

  mesh.position.x = rareBee.fromX + (rareBee.toX - rareBee.fromX) * ease;
  mesh.position.y = rareBee.y + bob + arc;
  mesh.position.z = rareBee.z + Math.sin(progress * Math.PI) * 0.34;
  mesh.rotation.z = (rareBee.direction > 0 ? -0.08 : 0.08) + Math.sin(t * 7) * 0.045;
  mesh.scale.set(1 + Math.sin(t * 11) * 0.02, wingPulse, 1);

  if (progress >= 1) {
    rareBee.active = false;
    rareBee.rightFlyingBee.visible = false;
    rareBee.leftFlyingBee.visible = false;
    nextRareBeeAt = t + 24 + Math.random() * 36;
  }
}

function buildScene() {
  createPlane({
    url: backgroundPanelUrl,
    width: 10.45,
    height: 5.85,
    y: 0.28,
    z: -3.05,
    opacity: 0.68,
    transparent: true,
    depthTest: false,
    renderOrder: 0
  });

  addPatternTileGrid();

  createWavyHill({ width: 16.0, height: 2.05, x: 0, y: -2.58, z: -0.3, color: '#cbd966', opacity: 0.82, renderOrder: 15, amplitude: 0.18, frequency: 0.8, phase: 0.5 });
  createWavyHill({ width: 16.2, height: 1.86, x: -0.15, y: -2.78, z: 1.45, color: '#acc348', opacity: 0.9, renderOrder: 30, amplitude: 0.22, frequency: 0.9, phase: 1.25 });
  createWavyHill({ width: 16.5, height: 1.58, x: 0.15, y: -2.94, z: 3.55, color: '#8fb93e', opacity: 0.98, renderOrder: 62, amplitude: 0.2, frequency: 1.0, phase: 2.0 });

  const topLogo = createPlane({ url: iedisLogoUrl, width: 3.36, height: 1.4, x: 0, y: 2.74, z: -0.04, opacity: 0.98, renderOrder: 10, depthTest: false });
  addBreathingLayer(topLogo, { floatY: 0.022, scale: 0.006, rotate: 0.004, speed: 0.35, parallax: 0.04 });

  const eventLogo = createPlane({ url: eventLogoUrl, width: 3.68, height: 1.1, x: 0.08, y: -0.96, z: 1.55, opacity: 0.96, renderOrder: 26, depthTest: false });
  addBreathingLayer(eventLogo, { floatY: 0.035, scale: 0.01, rotate: 0.006, speed: 0.55, parallax: 0.08 });

  createAnchoredArt({ url: treeLeftUrl, width: 1.95, height: 4.78, x: -6.34, groundY: sampleMidGround(-6.34) - 0.03, z: 1.04, opacity: 0.97, renderOrder: 28, rotation: -0.015, sway: 0.02, phase: 0.4, parallax: 0.1 });
  createAnchoredArt({ url: plantButterflyUrl, width: 1.06, height: 2.04, x: -5.18, groundY: sampleFrontGround(-5.18) - 0.02, z: 3.3, opacity: 0.95, renderOrder: 72, rotation: -0.065, sway: 0.035, phase: 2.4, parallax: 0.17 });
  createAnchoredArt({ url: treeOrangeUrl, width: 1.78, height: 3.3, x: 5.82, groundY: sampleMidGround(5.82) - 0.03, z: 1.06, opacity: 0.98, renderOrder: 28, rotation: 0.025, sway: 0.022, phase: 2.2, parallax: 0.1 });
  createAnchoredArt({ url: treeGoldUrl, width: 1.16, height: 2.52, x: -6.78, groundY: sampleFrontGround(-6.78) - 0.02, z: 3.22, opacity: 0.9, renderOrder: 70, rotation: 0.04, sway: 0.028, phase: 1.2, parallax: 0.18 });

  const leftBee = createBillboard({ url: beeRightUrl, width: 1.26, height: 1.38, x: -5.92, y: 2.35, z: 3.5, opacity: 0.98, depthTest: false, renderOrder: 142 });
  leftBee.rotation.z = -0.06;
  addBreathingLayer(leftBee, { floatY: 0.27, floatX: 0.34, scale: 0.035, rotate: 0.12, speed: 1.22, orbitX: 0.3, orbitY: 0.14, parallax: 0.2 });

  const rightBee = createBillboard({ url: beeLeftUrl, width: 1.22, height: 1.34, x: 5.98, y: 2.52, z: 3.5, opacity: 0.98, depthTest: false, renderOrder: 142 });
  rightBee.rotation.z = 0.03;
  addBreathingLayer(rightBee, { floatY: 0.24, floatX: 0.3, scale: 0.03, rotate: 0.11, speed: 1.12, phase: 1.7, orbitX: 0.28, orbitY: 0.16, parallax: 0.2 });

  addFlowerField();

  const butterflyA = createBillboard({ url: butterflyYellowUrl, width: 0.48, height: 0.44, x: -4.55, y: -1.6, z: 4.76, opacity: 0.9, depthTest: false, renderOrder: 125 });
  addBreathingLayer(butterflyA, { floatY: 0.25, floatX: 0.25, scale: 0.04, rotate: 0.2, speed: 1.35, orbitX: 0.25, orbitY: 0.18, parallax: 0.24 });

  const butterflyB = createBillboard({ url: butterflyTealUrl, width: 0.42, height: 0.24, x: 4.78, y: -1.62, z: 4.78, opacity: 0.9, depthTest: false, renderOrder: 125 });
  addBreathingLayer(butterflyB, { floatY: 0.22, floatX: 0.24, scale: 0.035, rotate: 0.17, speed: 1.18, phase: 2.2, orbitX: 0.28, orbitY: 0.12, parallax: 0.24 });

  const butterflyC = createBillboard({ url: butterflyGoldUrl, width: 0.34, height: 0.24, x: -2.9, y: -1.88, z: 4.62, opacity: 0.84, depthTest: false, renderOrder: 125 });
  addBreathingLayer(butterflyC, { floatY: 0.2, floatX: 0.18, scale: 0.036, rotate: 0.18, speed: 1.08, phase: 1.1, orbitX: 0.18, orbitY: 0.1, parallax: 0.24 });

  addParticleField();
  addRareBeeTraffic();
}

function animate(time = 0) {
  const t = time * 0.001;

  cameraDrift.x += (pointerTarget.x - cameraDrift.x) * 0.035;
  cameraDrift.y += (pointerTarget.y - cameraDrift.y) * 0.035;
  camera.position.x = cameraDrift.x * 0.17;
  camera.position.y = 0.16 + cameraDrift.y * 0.1;
  camera.lookAt(cameraDrift.x * 0.045, 0.08 + cameraDrift.y * 0.035, 0);

  animated.forEach(item => {
    if (item.type === 'particles') {
      item.mesh.rotation.z = Math.sin(t * item.speed + item.phase) * 0.05;
      item.mesh.position.y = item.basePosition.y + Math.sin(t * 0.34 + item.phase) * 0.08;
      return;
    }

    if (item.type === 'pattern') {
      const wave = Math.sin(t * item.speed + item.phase);
      const drift = Math.cos(t * item.speed * 0.8 + item.phase);
      item.mesh.position.x = item.basePosition.x + wave * item.driftX - cameraDrift.x * item.parallax;
      item.mesh.position.y = item.basePosition.y + drift * item.driftY - cameraDrift.y * item.parallax * 0.45;
      item.mesh.rotation.z = item.baseRotationZ + wave * item.rotate;
      item.mesh.material.opacity = item.baseOpacity + wave * item.opacityWave;
      return;
    }

    if (item.type === 'anchored') {
      const wave = Math.sin(t * item.speed + item.phase);
      item.root.position.x = item.basePosition.x - cameraDrift.x * item.parallax;
      item.root.position.y = item.basePosition.y - cameraDrift.y * item.parallax * 0.3;
      item.root.rotation.z = item.baseRotationZ + wave * item.sway;
      const scale = 1 + Math.sin(t * item.speed * 0.7 + item.phase) * 0.006;
      item.root.scale.set(scale, scale, 1);
      return;
    }

    if (item.type === 'flower') {
      const wave = Math.sin(t * item.speed + item.phase);
      const quick = Math.sin(t * item.speed * 2.45 + item.phase * 0.7);
      const pulse = 1 + wave * 0.072 + quick * 0.018;
      const bend = item.baseRotationZ + wave * item.swing;
      const leafWave = Math.sin(t * item.speed * 1.4 + item.phase);

      item.root.position.x = item.basePosition.x + quick * 0.01 - cameraDrift.x * 0.08;
      item.root.position.y = item.basePosition.y - cameraDrift.y * 0.025;
      item.root.rotation.z = bend;
      item.stem.scale.y = 1 + Math.abs(wave) * 0.025;
      item.head.position.x = quick * 0.03;
      item.head.position.y = item.stemHeight + Math.abs(wave) * 0.05;
      item.head.rotation.z = wave * 0.24 + quick * 0.06;
      item.head.scale.set(item.baseSize * pulse, item.baseSize * 1.08 * (1 + wave * 0.045), 1);
      item.leafLeft.rotation.z = -0.68 - bend * 0.35 + leafWave * 0.08;
      item.leafRight.rotation.z = 0.62 - bend * 0.28 - leafWave * 0.07;
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
  const safeHeight = Math.max(height, 1);
  const aspect = width / safeHeight;
  const shortViewport = Math.max(0, Math.min(1, (680 - safeHeight) / 280));
  const narrowViewport = Math.max(0, Math.min(1, (0.9 - aspect) / 0.38));
  const ultrawide = Math.max(0, Math.min(1, (aspect - 1.9) / 0.8));

  renderer.setSize(width, safeHeight, false);
  camera.aspect = aspect;
  camera.position.z = 11.45 + shortViewport * 1.35 + narrowViewport * 1.7 - ultrawide * 0.22;
  camera.fov = 42.4 + shortViewport * 5.2 + narrowViewport * 4.8;

  if (worldRoot) {
    const scale = 1 - shortViewport * 0.1 - narrowViewport * 0.075;
    worldRoot.scale.setScalar(scale);
    worldRoot.position.y = 0.18 + shortViewport * 0.34 + narrowViewport * 0.12;
    worldRoot.position.x = 0;
  }

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
  worldRoot = new Group();
  scene.add(worldRoot);
  camera = new PerspectiveCamera(42.4, 1, 0.1, 100);
  camera.position.set(0, 0.16, 11.45);

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
