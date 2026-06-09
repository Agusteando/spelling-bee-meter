<template>
  <div ref="mount" class="bee-world" aria-hidden="true"></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
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
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
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

let renderer;
let scene;
let camera;
let frameId;
let resizeObserver;
let worldRoot;
let decorRoot;
let landscapeRoot;
let stageRoot;
let flowerRoot;
let insectRoot;
let rareBee;
let viewWidth = 14;
let viewHeight = 8;
let nextRareBeeAt = 12;
let lastActivity = 0;
const clock = new Clock();
const textureLoader = new TextureLoader();
const cleanup = [];
const animated = [];
const shaderUniforms = [];
const pointerTarget = new Vector2(0, 0);
const cameraDrift = new Vector2(0, 0);

const COLORS = {
  honey: '#f7bf37',
  honeyDark: '#d99a23',
  cream: '#fff5ce',
  creamSoft: '#fff9df',
  bark: '#6f351d',
  barkDark: '#422011',
  red: '#c81427',
  redDeep: '#8f1322',
  orange: '#f47d1f',
  yellow: '#ffc743',
  teal: '#008f87',
  leaf: '#72ad38',
  leafDark: '#3f7c27',
  ground: '#b7cf56',
  groundDark: '#8fb33a',
  skyWarm: '#f6dfb7'
};

function makeTexture(url) {
  const texture = textureLoader.load(url);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  cleanup.push(() => texture.dispose());
  return texture;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose?.();
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

function add(parent, child) {
  parent.add(child);
  return child;
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
    roughness: options.roughness ?? 0.82,
    metalness: options.metalness ?? 0,
    transparent: options.opacity !== undefined && options.opacity < 1,
    opacity: options.opacity ?? 1,
    side: options.side ?? DoubleSide,
    depthWrite: options.depthWrite ?? true
  });
}

function patternShader({ opacity = 1, scale = 1.0, warmth = 0.0 } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uOpacity: { value: opacity },
    uScale: { value: scale },
    uWarmth: { value: warmth }
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
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uScale;
      uniform float uWarmth;
      varying vec2 vUv;
      varying vec3 vWorld;

      float circle(vec2 p, vec2 c, float r) {
        return smoothstep(r, r - 0.012, length(p - c));
      }

      float stripes(vec2 p, float angle, float density) {
        float s = sin(angle);
        float c = cos(angle);
        vec2 q = mat2(c, -s, s, c) * p;
        return smoothstep(0.48, 0.5, abs(fract(q.x * density) - 0.5));
      }

      void main() {
        vec2 uv = vUv;
        vec2 grid = fract(uv * vec2(5.0 * uScale, 3.0 * uScale));
        vec2 cell = floor(uv * vec2(5.0 * uScale, 3.0 * uScale));
        float wave = 0.5 + 0.5 * sin(uTime * 0.42 + cell.x * 1.7 + cell.y * 2.1);

        float c1 = circle(grid, vec2(0.25, 0.35), 0.18);
        float c2 = circle(grid, vec2(0.74, 0.68), 0.13);
        float arc = smoothstep(0.035, 0.0, abs(length(grid - vec2(0.0, 0.0)) - 0.62));
        float stripe = stripes(grid + wave * 0.015, 0.72, 8.0);
        float dot = circle(fract(grid * 6.0), vec2(0.5), 0.085) * 0.35;
        float shape = max(max(c1 * 0.24, c2 * 0.18), max(arc * 0.22, stripe * 0.10 + dot));
        shape *= 0.6 + 0.4 * wave;

        vec3 base = mix(vec3(1.0, 0.96, 0.76), vec3(1.0, 0.83, 0.48), uWarmth);
        vec3 ink = mix(vec3(0.82, 0.67, 0.36), vec3(0.94, 0.70, 0.27), wave);
        vec3 color = mix(base, ink, shape);
        float alpha = uOpacity * (0.19 + shape * 0.62);
        gl_FragColor = vec4(color, alpha);
      }
    `
  });
  cleanup.push(() => material.dispose());
  return material;
}

function terrainShader(topColor, bottomColor, { opacity = 1, waveStrength = 0.08 } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uTop: { value: new Color(topColor) },
    uBottom: { value: new Color(bottomColor) },
    uOpacity: { value: opacity },
    uWaveStrength: { value: waveStrength }
  };
  shaderUniforms.push(uniforms);
  const material = new ShaderMaterial({
    uniforms,
    transparent: opacity < 1,
    side: DoubleSide,
    vertexShader: `
      uniform float uTime;
      uniform float uWaveStrength;
      varying vec2 vUv;
      varying float vShade;
      void main() {
        vUv = uv;
        vec3 p = position;
        float w = sin(p.x * 1.3 + uTime * 0.55) * 0.5 + sin(p.x * 2.1 - uTime * 0.31) * 0.5;
        p.y += w * uWaveStrength * smoothstep(0.15, 1.0, uv.y);
        vShade = 0.5 + 0.5 * w;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vShade;
      void main() {
        vec3 color = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
        color += vec3(0.04, 0.035, 0.0) * vShade;
        gl_FragColor = vec4(color, uOpacity);
      }
    `
  });
  cleanup.push(() => material.dispose());
  return material;
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

function createRoundedPanel(width, height, radius, material, position, renderOrder = 0) {
  const geometry = new ShapeGeometry(createRoundedShape(width, height, radius), 36);
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.renderOrder = renderOrder;
  register(mesh);
  return mesh;
}

function createTexturedPlane(url, width, height, position, { opacity = 1, renderOrder = 0 } = {}) {
  const map = makeTexture(url);
  const material = new MeshBasicMaterial({
    map,
    transparent: true,
    opacity,
    alphaTest: 0.02,
    depthWrite: false,
    side: DoubleSide
  });
  const mesh = new Mesh(new PlaneGeometry(width, height), material);
  mesh.position.copy(position);
  mesh.renderOrder = renderOrder;
  register(mesh);
  return mesh;
}

function makePetalGeometry() {
  const geometry = new SphereGeometry(0.16, 18, 12);
  geometry.scale(0.72, 1.18, 0.16);
  return geometry;
}

function createFlower({ x, z, stem = 0.72, scale = 1, petals = 6, color = COLORS.red, center = COLORS.yellow, phase = 0 }) {
  const ground = sampleFrontGround(x);
  const group = new Group();
  group.position.set(x, ground, z);
  group.scale.setScalar(scale);

  const stemGeometry = new CylinderGeometry(0.025, 0.04, stem, 8);
  const stemMesh = new Mesh(stemGeometry, toon(COLORS.leafDark));
  stemMesh.position.y = stem / 2;
  stemMesh.rotation.z = MathUtils.degToRad((Math.sin(x * 3.1) * 4));
  group.add(stemMesh);

  const leafGeometry = new SphereGeometry(0.13, 14, 10);
  leafGeometry.scale(1.25, 0.38, 0.1);
  const leafMat = toon(COLORS.leaf);
  [-1, 1].forEach((side, index) => {
    const leaf = new Mesh(leafGeometry.clone(), leafMat.clone());
    leaf.position.set(0.07 * side, stem * (0.38 + index * 0.14), 0.018);
    leaf.rotation.z = MathUtils.degToRad(32 * side);
    leaf.rotation.y = MathUtils.degToRad(8 * side);
    group.add(leaf);
  });

  const head = new Group();
  head.position.y = stem + 0.06;
  group.add(head);

  const petalGeo = makePetalGeometry();
  const petalMat = toon(color);
  for (let i = 0; i < petals; i += 1) {
    const angle = (i / petals) * Math.PI * 2;
    const petal = new Mesh(petalGeo.clone(), petalMat.clone());
    petal.position.set(Math.cos(angle) * 0.17, Math.sin(angle) * 0.17, 0.02 + (i % 2) * 0.01);
    petal.rotation.z = angle;
    petal.rotation.x = MathUtils.degToRad(8 + (i % 2) * 5);
    head.add(petal);
  }

  const centerMesh = new Mesh(new SphereGeometry(0.12, 18, 12), toon(center));
  centerMesh.scale.set(1, 1, 0.35);
  centerMesh.position.z = 0.075;
  head.add(centerMesh);

  flowerRoot.add(group);
  register(group);
  animated.push({ type: 'flower3d', group, head, stemMesh, baseY: group.position.y, phase, dance: 0.13 + Math.random() * 0.08 });
  return group;
}

function createDaisyCluster(x, count, spread, colors) {
  for (let i = 0; i < count; i += 1) {
    const localX = x + (i - (count - 1) / 2) * spread + Math.sin(i * 4.7) * 0.08;
    createFlower({
      x: localX,
      z: 1.65 + (i % 3) * 0.12,
      stem: 0.46 + (i % 4) * 0.09,
      scale: 0.68 + (i % 3) * 0.13,
      petals: i % 2 ? 5 : 6,
      color: colors[i % colors.length],
      center: i % 2 ? COLORS.redDeep : COLORS.yellow,
      phase: i * 0.73 + x
    });
  }
}

function createBranch(start, end, radius = 0.035, color = COLORS.bark) {
  const curve = new CatmullRomCurve3([
    new Vector3(start.x, start.y, start.z),
    new Vector3((start.x + end.x) / 2 + Math.sin(end.x) * 0.08, (start.y + end.y) / 2 + 0.08, (start.z + end.z) / 2),
    new Vector3(end.x, end.y, end.z)
  ]);
  const mesh = new Mesh(new TubeGeometry(curve, 16, radius, 7, false), toon(color));
  return mesh;
}

function createStylizedTree({ side = 'left', x = -6, scale = 1, canopyColor = COLORS.honey, accentColor = COLORS.cream }) {
  const rootY = sampleFrontGround(x) - 0.02;
  const group = new Group();
  group.position.set(x, rootY, 0.58);
  group.scale.setScalar(scale);
  landscapeRoot.add(group);

  const trunk = new Mesh(new CylinderGeometry(0.07, 0.11, 2.18, 12), toon(side === 'left' ? COLORS.bark : COLORS.honeyDark));
  trunk.position.y = 1.06;
  trunk.rotation.z = MathUtils.degToRad(side === 'left' ? -2 : 2);
  group.add(trunk);

  const branchSign = side === 'left' ? 1 : -1;
  group.add(createBranch(new Vector3(0.02, 1.08, 0.01), new Vector3(branchSign * 0.45, 1.62, 0.04), 0.035, side === 'left' ? COLORS.bark : COLORS.honeyDark));
  group.add(createBranch(new Vector3(0.0, 1.35, 0.01), new Vector3(branchSign * -0.34, 1.83, 0.02), 0.027, side === 'left' ? COLORS.bark : COLORS.honeyDark));

  const canopyMat = toon(canopyColor);
  const blobPositions = side === 'left'
    ? [[-0.32, 2.18, 0, 0.85, 1.05], [0.24, 2.2, 0.04, 0.98, 0.92], [-0.05, 2.64, -0.01, 0.92, 0.78]]
    : [[0.08, 2.23, 0, 1.05, 0.86], [-0.52, 2.28, 0.03, 0.88, 0.78], [0.54, 2.46, 0.02, 0.78, 0.7], [0.1, 2.77, -0.01, 0.8, 0.62]];
  blobPositions.forEach(([bx, by, bz, sx, sy], index) => {
    const blob = new Mesh(new SphereGeometry(0.54, 24, 16), canopyMat.clone());
    blob.position.set(bx, by, bz);
    blob.scale.set(sx, sy, 0.16);
    group.add(blob);

    const rim = new Mesh(new TorusGeometry(0.49, 0.017, 8, 48), toon(index % 2 ? COLORS.cream : COLORS.honeyDark, { opacity: 0.65 }));
    rim.position.set(bx + 0.04 * branchSign, by + 0.04, bz + 0.02);
    rim.scale.set(sx, sy, 0.12);
    rim.rotation.x = MathUtils.degToRad(0);
    rim.rotation.z = MathUtils.degToRad(index * 14 + (side === 'left' ? -8 : 8));
    group.add(rim);
  });

  const accentMat = toon(accentColor);
  const dotMat = toon(side === 'left' ? COLORS.cream : COLORS.orange);
  const dots = side === 'left' ? 18 : 14;
  for (let i = 0; i < dots; i += 1) {
    const angle = i * 2.399 + scale;
    const radius = 0.18 + (i % 5) * 0.075;
    const dx = Math.cos(angle) * radius + (i % 3 - 1) * 0.16;
    const dy = 2.25 + Math.sin(angle * 1.7) * 0.34 + (i % 4) * 0.07;
    const dot = new Mesh(new SphereGeometry(side === 'left' ? 0.045 : 0.055, 10, 8), dotMat.clone());
    dot.scale.z = 0.32;
    dot.position.set(dx, dy, 0.12 + (i % 2) * 0.03);
    group.add(dot);
  }

  animated.push({ type: 'tree3d', group, phase: x * 0.3, baseY: group.position.y });
  register(group);
  return group;
}

function createWavyTerrain({ y, z, height, top, bottom, width = 22, phase = 0, renderOrder = 0 }) {
  const segments = 96;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const x = -width / 2 + t * width;
    const wave = Math.sin((x + phase) * 0.9) * 0.18 + Math.sin((x - phase) * 1.7) * 0.065;
    const topY = y + wave;
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
  const mesh = new Mesh(geometry, terrainShader(top, bottom, { waveStrength: 0.035 }));
  mesh.renderOrder = renderOrder;
  landscapeRoot.add(mesh);
  register(mesh);
  animated.push({ type: 'terrain', mesh, phase });
  return mesh;
}

function sampleFrontGround(x) {
  return -2.82 + Math.sin((x + 0.7) * 0.9) * 0.18 + Math.sin((x - 1.7) * 1.7) * 0.065;
}

function createPollenField() {
  const count = 160;
  const positions = [];
  for (let i = 0; i < count; i += 1) {
    positions.push(
      MathUtils.randFloatSpread(17.5),
      MathUtils.randFloat(-2.1, 3.45),
      MathUtils.randFloat(-2.0, 1.7)
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    size: 0.045,
    color: '#fff2a2',
    transparent: true,
    opacity: 0.55,
    blending: AdditiveBlending,
    depthWrite: false
  });
  const points = new Points(geometry, material);
  points.renderOrder = 1;
  decorRoot.add(points);
  register(points);
  animated.push({ type: 'pollen', mesh: points, phase: Math.random() * 100 });
}

function createButterfly({ x, y, z, color = COLORS.orange, phase = 0 }) {
  const group = new Group();
  group.position.set(x, y, z);
  insectRoot.add(group);

  const wingMat = toon(color, { opacity: 0.92, depthWrite: false });
  const bodyMat = toon(COLORS.barkDark);
  const wingGeo = new SphereGeometry(0.11, 14, 10);
  wingGeo.scale(1.1, 0.7, 0.06);
  [-1, 1].forEach((side) => {
    const wing = new Mesh(wingGeo.clone(), wingMat.clone());
    wing.position.set(side * 0.085, 0.02, 0.01);
    wing.rotation.z = MathUtils.degToRad(side * 32);
    group.add(wing);
  });
  const body = new Mesh(new CylinderGeometry(0.018, 0.018, 0.17, 8), bodyMat);
  body.rotation.z = MathUtils.degToRad(90);
  group.add(body);

  animated.push({ type: 'butterfly3d', group, basePosition: group.position.clone(), phase, amp: 0.16 + Math.random() * 0.08 });
  register(group);
  return group;
}

function createBeeSprite({ x = 0, y = 2.5, z = 2.1, direction = 'right', scale = 1, rare = false }) {
  const texture = makeTexture(direction === 'right' ? beeRightUrl : beeLeftUrl);
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    depthTest: false
  });
  const sprite = new Sprite(material);
  sprite.position.set(x, y, z);
  sprite.scale.set(0.68 * scale, 0.53 * scale, 1);
  sprite.renderOrder = 16;
  sprite.userData.direction = direction;
  sprite.userData.rightTexture = makeTexture(beeRightUrl);
  sprite.userData.leftTexture = makeTexture(beeLeftUrl);
  insectRoot.add(sprite);
  cleanup.push(() => {
    material.dispose();
  });
  animated.push({ type: rare ? 'rareBee' : 'bee', sprite, basePosition: sprite.position.clone(), phase: Math.random() * Math.PI * 2, speed: 0.55 + Math.random() * 0.18 });
  return sprite;
}

function setBeeDirection(sprite, direction) {
  if (!sprite || sprite.userData.direction === direction) return;
  sprite.userData.direction = direction;
  sprite.material.map = direction === 'right' ? sprite.userData.rightTexture : sprite.userData.leftTexture;
  sprite.material.needsUpdate = true;
}

function create3DLogoStage() {
  const back = createRoundedPanel(9.2, 4.65, 0.36, patternShader({ opacity: 0.5, scale: 1.2, warmth: 0.28 }), new Vector3(0, 0.38, -0.8), 0);
  back.scale.z = 1;
  stageRoot.add(back);

  const glass = createRoundedPanel(7.2, 3.35, 0.28, patternShader({ opacity: 0.74, scale: 1.55, warmth: 0.03 }), new Vector3(0, 0.18, -0.45), 1);
  stageRoot.add(glass);

  const frame = createRoundedPanel(7.55, 3.68, 0.34, new MeshBasicMaterial({ color: '#fff4c6', transparent: true, opacity: 0.18, side: DoubleSide, depthWrite: false }), new Vector3(0, 0.18, -0.48), 0);
  stageRoot.add(frame);

  const logo = createTexturedPlane(iedisLogoUrl, 2.7, 0.92, new Vector3(0, 1.78, -0.18), { opacity: 0.98, renderOrder: 2 });
  stageRoot.add(logo);
  const eventLogo = createTexturedPlane(eventLogoUrl, 3.75, 1.38, new Vector3(0.05, -0.95, -0.16), { opacity: 0.97, renderOrder: 2 });
  stageRoot.add(eventLogo);

  animated.push({ type: 'stage', group: stageRoot, phase: 1.2, basePosition: stageRoot.position.clone() });
}

function createSkyDome() {
  const geometry = new SphereGeometry(18, 32, 18);
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uTop: { value: new Color('#f4d3a2') },
      uBottom: { value: new Color('#fff8cf') }
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uTop;
      uniform vec3 uBottom;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y * 0.5 + 0.5;
        float glow = 0.08 * sin(uTime * 0.18 + vPos.x * 0.08);
        vec3 color = mix(uBottom, uTop, smoothstep(0.0, 1.0, h + glow));
        gl_FragColor = vec4(color, 1.0);
      }
    `
  });
  shaderUniforms.push(material.uniforms);
  const dome = new Mesh(geometry, material);
  scene.add(dome);
  register(dome);
}

function createBackgroundTiles() {
  const tileGroup = new Group();
  tileGroup.position.set(0, 0.25, -1.8);
  decorRoot.add(tileGroup);

  const cols = 7;
  const rows = 4;
  const tileW = 2.34;
  const tileH = 1.5;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const material = patternShader({ opacity: 0.22 + ((row + col) % 3) * 0.025, scale: 1 + (row % 2) * 0.25, warmth: ((row + col) % 4) * 0.08 });
      const tile = new Mesh(new PlaneGeometry(tileW * 0.98, tileH * 0.98), material);
      tile.position.set((col - (cols - 1) / 2) * tileW, 0.15 + (row - (rows - 1) / 2) * tileH, 0);
      tile.renderOrder = -2;
      tileGroup.add(tile);
      animated.push({ type: 'bgTile', mesh: tile, basePosition: tile.position.clone(), phase: row * 1.9 + col * 0.73, drift: 0.02 + (col % 3) * 0.006 });
    }
  }
  register(tileGroup);
}

function createScene() {
  scene = new Scene();
  scene.background = new Color('#f5deb4');

  camera = new OrthographicCamera(-7, 7, 4, -4, 0.1, 60);
  camera.position.set(0, 0.08, 10);
  camera.lookAt(0, 0, 0);

  worldRoot = new Group();
  decorRoot = new Group();
  landscapeRoot = new Group();
  stageRoot = new Group();
  flowerRoot = new Group();
  insectRoot = new Group();
  scene.add(worldRoot);
  worldRoot.add(decorRoot, stageRoot, landscapeRoot, flowerRoot, insectRoot);

  const hemi = new HemisphereLight('#fff6d2', '#d19a4e', 1.28);
  const ambient = new AmbientLight('#fff3cb', 1.35);
  const key = new DirectionalLight('#ffffff', 2.35);
  key.position.set(-3.2, 4.5, 6);
  const rim = new DirectionalLight('#ffd57b', 1.2);
  rim.position.set(4.6, 2.2, 4.2);
  scene.add(hemi, ambient, key, rim);

  createSkyDome();
  createBackgroundTiles();
  create3DLogoStage();

  createWavyTerrain({ y: -2.14, z: -0.55, height: 1.2, top: '#dce57b', bottom: '#b5cc51', phase: 2.1, renderOrder: 2 });
  createWavyTerrain({ y: -2.47, z: 0.1, height: 1.3, top: '#c7db62', bottom: '#94b642', phase: -0.7, renderOrder: 3 });
  createWavyTerrain({ y: -2.82, z: 0.72, height: 1.5, top: '#b6d158', bottom: '#789f38', phase: 0.6, renderOrder: 4 });

  createStylizedTree({ side: 'left', x: -6.25, scale: 1.02, canopyColor: COLORS.honey, accentColor: COLORS.cream });
  createStylizedTree({ side: 'left', x: -5.32, scale: 0.77, canopyColor: COLORS.orange, accentColor: COLORS.cream });
  createStylizedTree({ side: 'right', x: 6.0, scale: 1.13, canopyColor: COLORS.red, accentColor: COLORS.orange });
  createStylizedTree({ side: 'right', x: 5.0, scale: 0.72, canopyColor: COLORS.redDeep, accentColor: COLORS.orange });

  createDaisyCluster(-6.55, 8, 0.28, [COLORS.red, COLORS.orange, COLORS.yellow]);
  createDaisyCluster(-4.85, 6, 0.34, [COLORS.orange, COLORS.yellow, COLORS.red]);
  createDaisyCluster(-2.7, 4, 0.42, [COLORS.yellow, COLORS.orange]);
  createDaisyCluster(2.8, 4, 0.42, [COLORS.orange, COLORS.yellow]);
  createDaisyCluster(4.9, 7, 0.29, [COLORS.red, COLORS.yellow, COLORS.orange]);
  createDaisyCluster(6.55, 9, 0.25, [COLORS.yellow, COLORS.red, COLORS.orange]);

  createButterfly({ x: -2.9, y: -1.52, z: 1.35, color: COLORS.orange, phase: 0.6 });
  createButterfly({ x: 2.95, y: -1.28, z: 1.3, color: COLORS.teal, phase: 2.1 });
  createButterfly({ x: 4.1, y: -0.95, z: 1.1, color: COLORS.yellow, phase: 3.5 });
  createButterfly({ x: -0.2, y: 2.65, z: 0.55, color: COLORS.red, phase: 1.7 });

  createBeeSprite({ x: -6.65, y: 2.95, z: 2.2, direction: 'right', scale: 0.95 });
  createBeeSprite({ x: 6.65, y: 3.05, z: 2.2, direction: 'left', scale: 0.88 });
  rareBee = createBeeSprite({ x: -10, y: 2.2, z: 2.5, direction: 'right', scale: 0.72, rare: true });
  rareBee.visible = false;

  createPollenField();
}

function updateResponsive() {
  const host = mount.value;
  if (!host || !renderer || !camera) return;
  const rect = host.getBoundingClientRect();
  const width = Math.max(320, rect.width || window.innerWidth);
  const height = Math.max(320, rect.height || window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.setSize(width, height, false);

  const aspect = width / height;
  viewHeight = aspect < 0.72 ? 9.45 : aspect < 1.05 ? 8.35 : aspect > 2.1 ? 6.35 : 7.45;
  viewWidth = viewHeight * aspect;
  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.near = 0.1;
  camera.far = 60;
  camera.updateProjectionMatrix();

  const narrowScale = aspect < 0.82 ? 0.78 : aspect < 1.05 ? 0.88 : 1;
  worldRoot.scale.setScalar(narrowScale);
  worldRoot.position.y = aspect < 0.82 ? 0.38 : aspect > 2.1 ? -0.1 : 0.06;

  const safeEdge = Math.max(5.2, Math.min(viewWidth / (2 * narrowScale) - 0.55, 7.15));
  landscapeRoot.children.forEach((child) => {
    if (!child.isGroup) return;
    if (child.position.x < -4.5) child.position.x = -safeEdge + (child.scale.x < 0.9 ? 0.78 : 0.2);
    if (child.position.x > 4.5) child.position.x = safeEdge - (child.scale.x < 0.9 ? 0.75 : 0.2);
  });
}

function scheduleRareBee(now) {
  nextRareBeeAt = now + MathUtils.randFloat(11, 18);
}

function triggerRareBee(now) {
  if (!rareBee || rareBee.visible) return;
  const fromLeft = Math.random() > 0.5;
  rareBee.visible = true;
  rareBee.userData.active = true;
  rareBee.userData.start = now;
  rareBee.userData.duration = MathUtils.randFloat(5.8, 7.4);
  rareBee.userData.fromLeft = fromLeft;
  rareBee.userData.startX = (fromLeft ? -1 : 1) * (viewWidth / 2 + 1.3);
  rareBee.userData.endX = (fromLeft ? 1 : -1) * (viewWidth / 2 + 1.3);
  rareBee.userData.baseY = MathUtils.randFloat(1.35, 2.8);
  rareBee.position.set(rareBee.userData.startX, rareBee.userData.baseY, 2.7);
  setBeeDirection(rareBee, fromLeft ? 'right' : 'left');
}

function animate() {
  const elapsed = clock.getElapsedTime();
  shaderUniforms.forEach((uniforms) => {
    if (uniforms.uTime) uniforms.uTime.value = elapsed;
  });

  cameraDrift.lerp(pointerTarget, 0.035);
  camera.position.x = cameraDrift.x * 0.28;
  camera.position.y = 0.08 + cameraDrift.y * 0.16;
  camera.lookAt(cameraDrift.x * 0.04, cameraDrift.y * 0.04, 0);

  for (const item of animated) {
    if (item.type === 'bgTile') {
      const t = elapsed * 0.42 + item.phase;
      item.mesh.position.x = item.basePosition.x + Math.sin(t * 0.71) * item.drift;
      item.mesh.position.y = item.basePosition.y + Math.cos(t * 0.59) * item.drift;
      item.mesh.rotation.z = Math.sin(t * 0.37) * 0.006;
    }

    if (item.type === 'stage') {
      item.group.position.y = item.basePosition.y + Math.sin(elapsed * 0.55 + item.phase) * 0.025;
      item.group.rotation.z = Math.sin(elapsed * 0.28) * 0.0025;
    }

    if (item.type === 'tree3d') {
      const t = elapsed * 0.62 + item.phase;
      item.group.rotation.z = Math.sin(t) * 0.012;
      item.group.position.y = item.baseY + Math.sin(t * 0.72) * 0.018;
    }

    if (item.type === 'flower3d') {
      const t = elapsed * (1.12 + item.dance) + item.phase;
      item.group.rotation.z = Math.sin(t) * 0.09;
      item.group.position.y = item.baseY + Math.sin(t * 1.55) * 0.035;
      item.head.rotation.z = Math.sin(t * 1.2) * 0.18;
      item.head.scale.setScalar(1 + Math.sin(t * 2.2) * 0.035);
      item.stemMesh.rotation.z = Math.sin(t * 0.9) * 0.06;
    }

    if (item.type === 'butterfly3d') {
      const t = elapsed * 1.0 + item.phase;
      item.group.position.x = item.basePosition.x + Math.sin(t * 0.73) * item.amp;
      item.group.position.y = item.basePosition.y + Math.cos(t * 1.4) * item.amp * 0.42;
      item.group.rotation.z = Math.sin(t * 1.5) * 0.2;
      item.group.children.forEach((child, index) => {
        if (index < 2) child.rotation.y = Math.sin(t * 9.0) * 0.55 * (index ? 1 : -1);
      });
    }

    if (item.type === 'bee') {
      const t = elapsed * item.speed + item.phase;
      item.sprite.position.x = item.basePosition.x + Math.sin(t * 0.8) * 0.24;
      item.sprite.position.y = item.basePosition.y + Math.cos(t * 1.15) * 0.18;
      item.sprite.rotation.z = Math.sin(t * 1.4) * 0.08;
    }

    if (item.type === 'rareBee' && item.sprite.userData.active) {
      const data = item.sprite.userData;
      const p = Math.min(1, (elapsed - data.start) / data.duration);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      item.sprite.position.x = MathUtils.lerp(data.startX, data.endX, eased);
      item.sprite.position.y = data.baseY + Math.sin(p * Math.PI * 4) * 0.32 + Math.sin(p * Math.PI) * 0.25;
      item.sprite.rotation.z = Math.sin(elapsed * 8) * 0.08;
      if (p >= 1) {
        item.sprite.visible = false;
        item.sprite.userData.active = false;
        scheduleRareBee(elapsed);
      }
    }

    if (item.type === 'pollen') {
      item.mesh.rotation.z = elapsed * 0.015;
      item.mesh.position.y = Math.sin(elapsed * 0.25 + item.phase) * 0.05;
    }
  }

  if (elapsed > nextRareBeeAt && elapsed - lastActivity > 6) {
    triggerRareBee(elapsed);
  }

  renderer.render(scene, camera);
  frameId = window.requestAnimationFrame(animate);
}

function handlePointerMove(event) {
  const x = (event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
  const y = -((event.clientY / Math.max(window.innerHeight, 1)) * 2 - 1);
  pointerTarget.set(MathUtils.clamp(x, -1, 1), MathUtils.clamp(y, -1, 1));
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
