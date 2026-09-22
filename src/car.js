import * as THREE from 'three';
import { damp, clamp } from './util.js';
import { orientCompass } from './compass.js';
import { paintMaterial, glassMaterial, carbonMaterial, rubberMaterial, chromeMaterial } from './materials.js';

const ACCENTS = [0xf4f1ea, 0xc4271d, 0x141414, 0xf4f1ea, 0xd4a017, 0xf4f1ea];

const _nose = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _basis = new THREE.Matrix4();

export function createCar(color, number) {
  const paint = paintMaterial(color);
  const accent = paintMaterial(ACCENTS[(number - 1) % ACCENTS.length]);
  const glass = glassMaterial();
  const carbon = carbonMaterial();
  const rubber = rubberMaterial();
  const chrome = chromeMaterial();
  const tail = new THREE.MeshStandardMaterial({
    color: 0x2a0505,
    emissive: 0xff1d1d,
    emissiveIntensity: 1.6,
    roughness: 0.28,
  });
  const head = new THREE.MeshStandardMaterial({
    color: 0xfff6e4,
    emissive: 0xfff1cc,
    emissiveIntensity: 4.2,
    roughness: 0.18,
  });

  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  chassis.add(new THREE.Mesh(loft(bodyStations(), 20), paint));
  chassis.add(new THREE.Mesh(loft(cabinStations(), 16), glass));
  chassis.add(undertray(carbon));
  addAero(chassis, paint, accent, carbon, chrome);
  addLamps(chassis, head, tail, chrome);
  addLivery(chassis, accent, number);

  const wheels = [];
  const spinners = [];
  const mounts = [
    { x: -0.86, z: 1.28, steer: true },
    { x: 0.86, z: 1.28, steer: true },
    { x: -0.86, z: -1.28, steer: false },
    { x: 0.86, z: -1.28, steer: false },
  ];
  for (const mount of mounts) {
    const pivot = new THREE.Group();
    pivot.position.set(mount.x, 0.34, mount.z);
    const spinner = makeWheel(rubber, chrome, Math.sign(mount.x));
    pivot.add(spinner);
    root.add(pivot);
    wheels.push(pivot);
    spinners.push(spinner);
    chassis.add(blister(paint, mount.x, mount.z));
    chassis.add(mudFlap(rubber, mount.x, mount.z));
  }

  const beams = addBeams(chassis);
  const spots = addHeadlights(chassis);
  const shadow = contactShadow();
  root.add(shadow);

  root.traverse((child) => {
    if (child.isMesh && child.material && !child.material.transparent) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  shadow.castShadow = false;
  for (const beam of beams) beam.castShadow = false;

  const box = new THREE.Box3().setFromObject(chassis);
  return {
    root,
    chassis,
    wheels,
    spinners,
    tail,
    beams,
    spots,
    nose: box.max.z,
    roof: box.max.y,
    steer: 0,
    spin: 0,
    pitch: 0,
    roll: 0,
    bump: 0,
    bumpVel: 0,
  };
}

export function syncCar(model, vehicle, sample, dt, input) {
  const frame = vehicle.compass || orientCompass(vehicle.heading, sample.up);
  _nose.set(frame.forward.x, frame.forward.y, frame.forward.z);
  _right.set(frame.right.x, frame.right.y, frame.right.z);
  _up.set(frame.up.x, frame.up.y, frame.up.z);
  _basis.makeBasis(_right, _up, _nose);
  model.root.quaternion.setFromRotationMatrix(_basis);
  model.root.position.set(vehicle.x, sample.height + 0.02, vehicle.z);

  const throttle = input.throttle || 0;
  const brake = input.brake || 0;
  const steer = input.steer || 0;
  const targetPitch = clamp(-(vehicle.longG || 0) * 0.016, -0.075, 0.06);
  const targetRoll = clamp((vehicle.latG || 0) * 0.03, -0.09, 0.09);
  model.pitch = damp(model.pitch, targetPitch, 7, dt);
  model.roll = damp(model.roll, targetRoll, 7, dt);
  model.chassis.rotation.x = model.pitch;
  model.chassis.rotation.z = model.roll;

  const curb = Math.abs(sample.lateral) > 5.5 && Math.abs(sample.lateral) < 6.7 && Math.abs(vehicle.speed) > 10;
  if (curb) model.bumpVel += 9 * dt;
  model.bumpVel += (-model.bump * 90 - model.bumpVel * 9) * dt;
  model.bump += model.bumpVel * dt;
  model.root.position.y += model.bump * 0.018;

  model.steer = damp(model.steer, vehicle.steerAngle || steer * 0.42, 12, dt);
  model.spinners.forEach((spinner, index) => {
    const front = index < 2;
    const omega = front ? vehicle.frontOmega || 0 : vehicle.rearOmega || 0;
    spinner.rotation.x += omega * dt;
    if (front) model.wheels[index].rotation.y = model.steer;
  });

  const braking = brake > 0.2 || vehicle.speed < -0.5;
  model.tail.emissiveIntensity = braking ? 10 : 1.7;
  const beamOpacity = 0.05 + throttle * 0.03;
  for (const beam of model.beams) beam.material.opacity = beamOpacity;
}

function bodyStations() {
  return [
    { z: 2.08, y: 0.34, rx: 0.18, ry: 0.06, n: 2.2 },
    { z: 1.86, y: 0.36, rx: 0.62, ry: 0.14, n: 3.4 },
    { z: 1.48, y: 0.38, rx: 0.86, ry: 0.26, n: 4.6 },
    { z: 1.05, y: 0.4, rx: 0.74, ry: 0.2, n: 4.2 },
    { z: 0.58, y: 0.38, rx: 0.84, ry: 0.28, n: 4.8 },
    { z: 0.05, y: 0.36, rx: 0.82, ry: 0.3, n: 5.0 },
    { z: -0.52, y: 0.36, rx: 0.84, ry: 0.3, n: 5.0 },
    { z: -1.05, y: 0.4, rx: 0.9, ry: 0.32, n: 4.8 },
    { z: -1.48, y: 0.42, rx: 0.8, ry: 0.26, n: 4.2 },
    { z: -1.82, y: 0.4, rx: 0.7, ry: 0.2, n: 3.6 },
    { z: -2.02, y: 0.36, rx: 0.42, ry: 0.1, n: 2.8 },
  ];
}

function cabinStations() {
  return [
    { z: 0.62, y: 0.64, rx: 0.48, ry: 0.05, n: 2.4 },
    { z: 0.34, y: 0.78, rx: 0.58, ry: 0.26, n: 2.15 },
    { z: -0.08, y: 0.9, rx: 0.54, ry: 0.3, n: 2.25 },
    { z: -0.48, y: 0.84, rx: 0.5, ry: 0.2, n: 2.35 },
    { z: -0.78, y: 0.7, rx: 0.42, ry: 0.06, n: 2.5 },
  ];
}

function addAero(chassis, paint, accent, carbon, chrome) {
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.04, 0.36), carbon);
  splitter.position.set(0, 0.24, 1.92);
  const skirtL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 1.85), carbon);
  skirtL.position.set(-0.9, 0.28, -0.05);
  const skirtR = skirtL.clone();
  skirtR.position.x = 0.9;

  const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.72), paint);
  scoop.position.set(0, 0.66, 1.12);
  scoop.rotation.x = -0.14;
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.16), carbon);
  intake.position.set(0, 0.7, 1.4);

  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.42), carbon);
  diffuser.position.set(0, 0.3, -1.92);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.04, 0.34), accent);
  wing.position.set(0, 1.22, -1.68);
  wing.rotation.x = -0.28;
  const uprightGeo = new THREE.BoxGeometry(0.04, 0.42, 0.16);
  const uprightL = new THREE.Mesh(uprightGeo, carbon);
  uprightL.position.set(-0.62, 1.02, -1.64);
  const uprightR = uprightL.clone();
  uprightR.position.x = 0.62;
  const endGeo = new THREE.BoxGeometry(0.025, 0.2, 0.3);
  const endL = new THREE.Mesh(endGeo, carbon);
  endL.position.set(-0.8, 1.2, -1.66);
  const endR = endL.clone();
  endR.position.x = 0.8;

  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.035, 0.7), accent);
  roof.position.set(0, 1.2, -0.12);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.38, 6), chrome);
  antenna.position.set(0.28, 1.36, -0.35);
  antenna.rotation.z = -0.55;

  const mirrorGeo = new THREE.BoxGeometry(0.16, 0.07, 0.1);
  const mirrorL = new THREE.Mesh(mirrorGeo, paint);
  mirrorL.position.set(-0.72, 0.78, 0.42);
  const mirrorR = mirrorL.clone();
  mirrorR.position.x = 0.72;

  for (const side of [-1, 1]) {
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.18, 12), chrome);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(side * 0.28, 0.3, -2.08);
    chassis.add(exhaust);
  }

  chassis.add(
    splitter, skirtL, skirtR, scoop, intake, diffuser,
    wing, uprightL, uprightR, endL, endR, roof, antenna, mirrorL, mirrorR,
  );
}

function addLamps(chassis, head, tail, chrome) {
  const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 16), chrome);
  for (const side of [-0.22, -0.08, 0.08, 0.22]) {
    const pod = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), head);
    pod.position.set(side, 0.48, 2.02);
    const ring = bezel.clone();
    ring.rotation.x = Math.PI / 2;
    ring.position.set(side, 0.48, 2.0);
    chassis.add(pod, ring);
  }
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.05), head);
    lamp.position.set(side * 0.58, 0.46, 2.0);
    const tailLamp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.04), tail);
    tailLamp.position.set(side * 0.48, 0.52, -2.0);
    chassis.add(lamp, tailLamp);
  }
}

function addLivery(chassis, accent, number) {
  const sideGeo = new THREE.BoxGeometry(0.018, 0.07, 2.15);
  const sideL = new THREE.Mesh(sideGeo, accent);
  sideL.position.set(-0.9, 0.5, 0.05);
  const sideR = sideL.clone();
  sideR.position.x = 0.9;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.018, 1.15), accent);
  hood.position.set(0, 0.64, 1.15);

  const plateMat = new THREE.MeshStandardMaterial({
    map: numberTexture(number),
    roughness: 0.42,
    metalness: 0.04,
  });
  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36), plateMat);
    door.position.set(side * 0.9, 0.58, 0.15);
    door.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    chassis.add(door);
  }
  const rear = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), plateMat);
  rear.position.set(0, 0.7, -1.9);
  rear.rotation.y = Math.PI;
  chassis.add(sideL, sideR, hood, rear);
}

function blister(material, x, z) {
  const geo = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  geo.scale(0.26, 0.2, 0.46);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, 0.4, z);
  return mesh;
}

function mudFlap(material, x, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.02), material);
  mesh.position.set(x * 0.98, 0.2, z - Math.sign(z) * 0.46);
  mesh.rotation.x = z > 0 ? 0.25 : -0.25;
  return mesh;
}

function undertray(material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.07, 3.55), material);
  mesh.position.set(0, 0.27, 0.02);
  return mesh;
}

function makeWheel(rubber, chrome, side) {
  const spinner = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.28, 28), rubber);
  tire.rotation.z = Math.PI / 2;
  const sidewall = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 20), rubber);
  sidewall.rotation.y = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 20), chrome);
  rim.rotation.z = Math.PI / 2;
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.08, 16), chrome);
  dish.rotation.z = Math.PI / 2;
  dish.position.x = side * 0.1;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.32, 10), chrome);
  cap.rotation.z = Math.PI / 2;
  spinner.add(tire, sidewall, rim, dish, cap);
  for (let i = 0; i < 6; i += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.16, 0.04), chrome);
    spoke.geometry.translate(0, 0.09, 0);
    spoke.rotation.x = (i / 6) * Math.PI * 2;
    spinner.add(spoke);
  }
  return spinner;
}

function addBeams(chassis) {
  const geo = new THREE.CylinderGeometry(1.2, 0.04, 14, 12, 1, true);
  geo.translate(0, 7, 0);
  geo.rotateX(Math.PI / 2);
  const beams = [];
  for (const side of [-0.58, 0.58]) {
    const beam = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0xffe2b0,
        transparent: true,
        opacity: 0.05,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    beam.position.set(side, 0.48, 2.15);
    chassis.add(beam);
    beams.push(beam);
  }
  return beams;
}

function addHeadlights(chassis) {
  const spots = [];
  for (const side of [-0.58, 0.58]) {
    const spot = new THREE.SpotLight(0xfff0d2, 22, 46, 0.46, 0.6, 1.35);
    spot.position.set(side, 0.5, 2.05);
    const target = new THREE.Object3D();
    target.position.set(side, 0.12, 18);
    chassis.add(spot, target);
    spot.target = target;
    spots.push(spot);
  }
  return spots;
}

function contactShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 4.3),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  mesh.renderOrder = 1;
  return mesh;
}

function numberTexture(number) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#16181d';
  ctx.lineWidth = 10;
  ctx.strokeRect(6, 6, 116, 116);
  ctx.fillStyle = '#16181d';
  ctx.font = '700 78px Oswald, Arial Narrow, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function loft(stations, segments) {
  const rings = stations.map((station) => ring(station, segments));
  const positions = [];
  const uvs = [];
  rings.forEach((pts, i) => {
    pts.forEach((p, j) => {
      positions.push(p.x, p.y, p.z);
      uvs.push(j / (pts.length - 1), i / (rings.length - 1));
    });
  });
  const indices = [];
  const cols = segments + 1;
  for (let i = 0; i < rings.length - 1; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = i * cols + j;
      indices.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  cap(indices, 0, cols, true);
  cap(indices, (rings.length - 1) * cols, cols, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function ring(station, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i += 1) {
    const theta = Math.PI * (1 - i / segments);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const x = Math.sign(c || 1) * Math.abs(c) ** (2 / station.n) * station.rx;
    const y = Math.sign(s || 1) * Math.abs(s) ** (2 / station.n) * station.ry;
    pts.push(new THREE.Vector3(x, station.y + Math.max(0, y), station.z));
  }
  return pts;
}

function cap(indices, start, cols, nose) {
  const center = start + (cols >> 1);
  for (let j = 0; j < cols - 2; j += 1) {
    if (nose) indices.push(center, start + j, start + j + 1);
    else indices.push(center, start + j + 1, start + j);
  }
}
