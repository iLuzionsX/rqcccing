export function createAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const engine = ctx.createOscillator();
  const engine2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  engine.type = 'sawtooth';
  engine2.type = 'triangle';
  engine2.detune.value = 7;
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  gain.gain.value = 0;
  engine.connect(filter);
  engine2.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  engine.start();
  engine2.start();

  const wind = ctx.createBufferSource();
  wind.buffer = noiseBuffer(ctx);
  wind.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 400;
  const windGain = ctx.createGain();
  windGain.gain.value = 0;
  wind.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(master);
  wind.start();

  const scrub = ctx.createBufferSource();
  scrub.buffer = noiseBuffer(ctx);
  scrub.loop = true;
  const scrubFilter = ctx.createBiquadFilter();
  scrubFilter.type = 'bandpass';
  scrubFilter.frequency.value = 900;
  scrubFilter.Q.value = 0.7;
  const scrubGain = ctx.createGain();
  scrubGain.gain.value = 0;
  scrub.connect(scrubFilter);
  scrubFilter.connect(scrubGain);
  scrubGain.connect(master);
  scrub.start();

  return {
    ctx,
    resume() {
      return ctx.resume();
    },
    update(speed, throttle, gear = 1, slip = 0) {
      const now = ctx.currentTime;
      const kmh = Math.max(0, speed) * 3.6;
      const bands = [0, 42, 78, 118, 158, 205, 280];
      const index = Math.min(6, Math.max(1, gear));
      const local = Math.min(1, Math.max(0, (kmh - bands[index - 1]) / (bands[index] - bands[index - 1])));
      const freq = 52 + local * 128 + (index - 1) * 6;
      engine.frequency.setTargetAtTime(freq, now, 0.045);
      engine2.frequency.setTargetAtTime(freq * 0.5, now, 0.05);
      filter.frequency.setTargetAtTime(260 + local * 1900 + throttle * 900, now, 0.05);
      gain.gain.setTargetAtTime(0.016 + throttle * 0.034 + local * 0.012, now, 0.05);
      const rpm = Math.min(1, kmh / 250);
      windGain.gain.setTargetAtTime(Math.min(0.045, rpm * rpm * 0.055), now, 0.1);
      windFilter.frequency.setTargetAtTime(280 + rpm * 1900, now, 0.1);
      const scrub = Math.min(1, Math.max(0, Math.abs(slip) - 0.16) * 2.8);
      scrubGain.gain.setTargetAtTime(scrub * (0.012 + rpm * 0.03), now, 0.04);
      scrubFilter.frequency.setTargetAtTime(700 + scrub * 1800, now, 0.05);
    },
    tone(freq, duration, type = 'sine', level = 0.06) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(g);
      g.connect(master);
      const now = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(level, now + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    },
  };
}

function noiseBuffer(ctx) {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = last * 0.96 + white * 0.04;
    data[i] = last * 3;
  }
  return buffer;
}
