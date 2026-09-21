import * as THREE from 'three';
import { damp, clamp } from './util.js';
import { orientCompass } from './compass.js';

const SCALE = 1.42;
const WHEEL_NAME = /^wheel-(front|back)-(left|right)$/;

const _nose = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _center = new THREE.Vector3();

export function createCar(template, color, number) {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  const visual = template.scene.clone(true);
  prepareMaterials(visual);
  const wheelMeshes = takeWheels(visual);
  visual.scale.setScalar(SCALE);
  chassis.add(visual);

  const mounted = wheelMeshes.map((wheel) => mountWheel(root, wheel));
  mounted.sort((a, b) => Number(b.front) - Number(a.front));

  visual.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(visual);
  const lights = addLights(chassis, box);
  addLivery(chassis, box, color, number);
  const shadow = contactShadow(box);
  root.add(shadow);

  root.traverse((child) => {
    if (child.isMesh && child.material && !child.material.transparent) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  shadow.castShadow = false;
  for (const beam of lights.beams) beam.castShadow = false;

  return {
    root,
    chassis,
    wheels: mounted.map((entry) => entry.pivot),
    spinners: mounted.map((entry) => entry.spinner),
    tail: lights.tail,
    beams: lights.beams,
    spots: lights.spots,
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
  model.tail.emissiveIntensity = braking ? 9 : 1.6;
  const beamOpacity = 0.045 + throttle * 0.02;
  for (const beam of model.beams) beam.material.opacity = beamOpacity;
}

function prepareMaterials(visual) {
  visual.traverse((child) => {
    if (!child.isMesh) return;
    const material = child.material.clone();
    const wheel = WHEEL_NAME.test(child.name);
    material.roughness = wheel ? 0.92 : 0.58;
    material.metalness = 0;
    material.envMapIntensity = wheel ? 0.15 : 0.42;
    child.material = material;
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

function takeWheels(visual) {
  const wheels = [];
  visual.traverse((child) => {
    if (child.isMesh && WHEEL_NAME.test(child.name)) wheels.push(child);
  });
  for (const wheel of wheels) wheel.removeFromParent();
  return wheels;
}

function mountWheel(root, wheel) {
  wheel.geometry.computeBoundingBox();
  wheel.geometry.boundingBox.getCenter(_center);
  const pivot = new THREE.Group();
  pivot.position.copy(wheel.position).add(_center).multiplyScalar(SCALE);
  const spinner = new THREE.Group();
  wheel.position.copy(_center).negate();
  spinner.add(wheel);
  pivot.add(spinner);
  root.add(pivot);
  return { pivot, spinner, front: wheel.name.includes('front') };
}

function addLights(chassis, box) {
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
  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  const lampY = box.min.y + height * 0.38;
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(width * 0.16, 0.09, 0.06), head);
    lamp.position.set(side * width * 0.28, lampY, box.max.z + 0.02);
    const tailLamp = new THREE.Mesh(new THREE.BoxGeometry(width * 0.18, 0.08, 0.05), tail);
    tailLamp.position.set(side * width * 0.3, lampY + 0.04, box.min.z - 0.02);
    chassis.add(lamp, tailLamp);
  }

  const beams = addBeams(chassis, width, lampY, box.max.z);
  const spots = addHeadlights(chassis, width, lampY, box.max.z);
  return { tail, beams, spots };
}

function addLivery(chassis, box, color, number) {
  const width = box.max.x - box.min.x;
  const length = box.max.z - box.min.z;
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.16, 0.03, length * 0.62),
    new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.06 }),
  );
  stripe.position.set(0, box.max.y + 0.015, (box.max.z + box.min.z) * 0.08);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshStandardMaterial({ map: numberTexture(number), roughness: 0.45, metalness: 0.05 }),
  );
  plate.position.set(0, box.min.y + (box.max.y - box.min.y) * 0.62, box.min.z - 0.03);
  plate.rotation.y = Math.PI;
  chassis.add(stripe, plate);
}

function addBeams(chassis, width, lampY, noseZ) {
  const geo = new THREE.CylinderGeometry(1.15, 0.05, 12, 12, 1, true);
  geo.translate(0, 6, 0);
  geo.rotateX(Math.PI / 2);
  const beams = [];
  for (const side of [-1, 1]) {
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
    beam.position.set(side * width * 0.28, lampY, noseZ + 0.08);
    chassis.add(beam);
    beams.push(beam);
  }
  return beams;
}

function addHeadlights(chassis, width, lampY, noseZ) {
  const spots = [];
  for (const side of [-1, 1]) {
    const spot = new THREE.SpotLight(0xfff0d2, 18, 42, 0.5, 0.65, 1.4);
    spot.position.set(side * width * 0.28, lampY, noseZ + 0.05);
    const target = new THREE.Object3D();
    target.position.set(side * width * 0.28, lampY - 0.35, noseZ + 16);
    chassis.add(spot, target);
    spot.target = target;
    spots.push(spot);
  }
  return spots;
}

function contactShadow(box) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0,0,0,0.45)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(2.2, (box.max.x - box.min.x) * 1.35), Math.max(3.4, (box.max.z - box.min.z) * 1.15)),
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
  ctx.strokeStyle = '#16181d';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 116, 116);
  ctx.fillStyle = '#16181d';
  ctx.font = '700 84px Oswald, Arial Narrow, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
