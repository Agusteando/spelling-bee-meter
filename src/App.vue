<template>
  <main class="app-shell">
    <section class="hero-stage">
      <ThreeBeeScene :slow-drift-enabled="panoramaDriftEnabled" :splat-enabled="splatEnabled" />

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

    <section class="splat-orbit-panel" aria-label="Scene view controls">
      <div class="orbit-actions">
        <button class="btn orbit-toggle" type="button" @click="panoramaDriftEnabled = !panoramaDriftEnabled">
          {{ panoramaDriftEnabled ? 'Pause slow depth travel' : 'Resume slow depth travel' }}
        </button>
        <button class="btn orbit-toggle secondary" type="button" @click="splatEnabled = !splatEnabled">
          {{ splatEnabled ? 'Hide Gaussian splat scene' : 'Show Gaussian splat scene' }}
        </button>
      </div>
      <p>The Gaussian splat is on by default. The camera travels slowly forward and back at a fixed angle to show depth; drag lightly to nudge the view.</p>
    </section>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import ThreeBeeScene from './components/ThreeBeeScene.vue';

const BUILD_STAMP = '20260610-011500';
const STATE_KEY = 'bee-slot-state';
const DUR_KEY = 'bee-slot-dur';
const DEF_MAX = 100;
const DEF_SEC = 5;
const REEL_LOOPS = 4;
const INTRO_TOTAL_MS = 8000;
const INTRO_FADE_MS = 2000;

const reelsRoot = ref(null);
const introVideo = ref(null);
const showIntro = ref(true);
const rolling = ref(false);
const installPrompt = ref(null);
const panoramaDriftEnabled = ref(true);
const splatEnabled = ref(true);
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

let displayedValue = state.value.drawn.at(-1) ?? 0;
let digitHeight = 0;
let resizeFrame = 0;
let currentDigits = [];
let activeTimers = [];

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
  return `translateY(${-row * digitHeight}px)`;
}

function cancelReelTimers() {
  activeTimers.forEach((timer) => window.clearTimeout(timer));
  activeTimers = [];
}

function setColumnRow(column, row) {
  column.style.transition = 'none';
  column.style.transform = transformForRow(row);
}

function normalizeRowsToValue(value = displayedValue) {
  const digits = pad(value).split('').map(Number);
  const columns = getColumns();
  currentDigits = digits;
  columns.forEach((column, index) => {
    setColumnRow(column, currentDigits[index] ?? 0);
  });
}

async function setupReels(value = displayedValue) {
  await nextTick();
  await document.fonts?.ready?.catch?.(() => null);
  measureDigit();
  normalizeRowsToValue(value);
}

function waitForTransformEnd(column, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      column.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (event.propertyName === 'transform') finish();
    };
    column.addEventListener('transitionend', onEnd);
    const timer = window.setTimeout(finish, timeoutMs + 120);
    activeTimers.push(timer);
  });
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

  cancelReelTimers();
  rolling.value = true;
  setSpinTimeCss();
  await nextTick();

  const targetDigits = pad(value).split('').map(Number);
  const durationMs = Math.max(700, spinInput.value * 1000);

  await Promise.all(columns.map(async (column, index) => {
    const targetDigit = targetDigits[index] ?? 0;
    const loops = REEL_LOOPS + index;
    const endRow = loops * 10 + targetDigit;
    const localDuration = durationMs + index * 120;

    // Match the original project behavior: do not reset the visible reel before spinning.
    // The column is already parked on the current digit; we only transition to a far
    // repeated row of the target digit, then invisibly park it back on that same digit.
    column.style.transition = `transform ${localDuration}ms cubic-bezier(.32,.02,.19,1)`;
    column.style.transform = transformForRow(endRow);

    await waitForTransformEnd(column, localDuration);

    setColumnRow(column, targetDigit);
  }));

  cancelReelTimers();
  displayedValue = value;
  currentDigits = targetDigits;
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
  cancelReelTimers();
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('resize', handleMeterResize);
  window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
});
</script>
