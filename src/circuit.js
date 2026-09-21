import * as THREE from 'three';
import { clamp } from './util.js';

const CONTROL_POINTS = [
  [0, 0.6, 0],
  [70, 1.2, 40],
  [150, 4, 110],
  [190, 9, 200],
  [120, 13, 280],
  [20, 8, 310],
  [-90, 4.5, 270],
  [-170, 3, 190],
  [-210, 7, 90],
  [-170, 12, -10],
  [-80, 7, -60],
  [10, 2.5, -40],
];

export const LAKE = { x: -4, z: 160, radius: 58, y: 0.42 };

export function createCircuit(segments = 640) {
  const points = CONTROL_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.35);
  const raw = sampleCenterline(curve, segments);
  const samples = frameSamples(raw);
  const length = samples[samples.length - 1].distance;

  return {
    curve,
    samples,
    length,
    halfWidth: 6,
    lake: LAKE,
    query(x, z) {
      return querySamples(samples, x, z);
    },
    atDistance(distance) {
      return sampleByDistance(samples, length, distance);
    },
  };
}

function sampleCenterline(curve, segments) {
  const raw = [];
  let distance = 0;
  let previous = null;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(Math.min(t, 0.9999)).normalize();
    if (previous) distance += previous.distanceTo(point);
    raw.push({ t, point, tangent, distance });
    previous = point;
  }
  return raw;
}

function frameSamples(raw) {
  const frames = raw.map((sample, index) => {
    const next = raw[(index + 1) % (raw.length - 1)];
    const curvature = sample.tangent.z * next.tangent.x - sample.tangent.x * next.tangent.z;
    const bank = clamp(-curvature * 42, -0.26, 0.26);
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, sample.tangent);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(sample.tangent, right).normalize();
    right.applyAxisAngle(sample.tangent, bank);
    up.applyAxisAngle(sample.tangent, bank);
    return {
      t: sample.t,
      distance: sample.distance,
      point: sample.point,
      tangent: sample.tangent,
      right,
      up,
      bank,
      curvature,
    };
  });
  return frames;
}

function querySamples(samples, x, z) {
  let best = 0;
  let bestD = Infinity;
  const last = samples.length - 1;
  for (let i = 0; i < last; i += 1) {
    const dx = x - samples[i].point.x;
    const dz = z - samples[i].point.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const sample = samples[best];
  const dx = x - sample.point.x;
  const dz = z - sample.point.z;
  const lateral = dx * sample.right.x + dz * sample.right.z;
  const height = sample.point.y + lateral * sample.right.y;
  return { ...sample, index: best, lateral, height };
}

function sampleByDistance(samples, length, distance) {
  const span = ((distance % length) + length) % length;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (samples[mid].distance < span) low = mid + 1;
    else high = mid;
  }
  const index = Math.max(0, low - 1);
  const a = samples[index];
  const b = samples[Math.min(samples.length - 1, index + 1)];
  const denom = b.distance - a.distance || 1;
  const t = clamp((span - a.distance) / denom, 0, 1);
  return {
    ...a,
    index,
    point: a.point.clone().lerp(b.point, t),
    tangent: a.tangent.clone().lerp(b.tangent, t).normalize(),
    right: a.right.clone().lerp(b.right, t).normalize(),
    up: a.up.clone().lerp(b.up, t).normalize(),
    distance: span,
    t: a.t + (b.t - a.t) * t,
  };
}
