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

  return {
    ctx,
    resume() {
      return ctx.resume();
    },
    update(speed, throttle) {
      const now = ctx.currentTime;
      const rpm = Math.min(1, Math.max(0, speed / 70));
      const gear = Math.min(5, Math.floor(rpm * 6));
      const local = rpm * 6 - gear;
      const freq = 48 + local * 92 + gear * 8;
      engine.frequency.setTargetAtTime(freq, now, 0.04);
      engine2.frequency.setTargetAtTime(freq * 0.5, now, 0.05);
      filter.frequency.setTargetAtTime(280 + local * 1800 + throttle * 700, now, 0.05);
      gain.gain.setTargetAtTime(0.018 + throttle * 0.03 + rpm * 0.02, now, 0.05);
      windGain.gain.setTargetAtTime(Math.min(0.04, rpm * rpm * 0.05), now, 0.1);
      windFilter.frequency.setTargetAtTime(300 + rpm * 1800, now, 0.1);
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
