<template>
  <main class="app-shell">
    <section class="hero-stage">
      <ThreeBeeScene />

      <video
        v-if="showIntro"
        ref="introVideo"
        class="intro-video"
        src="/intro.mp4"
        autoplay
        muted
        playsinline
        @ended="showIntro = false"
        @timeupdate="fadeIntro"
      ></video>

      <div class="slot-overlay" aria-label="Spelling Bee draw meter">
        <div ref="reelsRoot" class="reel-wrap" :class="{ rolling }" @click="draw">
          <div v-for="position in state.digits" :key="position" class="reel">
            <div class="numbers">
              <span v-for="(digit, index) in reelDigits" :key="`${position}-${index}`">{{ digit }}</span>
            </div>
          </div>
        </div>
        <p class="draw-hint">Click the meter or press space to draw</p>
      </div>

      <div id="gradient" class="gradient-bar" :class="{ animate: rolling }"></div>
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
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import ThreeBeeScene from './components/ThreeBeeScene.vue';

const BUILD_STAMP = '20260609-231027';
const STATE_KEY = 'bee-slot-state';
const DUR_KEY = 'bee-slot-dur';
const DEF_MAX = 100;
const DEF_SEC = 5;
const REEL_LOOPS = 5;
const REEL_STRIP_SETS = 96;
const INTRO_TOTAL_MS = 8000;
const INTRO_FADE_MS = 2000;

const reelsRoot = ref(null);
const introVideo = ref(null);
const showIntro = ref(true);
const rolling = ref(false);
const installPrompt = ref(null);
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
const reelDigits = computed(() => Array.from({ length: REEL_STRIP_SETS * 10 }, (_, index) => index % 10));

let displayedValue = state.value.drawn.at(-1) ?? 0;
let digitHeight = 0;
let resizeFrame = 0;
let currentRows = [];
let currentDigits = [];
let activeAnimations = [];

function pad(value) {
  return String(value).padStart(state.value.digits, '0');
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state.value));
  hasSavedState.value = true;
}

function notifySceneActivity() {
  window.dispatchEvent(new CustomEvent('bee-meter-activity'));
}

function setSpinTimeCss() {
  document.documentElement.style.setProperty('--spin-time', `${spinInput.value}s`);
}

function measureDigit() {
  const span = reelsRoot.value?.querySelector('span');
  const nextHeight = span?.getBoundingClientRect().height || 0;
  if (nextHeight > 0) digitHeight = nextHeight;
  return digitHeight;
}

function getColumns() {
  return [...(reelsRoot.value?.querySelectorAll('.numbers') || [])];
}

function transformForRow(row) {
  return `translate3d(0, ${-row * digitHeight}px, 0)`;
}

function setColumnRow(column, row) {
  column.getAnimations?.().forEach((animation) => animation.cancel());
  column.style.transition = 'none';
  column.style.transform = transformForRow(row);
}

function normalizeRowsToValue(value = displayedValue) {
  const digits = pad(value).split('').map(Number);
  const columns = getColumns();
  currentRows = digits.map((digit) => digit);
  currentDigits = digits;
  columns.forEach((column, index) => {
    setColumnRow(column, currentRows[index] ?? 0);
  });
}

async function setupReels(value = displayedValue) {
  await nextTick();
  await document.fonts?.ready?.catch?.(() => null);
  measureDigit();
  normalizeRowsToValue(value);
}

function normalizeIfNeeded(columns) {
  const threshold = REEL_STRIP_SETS * 10 - 90;
  if (!currentRows.some((row) => row > threshold)) return;
  currentRows = currentDigits.map((digit) => digit);
  columns.forEach((column, index) => setColumnRow(column, currentRows[index] ?? 0));
}

async function spinTo(value) {
  const columns = getColumns();
  if (!columns.length) return;
  measureDigit();
  if (!digitHeight) {
    displayedValue = value;
    normalizeRowsToValue(value);
    return;
  }

  activeAnimations.forEach((animation) => animation.cancel());
  activeAnimations = [];
  rolling.value = true;
  setSpinTimeCss();
  await nextTick();

  const targetDigits = pad(value).split('').map(Number);
  const durationMs = Math.max(650, spinInput.value * 1000);

  await Promise.all(columns.map((column, index) => {
    const startRow = currentRows[index] ?? Number(pad(displayedValue)[index] ?? 0);
    const startDigit = ((startRow % 10) + 10) % 10;
    const targetDigit = targetDigits[index] ?? 0;
    const delta = (targetDigit - startDigit + 10) % 10;
    const loops = REEL_LOOPS + index + Math.floor(index / 2);
    const endRow = startRow + loops * 10 + delta;
    const delay = index * 80;

    currentRows[index] = endRow;
    currentDigits[index] = targetDigit;

    column.style.transition = 'none';
    column.style.transform = transformForRow(startRow);

    const animation = column.animate(
      [
        { transform: transformForRow(startRow), filter: 'brightness(1)' },
        { transform: transformForRow(endRow - 1.16), filter: 'brightness(1.16)', offset: 0.78 },
        { transform: transformForRow(endRow + 0.18), filter: 'brightness(1.04)', offset: 0.92 },
        { transform: transformForRow(endRow), filter: 'brightness(1)' }
      ],
      {
        duration: durationMs + delay,
        easing: 'cubic-bezier(.19,.92,.21,1)',
        fill: 'forwards'
      }
    );

    activeAnimations.push(animation);

    return animation.finished.catch(() => null).then(() => {
      column.style.transform = transformForRow(endRow);
    });
  }));

  displayedValue = value;
  normalizeIfNeeded(columns);
  rolling.value = false;
}

async function draw() {
  if (rolling.value) return;
  notifySceneActivity();

  if (state.value.idx + 1 >= state.value.data.length) {
    state.value = fresh(state.value.max);
    displayedValue = 0;
    await setupReels(0);
  }

  state.value.idx += 1;
  const drawnNumber = state.value.data[state.value.idx];
  state.value.drawn.push(drawnNumber);
  saveState();
  await spinTo(drawnNumber);
}

async function resetList() {
  if (rolling.value) return;
  notifySceneActivity();
  state.value = fresh(state.value.max);
  saveState();
  displayedValue = 0;
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

function fadeIntro() {
  const video = introVideo.value;
  if (!video) return;
  if (video.currentTime >= (INTRO_TOTAL_MS - INTRO_FADE_MS) / 1000) {
    const remainingMs = Math.max(250, (INTRO_TOTAL_MS / 1000 - video.currentTime) * 1000);
    video.style.transition = `opacity ${remainingMs}ms linear`;
    video.style.opacity = '0';
  }
}

function handleKeydown(event) {
  if (event.key === ' ') {
    event.preventDefault();
    draw();
  }
}

function handleMeterResize() {
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0;
    if (rolling.value) return;
    measureDigit();
    normalizeRowsToValue(displayedValue);
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
  await setupReels(displayedValue);
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', handleMeterResize);
  window.addEventListener('beforeinstallprompt', handleBeforeInstall);
  refreshServiceWorker();
});

onBeforeUnmount(() => {
  activeAnimations.forEach((animation) => animation.cancel());
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('resize', handleMeterResize);
  window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
});
</script>
