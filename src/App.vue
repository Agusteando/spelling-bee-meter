<template>
  <main class="app-shell">
    <section class="hero-stage">
      <ThreeBeeScene
        :slow-drift-enabled="panoramaDriftEnabled"
        :splat-enabled="splatEnabled"
        @scene-ready="handleSceneReady"
      />

      <div v-show="sceneReady" class="slot-overlay" aria-label="Spelling Bee draw meter">
        <div
          ref="reelsRoot"
          class="reel-wrap"
          :class="{ rolling }"
          role="button"
          tabindex="0"
          :aria-label="meterLabel"
          :aria-disabled="rolling || !sceneReady"
          :aria-busy="rolling"
          @click="draw"
        >
          <div v-for="position in state.digits" :key="`reel-${state.digits}-${position}`" class="reel">
            <div class="numbers" :data-reel-index="position - 1" aria-hidden="true">
              <span v-for="(digit, index) in reelDigits" :key="`${position}-${index}`">
                <b>{{ digit }}</b>
              </span>
            </div>
          </div>
        </div>
        <p class="draw-hint">Click the meter or press space to draw</p>
      </div>

      <div v-show="sceneReady" id="gradient" class="gradient-bar" :class="{ animate: rolling }"></div>
    </section>

    <section id="controls" class="controls-panel">
      <div class="control-card primary-card">
        <div class="field">
          <label for="maxInput">Maximum value</label>
          <input id="maxInput" v-model.number="maxInput" type="number" min="1" />
          <button class="btn" type="button" @click="applyMax">Apply max</button>
        </div>

        <div class="field">
          <label for="spinInput">Rolling time (sec)</label>
          <input id="spinInput" v-model.number="spinInput" type="number" step="0.5" min="1" />
          <button class="btn" type="button" @click="applyDuration">Apply time</button>
        </div>

        <div class="action-stack">
          <button class="btn draw-btn" type="button" :disabled="rolling" @click="draw">Draw next</button>
          <button class="btn muted" type="button" :disabled="rolling" @click="resetList">Reset list</button>
          <button v-if="hasSavedState" class="btn danger" type="button" :disabled="rolling" @click="clearAll">Clear saved</button>
        </div>
      </div>

      <div class="control-card stats-card">
        <div id="stats">Drawn: {{ state.drawn.length }} | Remaining: {{ remaining }}</div>
        <div id="history">{{ historyText }}</div>
        <button v-if="installPrompt" class="btn install-btn" type="button" @click="installApp">
          Add Spelling-Bee-Meter to Home Screen
        </button>
      </div>
    </section>

    <section class="splat-orbit-panel" aria-label="Scene view controls">
      <div class="orbit-actions">
        <button class="btn orbit-toggle" type="button" @click="panoramaDriftEnabled = !panoramaDriftEnabled">
          {{ panoramaDriftEnabled ? 'Pause slow depth travel' : 'Resume slow depth travel' }}
        </button>
        <button class="btn orbit-toggle secondary" type="button" @click="splatEnabled = !splatEnabled">
          {{ splatEnabled ? 'Hide Gaussian splat scene' : 'Show Gaussian splat scene' }}
        </button>
      </div>
      <p>The Gaussian splat is on by default. The camera follows a closed Gaussian-view trajectory so the scene returns to the beginning of the loop; drag lightly to nudge the view.</p>
    </section>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import ThreeBeeScene from './components/ThreeBeeScene.vue';

const BUILD_STAMP = '20260611-044500';
const STATE_KEY = 'bee-slot-state';
const DUR_KEY = 'bee-slot-dur';
const DEF_MAX = 100;
const DEF_SEC = 5;
const REEL_LOOPS = 5;

const reelsRoot = ref(null);
const rolling = ref(false);
const installPrompt = ref(null);
const panoramaDriftEnabled = ref(true);
const splatEnabled = ref(true);
const sceneReady = ref(false);
const hasSavedState = ref(Boolean(localStorage.getItem(STATE_KEY)));

const qs = new URLSearchParams(window.location.search);
const startMax = Math.max(1, parseInt(qs.get('max') || DEF_MAX, 10));

function randInt(n) {
  if (window.crypto?.getRandomValues) {
    return window.crypto.getRandomValues(new Uint32Array(1))[0] % n;
  }
  return Math.floor(Math.random() * n);
}

function shuffle(values) {
  const arr = [...values];
  for (let i = arr.length; i > 0; i -= 1) {
    const j = randInt(i);
    [arr[i - 1], arr[j]] = [arr[j], arr[i - 1]];
  }
  return arr;
}

function fresh(max) {
  return {
    max,
    digits: String(max - 1).length,
    data: shuffle([...Array(max).keys()]),
    idx: -1,
    drawn: []
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY));
    return saved?.max === startMax ? saved : fresh(startMax);
  } catch {
    return fresh(startMax);
  }
}

const state = ref(loadState());
const maxInput = ref(state.value.max);
const spinInput = ref(parseFloat(localStorage.getItem(DUR_KEY)) || DEF_SEC);
const remaining = computed(() => state.value.max - state.value.drawn.length);
const historyText = computed(() => (state.value.drawn.length ? `Numbers drawn: ${state.value.drawn.join(', ')}` : ''));
const reelDigits = computed(() => Array.from({ length: (REEL_LOOPS + state.value.digits + 3) * 10 }, (_, index) => index % 10));

const displayedValue = ref(state.value.drawn.at(-1) ?? 0);
const meterLabel = computed(() => (rolling.value ? 'Drawing number' : `Current number ${pad(displayedValue.value)}`));
let reelStepPx = 0;
let resizeFrame = 0;
let currentDigits = [];
let activeAnimations = [];

function pad(value) {
  return String(value).padStart(state.value.digits, '0');
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state.value));
  hasSavedState.value = true;
}

async function handleSceneReady() {
  sceneReady.value = true;
  await setupReels(displayedValue.value);
}

function notifySceneActivity() {
  window.dispatchEvent(new CustomEvent('bee-meter-activity'));
}

function setSpinTimeCss() {
  document.documentElement.style.setProperty('--spin-time', `${spinInput.value}s`);
}

function getColumns() {
  return [...(reelsRoot.value?.querySelectorAll('.numbers') || [])];
}

function cancelReelAnimations() {
  activeAnimations.forEach((animation) => animation.cancel());
  activeAnimations = [];
  getColumns().forEach((column) => column.getAnimations().forEach((animation) => animation.cancel()));
}

function nextAnimationFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function measureReelStep() {
  const reel = reelsRoot.value?.querySelector('.reel');
  const nextStep = reel?.getBoundingClientRect().height || 0;
  if (nextStep > 0) reelStepPx = nextStep;
  return reelStepPx;
}

function transformForRow(row) {
  return `translate3d(0, ${-(row * reelStepPx)}px, 0)`;
}

function parkColumnAtRow(column, row) {
  column.getAnimations().forEach((animation) => animation.cancel());
  column.style.transition = 'none';
  column.style.transform = transformForRow(row);
  column.dataset.row = String(row);
}

function normalizeRowsToValue(value = displayedValue.value) {
  const digits = pad(value).split('').map(Number);
  const columns = getColumns();
  currentDigits = digits;
  measureReelStep();
  columns.forEach((column, index) => {
    parkColumnAtRow(column, currentDigits[index] ?? 0);
  });
}

async function setupReels(value = displayedValue.value) {
  await nextTick();
  await document.fonts?.ready?.catch?.(() => null);
  measureReelStep();
  normalizeRowsToValue(value);
}

function removeActiveAnimation(animation) {
  activeAnimations = activeAnimations.filter((item) => item !== animation);
}

async function animateColumnToDigit(column, index, fromDigit, targetDigit, durationMs) {
  const loopRows = (REEL_LOOPS + index + 1) * 10;
  const endRow = loopRows + targetDigit;
  const startTransform = transformForRow(fromDigit);
  const endTransform = transformForRow(endRow);
  const animation = column.animate(
    [
      { transform: startTransform, offset: 0 },
      { transform: transformForRow(Math.max(fromDigit, endRow - 13)), offset: 0.82 },
      { transform: endTransform, offset: 1 }
    ],
    {
      duration: durationMs + index * 170,
      easing: 'cubic-bezier(.18,.82,.18,1)',
      fill: 'forwards'
    }
  );

  activeAnimations.push(animation);

  try {
    await animation.finished;
  } catch {
    // A cancelled animation is expected during reset, resize, or component teardown.
  } finally {
    removeActiveAnimation(animation);
    animation.cancel();
    parkColumnAtRow(column, targetDigit);
  }
}

async function spinTo(value) {
  if (rolling.value) return;
  const columns = getColumns();
  if (!columns.length) {
    displayedValue.value = value;
    return;
  }

  measureReelStep();
  if (!reelStepPx) {
    displayedValue.value = value;
    normalizeRowsToValue(value);
    return;
  }

  rolling.value = true;
  setSpinTimeCss();
  cancelReelAnimations();
  await nextTick();

  const fromDigits = pad(displayedValue.value).split('').map(Number);
  const targetDigits = pad(value).split('').map(Number);
  const durationMs = Math.max(850, spinInput.value * 1000);

  columns.forEach((column, index) => {
    parkColumnAtRow(column, fromDigits[index] ?? 0);
  });

  // Commit the parked transforms before starting the WAAPI reel animations.
  reelsRoot.value?.getBoundingClientRect();
  await nextAnimationFrame();
  await nextAnimationFrame();

  try {
    await Promise.all(columns.map((column, index) => animateColumnToDigit(
      column,
      index,
      fromDigits[index] ?? 0,
      targetDigits[index] ?? 0,
      durationMs
    )));
  } finally {
    displayedValue.value = value;
    currentDigits = targetDigits;
    normalizeRowsToValue(value);
    rolling.value = false;
  }
}

async function draw() {
  if (!sceneReady.value || rolling.value) return;
  notifySceneActivity();

  let nextState = state.value;
  let nextIndex = nextState.idx + 1;

  if (nextIndex >= nextState.data.length) {
    nextState = fresh(nextState.max);
    state.value = nextState;
    displayedValue.value = 0;
    await setupReels(0);
    nextIndex = 0;
  }

  const drawnNumber = nextState.data[nextIndex];
  await spinTo(drawnNumber);

  nextState.idx = nextIndex;
  nextState.drawn.push(drawnNumber);
  state.value = { ...nextState, drawn: [...nextState.drawn] };
  saveState();
}

async function resetList() {
  if (rolling.value) return;
  notifySceneActivity();
  cancelReelAnimations();
  state.value = fresh(state.value.max);
  saveState();
  displayedValue.value = 0;
  await setupReels(0);
}

function clearAll() {
  if (rolling.value) return;
  notifySceneActivity();
  localStorage.removeItem(STATE_KEY);
  window.location.reload();
}

function applyMax() {
  if (rolling.value) return;
  notifySceneActivity();
  const nextMax = Math.max(1, parseInt(maxInput.value, 10) || DEF_MAX);
  window.location.search = `?max=${nextMax}`;
}

function applyDuration() {
  if (rolling.value) return;
  notifySceneActivity();
  spinInput.value = Math.max(1, parseFloat(spinInput.value) || DEF_SEC);
  localStorage.setItem(DUR_KEY, spinInput.value);
  setSpinTimeCss();
}

function isEditableTarget(target) {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest('input, textarea, select, button, [contenteditable="true"]'));
}

function handleKeydown(event) {
  if (event.key === ' ' && !isEditableTarget(event.target)) {
    event.preventDefault();
    draw();
  }
}

function handleMeterResize() {
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0;
    if (rolling.value) return;
    measureReelStep();
    normalizeRowsToValue(displayedValue.value);
  });
}

function installApp() {
  if (!installPrompt.value) return;
  installPrompt.value.prompt();
  installPrompt.value = null;
}

function handleBeforeInstall(event) {
  event.preventDefault();
  installPrompt.value = event;
}

async function refreshServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const keys = await caches?.keys?.();
    await Promise.all((keys || []).filter((key) => key.startsWith('spelling-bee')).map((key) => caches.delete(key)));
    const registration = await navigator.serviceWorker.register(`/service-worker.js?v=${BUILD_STAMP}`);
    await registration.update();
  } catch {
    // Keep runtime behavior independent from PWA cache maintenance.
  }
}

onMounted(async () => {
  setSpinTimeCss();
  await setupReels(displayedValue.value);
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', handleMeterResize);
  window.addEventListener('beforeinstallprompt', handleBeforeInstall);
  refreshServiceWorker();
});

onBeforeUnmount(() => {
  cancelReelAnimations();
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('resize', handleMeterResize);
  window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
});
</script>
