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
import { createAudio, loadAudioFiles, surfaceKind } from './audio.js';
import {
  CONTROL_IDS,
  clampCenter,
  clearLayout,
  readLayout,
  separateControls,
  writeLayout,
} from './control-layout.js';
import {
  displayedCountdown,
  formatTime,
  gearLabel,
  readBestLap,
  stageDistanceText,
  writeBestLap,
} from './readout.js';
import {
  createWheelState,
  dragWheel,
  grabWheel,
  pointerSample,
  releaseWheel,
  resetWheel,
  springWheel,
  wheelSteer,
} from './wheel.js';

const RALLY_CARS = [
  'Subaru Impreza',
  'Lancia Delta',
  'Audi Quattro',
  'Peugeot 205',
  'Toyota Celica',
  'Ford Escort RS1800',
];
const params = new URLSearchParams(location.search);
const quality = detectQuality();

const hud = {
  title: document.querySelector('#title'),
  hud: document.querySelector('#hud'),
  speed: document.querySelector('#speed'),
  speedFill: document.querySelector('#speed-fill'),
  speedMeter: document.querySelector('#speed-meter'),
  gear: document.querySelector('#gear'),
  lap: document.querySelector('#lap'),
  lapCurrent: document.querySelector('#lap-current'),
  place: document.querySelector('#place'),
  time: document.querySelector('#time'),
  best: document.querySelector('#best'),
  countdown: document.querySelector('#countdown'),
  warning: document.querySelector('#warning'),
  results: document.querySelector('#results'),
  resultBody: document.querySelector('#result-body'),
  finishPlace: document.querySelector('#finish-place'),
  finishTime: document.querySelector('#finish-time'),
  finishBest: document.querySelector('#finish-best'),
  pause: document.querySelector('#pause'),
  pauseToggle: document.querySelector('#pause-toggle'),
  resume: document.querySelector('#resume'),
  restart: document.querySelector('#restart-stage'),
  backMenu: document.querySelector('#back-menu'),
  resultsMenu: document.querySelector('#results-menu'),
  cameraToggle: document.querySelector('#camera-toggle'),
  cameraMode: document.querySelector('#camera-mode'),
  minimap: document.querySelector('#minimap'),
  start: document.querySelector('#start'),
  startLabel: document.querySelector('#start-label'),
  loadStatus: document.querySelector('#load-status'),
  stageDistance: document.querySelector('#stage-distance'),
  carName: document.querySelector('#car-name'),
  carIndex: document.querySelector('#car-index'),
  carPrev: document.querySelector('#car-prev'),
  carNext: document.querySelector('#car-next'),
  again: document.querySelector('#again'),
  mute: document.querySelector('#mute'),
  openSettings: document.querySelector('#open-settings'),
  pauseSettings: document.querySelector('#pause-settings'),
  settings: document.querySelector('#settings'),
  arrangeControls: document.querySelector('#arrange-controls'),
  resetLayout: document.querySelector('#reset-layout'),
  closeSettings: document.querySelector('#close-settings'),
  arrangeBar: document.querySelector('#arrange-bar'),
  arrangeDone: document.querySelector('#arrange-done'),
  arrangeReset: document.querySelector('#arrange-reset'),
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
let models = [];
const post = createComposer(renderer, scene, camera, quality);
let audio = null;
let rallyAssets = null;
let selectedCarIndex = 0;
const rallyModelsByName = new Map();
let carNamesByDriver = [];

const keys = new Set();
const touch = { steer: 0, gas: false, brake: false, handbrake: false };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const wheelState = createWheelState();
let cameraMode = 'title';
let paused = false;
let seenCompleted = 0;
let audioOn = false;
let audioReady = null;
let arranging = false;
let drag = null;
let muted = false;
try { muted = localStorage.getItem('rqcccing.muted') === '1'; } catch { muted = false; }
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
hud.startLabel.textContent = 'Loading car and stage';
hud.start.setAttribute('aria-busy', 'true');
renderStageDistance();
updateCarSelection();
hud.start.addEventListener('click', () => begin());
hud.again.addEventListener('click', () => begin(true));
hud.carPrev.addEventListener('click', () => selectCar(-1));
hud.carNext.addEventListener('click', () => selectCar(1));
hud.pauseToggle.addEventListener('click', () => setPaused(true));
hud.resume.addEventListener('click', () => setPaused(false));
hud.restart.addEventListener('click', () => begin(true));
hud.backMenu.addEventListener('click', returnToMenu);
hud.resultsMenu.addEventListener('click', returnToMenu);
hud.cameraToggle.addEventListener('click', cycleCamera);
hud.mute.addEventListener('click', () => setMuted(!muted));
hud.openSettings.addEventListener('click', openSettings);
hud.pauseSettings.addEventListener('click', openSettings);
hud.arrangeControls.addEventListener('click', startArrange);
hud.resetLayout.addEventListener('click', () => resetControlLayout());
hud.closeSettings.addEventListener('click', closeSettings);
hud.arrangeDone.addEventListener('click', finishArrange);
hud.arrangeReset.addEventListener('click', () => resetControlLayout());
setCameraLabel();
setMuted(muted);
applySavedLayout();
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  setPaused(true);
  audio?.suspend();
});

const clock = new THREE.Clock();
loadGameAssets(renderer).then((assets) => {
  rallyAssets = assets.rally;
  rebuildCarModels();
  lighting = createLighting(scene, renderer, assets.hdr, circuit.stageId);
  track = createTrack(scene, circuit, assets);
  environment = createEnvironment(scene, circuit, quality, assets);
  hud.start.disabled = false;
  hud.startLabel.textContent = 'Start stage';
  hud.start.setAttribute('aria-busy', 'false');
  hud.loadStatus.textContent = 'Stage ready';
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
    const chaseAberration = Math.min(0.0035, player.speed * 0.00003);
    post.grade.uniforms.aberration.value = reducedMotion.matches || cameraMode === 'title' ? 0 : chaseAberration;
    applyShot();
    post.composer.render();
  });
}).catch((error) => {
  console.error(error);
  hud.startLabel.textContent = 'Unable to load stage';
  hud.start.setAttribute('aria-busy', 'false');
  hud.loadStatus.textContent = 'Stage failed to load';
});

function step(dt) {
  const input = readInput();
  if (race.phase === 'title') {
    updateTitleCamera(dt);
  } else {
    const drive = params.get('bot') === '1' ? null : input;
    race.update(dt, drive);
    rememberCompletedLap();
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

async function begin(resetRace = false) {
  await ensureAudio();
  audio.resume();
  if (resetRace || race.phase === 'title' || race.phase === 'finish') {
    resetCars();
    race.phase = 'countdown';
  }
  beepState = -1;
  paused = false;
  clearDriveInput();
  document.body.classList.remove('paused');
  hud.title.classList.add('hidden');
  hud.pause.classList.add('hidden');
  hud.results.classList.add('hidden');
  hud.resultBody.innerHTML = '';
  hud.hud.classList.remove('hidden');
  document.body.classList.add('driving');
  cameraMode = 'chase';
  setCameraLabel();
}

function selectCar(direction) {
  selectedCarIndex = (selectedCarIndex + direction + RALLY_CARS.length) % RALLY_CARS.length;
  updateCarSelection();
  if (rallyAssets) moveSelectedCarToPlayer();
}

function updateCarSelection() {
  hud.carName.textContent = RALLY_CARS[selectedCarIndex].toUpperCase();
  hud.carIndex.textContent = `${String(selectedCarIndex + 1).padStart(2, '0')} / ${String(RALLY_CARS.length).padStart(2, '0')}`;
}

function rebuildCarModels() {
  models.forEach((model) => scene.remove(model.root));
  rallyModelsByName.clear();
  carNamesByDriver = [];
  models = race.cars.map((_, index) => {
    const carName = RALLY_CARS[index];
    const model = createCar(rallyAssets, carName);
    scene.add(model.root);
    rallyModelsByName.set(carName, model);
    carNamesByDriver.push(carName);
    return model;
  });
  moveSelectedCarToPlayer();
}

function moveSelectedCarToPlayer() {
  const carName = RALLY_CARS[selectedCarIndex];
  const currentSlot = models.indexOf(rallyModelsByName.get(carName));
  if (currentSlot <= 0) return;
  [models[0], models[currentSlot]] = [models[currentSlot], models[0]];
  [carNamesByDriver[0], carNamesByDriver[currentSlot]] = [carNamesByDriver[currentSlot], carNamesByDriver[0]];
}

function cycleCamera() {
  const modes = ['chase', 'bumper', 'hood'];
  const current = modes.indexOf(cameraMode);
  cameraMode = modes[(current + 1 + modes.length) % modes.length];
  setCameraLabel();
}

function setCameraLabel() {
  hud.cameraMode.textContent = `${cameraMode.toUpperCase()} · C`;
}

function setPaused(nextPaused) {
  if (race.phase !== 'race' && race.phase !== 'countdown') return;
  paused = nextPaused;
  clearDriveInput();
  hud.pause.classList.toggle('hidden', !paused);
  document.body.classList.toggle('paused', paused);
  hud.pauseToggle.setAttribute('aria-label', paused ? 'Race paused' : 'Pause race');
  if (paused) {
    silenceAudio();
    audio?.suspend();
  } else audio?.resume();
}

function clearDriveInput() {
  keys.clear();
  touch.steer = 0;
  touch.gas = false;
  touch.brake = false;
  touch.handbrake = false;
  resetWheel(wheelState);
}

function returnToMenu() {
  resetCars();
  race.phase = 'title';
  renderStageDistance();
  paused = false;
  beepState = -1;
  clearDriveInput();
  silenceAudio();
  document.body.classList.remove('driving', 'paused');
  hud.title.classList.remove('hidden');
  hud.hud.classList.add('hidden');
  hud.pause.classList.add('hidden');
  hud.results.classList.add('hidden');
  hud.resultBody.innerHTML = '';
  cameraMode = 'title';
  setCameraLabel();
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
    handbrake: keys.has(' ') || touch.handbrake ? 1 : 0,
  };
}

function pressed(...names) {
  return names.some((name) => keys.has(name));
}

function updateTitleCamera(dt) {
  if (!reducedMotion.matches) titleAngle += dt * 0.12;
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
  const nose = models[0].nose || 2;
  const roof = models[0].roof || 1.1;
  if (cameraMode === 'bumper') {
    desiredPos.copy(origin).addScaledVector(forward, nose + 0.45).addScaledVector(sample.up, 0.72);
    desiredLook.copy(origin).addScaledVector(forward, nose + 12).addScaledVector(sample.up, 0.55);
  } else if (cameraMode === 'hood') {
    desiredPos.copy(origin).addScaledVector(forward, nose * 0.42).addScaledVector(sample.up, roof * 0.62);
    desiredLook.copy(origin).addScaledVector(forward, nose + 14).addScaledVector(sample.up, roof * 0.42);
  } else {
    const lat = player.latG || 0;
    const back = 7.15 + Math.min(Math.max(player.speed, 0), 50) * 0.045;
    const height = 2.15 + Math.min(Math.max(player.speed, 0), 50) * 0.014;
    desiredPos.copy(origin).addScaledVector(forward, -back).addScaledVector(sample.up, height);
    desiredPos.x += frame.right.x * clamp(lat, -8, 8) * 0.07;
    desiredPos.y += frame.right.y * clamp(lat, -8, 8) * 0.07;
    desiredPos.z += frame.right.z * clamp(lat, -8, 8) * 0.07;
    desiredLook.copy(origin).addScaledVector(forward, 9).addScaledVector(sample.up, 0.92);
  }
  const follow = cameraMode === 'chase' ? 3.15 : 5.8;
  camPos.lerp(desiredPos, 1 - Math.exp(-follow * dt));
  camLook.lerp(desiredLook, 1 - Math.exp(-4.4 * dt));
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
    camera.lookAt(player.x + fx * 0.4, player.y + 0.7, player.z + fz * 0.4);
    camera.fov = 28;
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
  camera.fov += (target - camera.fov) * Math.min(1, dt * 1.35);
  camera.updateProjectionMatrix();
}

function updateHud() {
  const player = race.cars[0];
  const kmh = Math.max(0, player.speed) * 3.6;
  hud.speed.textContent = String(Math.round(kmh));
  hud.speedFill.style.width = `${Math.min(kmh / 280, 1) * 100}%`;
  hud.speedMeter.setAttribute('aria-valuenow', String(Math.min(280, Math.round(kmh))));
  hud.gear.textContent = gearLabel(player.speed, player.vLong, player.gear);
  hud.lapCurrent.textContent = String(Math.min(player.completed + 1, 3));
  const order = raceStandings(race);
  const place = order.findIndex((entry) => entry.index === 0) + 1;
  hud.place.textContent = ordinal(place).toUpperCase();
  hud.time.textContent = formatTime(race.phase === 'finish' ? player.finishTime : race.elapsed);
  hud.best.textContent = formatTime(player.bestLap);
  hud.warning.classList.toggle('hidden', player.wrongWay < 0.35 || race.phase !== 'race');
  hud.pauseToggle.classList.toggle('hidden', race.phase === 'finish');
  if (race.phase === 'countdown') {
    hud.countdown.textContent = displayedCountdown(race.countdown);
    hud.countdown.classList.remove('hidden');
  } else if (race.phase === 'race' && race.elapsed < 1.1) {
    hud.countdown.textContent = 'GO';
    hud.countdown.classList.remove('hidden');
  } else {
    hud.countdown.classList.add('hidden');
  }
  if (race.phase === 'finish') showResults(order);
  const heard = readInput();
  const sample = circuit.query(player.x, player.z);
  audio?.update({
    speed: Math.max(player.speed, 0),
    throttle: heard.throttle,
    gear: player.gear || 1,
    slip: player.slip || 0,
    handbrake: heard.handbrake,
    surface: surfaceKind(circuit.stageId, sample.lateral),
    airborne: !!player.airborne,
  });
  drawMinimap(order);
}

function showResults(order) {
  if (!hud.results.classList.contains('hidden') && hud.resultBody.childElementCount) return;
  hud.results.classList.remove('hidden');
  hud.resultBody.innerHTML = '';
  const playerPlace = order.findIndex((entry) => entry.index === 0) + 1;
  hud.finishPlace.textContent = ordinal(playerPlace).toUpperCase();
  hud.finishTime.textContent = formatTime(race.cars[0].finishTime);
  hud.finishBest.textContent = formatTime(readBestLap(localStorage, circuit.stageId));
  order.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = `result-row${entry.index === 0 ? ' is-player' : ''}`;
    const rank = document.createElement('span');
    rank.className = 'result-rank';
    rank.textContent = String(index + 1).padStart(2, '0');
    const driver = document.createElement('span');
    driver.className = 'result-driver';
    const carName = carNamesByDriver[entry.index] || RALLY_CARS[entry.index];
    driver.textContent = entry.index === 0 ? `YOU · ${carName}` : carName;
    const laptime = document.createElement('span');
    laptime.className = 'result-laptime';
    const time = entry.vehicle.finishTime ? formatTime(entry.vehicle.finishTime) : 'running';
    laptime.textContent = time;
    row.append(rank, driver, laptime);
    hud.resultBody.appendChild(row);
  });
}

function resetCars() {
  const fresh = createRace(circuit);
  race.cars.forEach((car, index) => Object.assign(car, fresh.cars[index]));
  race.countdown = 3.4;
  race.elapsed = 0;
  race.finishedOrder = [];
  seenCompleted = 0;
  const best = readBestLap(localStorage, circuit.stageId);
  if (best != null) race.cars[0].bestLap = best;
}

function rememberCompletedLap() {
  const player = race.cars[0];
  if (player.completed === seenCompleted) return;
  seenCompleted = player.completed;
  const best = writeBestLap(localStorage, circuit.stageId, player.lastLap);
  if (best != null) player.bestLap = best;
}

function renderStageDistance() {
  hud.stageDistance.textContent = stageDistanceText(
    circuit.length,
    readBestLap(localStorage, circuit.stageId),
  );
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
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && race.phase !== 'title') event.preventDefault();
    if (event.key.toLowerCase() === 'c' && !event.repeat && !paused && (race.phase === 'race' || race.phase === 'countdown')) cycleCamera();
    if ((event.key.toLowerCase() === 'p' || event.key === 'Escape') && !event.repeat) {
      if (arranging) finishArrange();
      else setPaused(!paused);
    }
    if (event.key.toLowerCase() === 'm' && !event.repeat) setMuted(!muted);
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
      player.airborne = false;
      player.airY = sample.height + 0.02;
      player.airVelocity = 0;
      player.bumpImpulse = 0;
      player.compass = orientCompass(player.heading, sample.up);
    }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
  bindHold('gas', 'gas');
  bindHold('brake', 'brake');
  bindHold('handbrake', 'handbrake');
  bindWheel();
  bindLayout();
  lockPageZoom();
}

function bindHold(id, field) {
  const el = document.getElementById(id);
  const on = (event) => {
    if (arranging) return;
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

function bindWheel() {
  const wheel = document.getElementById('wheel');
  const rotor = document.getElementById('wheel-rotor');
  const sample = (event) => pointerSample(event.clientX, event.clientY, wheel.getBoundingClientRect());
  wheel.addEventListener('pointerdown', (event) => {
    if (arranging) return;
    wheelState.pointerId = event.pointerId;
    grabWheel(wheelState, sample(event));
    try { wheel.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    event.preventDefault();
  });
  wheel.addEventListener('pointermove', (event) => {
    if (!wheelState.held || event.pointerId !== wheelState.pointerId) return;
    dragWheel(wheelState, sample(event));
    applyWheel(rotor);
  });
  const release = (event) => {
    if (event.pointerId !== wheelState.pointerId) return;
    if (wheel.hasPointerCapture(event.pointerId)) wheel.releasePointerCapture(event.pointerId);
    releaseWheel(wheelState);
  };
  wheel.addEventListener('pointerup', release);
  wheel.addEventListener('pointercancel', release);
}

function updateWheel(dt) {
  if (!wheelState.held) wheelState.rotation = springWheel(wheelState.rotation, dt);
  const rotor = document.getElementById('wheel-rotor');
  if (rotor) applyWheel(rotor);
}

function applyWheel(rotor) {
  touch.steer = wheelSteer(wheelState.rotation);
  rotor.style.transform = `rotate(${wheelState.rotation}rad)`;
  const wheel = document.getElementById('wheel');
  wheel.setAttribute('aria-valuenow', touch.steer.toFixed(2));
  wheel.setAttribute('aria-valuetext', touch.steer > 0.08 ? 'Right' : touch.steer < -0.08 ? 'Left' : 'Centered');
}

function ensureAudio() {
  if (!audioReady) {
    audioReady = loadAudioFiles().then(async (encoded) => {
      try {
        audio = await createAudio(encoded);
      } catch (error) {
        console.error(error);
        audio = { resume() {}, suspend() {}, setMuted() {}, update() {}, tone() {} };
      }
      if (muted) audio.setMuted(true);
      audioOn = true;
    });
  }
  return audioReady;
}

function silenceAudio() {
  audio?.update({
    speed: 0, throttle: 0, gear: 1, slip: 0, handbrake: 0, surface: 'asphalt', airborne: false,
  });
}

function setMuted(next) {
  muted = next;
  try { localStorage.setItem('rqcccing.muted', muted ? '1' : '0'); } catch { /* private mode */ }
  audio?.setMuted(muted);
  if (hud.mute) {
    hud.mute.textContent = muted ? 'SOUND OFF' : 'SOUND';
    hud.mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  }
}

function openSettings() {
  hud.settings.classList.remove('hidden');
}

function closeSettings() {
  hud.settings.classList.add('hidden');
}

function startArrange() {
  arranging = true;
  clearDriveInput();
  document.body.classList.add('arranging');
  hud.settings.classList.add('hidden');
  hud.pause.classList.add('hidden');
  hud.arrangeBar.classList.remove('hidden');
}

function finishArrange() {
  arranging = false;
  drag = null;
  document.body.classList.remove('arranging');
  hud.arrangeBar.classList.add('hidden');
  if (paused) hud.pause.classList.remove('hidden');
}

function bindLayout() {
  for (const id of CONTROL_IDS) {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', (event) => {
      if (!arranging) return;
      const rect = el.getBoundingClientRect();
      drag = {
        id,
        el,
        pointerId: event.pointerId,
        offsetX: event.clientX - (rect.left + rect.width / 2),
        offsetY: event.clientY - (rect.top + rect.height / 2),
      };
      try { el.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      event.preventDefault();
    });
  }
  window.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const size = { w: drag.el.offsetWidth, h: drag.el.offsetHeight };
    const fitted = clampCenter(
      event.clientX - drag.offsetX,
      event.clientY - drag.offsetY,
      size.w,
      size.h,
      window.innerWidth,
      window.innerHeight,
    );
    placeControl(drag.el, fitted.x, fitted.y);
  });
  window.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    settleDragged(drag.id);
    drag = null;
  });
}

function settleDragged(movedId) {
  const centers = {};
  const sizes = {};
  for (const id of CONTROL_IDS) {
    const el = document.getElementById(id);
    const rect = el.getBoundingClientRect();
    centers[id] = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    sizes[id] = { w: rect.width, h: rect.height };
  }
  const moved = separateControls(movedId, centers, sizes, {
    w: window.innerWidth,
    h: window.innerHeight,
  });
  placeControl(document.getElementById(movedId), moved.x, moved.y);
  saveCurrentLayout();
}

function placeControl(el, x, y) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.transform = 'translate(-50%, -50%)';
}

function saveCurrentLayout() {
  const layout = {};
  for (const id of CONTROL_IDS) {
    const rect = document.getElementById(id).getBoundingClientRect();
    layout[id] = {
      x: (rect.left + rect.width / 2) / window.innerWidth,
      y: (rect.top + rect.height / 2) / window.innerHeight,
    };
  }
  try { writeLayout(localStorage, layout); } catch { /* private mode */ }
  document.body.classList.add('has-custom-layout');
}

function applySavedLayout() {
  let layout = null;
  try { layout = readLayout(localStorage); } catch { layout = null; }
  if (!layout) return;
  document.body.classList.add('has-custom-layout');
  for (const id of CONTROL_IDS) {
    const el = document.getElementById(id);
    placeControl(el, layout[id].x * window.innerWidth, layout[id].y * window.innerHeight);
  }
}

function resetControlLayout() {
  try { clearLayout(localStorage); } catch { /* private mode */ }
  document.body.classList.remove('has-custom-layout');
  for (const id of CONTROL_IDS) {
    const el = document.getElementById(id);
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    el.style.transform = '';
  }
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
  applySavedLayout();
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
  ctx.fillStyle = 'rgba(13, 16, 17, 0.3)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  circuit.samples.forEach((sample, index) => {
    const x = mapX(sample.point.x);
    const z = mapZ(sample.point.z);
    if (index === 0) ctx.moveTo(x, z);
    else ctx.lineTo(x, z);
  });
  ctx.strokeStyle = 'rgba(246, 242, 233, 0.76)';
  ctx.lineWidth = 3;
  ctx.stroke();
  const lake = circuit.lake;
  ctx.beginPath();
  ctx.ellipse(mapX(lake.x), mapZ(lake.z), 10, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(100, 148, 166, 0.34)';
  ctx.fill();
  order.forEach((entry) => {
    const car = entry.vehicle;
    ctx.beginPath();
    ctx.arc(mapX(car.x), mapZ(car.z), entry.index === 0 ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = entry.index === 0 ? '#ffc17d' : 'rgba(246, 242, 233, 0.78)';
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
