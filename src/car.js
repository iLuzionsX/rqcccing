import * as THREE from 'three';
import { damp, clamp } from './util.js';
import { paintMaterial, glassMaterial, carbonMaterial, rubberMaterial, chromeMaterial } from './materials.js';

const _nose = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export function createCar(color, number) {
  const paint = paintMaterial(color);
  const glass = glassMaterial();
  const carbon = carbonMaterial();
  const rubber = rubberMaterial();
  const chrome = chromeMaterial();
  const tail = new THREE.MeshStandardMaterial({
    color: 0x2a0505,
    emissive: 0xff1d1d,
    emissiveIntensity: 1.4,
    roughness: 0.35,
  });
  const head = new THREE.MeshStandardMaterial({
    color: 0xfff6e4,
    emissive: 0xfff1cc,
    emissiveIntensity: 3.2,
    roughness: 0.25,
  });

  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  chassis.add(new THREE.Mesh(loft(bodyStations(), 18), paint));
  chassis.add(new THREE.Mesh(loft(cabinStations(), 14), glass));
  chassis.add(undertray(carbon));
  addDetails(chassis, paint, carbon, chrome, head, tail, number);

  const wheels = [];
  const spinners = [];
  const mounts = [
    { x: -0.98, z: 1.28, steer: true },
    { x: 0.98, z: 1.28, steer: true },
    { x: -0.98, z: -1.45, steer: false },
    { x: 0.98, z: -1.45, steer: false },
  ];
  for (const mount of mounts) {
    const pivot = new THREE.Group();
    pivot.position.set(mount.x, 0.34, mount.z);
    const spinner = makeWheel(rubber, chrome);
    pivot.add(spinner);
    root.add(pivot);
    wheels.push(pivot);
    spinners.push(spinner);
    chassis.add(fender(paint, mount.x, mount.z));
  }

  const beams = addBeams(root);
  const spots = addHeadlights(root);
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

  return {
    root,
    chassis,
    wheels,
    spinners,
    tail,
    beams,
    spots,
    steer: 0,
    spin: 0,
    pitch: 0,
    roll: 0,
    bump: 0,
    bumpVel: 0,
  };
}

export function syncCar(model, vehicle, sample, dt, input) {
  _nose.set(Math.sin(vehicle.heading), 0, Math.cos(vehicle.heading));
  _nose.addScaledVector(sample.up, -_nose.dot(sample.up));
  if (_nose.lengthSq() < 1e-8) _nose.copy(sample.tangent);
  _nose.normalize();
  _right.crossVectors(sample.up, _nose).normalize();
  _up.copy(sample.up);
  model.root.position.set(vehicle.x, sample.height + 0.02, vehicle.z);
  model.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(_right, _up, _nose));

  const throttle = input.throttle || 0;
  const brake = input.brake || 0;
  const steer = input.steer || 0;
  const targetPitch = clamp(-(vehicle.longG || (brake * 4 - throttle * 3)) * 0.016, -0.075, 0.06);
  const targetRoll = clamp((vehicle.latG || -steer * 4) * 0.03, -0.09, 0.09);
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
  model.tail.emissiveIntensity = braking ? 9 : 1.6;
  const beamOpacity = 0.045 + throttle * 0.02;
  for (const beam of model.beams) beam.material.opacity = beamOpacity;
}

function bodyStations() {
  return [
    { z: 2.24, y: 0.36, rx: 0.16, ry: 0.05, n: 2.1 },
    { z: 2.02, y: 0.33, rx: 0.58, ry: 0.13, n: 2.5 },
    { z: 1.7, y: 0.34, rx: 0.84, ry: 0.2, n: 3.0 },
    { z: 1.28, y: 0.36, rx: 0.7, ry: 0.22, n: 3.1 },
    { z: 0.82, y: 0.32, rx: 0.9, ry: 0.28, n: 3.25 },
    { z: 0.15, y: 0.3, rx: 0.93, ry: 0.3, n: 3.2 },
    { z: -0.5, y: 0.3, rx: 0.94, ry: 0.32, n: 3.15 },
    { z: -1.05, y: 0.32, rx: 0.9, ry: 0.28, n: 3.2 },
    { z: -1.45, y: 0.35, rx: 0.72, ry: 0.22, n: 3.05 },
    { z: -1.88, y: 0.33, rx: 0.84, ry: 0.18, n: 2.7 },
    { z: -2.18, y: 0.32, rx: 0.42, ry: 0.1, n: 2.3 },
  ];
}

function cabinStations() {
  return [
    { z: 0.78, y: 0.58, rx: 0.42, ry: 0.04, n: 2.2 },
    { z: 0.48, y: 0.62, rx: 0.6, ry: 0.24, n: 2.05 },
    { z: 0.02, y: 0.66, rx: 0.56, ry: 0.28, n: 2.1 },
    { z: -0.38, y: 0.6, rx: 0.5, ry: 0.12, n: 2.25 },
  ];
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

function undertray(material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 4.15), material);
  mesh.position.set(0, 0.28, 0);
  return mesh;
}

function addDetails(chassis, paint, carbon, chrome, head, tail, number) {
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.045, 0.42), carbon);
  splitter.position.set(0, 0.24, 2.05);
  const skirtL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 1.7), carbon);
  skirtL.position.set(-0.9, 0.28, -0.1);
  const skirtR = skirtL.clone();
  skirtR.position.x = 0.9;
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.18, 0.46), carbon);
  diffuser.position.set(0, 0.3, -2.05);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.05, 0.32), paint);
  wing.position.set(0, 0.98, -1.82);
  wing.rotation.x = -0.18;
  const uprightGeo = new THREE.BoxGeometry(0.05, 0.32, 0.18);
  const uprightL = new THREE.Mesh(uprightGeo, carbon);
  uprightL.position.set(-0.48, 0.8, -1.78);
  const uprightR = uprightL.clone();
  uprightR.position.x = 0.48;

  const mirrorGeo = new THREE.BoxGeometry(0.16, 0.08, 0.1);
  const mirrorL = new THREE.Mesh(mirrorGeo, paint);
  mirrorL.position.set(-0.72, 0.72, 0.48);
  const mirrorR = mirrorL.clone();
  mirrorR.position.x = 0.72;

  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.08), head);
    lamp.position.set(side * 0.58, 0.46, 2.16);
    const tailLamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.06), tail);
    tailLamp.position.set(side * 0.55, 0.5, -2.16);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 10), chrome);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(side * 0.32, 0.3, -2.28);
    chassis.add(lamp, tailLamp, exhaust);
  }

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshStandardMaterial({ map: numberTexture(number), roughness: 0.45, metalness: 0.1 }),
  );
  plate.position.set(0, 0.52, 1.55);
  plate.rotation.x = -0.7;

  chassis.add(splitter, skirtL, skirtR, diffuser, wing, uprightL, uprightR, mirrorL, mirrorR, plate);
}

function fender(material, x, z) {
  const geo = new THREE.TorusGeometry(0.4, 0.055, 8, 18, Math.PI);
  geo.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, 0.4, z);
  return mesh;
}

function makeWheel(rubber, chrome) {
  const spinner = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 28), rubber);
  tire.rotation.z = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.27, 18), chrome);
  rim.rotation.z = Math.PI / 2;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.28, 10), chrome);
  cap.rotation.z = Math.PI / 2;
  spinner.add(tire, rim, cap);
  for (let i = 0; i < 5; i += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.045), chrome);
    spoke.geometry.translate(0, 0.1, 0);
    spoke.rotation.x = (i / 5) * Math.PI * 2;
    spinner.add(spoke);
  }
  return spinner;
}

function addBeams(root) {
  const geo = new THREE.CylinderGeometry(1.35, 0.05, 12, 14, 1, true);
  geo.translate(0, 6, 0);
  geo.rotateX(Math.PI / 2);
  const beams = [];
  for (const side of [-0.58, 0.58]) {
    const beam = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0xffe2b0,
        transparent: true,
        opacity: 0.045,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    beam.position.set(side, 0.48, 2.3);
    root.add(beam);
    beams.push(beam);
  }
  return beams;
}

function addHeadlights(root) {
  const spots = [];
  for (const side of [-0.58, 0.58]) {
    const spot = new THREE.SpotLight(0xfff0d2, 28, 48, 0.48, 0.62, 1.4);
    spot.position.set(side, 0.5, 2.2);
    const target = new THREE.Object3D();
    target.position.set(side, 0.15, 16);
    root.add(spot, target);
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
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 4.4),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.04;
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
  ctx.fillStyle = '#16181d';
  ctx.font = '700 84px Oswald, Arial Narrow, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
