import * as THREE from 'three';
import { detectQuality, clamp } from './util.js';
import { orientCompass } from './compass.js';
import { loadGameAssets } from './assets.js';
import { createCircuit } from './circuit.js';
import { createLighting } from './lighting.js';
import { createEnvironment } from './environment.js';
import { createTrack } from './track.js';
import { createCar, syncCar } from './car.js';
import { createRace, raceStandings } from './race.js';
import { createComposer } from './post.js';
import { createAudio } from './audio.js';

const COLORS = [0x1f5bff, 0xf3f1ec, 0xd4a017, 0xc4271d, 0x17191d, 0x0e8f62];
const params = new URLSearchParams(location.search);
const quality = detectQuality();

const hud = {
  title: document.querySelector('#title'),
  speed: document.querySelector('#speed'),
  gear: document.querySelector('#gear'),
  lap: document.querySelector('#lap'),
  place: document.querySelector('#place'),
  time: document.querySelector('#time'),
  best: document.querySelector('#best'),
  countdown: document.querySelector('#countdown'),
  warning: document.querySelector('#warning'),
  results: document.querySelector('#results'),
  resultBody: document.querySelector('#result-body'),
  minimap: document.querySelector('#minimap'),
  start: document.querySelector('#start'),
  again: document.querySelector('#again'),
};

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.18, 6000);
const circuit = createCircuit(quality.roadSegments);
let lighting;
let track;
let environment;
const race = createRace(circuit);
const models = race.cars.map((car, index) => {
  const model = createCar(COLORS[index], index + 1);
  scene.add(model.root);
  return model;
});
const post = createComposer(renderer, scene, camera, quality);
let audio = null;

const keys = new Set();
const touch = { steer: 0, gas: false, brake: false };
const wheelState = { rotation: 0, held: false, lastAngle: 0 };
let cameraMode = 'title';
let paused = false;
let audioOn = false;
let beepState = -1;
const smoke = createSmoke(scene);
const minimap = setupMinimap(circuit);

const camPos = new THREE.Vector3(40, 8, -20);
const camLook = new THREE.Vector3();
const desiredPos = new THREE.Vector3();
const desiredLook = new THREE.Vector3();
const forward = new THREE.Vector3();
let titleAngle = 0.4;

bindInput();
hud.start.disabled = true;
hud.start.textContent = 'Loading';
hud.start.addEventListener('click', () => begin());
hud.again.addEventListener('click', () => begin(true));
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
loadGameAssets(renderer).then((assets) => {
  lighting = createLighting(scene, renderer, assets.hdr);
  track = createTrack(scene, circuit, assets);
  environment = createEnvironment(scene, circuit, quality, assets);
  hud.start.disabled = false;
  hud.start.textContent = 'Drive';
  if (params.get('autostart') === '1') {
    begin();
    if (params.get('skipintro') === '1') {
      race.phase = 'race';
      race.countdown = 0;
    }
  }
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    updateWheel(dt);
    if (!paused) step(dt);
    environment.update(dt, camera, lighting.sunDirection);
    track.update(dt);
    const player = race.cars[0];
    lighting.updateShadows(models[0].root.position, quality.shadowMap);
    post.grade.uniforms.aberration.value = cameraMode === 'title' ? 0 : Math.min(0.0035, player.speed * 0.00003);
    applyShot();
    post.composer.render();
  });
}).catch((error) => {
  console.error(error);
  hud.start.textContent = 'Load failed';
});

function step(dt) {
  const input = readInput();
  if (race.phase === 'title') {
    updateTitleCamera(dt);
  } else {
    const drive = params.get('bot') === '1' ? null : input;
    race.update(dt, drive);
    updateCountdownAudio();
    race.cars.forEach((car, index) => {
      const sample = circuit.query(car.x, car.z);
      const drive = index === 0 ? input : { throttle: car.speed > 2 ? 0.4 : 0, brake: 0, steer: 0 };
      syncCar(models[index], car, sample, dt, drive);
      if (index === 0) smoke.update(dt, car, sample, input);
    });
    updateChaseCamera(dt, input);
    updateHud();
  }
  if (race.phase === 'title') {
    race.cars.forEach((car, index) => {
      const sample = circuit.query(car.x, car.z);
      syncCar(models[index], car, sample, dt, { throttle: 0, brake: 0, steer: 0 });
    });
  }
}

function begin(resetRace = false) {
  if (!audioOn) {
    audio = createAudio();
    audio.resume();
    audioOn = true;
  }
  if (resetRace) {
    const fresh = createRace(circuit);
    race.cars.forEach((car, index) => Object.assign(car, fresh.cars[index]));
    race.phase = 'countdown';
    race.countdown = 3.4;
    race.elapsed = 0;
    race.finishedOrder = [];
  } else if (race.phase === 'title' || race.phase === 'finish') {
    const fresh = createRace(circuit);
    race.cars.forEach((car, index) => Object.assign(car, fresh.cars[index]));
    race.phase = 'countdown';
    race.countdown = 3.4;
    race.elapsed = 0;
    race.finishedOrder = [];
  }
  beepState = -1;
  paused = false;
  hud.title.classList.add('hidden');
  hud.results.classList.add('hidden');
  hud.results.querySelector('#result-body').innerHTML = '';
  document.querySelector('#hud').classList.remove('hidden');
  document.body.classList.add('driving');
  cameraMode = 'chase';
}

function updateCountdownAudio() {
  if (race.phase !== 'countdown') {
    if (beepState !== 99 && race.phase === 'race') {
      audio.tone(880, 0.28, 'square', 0.05);
      track.setLights('green');
      beepState = 99;
    }
    return;
  }
  track.setLights('red');
  const mark = Math.ceil(race.countdown);
  if (mark !== beepState && mark <= 3 && mark >= 1) {
    audio.tone(420 + (3 - mark) * 70, 0.14, 'square', 0.045);
    beepState = mark;
  }
}

function readInput() {
  const bot = params.get('bot') === '1';
  if (bot && race.phase === 'race') {
    return { throttle: 1, brake: 0, steer: 0, handbrake: 0 };
  }
  const keysSteer = (pressed('arrowright', 'd') ? 1 : 0) - (pressed('arrowleft', 'a') ? 1 : 0);
  const steer = clamp(keysSteer + touch.steer, -1, 1);
  return {
    throttle: pressed('arrowup', 'w') || touch.gas ? 1 : 0,
    brake: pressed('arrowdown', 's') || touch.brake ? 1 : 0,
    steer,
    handbrake: keys.has(' ') ? 1 : 0,
  };
}

function pressed(...names) {
  return names.some((name) => keys.has(name));
}

function updateTitleCamera(dt) {
  titleAngle += dt * 0.12;
  const origin = circuit.atDistance(circuit.length - 24);
  const radius = 16 + Math.sin(titleAngle * 0.7) * 2;
  desiredPos.copy(origin.point)
    .addScaledVector(origin.tangent, Math.cos(titleAngle) * radius)
    .addScaledVector(origin.right, Math.sin(titleAngle) * 9)
    .add(new THREE.Vector3(0, 3.1, 0));
  desiredLook.copy(origin.point).add(new THREE.Vector3(0, 1.1, 0));
  camPos.lerp(desiredPos, 1 - Math.exp(-1.4 * dt));
  camLook.lerp(desiredLook, 1 - Math.exp(-1.6 * dt));
  camera.position.copy(camPos);
  camera.up.set(0, 1, 0);
  camera.lookAt(camLook);
  dampFov(52, dt);
}

function updateChaseCamera(dt, input) {
  const player = race.cars[0];
  const sample = circuit.query(player.x, player.z);
  const frame = player.compass || orientCompass(player.heading, sample.up);
  forward.set(frame.forward.x, frame.forward.y, frame.forward.z);
  const origin = models[0].root.position;
  if (cameraMode === 'bumper') {
    desiredPos.copy(origin).addScaledVector(forward, 1.15).addScaledVector(sample.up, 0.95);
    desiredLook.copy(origin).addScaledVector(forward, 14).addScaledVector(sample.up, 0.7);
  } else if (cameraMode === 'hood') {
    desiredPos.copy(origin).addScaledVector(forward, 0.55).addScaledVector(sample.up, 0.72);
    desiredLook.copy(origin).addScaledVector(forward, 16).addScaledVector(sample.up, 0.55);
  } else {
    const lat = player.latG || 0;
    const back = 6.7 + Math.min(Math.max(player.speed, 0), 55) * 0.04;
    const height = 2.05 + Math.min(Math.max(player.speed, 0), 55) * 0.012;
    desiredPos.copy(origin).addScaledVector(forward, -back).addScaledVector(sample.up, height);
    desiredPos.x += frame.right.x * clamp(lat, -8, 8) * 0.07;
    desiredPos.y += frame.right.y * clamp(lat, -8, 8) * 0.07;
    desiredPos.z += frame.right.z * clamp(lat, -8, 8) * 0.07;
    desiredLook.copy(origin).addScaledVector(forward, 9).addScaledVector(sample.up, 0.92);
  }
  const follow = cameraMode === 'chase' ? 4.6 : 8;
  camPos.lerp(desiredPos, 1 - Math.exp(-follow * dt));
  camLook.lerp(desiredLook, 1 - Math.exp(-6.2 * dt));
  camera.position.copy(camPos);
  const roll = models[0].roll;
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  camera.up.set(
    frame.up.x * cos + frame.right.x * sin,
    frame.up.y * cos + frame.right.y * sin,
    frame.up.z * cos + frame.right.z * sin,
  );
  camera.lookAt(camLook);
  dampFov(58 + Math.min(Math.max(player.speed, 0), 70) * 0.15 + (input.throttle || 0) * 1.2, dt);
}

function applyShot() {
  const shot = params.get('shot');
  if (!shot) return;
  const player = models[0].root.position;
  const heading = race.cars[0].heading;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  camera.up.set(0, 1, 0);
  if (shot === 'car') {
    camera.position.set(player.x - fx * 6.5 + fz * 3.4, player.y + 1.7, player.z - fz * 6.5 - fx * 3.4);
    camera.lookAt(player.x + fx * 0.4, player.y + 0.55, player.z + fz * 0.4);
    camera.fov = 36;
  } else if (shot === 'beauty') {
    const lake = circuit.lake;
    const sample = circuit.atDistance(circuit.length * 0.18);
    camera.position.set(lake.x + 70, 18, lake.z + 24);
    camera.lookAt(sample.point.x, sample.point.y + 2, sample.point.z);
    camera.fov = 46;
  }
  camera.updateProjectionMatrix();
}

function dampFov(target, dt) {
  camera.fov += (target - camera.fov) * Math.min(1, dt * 2.5);
  camera.updateProjectionMatrix();
}

function updateHud() {
  const player = race.cars[0];
  const kmh = Math.max(0, player.speed) * 3.6;
  hud.speed.textContent = String(Math.round(kmh));
  hud.gear.textContent = Math.abs(player.speed) < 0.7 ? 'N' : String(player.gear || 1);
  hud.lap.textContent = `${Math.min(player.completed + 1, 3)} / 3`;
  const order = raceStandings(race);
  const place = order.findIndex((entry) => entry.index === 0) + 1;
  hud.place.textContent = ordinal(place);
  hud.time.textContent = formatTime(race.phase === 'finish' ? player.finishTime : race.elapsed);
  hud.best.textContent = formatTime(player.bestLap);
  hud.warning.classList.toggle('hidden', player.wrongWay < 0.35 || race.phase !== 'race');
  if (race.phase === 'countdown') {
    const n = Math.ceil(race.countdown);
    hud.countdown.textContent = n > 0 ? String(n) : '';
    hud.countdown.classList.remove('hidden');
  } else if (race.phase === 'race' && race.elapsed < 1.1) {
    hud.countdown.textContent = 'GO';
    hud.countdown.classList.remove('hidden');
  } else {
    hud.countdown.classList.add('hidden');
  }
  if (race.phase === 'finish') showResults(order);
  const heard = readInput();
  audio?.update(Math.max(player.speed, 0), heard.throttle, player.gear || 1, player.slip || 0);
  drawMinimap(order);
}

function showResults(order) {
  if (!hud.results.classList.contains('hidden') && hud.resultBody.childElementCount) return;
  hud.results.classList.remove('hidden');
  hud.resultBody.innerHTML = '';
  order.forEach((entry, index) => {
    const row = document.createElement('div');
    const label = entry.index === 0 ? 'You' : `Car ${entry.index + 1}`;
    const time = entry.vehicle.finishTime ? formatTime(entry.vehicle.finishTime) : 'running';
    row.textContent = `${index + 1}  ${label}  ${time}`;
    hud.resultBody.appendChild(row);
  });
}

function formatTime(value) {
  if (value == null || !Number.isFinite(value)) return '--:--.---';
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

function ordinal(n) {
  const mod = n % 100;
  if (mod >= 11 && mod <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

function bindInput() {
  window.addEventListener('keydown', (event) => {
    keys.add(event.key.toLowerCase());
    if (event.key === ' ') event.preventDefault();
    if (event.key.toLowerCase() === 'c') {
      cameraMode = cameraMode === 'chase' ? 'bumper' : cameraMode === 'bumper' ? 'hood' : 'chase';
    }
    if (event.key.toLowerCase() === 'p') paused = !paused;
    if (event.key.toLowerCase() === 'r' && race.phase === 'race') {
      const player = race.cars[0];
      const sample = circuit.atDistance(player.distance);
      player.x = sample.point.x;
      player.z = sample.point.z;
      player.heading = Math.atan2(sample.tangent.x, sample.tangent.z);
      player.speed = Math.min(Math.max(player.speed, 0), 18);
      player.vLong = player.speed;
      player.vLat = 0;
      player.vx = Math.sin(player.heading) * player.speed;
      player.vz = Math.cos(player.heading) * player.speed;
      player.yawRate = 0;
      player.slip = 0;
      player.compass = orientCompass(player.heading, sample.up);
    }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
  bindHold('gas', 'gas');
  bindHold('brake', 'brake');
  bindWheel();
  lockPageZoom();
}

function bindHold(id, field) {
  const el = document.getElementById(id);
  const on = (event) => {
    touch[field] = true;
    try { el.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    event.preventDefault();
  };
  const off = (event) => {
    if (event.pointerId != null && el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    touch[field] = false;
  };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
}

const WHEEL_LOCK = 1.15;

function bindWheel() {
  const wheel = document.getElementById('wheel');
  const rotor = document.getElementById('wheel-rotor');
  const angleOf = (event) => {
    const rect = wheel.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    return Math.atan2(x, -y);
  };
  wheel.addEventListener('pointerdown', (event) => {
    wheelState.held = true;
    wheelState.pointerId = event.pointerId;
    wheelState.lastAngle = angleOf(event);
    try { wheel.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    event.preventDefault();
  });
  wheel.addEventListener('pointermove', (event) => {
    if (!wheelState.held || event.pointerId !== wheelState.pointerId) return;
    const next = angleOf(event);
    let delta = next - wheelState.lastAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    wheelState.lastAngle = next;
    wheelState.rotation = clamp(wheelState.rotation + delta, -WHEEL_LOCK, WHEEL_LOCK);
    applyWheel(rotor);
  });
  const release = (event) => {
    if (event.pointerId !== wheelState.pointerId) return;
    if (wheel.hasPointerCapture(event.pointerId)) wheel.releasePointerCapture(event.pointerId);
    wheelState.held = false;
    wheelState.pointerId = null;
  };
  wheel.addEventListener('pointerup', release);
  wheel.addEventListener('pointercancel', release);
}

function updateWheel(dt) {
  if (!wheelState.held) {
    wheelState.rotation += (0 - wheelState.rotation) * (1 - Math.exp(-8 * dt));
    if (Math.abs(wheelState.rotation) < 0.008) wheelState.rotation = 0;
  }
  touch.steer = wheelState.rotation / WHEEL_LOCK;
  const rotor = document.getElementById('wheel-rotor');
  if (rotor) applyWheel(rotor);
}

function applyWheel(rotor) {
  touch.steer = wheelState.rotation / WHEEL_LOCK;
  rotor.style.transform = `rotate(${wheelState.rotation}rad)`;
  const wheel = document.getElementById('wheel');
  wheel.setAttribute('aria-valuenow', touch.steer.toFixed(2));
  wheel.setAttribute('aria-valuetext', touch.steer > 0.08 ? 'Right' : touch.steer < -0.08 ? 'Left' : 'Centered');
}

function lockPageZoom() {
  const block = (event) => event.preventDefault();
  document.addEventListener('gesturestart', block, { passive: false });
  document.addEventListener('gesturechange', block, { passive: false });
  document.addEventListener('gestureend', block, { passive: false });
  document.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
  window.addEventListener('wheel', (event) => {
    if (event.ctrlKey) event.preventDefault();
  }, { passive: false });
  document.addEventListener('contextmenu', block);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);
  post.resize(width, height, pixelRatio);
}

function setupMinimap(trackCircuit) {
  const canvas = hud.minimap;
  const ctx = canvas.getContext('2d');
  const pad = 12;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const sample of trackCircuit.samples) {
    minX = Math.min(minX, sample.point.x);
    maxX = Math.max(maxX, sample.point.x);
    minZ = Math.min(minZ, sample.point.z);
    maxZ = Math.max(maxZ, sample.point.z);
  }
  const mapX = (x) => pad + ((x - minX) / (maxX - minX)) * (canvas.width - pad * 2);
  const mapZ = (z) => canvas.height - pad - ((z - minZ) / (maxZ - minZ)) * (canvas.height - pad * 2);
  return { ctx, mapX, mapZ, canvas };
}

function drawMinimap(order) {
  const { ctx, mapX, mapZ, canvas } = minimap;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(10, 12, 16, 0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  circuit.samples.forEach((sample, index) => {
    const x = mapX(sample.point.x);
    const z = mapZ(sample.point.z);
    if (index === 0) ctx.moveTo(x, z);
    else ctx.lineTo(x, z);
  });
  ctx.strokeStyle = 'rgba(255, 214, 170, 0.85)';
  ctx.lineWidth = 3;
  ctx.stroke();
  const lake = circuit.lake;
  ctx.beginPath();
  ctx.ellipse(mapX(lake.x), mapZ(lake.z), 10, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120, 170, 190, 0.45)';
  ctx.fill();
  order.forEach((entry) => {
    const car = entry.vehicle;
    ctx.beginPath();
    ctx.arc(mapX(car.x), mapZ(car.z), entry.index === 0 ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = entry.index === 0 ? '#1f5bff' : '#f4f1ea';
    ctx.fill();
  });
}

function createSmoke(targetScene) {
  const count = 48;
  const sprites = [];
  const map = new THREE.CanvasTexture(circleCanvas());
  for (let i = 0; i < count; i += 1) {
    const material = new THREE.SpriteMaterial({
      map,
      color: 0xd8d2cc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(0.4);
    sprite.visible = false;
    sprite.userData.life = 0;
    targetScene.add(sprite);
    sprites.push(sprite);
  }
  let cursor = 0;
  return {
    update(dt, car, sample, input) {
      const slip = Math.abs(car.slip);
      const off = Math.abs(sample.lateral) > 6.2;
      const drifting = slip > 0.2 || off || input.handbrake > 0.5;
      if (drifting && car.speed > 8) emit(car, sample);
      for (const sprite of sprites) {
        if (sprite.userData.life <= 0) continue;
        sprite.userData.life -= dt;
        sprite.position.y += dt * 0.8;
        sprite.material.opacity = Math.max(0, sprite.userData.life * 0.35);
        sprite.scale.setScalar(0.5 + (1 - sprite.userData.life) * 1.6);
        if (sprite.userData.life <= 0) sprite.visible = false;
      }
    },
  };

  function emit(car, sample) {
    const sprite = sprites[cursor];
    cursor = (cursor + 1) % sprites.length;
    const side = cursor % 2 === 0 ? -0.9 : 0.9;
    sprite.position.set(
      car.x - Math.sin(car.heading) * 1.5 + sample.right.x * side,
      sample.height + 0.25,
      car.z - Math.cos(car.heading) * 1.5 + sample.right.z * side,
    );
    sprite.userData.life = 0.8;
    sprite.visible = true;
    sprite.material.opacity = 0.3;
  }
}

function circleCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

window.__rq = { race, circuit, camera, scene, renderer };
