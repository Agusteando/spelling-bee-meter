const SOUND_PREF_KEY = 'bee-sound-enabled';
const MASTER_VOLUME = 0.72;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function now(ctx) {
  return ctx?.currentTime || 0;
}

export function createSoundboard({ onState } = {}) {
  let ctx = null;
  let masterGain = null;
  let ambienceGain = null;
  let sfxGain = null;
  let reelGain = null;
  let loaderGain = null;
  let compressor = null;
  let enabled = localStorage.getItem(SOUND_PREF_KEY) === 'true';
  let muted = !enabled;
  let unlocked = false;
  let sceneActive = false;
  let loaderActive = true;
  let ambienceStarted = false;
  let ambientTimer = 0;
  let loaderTimer = 0;
  let spinTimer = 0;
  const ambientNodes = [];
  const timeouts = new Set();

  function emitState() {
    onState?.({
      enabled,
      muted,
      unlocked,
      supported: Boolean(window.AudioContext || window.webkitAudioContext)
    });
  }

  function ensureContext() {
    if (ctx) return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      emitState();
      return false;
    }

    ctx = new AudioContextClass({ latencyHint: 'interactive' });

    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;

    masterGain = ctx.createGain();
    ambienceGain = ctx.createGain();
    sfxGain = ctx.createGain();
    reelGain = ctx.createGain();
    loaderGain = ctx.createGain();

    masterGain.gain.value = enabled && !muted ? MASTER_VOLUME : 0;
    ambienceGain.gain.value = 0.2;
    sfxGain.gain.value = 0.78;
    reelGain.gain.value = 0.58;
    loaderGain.gain.value = 0.46;

    ambienceGain.connect(masterGain);
    sfxGain.connect(masterGain);
    reelGain.connect(masterGain);
    loaderGain.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);
    emitState();
    return true;
  }

  async function resume() {
    if (!ensureContext()) return false;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      unlocked = ctx.state === 'running';
    } catch {
      unlocked = false;
    }
    emitState();
    return unlocked;
  }

  function setMasterVolume(target = MASTER_VOLUME) {
    if (!masterGain || !ctx) return;
    const t = now(ctx);
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setTargetAtTime(target, t, 0.035);
  }

  function setGroupGain(gainNode, value, timeConstant = 0.06) {
    if (!gainNode || !ctx) return;
    const t = now(ctx);
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setTargetAtTime(value, t, timeConstant);
  }

  function isAudible() {
    return Boolean(ctx && enabled && !muted);
  }

  function createNoiseBuffer(seconds = 1.4) {
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(sampleRate * seconds)), sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[i] = last;
    }
    return buffer;
  }

  function envGain({ attack = 0.01, decay = 0.1, sustain = 0, release = 0.2, peak = 0.3, start = now(ctx), hold = 0 } = {}) {
    const gain = ctx.createGain();
    const p = Math.max(0.0001, peak);
    const endAttack = start + attack;
    const endDecay = endAttack + decay;
    const startRelease = endDecay + hold;

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(p, endAttack);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, p * sustain), endDecay);
    gain.gain.setValueAtTime(Math.max(0.0001, p * sustain), startRelease);
    gain.gain.exponentialRampToValueAtTime(0.0001, startRelease + release);
    return gain;
  }

  function playTone({
    type = 'sine',
    frequency = 440,
    endFrequency = null,
    duration = 0.35,
    gain = 0.2,
    destination = sfxGain,
    delay = 0,
    attack = 0.01,
    decay = 0.08,
    sustain = 0.25,
    release = 0.18,
    detune = 0
  } = {}) {
    if (!isAudible()) return null;
    const start = now(ctx) + delay;
    const oscillator = ctx.createOscillator();
    const amp = envGain({ attack, decay, sustain, release, peak: gain, start, hold: Math.max(0, duration - attack - decay - release) });
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.detune.setValueAtTime(detune, start);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    oscillator.connect(amp);
    amp.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + release + 0.05);
    return oscillator;
  }

  function playNoise({
    destination = sfxGain,
    delay = 0,
    duration = 0.35,
    gain = 0.18,
    attack = 0.01,
    decay = 0.08,
    sustain = 0.2,
    release = 0.18,
    filterType = 'bandpass',
    frequency = 900,
    endFrequency = null,
    q = 1.2
  } = {}) {
    if (!isAudible()) return null;
    const start = now(ctx) + delay;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const amp = envGain({ attack, decay, sustain, release, peak: gain, start, hold: Math.max(0, duration - attack - decay - release) });

    source.buffer = createNoiseBuffer(duration + release + 0.08);
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    filter.Q.value = q;
    if (endFrequency) filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);

    source.connect(filter);
    filter.connect(amp);
    amp.connect(destination);
    source.start(start);
    source.stop(start + duration + release + 0.05);
    return source;
  }

  function schedule(fn, delayMs) {
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      fn();
    }, Math.max(0, delayMs));
    timeouts.add(id);
    return id;
  }

  function clearScheduled() {
    timeouts.forEach((id) => window.clearTimeout(id));
    timeouts.clear();
  }

  function chime(frequencies, { gain = 0.13, delay = 0, spread = 0.045, destination = sfxGain } = {}) {
    frequencies.forEach((frequency, index) => {
      playTone({
        type: 'sine',
        frequency,
        duration: 0.58 + index * 0.04,
        gain: gain * (1 - index * 0.08),
        destination,
        delay: delay + index * spread,
        attack: 0.008,
        decay: 0.12,
        sustain: 0.22,
        release: 0.42
      });
    });
  }

  function honeyPop(delay = 0, strength = 1) {
    playTone({ type: 'triangle', frequency: 220, endFrequency: 145, duration: 0.15, gain: 0.09 * strength, delay, attack: 0.006, decay: 0.04, sustain: 0.2, release: 0.08 });
    playNoise({ frequency: 720, endFrequency: 320, q: 5.5, duration: 0.16, gain: 0.055 * strength, delay, attack: 0.003, decay: 0.045, sustain: 0.14, release: 0.1 });
  }

  function sparkle(delay = 0, strength = 1) {
    chime([1320, 1760, 2217], { gain: 0.032 * strength, delay, spread: 0.032, destination: sfxGain });
  }

  function wingFlutter(delay = 0, strength = 1) {
    playNoise({ frequency: 1650, endFrequency: 1120, q: 7.2, duration: 0.18, gain: 0.035 * strength, delay, attack: 0.008, decay: 0.05, sustain: 0.18, release: 0.11 });
    playNoise({ frequency: 2400, endFrequency: 1600, q: 9.5, duration: 0.12, gain: 0.018 * strength, delay: delay + 0.04, attack: 0.004, decay: 0.04, sustain: 0.12, release: 0.07 });
  }

  function beeFlutter(delay = 0, strength = 1) {
    playTone({ type: 'sawtooth', frequency: 118, endFrequency: 132, duration: 0.26, gain: 0.018 * strength, delay, attack: 0.02, decay: 0.07, sustain: 0.25, release: 0.14 });
    playNoise({ frequency: 620, endFrequency: 740, q: 3.8, duration: 0.24, gain: 0.026 * strength, delay, attack: 0.012, decay: 0.06, sustain: 0.28, release: 0.13 });
  }

  function startAmbience() {
    if (ambienceStarted || !isAudible()) return;
    ambienceStarted = true;
    setGroupGain(ambienceGain, sceneActive ? 0.22 : 0.08, 0.18);

    const t = now(ctx);
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 680;
    padFilter.Q.value = 0.4;
    padFilter.connect(ambienceGain);

    [110, 165, 220].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = index === 1 ? 'triangle' : 'sine';
      osc.frequency.value = frequency;
      gain.gain.value = [0.014, 0.01, 0.008][index];
      osc.connect(gain);
      gain.connect(padFilter);
      osc.start(t + index * 0.02);
      ambientNodes.push(osc, gain);
    });

    const wind = ctx.createBufferSource();
    const windFilter = ctx.createBiquadFilter();
    const windGain = ctx.createGain();
    wind.buffer = createNoiseBuffer(3);
    wind.loop = true;
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 480;
    windGain.gain.value = 0.022;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(ambienceGain);
    wind.start(t);
    ambientNodes.push(wind, windFilter, windGain);

    ambientTimer = window.setInterval(() => {
      if (!isAudible() || !sceneActive) return;
      const pick = Math.random();
      if (pick < 0.38) beeFlutter(0, 0.7 + Math.random() * 0.5);
      else if (pick < 0.72) wingFlutter(0, 0.55 + Math.random() * 0.45);
      else sparkle(0, 0.45 + Math.random() * 0.35);
    }, 1350);
  }

  function stopAmbience() {
    if (ambientTimer) window.clearInterval(ambientTimer);
    ambientTimer = 0;
    ambientNodes.splice(0).forEach((node) => {
      try { node.stop?.(); } catch {}
      try { node.disconnect?.(); } catch {}
    });
    ambienceStarted = false;
  }

  function startLoaderLoop() {
    if (loaderTimer || !isAudible() || !loaderActive) return;
    setGroupGain(loaderGain, 0.44, 0.08);
    loaderTimer = window.setInterval(() => {
      if (!isAudible() || !loaderActive) return;
      honeyPop(0, 0.52 + Math.random() * 0.38);
      if (Math.random() > 0.55) sparkle(0.04, 0.28);
    }, 820);
  }

  function stopLoaderLoop() {
    if (loaderTimer) window.clearInterval(loaderTimer);
    loaderTimer = 0;
    setGroupGain(loaderGain, 0.0, 0.08);
  }

  function loaderProgress(progress = 0, label = '', isError = false) {
    if (isError) {
      stopLoaderLoop();
      error();
      return;
    }

    loaderActive = progress < 1;
    if (loaderActive) {
      startLoaderLoop();
      if (isAudible() && progress > 0.2 && Math.random() > 0.88) honeyPop(0, 0.42);
    } else {
      stopLoaderLoop();
    }
  }

  function uiTap() {
    if (!isAudible()) return;
    honeyPop(0, 0.66);
  }

  function confirm() {
    if (!isAudible()) return;
    honeyPop(0, 0.55);
    sparkle(0.035, 0.36);
  }

  function reset() {
    if (!isAudible()) return;
    playNoise({ frequency: 900, endFrequency: 260, q: 3.2, duration: 0.34, gain: 0.075, attack: 0.01, decay: 0.08, sustain: 0.25, release: 0.22 });
    chime([660, 523, 392], { gain: 0.045, spread: 0.05 });
  }

  function error() {
    if (!isAudible()) return;
    playTone({ type: 'sine', frequency: 220, endFrequency: 196, duration: 0.42, gain: 0.09, attack: 0.012, decay: 0.08, sustain: 0.3, release: 0.32 });
    playTone({ type: 'triangle', frequency: 146, duration: 0.36, gain: 0.045, delay: 0.04, attack: 0.018, decay: 0.08, sustain: 0.28, release: 0.26 });
  }

  function spinStart({ durationMs = 5000, digits = 3 } = {}) {
    if (!isAudible()) return;
    stopSpin();

    const spinSeconds = durationMs / 1000;
    setGroupGain(reelGain, 0.66, 0.04);
    playNoise({ destination: reelGain, frequency: 180, endFrequency: 880, q: 1.15, duration: Math.min(1.25, spinSeconds * 0.26), gain: 0.17, attack: 0.018, decay: 0.18, sustain: 0.34, release: 0.22 });
    playTone({ destination: reelGain, type: 'triangle', frequency: 130, endFrequency: 196, duration: 0.38, gain: 0.08, attack: 0.01, decay: 0.08, sustain: 0.24, release: 0.16 });
    chime([523, 659, 784], { destination: reelGain, gain: 0.055, delay: 0.06, spread: 0.038 });

    let tickCount = 0;
    spinTimer = window.setInterval(() => {
      if (!isAudible()) return;
      tickCount += 1;
      const lift = clamp(tickCount / Math.max(1, spinSeconds * 9), 0, 1);
      const base = 260 + lift * 240 + Math.random() * 28;
      playTone({ destination: reelGain, type: 'square', frequency: base, duration: 0.055, gain: 0.018 + lift * 0.012, attack: 0.002, decay: 0.02, sustain: 0.08, release: 0.035 });
      if (tickCount % 3 === 0) playNoise({ destination: reelGain, frequency: 1200 + lift * 500, q: 7, duration: 0.05, gain: 0.014, attack: 0.002, decay: 0.012, sustain: 0.08, release: 0.035 });
    }, 105);

    for (let i = 0; i < digits; i += 1) {
      const lockMs = durationMs + i * 250;
      schedule(() => reelLock(i, digits), lockMs);
    }
  }

  function reelLock(index = 0, total = 3) {
    if (!isAudible()) return;
    const strength = 0.72 + index / Math.max(1, total) * 0.34;
    playTone({ destination: reelGain, type: 'triangle', frequency: 196 + index * 34, duration: 0.16, gain: 0.08 * strength, attack: 0.004, decay: 0.04, sustain: 0.2, release: 0.11 });
    playNoise({ destination: reelGain, frequency: 520 + index * 160, endFrequency: 260 + index * 80, q: 5.8, duration: 0.13, gain: 0.06 * strength, attack: 0.002, decay: 0.04, sustain: 0.13, release: 0.08 });
    if (index === total - 1) sparkle(0.06, 0.62);
  }

  function stopSpin() {
    if (spinTimer) window.clearInterval(spinTimer);
    spinTimer = 0;
    clearScheduled();
    setGroupGain(reelGain, 0.0, 0.16);
  }

  function spinComplete() {
    if (!isAudible()) return;
    stopSpin();
    playNoise({ destination: sfxGain, frequency: 360, endFrequency: 1260, q: 1.1, duration: 0.42, gain: 0.11, attack: 0.01, decay: 0.08, sustain: 0.18, release: 0.22 });
    chime([523, 659, 784, 1046, 1318], { gain: 0.095, delay: 0.04, spread: 0.055 });
    schedule(() => sparkle(0, 0.92), 180);
  }

  function sceneReady() {
    sceneActive = true;
    loaderActive = false;
    stopLoaderLoop();
    setGroupGain(ambienceGain, 0.22, 0.28);
    startAmbience();
    if (!isAudible()) return;
    playNoise({ destination: sfxGain, frequency: 240, endFrequency: 980, q: 1.1, duration: 0.55, gain: 0.075, attack: 0.02, decay: 0.12, sustain: 0.25, release: 0.28 });
    chime([392, 523, 659, 784], { gain: 0.055, delay: 0.08, spread: 0.05 });
  }

  async function enable() {
    enabled = true;
    muted = false;
    localStorage.setItem(SOUND_PREF_KEY, 'true');
    const ok = await resume();
    setMasterVolume(MASTER_VOLUME);
    startAmbience();
    if (loaderActive) startLoaderLoop();
    confirm();
    emitState();
    return ok;
  }

  function mute() {
    muted = true;
    enabled = false;
    localStorage.setItem(SOUND_PREF_KEY, 'false');
    setMasterVolume(0);
    stopLoaderLoop();
    stopSpin();
    emitState();
  }

  async function toggle() {
    if (enabled && !muted) {
      mute();
      return false;
    }
    await enable();
    return true;
  }

  async function resumeIfEnabled() {
    if (!enabled || muted) return false;
    await resume();
    setMasterVolume(MASTER_VOLUME);
    startAmbience();
    if (loaderActive) startLoaderLoop();
    return true;
  }

  function dispose() {
    stopLoaderLoop();
    stopSpin();
    stopAmbience();
    clearScheduled();
    if (ctx) {
      try { ctx.close(); } catch {}
    }
    ctx = null;
    emitState();
  }

  emitState();

  return {
    getState: () => ({ enabled, muted, unlocked, supported: Boolean(window.AudioContext || window.webkitAudioContext) }),
    enable,
    mute,
    toggle,
    resumeIfEnabled,
    loaderProgress,
    sceneReady,
    uiTap,
    confirm,
    reset,
    error,
    spinStart,
    spinComplete,
    stopSpin,
    dispose
  };
}
