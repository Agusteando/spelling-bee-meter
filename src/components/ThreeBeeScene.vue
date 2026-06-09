<template>
  <div ref="mount" class="bee-world" aria-hidden="true"></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  AdditiveBlending,
  AmbientLight,
  BufferGeometry,
  CatmullRomCurve3,
  Clock,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TextureLoader,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';

import beeLeftUrl from '../assets/spelling/bee_left.png';
import beeRightUrl from '../assets/spelling/bee_right.png';
import iedisLogoUrl from '../assets/spelling/iedis_logo.png';
import eventLogoUrl from '../assets/spelling/event_logo_2026.png';

const mount = ref(null);
const BUILD_STAMP = '20260609-231027';

let renderer;
let scene;
let camera;
let frameId;
let resizeObserver;
let worldRoot;
let backgroundRoot;
let stageRoot;
let terrainRoot;
let plantRoot;
let insectRoot;
let rareBee;
let viewWidth = 14;
let viewHeight = 8;
let nextRareBeeAt = 13;
let lastActivity = 0;

const clock = new Clock();
const loader = new TextureLoader();
const cleanup = [];
const animated = [];
const shaderUniforms = [];
const edgeAnchors = [];
const pointerTarget = new Vector2(0, 0);
const cameraDrift = new Vector2(0, 0);

const COLORS = {
  cream: '#fff7d7',
  creamDeep: '#f7dfaa',
  honey: '#f5b932',
  honeyDark: '#c88620',
  red: '#c91f2f',
  redDeep: '#8d1720',
  orange: '#f47a21',
  yellow: '#ffd147',
  teal: '#008f91',
  bark: '#6d351e',
  barkDark: '#3f2012',
  leaf: '#78af3d',
  leafDark: '#356f28',
  grass: '#87bd35',
  grassDark: '#537f25',
  ground: '#b9cf57'
};

function cacheUrl(url) {
  return `${url}${url.includes('?') ? '&' : '?'}v=${BUILD_STAMP}`;
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

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose?.());
    }
  });
}

function register(object) {
  cleanup.push(() => disposeObject(object));
  return object;
}

function toon(color, options = {}) {
  return new MeshToonMaterial({
    color,
    transparent: options.opacity !== undefined && options.opacity < 1,
    opacity: options.opacity ?? 1,
    side: options.side ?? DoubleSide,
    depthWrite: options.depthWrite ?? true
  });
}

function standard(color, options = {}) {
  return new MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.88,
    metalness: options.metalness ?? 0,
    transparent: options.opacity !== undefined && options.opacity < 1,
    opacity: options.opacity ?? 1,
    side: options.side ?? DoubleSide,
    depthWrite: options.depthWrite ?? true
  });
}

function patternMaterial({ opacity = 0.56, warmth = 0.35, scale = 1 } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uOpacity: { value: opacity },
    uWarmth: { value: warmth },
    uScale: { value: scale }
  };
  shaderUniforms.push(uniforms);
  const material = new ShaderMaterial({
    uniforms,
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
      uniform float uTime;
      uniform float uOpacity;
      uniform float uWarmth;
      uniform float uScale;
      varying vec2 vUv;

      float circle(vec2 p, vec2 c, float r) {
        return smoothstep(r, r - 0.012, length(p - c));
      }
      float ring(vec2 p, vec2 c, float r, float w) {
        float d = abs(length(p - c) - r);
        return smoothstep(w, 0.0, d);
      }
      float stripes(vec2 p, float angle, float density) {
        float s = sin(angle);
        float c = cos(angle);
        vec2 q = mat2(c, -s, s, c) * p;
        return smoothstep(0.47, 0.50, abs(fract(q.x * density) - 0.5));
      }
      void main() {
        vec2 uv = vUv;
        vec2 p = fract(uv * vec2(4.0 * uScale, 2.65 * uScale));
        vec2 cell = floor(uv * vec2(4.0 * uScale, 2.65 * uScale));
        float breathe = 0.5 + 0.5 * sin(uTime * 0.45 + cell.x * 1.3 + cell.y * 1.8);
        float forms = 0.0;
        forms = max(forms, circle(p, vec2(0.28, 0.32), 0.18) * 0.25);
        forms = max(forms, ring(p, vec2(0.92, 0.12), 0.52, 0.025) * 0.26);
        forms = max(forms, stripes(p + breathe * 0.01, 0.74, 8.0) * 0.09);
        forms = max(forms, circle(fract(p * 7.0), vec2(0.5), 0.055) * 0.23);
        forms *= 0.75 + breathe * 0.4;
        vec3 base = mix(vec3(1.0, 0.965, 0.76), vec3(1.0, 0.82, 0.48), uWarmth);
        vec3 mark = vec3(0.82, 0.64, 0.30);
        vec3 color = mix(base, mark, forms);
        gl_FragColor = vec4(color, uOpacity * (0.14 + forms));
      }
    `
  });
  cleanup.push(() => material.dispose());
  return material;
}

function terrainMaterial(top, bottom, { opacity = 1, motion = 0.04 } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uTop: { value: new Color(top) },
    uBottom: { value: new Color(bottom) },
    uOpacity: { value: opacity },
    uMotion: { value: motion }
  };
  shaderUniforms.push(uniforms);
  const material = new ShaderMaterial({
    uniforms,
    transparent: opacity < 1,
    side: DoubleSide,
    vertexShader: `
      uniform float uTime;
      uniform float uMotion;
      varying vec2 vUv;
      varying float vWave;
      void main() {
        vUv = uv;
        vec3 p = position;
        float w = sin(p.x * 1.1 + uTime * 0.32) * 0.5 + sin(p.x * 2.1 - uTime * 0.18) * 0.5;
        p.y += w * uMotion * smoothstep(0.2, 1.0, uv.y);
        vWave = w;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vWave;
      void main() {
        vec3 color = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
        color += vec3(0.035, 0.03, 0.0) * vWave;
        gl_FragColor = vec4(color, uOpacity);
      }
    `
  });
  cleanup.push(() => material.dispose());
  return material;
}

function sampleGround(x, layer = 0) {
  const base = -2.82 + layer * 0.22;
  return base + Math.sin((x + 0.65 + layer) * 0.9) * 0.18 + Math.sin((x - 1.7) * 1.7) * 0.065;
}

function createRoundedShape(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function createPanel(width, height, radius, color, opacity, position, order = -1) {
  const mesh = new Mesh(
    new ShapeGeometry(createRoundedShape(width, height, radius), 32),
    standard(color, { opacity, roughness: 0.94, depthWrite: false })
  );
  mesh.position.copy(position);
  mesh.renderOrder = order;
  stageRoot.add(mesh);
  register(mesh);
  return mesh;
}

function createAspectPlane(url, height, position, { opacity = 1, renderOrder = 6, parent = stageRoot } = {}) {
  let mesh;
  const texture = loadTexture(url, (loaded) => {
    if (!mesh) return;
    const aspect = loaded.image?.width && loaded.image?.height ? loaded.image.width / loaded.image.height : 1;
    mesh.scale.set(height * aspect, height, 1);
  });
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    alphaTest: 0.02,
    depthWrite: false,
    side: DoubleSide
  });
  mesh = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.position.copy(position);
  mesh.scale.set(height, height, 1);
  mesh.renderOrder = renderOrder;
  parent.add(mesh);
  register(mesh);
  return mesh;
}

function createBackground() {
  const sky = new Mesh(new PlaneGeometry(24, 13), patternMaterial({ opacity: 0.64, warmth: 0.25, scale: 1.08 }));
  sky.position.set(0, 0.12, -5.2);
  sky.renderOrder = -5;
  backgroundRoot.add(sky);
  register(sky);

  const cols = 7;
  const rows = 4;
  const tileW = 3.0;
  const tileH = 2.05;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const mat = patternMaterial({ opacity: 0.16 + ((row + col) % 3) * 0.035, warmth: (row + col) % 2 ? 0.2 : 0.5, scale: 0.9 + (col % 3) * 0.1 });
      const tile = new Mesh(new PlaneGeometry(tileW * 0.95, tileH * 0.94), mat);
      tile.position.set((col - (cols - 1) / 2) * tileW, 0.38 + (row - (rows - 1) / 2) * tileH, -4.8 + row * 0.02);
      tile.renderOrder = -4;
      backgroundRoot.add(tile);
      register(tile);
      animated.push({ type: 'tile', mesh: tile, base: tile.position.clone(), phase: row * 1.7 + col * 0.53 });
    }
  }
}

function createStage() {
  const shell = createPanel(10.5, 5.05, 0.34, '#ffe5b2', 0.28, new Vector3(0, 0.25, -2.8), -1);
  const card = createPanel(7.6, 3.68, 0.34, '#fffad8', 0.58, new Vector3(0, 0.08, -2.45), 0);
  animated.push({ type: 'stage', group: shell, base: shell.position.clone(), phase: 0.3 });
  animated.push({ type: 'stage', group: card, base: card.position.clone(), phase: 1.1 });

  createAspectPlane(iedisLogoUrl, 0.86, new Vector3(0, 2.48, -1.4), { renderOrder: 8 });
  createAspectPlane(eventLogoUrl, 1.08, new Vector3(1.02, -0.42, -1.36), { renderOrder: 8, opacity: 0.94 });
}

function createTerrainLayer({ y, z, height, top, bottom, phase = 0, layer = 0 }) {
  const width = 22;
  const segments = 128;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const x = -width / 2 + t * width;
    const topY = y + Math.sin((x + phase) * 0.9) * 0.18 + Math.sin((x - phase) * 1.7) * 0.065;
    positions.push(x, topY, z, x, y - height, z);
    uvs.push(t, 1, t, 0);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, terrainMaterial(top, bottom, { motion: 0.024 + layer * 0.012 }));
  mesh.renderOrder = 2 + layer;
  terrainRoot.add(mesh);
  register(mesh);
  animated.push({ type: 'terrain', mesh, phase });
  return mesh;
}

function createBranch(start, end, radius, color) {
  const curve = new CatmullRomCurve3([
    new Vector3(start.x, start.y, start.z),
    new Vector3((start.x + end.x) / 2 + Math.sin(end.x * 2.0) * 0.08, (start.y + end.y) / 2 + 0.12, (start.z + end.z) / 2),
    new Vector3(end.x, end.y, end.z)
  ]);
  return new Mesh(new TubeGeometry(curve, 16, radius, 8, false), toon(color));
}

function createTree({ side = 'left', x = -6.2, scale = 1, color = COLORS.honey }) {
  const rootY = sampleGround(x, 0);
  const group = new Group();
  group.position.set(x, rootY, 0.72);
  group.scale.setScalar(scale);
  terrainRoot.add(group);

  const trunkMat = toon(side === 'left' ? COLORS.bark : COLORS.honeyDark);
  const trunk = new Mesh(new CylinderGeometry(0.08, 0.13, 2.0, 12), trunkMat);
  trunk.position.y = 1.0;
  trunk.rotation.z = MathUtils.degToRad(side === 'left' ? -2 : 2);
  group.add(trunk);

  const sign = side === 'left' ? 1 : -1;
  group.add(createBranch(new Vector3(0.0, 0.9, 0.02), new Vector3(sign * 0.48, 1.52, 0.08), 0.035, side === 'left' ? COLORS.bark : COLORS.honeyDark));
  group.add(createBranch(new Vector3(0.0, 1.22, 0.02), new Vector3(-sign * 0.42, 1.72, 0.07), 0.028, side === 'left' ? COLORS.bark : COLORS.honeyDark));

  const canopyMat = toon(color);
  const blobs = side === 'left'
    ? [[-0.22, 1.96, 0, 0.78, 0.96], [0.32, 1.98, 0.04, 0.86, 0.82], [0.04, 2.4, 0.02, 0.82, 0.72]]
    : [[0.0, 2.0, 0, 0.98, 0.84], [-0.52, 2.13, 0.04, 0.78, 0.74], [0.52, 2.18, 0.03, 0.82, 0.72], [0.05, 2.5, 0.02, 0.82, 0.64]];
  blobs.forEach(([bx, by, bz, sx, sy], index) => {
    const blob = new Mesh(new SphereGeometry(0.55, 24, 16), canopyMat.clone());
    blob.position.set(bx, by, bz);
    blob.scale.set(sx, sy, 0.22);
    group.add(blob);

    const rim = new Mesh(new TorusGeometry(0.47, 0.017, 8, 48), toon(index % 2 ? COLORS.cream : COLORS.honeyDark, { opacity: 0.62 }));
    rim.position.set(bx + sign * 0.04, by + 0.04, bz + 0.06);
    rim.scale.set(sx, sy, 0.1);
    rim.rotation.z = MathUtils.degToRad(index * 12 + sign * -8);
    group.add(rim);
  });

  for (let i = 0; i < 16; i += 1) {
    const angle = i * 2.399 + x;
    const dot = new Mesh(new SphereGeometry(side === 'left' ? 0.04 : 0.055, 10, 8), toon(side === 'left' ? COLORS.cream : COLORS.orange));
    dot.scale.z = 0.36;
    dot.position.set(Math.cos(angle) * (0.18 + (i % 4) * 0.08), 2.05 + Math.sin(angle * 1.6) * 0.32 + (i % 3) * 0.08, 0.16);
    group.add(dot);
  }

  animated.push({ type: 'tree', group, baseY: rootY, phase: x * 0.45 });
  edgeAnchors.push({ group, side, originalX: x, scale, kind: 'tree' });
  register(group);
  return group;
}

function createGrassBlade(x, z, height, phase) {
  const rootY = sampleGround(x, 0) + 0.02;
  const group = new Group();
  group.position.set(x, rootY, z);
  plantRoot.add(group);

  const blade = new Mesh(new ConeGeometry(0.018, height, 5), toon(Math.random() > 0.5 ? COLORS.grass : COLORS.grassDark));
  blade.position.y = height / 2;
  blade.rotation.z = MathUtils.degToRad(MathUtils.randFloat(-16, 16));
  group.add(blade);

  animated.push({ type: 'grass', group, blade, baseY: rootY, phase, amp: MathUtils.randFloat(0.035, 0.09) });
  register(group);
}

function createGrass() {
  for (let i = 0; i < 150; i += 1) {
    const x = MathUtils.randFloat(-7.4, 7.4);
    if (Math.abs(x) < 1.8 && i % 2 === 0) continue;
    const z = MathUtils.randFloat(0.74, 1.62);
    const h = MathUtils.randFloat(0.16, 0.44);
    createGrassBlade(x, z, h, i * 0.37);
  }
}

function makePetalGeometry() {
  const geometry = new SphereGeometry(0.16, 18, 12);
  geometry.scale(0.7, 1.16, 0.18);
  return geometry;
}

function createFlower({ x, z = 1.35, stem: stemHeight = 0.7, scale = 1, petals = 6, color = COLORS.red, center = COLORS.yellow, phase = 0 }) {
  const rootY = sampleGround(x, 0) + 0.02;
  const group = new Group();
  group.position.set(x, rootY, z);
  group.scale.setScalar(scale);
  plantRoot.add(group);

  const stem = new Mesh(new CylinderGeometry(0.027, 0.043, stemHeight, 9), toon(COLORS.leafDark));
  stem.position.y = stem.geometry.parameters.height / 2;
  group.add(stem);

  const leafGeo = new SphereGeometry(0.13, 14, 10);
  leafGeo.scale(1.35, 0.38, 0.12);
  [-1, 1].forEach((side, index) => {
    const leaf = new Mesh(leafGeo.clone(), toon(index ? COLORS.leaf : COLORS.grass));
    leaf.position.set(0.07 * side, stem.geometry.parameters.height * (0.35 + index * 0.2), 0.03);
    leaf.rotation.z = MathUtils.degToRad(35 * side);
    leaf.rotation.y = MathUtils.degToRad(10 * side);
    group.add(leaf);
  });

  const head = new Group();
  head.position.y = stem.geometry.parameters.height + 0.08;
  group.add(head);

  const petalGeo = makePetalGeometry();
  for (let i = 0; i < petals; i += 1) {
    const angle = (i / petals) * Math.PI * 2;
    const petal = new Mesh(petalGeo.clone(), toon(color));
    petal.position.set(Math.cos(angle) * 0.17, Math.sin(angle) * 0.17, 0.06 + (i % 2) * 0.01);
    petal.rotation.z = angle;
    petal.rotation.x = MathUtils.degToRad(9 + (i % 2) * 5);
    head.add(petal);
  }

  const centerMesh = new Mesh(new SphereGeometry(0.12, 18, 12), toon(center));
  centerMesh.scale.set(1, 1, 0.42);
  centerMesh.position.z = 0.1;
  head.add(centerMesh);

  animated.push({ type: 'flower', group, stem, head, phase, baseY: rootY, dance: 0.09 + Math.random() * 0.06 });
  register(group);
  return group;
}

function createFlowerCluster(x, count, spread, colors) {
  for (let i = 0; i < count; i += 1) {
    const localX = x + (i - (count - 1) / 2) * spread + Math.sin(i * 5.11) * 0.06;
    createFlower({
      x: localX,
      z: 1.08 + (i % 4) * 0.12,
      stem: 0.42 + (i % 4) * 0.08,
      scale: 0.72 + (i % 3) * 0.14,
      petals: i % 2 ? 5 : 6,
      color: colors[i % colors.length],
      center: i % 3 ? COLORS.yellow : COLORS.redDeep,
      phase: i * 0.65 + x
    });
  }
}

function createButterfly({ x, y, z, color, phase }) {
  const group = new Group();
  group.position.set(x, y, z);
  insectRoot.add(group);

  const wingGeo = new SphereGeometry(0.12, 14, 10);
  wingGeo.scale(1.08, 0.72, 0.06);
  [-1, 1].forEach((side) => {
    const wing = new Mesh(wingGeo.clone(), toon(color, { opacity: 0.92, depthWrite: false }));
    wing.position.set(side * 0.08, 0.02, 0);
    wing.rotation.z = MathUtils.degToRad(side * 28);
    group.add(wing);
  });
  const body = new Mesh(new CylinderGeometry(0.014, 0.02, 0.22, 8), toon(COLORS.barkDark));
  body.rotation.z = Math.PI / 2;
  group.add(body);

  register(group);
  animated.push({ type: 'butterfly', group, base: group.position.clone(), phase, amp: 0.18 + Math.random() * 0.1 });
}

function setBeeDirection(sprite, direction) {
  const texture = direction === 'left' ? sprite.userData.leftTexture : sprite.userData.rightTexture;
  sprite.material.map = texture;
  const aspect = texture.image?.width && texture.image?.height ? texture.image.width / texture.image.height : 1;
  const h = sprite.userData.height || 1;
  sprite.scale.set(h * aspect, h, 1);
  sprite.material.needsUpdate = true;
}

function createBee({ x, y, z, direction = 'right', height = 0.82, rare = false }) {
  let sprite;
  const left = loadTexture(beeLeftUrl);
  const right = loadTexture(beeRightUrl, () => {
    if (sprite) setBeeDirection(sprite, direction);
  });
  const material = new SpriteMaterial({ map: direction === 'left' ? left : right, transparent: true, depthWrite: false });
  sprite = new Sprite(material);
  sprite.position.set(x, y, z);
  sprite.userData = { leftTexture: left, rightTexture: right, height, active: false };
  setBeeDirection(sprite, direction);
  insectRoot.add(sprite);
  cleanup.push(() => material.dispose());
  animated.push({ type: rare ? 'rareBee' : 'bee', sprite, base: sprite.position.clone(), phase: Math.random() * 8, speed: 0.9 + Math.random() * 0.35 });
  return sprite;
}

function createPollen() {
  const positions = [];
  for (let i = 0; i < 170; i += 1) {
    positions.push(MathUtils.randFloatSpread(16), MathUtils.randFloat(-2.25, 3.45), MathUtils.randFloat(-1.2, 1.5));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({ size: 0.04, color: '#fff4a4', transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false });
  const points = new Points(geometry, material);
  backgroundRoot.add(points);
  register(points);
  animated.push({ type: 'pollen', points, phase: 2.2 });
}

function createScene() {
  scene = new Scene();
  scene.background = new Color('#f6dfb7');
  camera = new OrthographicCamera(-7, 7, 4, -4, 0.1, 80);
  camera.position.set(0, 0.08, 10);
  camera.lookAt(0, 0, 0);

  worldRoot = new Group();
  backgroundRoot = new Group();
  stageRoot = new Group();
  terrainRoot = new Group();
  plantRoot = new Group();
  insectRoot = new Group();
  scene.add(worldRoot);
  worldRoot.add(backgroundRoot, stageRoot, terrainRoot, plantRoot, insectRoot);

  scene.add(new HemisphereLight('#fff7d4', '#d39445', 1.18));
  scene.add(new AmbientLight('#fff0bf', 1.1));
  const key = new DirectionalLight('#ffffff', 2.25);
  key.position.set(-3.2, 4.8, 6.5);
  const rim = new DirectionalLight('#ffd274', 0.95);
  rim.position.set(4.5, 2.7, 4.4);
  scene.add(key, rim);

  createBackground();
  createStage();

  createTerrainLayer({ y: -2.1, z: -0.72, height: 1.2, top: '#dde67a', bottom: '#b7cc55', phase: 2.2, layer: 0 });
  createTerrainLayer({ y: -2.45, z: 0.0, height: 1.35, top: '#c7dd61', bottom: '#92b642', phase: -0.6, layer: 1 });
  createTerrainLayer({ y: -2.82, z: 0.72, height: 1.52, top: '#b7d25a', bottom: '#789d38', phase: 0.7, layer: 2 });

  createTree({ side: 'left', x: -6.35, scale: 1.0, color: COLORS.honey });
  createTree({ side: 'left', x: -5.32, scale: 0.74, color: COLORS.orange });
  createTree({ side: 'right', x: 6.15, scale: 1.08, color: COLORS.red });
  createTree({ side: 'right', x: 5.12, scale: 0.7, color: COLORS.redDeep });

  createGrass();
  createFlowerCluster(-6.5, 9, 0.28, [COLORS.red, COLORS.orange, COLORS.yellow]);
  createFlowerCluster(-4.95, 7, 0.32, [COLORS.orange, COLORS.yellow, COLORS.red]);
  createFlowerCluster(-2.8, 5, 0.42, [COLORS.yellow, COLORS.orange]);
  createFlowerCluster(2.95, 5, 0.42, [COLORS.orange, COLORS.yellow]);
  createFlowerCluster(4.9, 8, 0.3, [COLORS.red, COLORS.yellow, COLORS.orange]);
  createFlowerCluster(6.48, 9, 0.26, [COLORS.yellow, COLORS.red, COLORS.orange]);

  createButterfly({ x: -2.85, y: -1.42, z: 1.55, color: COLORS.orange, phase: 0.6 });
  createButterfly({ x: 2.95, y: -1.25, z: 1.48, color: COLORS.teal, phase: 2.1 });
  createButterfly({ x: 4.1, y: -0.94, z: 1.35, color: COLORS.yellow, phase: 3.5 });
  createButterfly({ x: -0.2, y: 2.65, z: 0.6, color: COLORS.red, phase: 1.7 });

  createBee({ x: -6.75, y: 2.98, z: 2.7, direction: 'right', height: 0.72 });
  createBee({ x: 6.75, y: 3.08, z: 2.7, direction: 'left', height: 0.66 });
  rareBee = createBee({ x: -10, y: 2.35, z: 3.0, direction: 'right', height: 0.54, rare: true });
  rareBee.visible = false;

  createPollen();
}

function updateAnchors(safeEdge) {
  edgeAnchors.forEach((anchor) => {
    const inset = anchor.scale < 0.85 ? 0.68 : 0.2;
    const x = anchor.side === 'left' ? -safeEdge + inset : safeEdge - inset;
    anchor.group.position.x = x;
    const y = sampleGround(x, 0);
    anchor.group.position.y = y;
    const anim = animated.find((item) => item.group === anchor.group);
    if (anim) anim.baseY = y;
  });
}

function updateResponsive() {
  const host = mount.value;
  if (!host || !renderer || !camera || !worldRoot) return;
  const rect = host.getBoundingClientRect();
  const width = Math.max(320, rect.width || window.innerWidth);
  const height = Math.max(320, rect.height || window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(width, height, false);

  const aspect = width / height;
  viewHeight = aspect < 0.68 ? 9.85 : aspect < 0.95 ? 8.65 : aspect > 2.1 ? 6.28 : 7.42;
  viewWidth = viewHeight * aspect;
  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();

  const worldScale = aspect < 0.68 ? 0.76 : aspect < 0.95 ? 0.86 : aspect > 2.1 ? 0.93 : 1;
  worldRoot.scale.setScalar(worldScale);
  worldRoot.position.y = aspect < 0.68 ? 0.55 : aspect < 0.95 ? 0.35 : aspect > 2.1 ? -0.06 : 0.06;

  stageRoot.scale.setScalar(aspect < 0.68 ? 0.82 : aspect < 0.95 ? 0.9 : 1);
  stageRoot.position.y = aspect < 0.68 ? 0.38 : 0;

  const safeEdge = Math.max(4.7, Math.min(viewWidth / (2 * worldScale) - 0.35, 7.15));
  updateAnchors(safeEdge);
}

function scheduleRareBee(now) {
  nextRareBeeAt = now + MathUtils.randFloat(12, 20);
}

function triggerRareBee(now) {
  if (!rareBee || rareBee.visible) return;
  const fromLeft = Math.random() > 0.5;
  rareBee.visible = true;
  rareBee.userData.active = true;
  rareBee.userData.start = now;
  rareBee.userData.duration = MathUtils.randFloat(6.2, 8.2);
  rareBee.userData.startX = (fromLeft ? -1 : 1) * (viewWidth / 2 + 1.4);
  rareBee.userData.endX = (fromLeft ? 1 : -1) * (viewWidth / 2 + 1.4);
  rareBee.userData.baseY = MathUtils.randFloat(1.25, 2.95);
  rareBee.position.set(rareBee.userData.startX, rareBee.userData.baseY, 3.0);
  setBeeDirection(rareBee, fromLeft ? 'right' : 'left');
}

function animate() {
  const elapsed = clock.getElapsedTime();
  shaderUniforms.forEach((uniforms) => {
    if (uniforms.uTime) uniforms.uTime.value = elapsed;
  });

  cameraDrift.lerp(pointerTarget, 0.035);
  camera.position.x = cameraDrift.x * 0.24;
  camera.position.y = 0.08 + cameraDrift.y * 0.12;
  camera.lookAt(cameraDrift.x * 0.035, cameraDrift.y * 0.03, 0);

  for (const item of animated) {
    if (item.type === 'tile') {
      const t = elapsed * 0.42 + item.phase;
      item.mesh.position.x = item.base.x + Math.sin(t * 0.71) * 0.025;
      item.mesh.position.y = item.base.y + Math.cos(t * 0.59) * 0.025;
      item.mesh.rotation.z = Math.sin(t * 0.37) * 0.006;
    }

    if (item.type === 'stage') {
      item.group.position.y = item.base.y + Math.sin(elapsed * 0.48 + item.phase) * 0.018;
      item.group.rotation.z = Math.sin(elapsed * 0.3 + item.phase) * 0.0025;
    }

    if (item.type === 'tree') {
      const t = elapsed * 0.58 + item.phase;
      item.group.rotation.z = Math.sin(t) * 0.01;
      item.group.position.y = item.baseY;
    }

    if (item.type === 'grass') {
      const t = elapsed * 1.8 + item.phase;
      item.group.position.y = item.baseY;
      item.blade.rotation.z += Math.sin(t) * 0.0007;
      item.group.rotation.z = Math.sin(t) * item.amp;
    }

    if (item.type === 'flower') {
      const t = elapsed * (1.05 + item.dance) + item.phase;
      item.group.position.y = item.baseY;
      item.group.rotation.z = Math.sin(t) * 0.045;
      item.stem.rotation.z = Math.sin(t * 0.95) * 0.055;
      item.head.rotation.z = Math.sin(t * 1.28) * 0.2;
      item.head.position.y = item.stem.geometry.parameters.height + 0.08 + Math.sin(t * 1.55) * 0.035;
      item.head.scale.setScalar(1 + Math.sin(t * 2.2) * 0.04);
    }

    if (item.type === 'butterfly') {
      const t = elapsed + item.phase;
      item.group.position.x = item.base.x + Math.sin(t * 0.8) * item.amp;
      item.group.position.y = item.base.y + Math.cos(t * 1.45) * item.amp * 0.45;
      item.group.rotation.z = Math.sin(t * 1.6) * 0.2;
      item.group.children.forEach((child, index) => {
        if (index < 2) child.rotation.y = Math.sin(t * 9.0) * 0.55 * (index ? 1 : -1);
      });
    }

    if (item.type === 'bee') {
      const t = elapsed * item.speed + item.phase;
      item.sprite.position.x = item.base.x + Math.sin(t * 0.8) * 0.23;
      item.sprite.position.y = item.base.y + Math.cos(t * 1.12) * 0.18;
      item.sprite.rotation.z = Math.sin(t * 1.4) * 0.08;
    }

    if (item.type === 'rareBee' && item.sprite.userData.active) {
      const data = item.sprite.userData;
      const p = Math.min(1, (elapsed - data.start) / data.duration);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      item.sprite.position.x = MathUtils.lerp(data.startX, data.endX, eased);
      item.sprite.position.y = data.baseY + Math.sin(p * Math.PI * 4) * 0.3 + Math.sin(p * Math.PI) * 0.2;
      item.sprite.rotation.z = Math.sin(elapsed * 8) * 0.08;
      if (p >= 1) {
        item.sprite.visible = false;
        item.sprite.userData.active = false;
        scheduleRareBee(elapsed);
      }
    }

    if (item.type === 'pollen') {
      item.points.rotation.z = elapsed * 0.014;
      item.points.position.y = Math.sin(elapsed * 0.28 + item.phase) * 0.04;
    }
  }

  if (elapsed > nextRareBeeAt && elapsed - lastActivity > 7) triggerRareBee(elapsed);

  renderer.render(scene, camera);
  frameId = window.requestAnimationFrame(animate);
}

function handlePointerMove(event) {
  pointerTarget.set(
    MathUtils.clamp((event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1, -1, 1),
    MathUtils.clamp(-((event.clientY / Math.max(window.innerHeight, 1)) * 2 - 1), -1, 1)
  );
}

function handleActivity() {
  lastActivity = clock.getElapsedTime();
  scheduleRareBee(lastActivity + 2);
}

onMounted(() => {
  renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
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
  frameId = window.requestAnimationFrame(animate);
});

onBeforeUnmount(() => {
  if (frameId) window.cancelAnimationFrame(frameId);
  resizeObserver?.disconnect();
  window.removeEventListener('resize', updateResponsive);
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('bee-meter-activity', handleActivity);
  cleanup.splice(0).forEach((fn) => fn());
  renderer?.dispose();
});
</script>
