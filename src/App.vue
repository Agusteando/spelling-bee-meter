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

const STATE_KEY = 'bee-slot-state';
const DUR_KEY = 'bee-slot-dur';
const DEF_MAX = 100;
const DEF_SEC = 5;
const LOOPS = 4;
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
let digitHeight = 0;

const reelDigits = computed(() => Array.from({ length: (LOOPS + 3) * 10 }, (_, index) => index % 10));
const remaining = computed(() => state.value.max - state.value.drawn.length);
const historyText = computed(() => (state.value.drawn.length ? `Numbers drawn: ${state.value.drawn.join(', ')}` : ''));

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state.value));
  hasSavedState.value = true;
}

function measureDigit() {
  const span = reelsRoot.value?.querySelector('span');
  digitHeight = span?.getBoundingClientRect().height || 0;
}

function lastDisplayedValue() {
  return state.value.drawn.at(-1) ?? 0;
}

function resetReelColumns(value = lastDisplayedValue()) {
  const digits = pad(value).split('').map(Number);
  reelsRoot.value?.querySelectorAll('.numbers').forEach((column, index) => {
    const digit = digits[index] ?? 0;
    column.style.transition = 'none';
    column.style.transform = `translateY(${-digit * digitHeight}px)`;
  });
}

function notifySceneActivity() {
  window.dispatchEvent(new CustomEvent('bee-meter-activity'));
}

function pad(value) {
  return String(value).padStart(state.value.digits, '0');
}

function setSpinTimeCss() {
  document.documentElement.style.setProperty('--spin-time', `${spinInput.value}s`);
}

async function spinTo(value) {
  rolling.value = true;
  setSpinTimeCss();
  await nextTick();
  measureDigit();

  const columns = [...(reelsRoot.value?.querySelectorAll('.numbers') || [])];
  const digits = pad(value).split('').map(Number);

  if (!columns.length || !digitHeight) {
    rolling.value = false;
    return;
  }

  await Promise.all(columns.map((column, index) => new Promise(resolve => {
    const loops = LOOPS + index;
    const digit = digits[index] ?? 0;
    const endY = -(loops * 10 + digit) * digitHeight;

    column.style.transition = 'transform var(--spin-time) cubic-bezier(.32,.02,.19,1)';
    column.getBoundingClientRect();

    const finish = () => {
      column.removeEventListener('transitionend', finish);
      column.style.transition = 'none';
      column.style.transform = `translateY(${-digit * digitHeight}px)`;
      resolve();
    };

    column.addEventListener('transitionend', finish, { once: true });
    requestAnimationFrame(() => {
      column.style.transform = `translateY(${endY}px)`;
    });
  })));

  rolling.value = false;
}

async function draw() {
  if (rolling.value) return;
  notifySceneActivity();

  if (state.value.idx + 1 >= state.value.data.length) {
    state.value = fresh(state.value.max);
    await nextTick();
    measureDigit();
    resetReelColumns(0);
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
  await nextTick();
  measureDigit();
  resetReelColumns(0);
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

function installApp() {
  if (!installPrompt.value) return;
  installPrompt.value.prompt();
  installPrompt.value = null;
}

function handleBeforeInstall(event) {
  event.preventDefault();
  installPrompt.value = event;
}

onMounted(() => {
  setSpinTimeCss();
  nextTick(() => {
    measureDigit();
    resetReelColumns();
  });
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('beforeinstallprompt', handleBeforeInstall);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => null);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
});
</script>
