import { clamp } from './util.js';

const FILES = [
  ['engine', '/assets/audio/engine.ogg'],
  ['squeal', '/assets/audio/squeal.ogg'],
  ['gravel', '/assets/audio/gravel.ogg'],
  ['asphalt', '/assets/audio/asphalt.ogg'],
];

const GEAR_BANDS = [0, 42, 78, 118, 158, 205, 280];

export function loadAudioFiles() {
  return Promise.all(FILES.map(async ([id, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Missing ${url}`);
    return [id, await response.arrayBuffer()];
  }));
}

export function engineRpm(speed, gear) {
  const kmh = Math.max(0, speed) * 3.6;
  const index = Math.min(6, Math.max(1, gear || 1));
  const span = GEAR_BANDS[index] - GEAR_BANDS[index - 1] || 1;
  const local = clamp((kmh - GEAR_BANDS[index - 1]) / span, 0, 1);
  return 0.28 + local * 0.72;
}

export function surfaceKind(stageId, lateral) {
  const abs = Math.abs(lateral || 0);
  if (abs > 6.6) return 'grass';
  if (abs > 5.9 || stageId === 'ridge') return 'gravel';
  return 'asphalt';
}

export function scrubAmount(slip, handbrake, speed) {
  const slide = Math.min(1, Math.max(0, Math.abs(slip) - 0.08) * 3.4);
  const locked = handbrake > 0.4 ? 0.85 : 0;
  const moving = clamp((Math.abs(speed) - 1) / 6, 0, 1);
  return Math.min(1, Math.max(slide, locked) * moving);
}

export async function createAudio(encoded) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);

  const buffers = {};
  await Promise.all(encoded.map(async ([id, bytes]) => {
    buffers[id] = await ctx.decodeAudioData(bytes.slice(0));
  }));

  const engine = buildEngine(ctx, master, buffers.engine);
  const tires = buildTires(ctx, master, buffers);

  let muted = false;
  let gear = 1;

  return {
    ctx,
    resume() {
      return ctx.resume();
    },
    suspend() {
      return ctx.suspend();
    },
    setMuted(next) {
      muted = !!next;
      master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.03);
    },
    update(state) {
      const now = ctx.currentTime;
      const speed = Math.max(0, state.speed || 0);
      const throttle = clamp(state.throttle || 0, 0, 1);
      const nextGear = state.gear || 1;
      const shifted = nextGear !== gear && speed > 4;
      gear = nextGear;
      const rpm = engineRpm(speed, gear);
      engine.render(now, rpm, throttle, shifted);
      tires.render(now, {
        speed,
        surface: state.surface || 'asphalt',
        scrub: scrubAmount(state.slip || 0, state.handbrake || 0, speed),
        airborne: !!state.airborne,
      });
    },
    tone(freq, duration, type = 'sine', level = 0.05) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(master);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(level, 0.0002), now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    },
  };
}

function buildEngine(ctx, master, buffer) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.65;
  filter.connect(master);

  const layers = [
    { rate: (rpm) => 0.64 + rpm * 0.16, weight: (rpm) => clamp(1 - rpm * 1.55, 0, 1) },
    { rate: (rpm) => 0.86 + rpm * 0.26, weight: (rpm) => clamp(1 - Math.abs(rpm - 0.52) * 2.3, 0, 1) },
    { rate: (rpm) => 1.05 + rpm * 0.38, weight: (rpm) => clamp((rpm - 0.38) * 1.9, 0, 1) },
  ].map((layer) => {
    const source = loop(ctx, buffer);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(filter);
    source.start();
    return { ...layer, source, gain };
  });

  const body = loop(ctx, buffer);
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0;
  body.detune.value = -12;
  body.connect(bodyGain);
  bodyGain.connect(filter);
  body.start();

  return {
    render(now, rpm, throttle, shifted) {
      const loud = 0.16 + throttle * 0.42 + (1 - throttle) * (0.08 + rpm * 0.1);
      for (const layer of layers) {
        layer.source.playbackRate.setTargetAtTime(layer.rate(rpm), now, 0.08);
        layer.gain.gain.setTargetAtTime(layer.weight(rpm) * loud, now, throttle > 0.2 ? 0.06 : 0.04);
      }
      body.playbackRate.setTargetAtTime(0.7 + rpm * 0.22, now, 0.1);
      bodyGain.gain.setTargetAtTime(loud * 0.28, now, 0.08);
      const open = shifted ? 480 : 520 + rpm * 1500 + throttle * 1600;
      filter.frequency.setTargetAtTime(open, now, shifted ? 0.02 : 0.07);
    },
  };
}

function buildTires(ctx, master, buffers) {
  const asphalt = loopingGain(ctx, master, buffers.asphalt);
  const gravel = loopingGain(ctx, master, buffers.gravel);
  const squeal = loopingGain(ctx, master, buffers.squeal);
  squeal.filter = ctx.createBiquadFilter();
  squeal.filter.type = 'bandpass';
  squeal.filter.frequency.value = 1400;
  squeal.filter.Q.value = 0.7;
  squeal.source.disconnect();
  squeal.source.connect(squeal.filter);
  squeal.filter.connect(squeal.gain);

  return {
    render(now, state) {
      const pace = clamp((state.speed - 1.5) / 22, 0, 1);
      const rolling = state.airborne ? pace * 0.12 : pace;
      const onGravel = state.surface === 'gravel' || state.surface === 'grass';
      const gravelLevel = onGravel ? rolling * (state.surface === 'grass' ? 0.55 : 0.9) : 0;
      asphalt.gain.gain.setTargetAtTime(onGravel ? 0 : rolling * 0.55, now, 0.08);
      gravel.gain.gain.setTargetAtTime(gravelLevel + (onGravel ? state.scrub * 0.45 : 0), now, 0.05);
      asphalt.source.playbackRate.setTargetAtTime(0.85 + pace * 0.45, now, 0.1);
      gravel.source.playbackRate.setTargetAtTime(0.9 + pace * 0.55, now, 0.1);
      const squealLevel = state.scrub * (onGravel ? 0.22 : 0.7);
      squeal.gain.gain.setTargetAtTime(squealLevel, now, 0.04);
      squeal.source.playbackRate.setTargetAtTime(0.92 + state.scrub * 0.2, now, 0.05);
    },
  };
}

function loopingGain(ctx, master, buffer) {
  const source = loop(ctx, buffer);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(master);
  source.start();
  return { source, gain };
}

function loop(ctx, buffer) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}
