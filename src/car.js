import * as THREE from 'three';
import { damp, clamp } from './util.js';
import { orientCompass } from './compass.js';

const _nose = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _pos = new THREE.Vector3();

const PART = /spoiler|alettone|fanale|fanali/i;
const WHEEL = /wheel/i;

function sameCar(nodeName, carName) {
  const key = (value) => value.toLowerCase().replace(/[\s_]+/g, '');
  return key(nodeName) === key(carName);
}

export function prepareRallyMaterials(gltf) {
  gltf.scene.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const wheel = hasWheelAncestor(child);
    const next = [].concat(child.material).map((material) => (wheel ? tuneWheel(material) : glossBody(material)));
    child.material = Array.isArray(child.material) ? next : next[0];
  });
}

function tuneWheel(material) {
  material.roughness = 0.78;
  material.metalness = 0.12;
  material.envMapIntensity = 0.45;
  if (material.map) material.map.anisotropy = 8;
  return material;
}

function glossBody(material) {
  if (material.map) material.map.anisotropy = 8;
  const gloss = new THREE.MeshPhysicalMaterial({
    name: material.name,
    map: material.map,
    color: material.color,
    roughness: 0.28,
    metalness: 0.24,
    clearcoat: 0.72,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.35,
    side: material.side,
  });
  return gloss;
}

export function createCar(gltf, carName) {
  const catalog = catalogCars(gltf.scene);
  const spec = catalog.find((car) => sameCar(car.name, carName));
  if (!spec) throw new Error(`Missing rally car: ${carName}`);

  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  const content = new THREE.Group();
  const bodyClones = spec.parts.map((part) => placeClone(part, content));
  const wheelClones = spec.wheels.map((wheel) => placeClone(wheel, content));
  chassis.add(content);

  content.updateMatrixWorld(true);
  // Include the detached wheels before mounting them so tire bottoms sit on the track.
  const bounds = new THREE.Box3();
  for (const part of [...bodyClones, ...wheelClones]) bounds.expandByObject(part);
  const center = bounds.getCenter(new THREE.Vector3());
  content.position.set(-center.x, -bounds.min.y, -center.z);

  const mounted = wheelClones.map((wheel) => mountWheel(root, wheel));
  mounted.sort((a, b) => Number(b.front) - Number(a.front));

  content.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const part of bodyClones) box.expandByObject(part);
  const lights = addLights(chassis, box);
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
  model.tail.emissiveIntensity = braking ? 10 : 1.7;
  const beamOpacity = 0.05 + throttle * 0.03;
  for (const beam of model.beams) beam.material.opacity = beamOpacity;
}

function catalogCars(scene) {
  let rootNode = null;
  scene.updateMatrixWorld(true);
  scene.traverse((child) => {
    if (child.name === 'RootNode') rootNode = child;
  });
  const cars = [];
  let current = null;
  for (const child of rootNode.children) {
    const name = child.name || '';
    if (WHEEL.test(name)) {
      current?.wheels.push(child);
    } else if (PART.test(name)) {
      current?.parts.push(child);
    } else {
      current = { name, parts: [child], wheels: [] };
      cars.push(current);
    }
  }
  return cars;
}

function placeClone(source, parent) {
  const clone = source.clone(true);
  clone.matrix.copy(source.matrixWorld);
  clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
  clone.matrixAutoUpdate = true;
  parent.add(clone);
  return clone;
}

function mountWheel(root, wheel) {
  wheel.getWorldPosition(_pos);
  const pivot = new THREE.Group();
  pivot.position.copy(_pos);
  const spinner = new THREE.Group();
  pivot.add(spinner);
  root.add(pivot);
  spinner.attach(wheel);
  return { pivot, spinner, front: _pos.z > 0 };
}

function hasWheelAncestor(object) {
  let current = object;
  while (current) {
    if (WHEEL.test(current.name || '')) return true;
    current = current.parent;
  }
  return false;
}

function addLights(chassis, box) {
  const tail = new THREE.MeshStandardMaterial({
    color: 0x2a0505,
    emissive: 0xff1d1d,
    emissiveIntensity: 1.7,
    roughness: 0.28,
  });
  const head = new THREE.MeshStandardMaterial({
    color: 0xfff6e4,
    emissive: 0xfff1cc,
    emissiveIntensity: 3.4,
    roughness: 0.18,
  });
  const width = box.max.x - box.min.x;
  const lampY = box.min.y + (box.max.y - box.min.y) * 0.42;
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(width * 0.12, 0.07, 0.04), head);
    lamp.position.set(side * width * 0.32, lampY, box.max.z + 0.02);
    const tailLamp = new THREE.Mesh(new THREE.BoxGeometry(width * 0.16, 0.06, 0.04), tail);
    tailLamp.position.set(side * width * 0.3, lampY, box.min.z - 0.02);
    chassis.add(lamp, tailLamp);
  }
  return { tail, beams: addBeams(chassis, width, lampY, box.max.z), spots: addHeadlights(chassis, width, lampY, box.max.z) };
}

function addBeams(chassis, width, lampY, noseZ) {
  const geo = new THREE.CylinderGeometry(1.15, 0.04, 14, 12, 1, true);
  geo.translate(0, 7, 0);
  geo.rotateX(Math.PI / 2);
  const beams = [];
  for (const side of [-1, 1]) {
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
    beam.position.set(side * width * 0.32, lampY, noseZ + 0.06);
    chassis.add(beam);
    beams.push(beam);
  }
  return beams;
}

function addHeadlights(chassis, width, lampY, noseZ) {
  const spots = [];
  for (const side of [-1, 1]) {
    const spot = new THREE.SpotLight(0xfff0d2, 18, 42, 0.48, 0.62, 1.4);
    spot.position.set(side * width * 0.32, lampY, noseZ);
    const target = new THREE.Object3D();
    target.position.set(side * width * 0.32, lampY - 0.35, noseZ + 16);
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
  gradient.addColorStop(0, 'rgba(0,0,0,0.48)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry((box.max.x - box.min.x) * 1.25, (box.max.z - box.min.z) * 1.05),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  mesh.renderOrder = 1;
  return mesh;
}
