<template>
  <main class="app-shell">
    <section class="hero-stage">
      <ThreeBeeScene
        :slow-drift-enabled="panoramaDriftEnabled"
        :splat-enabled="splatEnabled"
        @scene-ready="handleSceneReady"
        @scene-loading="handleSceneLoading"
      />

      <transition name="loader-fade">
        <div v-if="!sceneReady" class="scene-loader" aria-live="polite" aria-label="Loading Gaussian splat scene">
          <div class="scene-loader-card" :class="{ 'is-error': Boolean(loaderError) }">
            <img
              class="scene-loader-logo"
              :src="spellingBeeLogo"
              alt="Annual Interscholastic Spelling Bee 2026"
              draggable="false"
            />

            <div class="scene-loader-progress" role="progressbar" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="loaderPercent">
              <div class="scene-loader-progress-track">
                <div class="scene-loader-progress-fill" :style="{ width: `${loaderPercent}%` }">
                  <span class="scene-loader-progress-glow"></span>
                </div>
              </div>
              <div class="scene-loader-progress-meta">
                <span class="scene-loader-label">{{ loaderLabel }}</span>
                <span class="scene-loader-value">{{ loaderPercent }}%</span>
              </div>
            </div>

            <p class="scene-loader-caption" :class="{ 'is-error': Boolean(loaderError) }">
              {{ loaderError || 'Preparing the splat reveal with honey-smooth precision…' }}
            </p>
          </div>
        </div>
      </transition>

      <div v-show="sceneReady" class="slot-overlay" aria-label="Spelling Bee draw meter">
        <img
          class="meter-branding meter-branding-top"
          :src="iedisLogo"
          alt="IEDIS"
          draggable="false"
        />

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
          <div
            v-for="position in state.digits"
            :key="`reel-${state.digits}-${position}`"
            class="reel"
            :data-reel-index="position - 1"
          >
            <div class="reel-window" aria-hidden="true">
              <span
                v-for="(offset, slotIndex) in REEL_VISIBLE_OFFSETS"
                :key="`${position}-${offset}`"
                class="reel-digit"
                :data-slot-index="slotIndex"
              >
                <b>0</b>
              </span>
            </div>
          </div>
        </div>

        <img
          class="meter-branding meter-branding-bottom"
          :src="spellingBeeLogo"
          alt="Annual Interscholastic Spelling Bee 2026"
          draggable="false"
        />

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
import iedisLogo from './assets/branding/iedis-logo.png';
import spellingBeeLogo from './assets/branding/spelling-bee-logo.png';

const BUILD_STAMP = '20260611-062500';
const STATE_KEY = 'bee-slot-state';
const DUR_KEY = 'bee-slot-dur';
const DEF_MAX = 100;
const DEF_SEC = 5;
const REEL_LOOPS = 7;
const REEL_VISIBLE_OFFSETS = [-3, -2, -1, 0, 1, 2, 3];

const reelsRoot = ref(null);
const rolling = ref(false);
const installPrompt = ref(null);
const panoramaDriftEnabled = ref(true);
const splatEnabled = ref(true);
const sceneReady = ref(false);
const loaderProgress = ref(4);
const loaderLabel = ref('Warming the hive…');
const loaderError = ref('');
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

const loaderPercent = computed(() => Math.max(0, Math.min(100, Math.round(loaderProgress.value * 100))));

const displayedValue = ref(state.value.drawn.at(-1) ?? 0);
const meterLabel = computed(() => (rolling.value ? 'Drawing number' : `Current number ${pad(displayedValue.value)}`));
let reelStepPx = 0;
let resizeFrame = 0;
let spinFrame = 0;
let reelPositions = [];

function pad(value) {
  return String(value).padStart(state.value.digits, '0');
}

function positiveModulo(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

function digitAtRow(row) {
  return positiveModulo(Math.round(row), 10);
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state.value));
  hasSavedState.value = true;
}

function handleSceneLoading(payload = {}) {
  if (typeof payload.progress === 'number' && Number.isFinite(payload.progress)) {
    loaderProgress.value = Math.max(loaderProgress.value, Math.min(0.99, payload.progress));
  }
  if (payload.label) loaderLabel.value = payload.label;
  if (payload.error) loaderError.value = payload.error;
}

async function handleSceneReady() {
  loaderProgress.value = 1;
  loaderLabel.value = 'Scene ready';
  loaderError.value = '';
  sceneReady.value = true;
  await setupReels(displayedValue.value);
}

function notifySceneActivity() {
  window.dispatchEvent(new CustomEvent('bee-meter-activity'));
}

function setSpinTimeCss() {
  document.documentElement.style.setProperty('--spin-time', `${spinInput.value}s`);
}

function getReels() {
  return [...(reelsRoot.value?.querySelectorAll('.reel') || [])];
}

function cancelReelAnimations() {
  if (spinFrame) {
    window.cancelAnimationFrame(spinFrame);
    spinFrame = 0;
  }
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

function renderReel(reel, position) {
  const slots = [...reel.querySelectorAll('.reel-digit')];
  const baseRow = Math.floor(position);
  slots.forEach((slot, slotIndex) => {
    const offset = REEL_VISIBLE_OFFSETS[slotIndex] ?? 0;
    const row = baseRow + offset;
    const y = (row - position) * reelStepPx;
    const distance = Math.abs(row - position);
    const digitNode = slot.querySelector('b');
    if (digitNode) digitNode.textContent = String(digitAtRow(row));
    slot.style.transform = `translate3d(0, ${y}px, 0)`;
    slot.style.opacity = String(Math.max(0, 1 - distance * 0.23));
    slot.style.setProperty('--digit-scale', String(Math.max(0.86, 1 - distance * 0.035)));
  });
}

function renderReels() {
  if (!reelStepPx && !measureReelStep()) return;
  getReels().forEach((reel, index) => {
    renderReel(reel, reelPositions[index] ?? 0);
  });
}

function setReelsToValue(value = displayedValue.value) {
  const digits = pad(value).split('').map(Number);
  reelPositions = digits.map((digit) => digit);
  renderReels();
}

async function setupReels(value = displayedValue.value) {
  await nextTick();
  await document.fonts?.ready?.catch?.(() => null);
  measureReelStep();
  setReelsToValue(value);
}

function easeOutCubic(t) {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function targetRowForDigit(fromRow, targetDigit, index) {
  const startRow = Math.round(fromRow);
  const currentDigit = positiveModulo(startRow, 10);
  const digitDelta = positiveModulo(targetDigit - currentDigit, 10);
  return startRow + (REEL_LOOPS + index) * 10 + digitDelta;
}

function animateRows(fromRows, targetRows, durationMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    const timings = targetRows.map((_, index) => ({
      delay: index * 95,
      duration: durationMs + index * 155
    }));
    const totalMs = Math.max(...timings.map((timing) => timing.delay + timing.duration));

    const tick = (now) => {
      const elapsed = now - start;
      let complete = true;

      targetRows.forEach((targetRow, index) => {
        const { delay, duration } = timings[index];
        const local = Math.min(1, Math.max(0, (elapsed - delay) / duration));
        if (local < 1) complete = false;
        const eased = easeOutCubic(local);
        reelPositions[index] = fromRows[index] + (targetRow - fromRows[index]) * eased;
      });

      renderReels();

      if (!complete || elapsed < totalMs) {
        spinFrame = window.requestAnimationFrame(tick);
        return;
      }

      spinFrame = 0;
      reelPositions = targetRows.map((row) => Math.round(row));
      renderReels();
      resolve();
    };

    spinFrame = window.requestAnimationFrame(tick);
  });
}

async function spinTo(value) {
  if (rolling.value) return;
  const reels = getReels();
  if (!reels.length) {
    displayedValue.value = value;
    return;
  }

  measureReelStep();
  if (!reelStepPx) {
    displayedValue.value = value;
    setReelsToValue(value);
    return;
  }

  rolling.value = true;
  setSpinTimeCss();
  cancelReelAnimations();
  await nextTick();

  const fromDigits = pad(displayedValue.value).split('').map(Number);
  const targetDigits = pad(value).split('').map(Number);

  while (reelPositions.length < state.value.digits) {
    reelPositions.push(fromDigits[reelPositions.length] ?? 0);
  }

  const fromRows = reelPositions
    .slice(0, state.value.digits)
    .map((row, index) => Math.round(Number.isFinite(row) ? row : fromDigits[index] ?? 0));
  const targetRows = targetDigits.map((digit, index) => targetRowForDigit(fromRows[index] ?? 0, digit, index));
  const durationMs = Math.max(900, spinInput.value * 1000);

  reelPositions = [...fromRows];
  renderReels();

  await nextAnimationFrame();

  try {
    await animateRows(fromRows, targetRows, durationMs);
  } finally {
    const finalDigits = targetRows.map((row) => digitAtRow(row));
    const expectedDigits = targetDigits.join('');
    const actualDigits = finalDigits.join('');
    displayedValue.value = value;

    if (actualDigits !== expectedDigits) {
      setReelsToValue(value);
    }

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
