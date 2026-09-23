import * as THREE from 'three';
import { clamp } from './util.js';

// Closed rally stage. The grid leaves on the same east-northeast heading as the
// old loop, climbs a ridge, drops into a valley, then climbs once more before
// the finish. Straights and sweepers stay far enough apart that the banks
// never fight each other.
const HEADING = Math.PI / 3;
const RADIUS = 152;
const REACH = 148;

export const LAKE = {
  x: -RADIUS * Math.cos(HEADING),
  z: RADIUS * Math.sin(HEADING),
  radius: 54,
  y: 0.4,
};

export function createCircuit(segments = 640, requestedStage = selectedStage()) {
  const stage = stageDefinition(requestedStage);
  const points = stage.points;
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.35);
  const raw = sampleCenterline(curve, segments);
  let samples = smoothBanks(frameSamples(raw));
  let length = samples[samples.length - 1].distance;
  const jumps = stage.jumps.map((jump) => ({
    ...jump,
    distance: nearestDistance(samples, points[jump.waypoint]),
  })).sort((a, b) => a.distance - b.distance);
  if (jumps.length) {
    raiseCrests(samples, jumps, length);
    samples = refitFrames(samples);
    length = samples[samples.length - 1].distance;
  }
  const centroid = loopCentroid(samples);
  const lake = stage.id === 'ridge' ? placeTarn(samples, centroid, length) : stage.lake;

  return {
    curve,
    samples,
    length,
    halfWidth: 6,
    bankOuter: stage.id === 'ridge' ? 16.8 : 29,
    stageId: stage.id,
    stageName: stage.name,
    stageDescription: stage.description,
    centroid,
    lake,
    jumps,
    query(x, z) {
      return querySamples(samples, x, z);
    },
    atDistance(distance) {
      return sampleByDistance(samples, length, distance);
    },
  };
}

function selectedStage() {
  if (typeof globalThis.location === 'undefined') return 'coast';
  return new URLSearchParams(globalThis.location.search).get('stage') || 'coast';
}

function stageDefinition(stageId) {
  if (stageId === 'ridge') {
    return {
      id: 'ridge',
      name: 'Ridgebreak Rally',
      description: 'A high-country gravel loop. Two switchbacks, a tarn beside the service straight, and crests that launch the car.',
      lake: null,
      points: ridgePoints(),
      jumps: [
        { id: 'switchback-drop', waypoint: 8, launchSpeed: 8.2, minSpeed: 11 },
        { id: 'eagle-crest', waypoint: 12, launchSpeed: 9.1, minSpeed: 12 },
      ],
    };
  }
  return {
    id: 'coast',
    name: 'Golden Hour GP',
    description: 'Three laps around a wet coastal circuit. The sun is low, the lake is glass, and the asphalt still holds the rain.',
    lake: LAKE,
    points: coastalPoints(),
    jumps: [],
  };
}

function nearestDistance(samples, target) {
  let distance = 0;
  let best = Infinity;
  for (let i = 0; i < samples.length - 1; i += 1) {
    const candidate = samples[i].point.distanceToSquared(target);
    if (candidate < best) {
      best = candidate;
      distance = samples[i].distance;
    }
  }
  return distance;
}

function ridgePoints() {
  // South service straight, an east climb into a hairpin, a high crest,
  // then a west descent. The finish is a quarter-circle so the loop closes
  // on the same heading instead of folding back over the straight.
  const pts = [
    [-220, 8.0, -188], [-140, 8.5, -186], [-55, 11.2, -180], [28, 16, -168],
    [108, 23, -140], [162, 31, -88], [186, 39, -22], [162, 47, 42],
    [108, 52, 88], [42, 47, 118], [-8, 52, 162], [-48, 59, 198],
    [-112, 63, 176], [-162, 56, 128], [-196, 46, 68], [-200, 34, 8],
    [-186, 26, -48], [-178, 21, -92], [-250, 16.5, -104],
  ];
  const radius = 76;
  const exitX = -268;
  const exitZ = -188;
  const cx = exitX;
  const cz = exitZ + radius;
  const arc = [
    [Math.PI, 13.5],
    [Math.PI * 1.25, 10.4],
    [Math.PI * 1.5, 8.2],
  ];
  for (const [theta, y] of arc) {
    pts.push([cx + radius * Math.cos(theta), y, cz + radius * Math.sin(theta)]);
  }
  return pts.map(([x, y, z]) => new THREE.Vector3(x, y, z));
}

function raiseCrests(samples, jumps, length) {
  const base = samples.map((sample) => sample.point.y);
  for (let i = 0; i < samples.length; i += 1) {
    let lift = 0;
    for (const jump of jumps) {
      let along = samples[i].distance - jump.distance;
      if (along > length * 0.5) along -= length;
      if (along < -length * 0.5) along += length;
      lift += crestOffset(along);
    }
    samples[i].point.y = base[i] + lift;
  }
}

function crestOffset(along) {
  if (along < -28 || along > 50) return 0;
  if (along <= 0) {
    const t = (along + 28) / 28;
    return 2.15 * t * t * (3 - 2 * t);
  }
  if (along <= 24) {
    const t = along / 24;
    return 2.15 - 3.25 * t * t;
  }
  const t = (along - 24) / 26;
  const fade = t * t * (3 - 2 * t);
  return -1.1 * (1 - fade);
}

function refitFrames(samples) {
  const n = samples.length - 1;
  for (let i = 0; i < n; i += 1) {
    const prev = samples[(i - 1 + n) % n].point;
    const next = samples[(i + 1) % n].point;
    samples[i].tangent.copy(next).sub(prev).normalize();
  }
  samples[n].point.copy(samples[0].point);
  samples[n].tangent.copy(samples[0].tangent);
  for (let i = 0; i < n; i += 1) {
    const next = samples[(i + 1) % n].tangent;
    const tangent = samples[i].tangent;
    samples[i].curvature = tangent.z * next.x - tangent.x * next.z;
  }
  samples[n].curvature = samples[0].curvature;
  return smoothBanks(samples);
}

function loopCentroid(samples) {
  const centroid = new THREE.Vector3();
  const n = samples.length - 1;
  for (let i = 0; i < n; i += 1) centroid.add(samples[i].point);
  return centroid.multiplyScalar(1 / n);
}

function placeTarn(samples, centroid, length) {
  const radius = 28;
  let best = null;
  for (const along of [48, 110, 175]) {
    const spot = sampleByDistance(samples, length, along);
    const centerSide = spot.right.x * (centroid.x - spot.point.x) + spot.right.z * (centroid.z - spot.point.z);
    const outside = centerSide >= 0 ? -1 : 1;
    for (const offset of [64, 78, 96]) {
      const x = spot.point.x + spot.right.x * outside * offset;
      const z = spot.point.z + spot.right.z * outside * offset;
      let nearest = Infinity;
      for (let i = 0; i < samples.length - 1; i += 2) {
        nearest = Math.min(nearest, Math.hypot(samples[i].point.x - x, samples[i].point.z - z));
      }
      if (nearest < radius + 24) continue;
      const score = offset + Math.abs(along - 110) * 0.15;
      if (!best || score < best.score) best = { x, z, nearest, y: spot.point.y, score };
    }
  }
  return {
    x: best.x,
    z: best.z,
    radius,
    y: Math.max(2.4, best.y - 2.6),
  };
}

function coastalPoints() {
  const sh = Math.sin(HEADING);
  const ch = Math.cos(HEADING);
  const local = [];
  const add = (u, v, y) => local.push([u, v, y]);
  add(0, 0, 1.9);
  add(74, 0, 2.15);
  add(REACH, 0, 2.9);
  const eastY = [8.8, 14.2, 17.2, 17.0, 16.2, 15.4];
  for (let i = 1; i <= 6; i += 1) {
    const t = (30 * i) * Math.PI / 180;
    add(REACH + RADIUS * Math.sin(t), RADIUS - RADIUS * Math.cos(t), eastY[i - 1]);
  }
  add(46, RADIUS * 2, 14.2);
  add(-46, RADIUS * 2, 10.6);
  add(-REACH, RADIUS * 2, 6.2);
  const westY = [2.4, 1.7, 2.6, 8.6, 13.0, 8.0];
  for (let i = 1; i <= 6; i += 1) {
    const t = (180 + 30 * i) * Math.PI / 180;
    add(-REACH + RADIUS * Math.sin(t), RADIUS - RADIUS * Math.cos(t), westY[i - 1]);
  }
  add(-74, 0, 3.8);
  return local.map(([u, v, y]) => new THREE.Vector3(u * sh - v * ch, y, u * ch + v * sh));
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
  const unique = raw.length - 1;
  return raw.map((sample, index) => {
    const next = raw[(index + 1) % unique];
    const curvature = sample.tangent.z * next.tangent.x - sample.tangent.x * next.tangent.z;
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, sample.tangent);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(sample.tangent, right).normalize();
    return {
      t: sample.t,
      distance: sample.distance,
      point: sample.point,
      tangent: sample.tangent,
      right,
      up,
      bank: 0,
      curvature,
    };
  });
}

function smoothBanks(frames) {
  const n = frames.length - 1;
  const radius = 12;
  const curvature = new Array(frames.length);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const sample = frames[(i + k + n) % n];
      const w = 1 - Math.abs(k) / (radius + 1);
      sum += sample.curvature * w;
      weight += w;
    }
    curvature[i] = sum / weight;
  }
  curvature[n] = curvature[0];
  for (let i = 0; i < n; i += 1) {
    const frame = frames[i];
    frame.curvature = curvature[i];
    frame.bank = clamp(-frame.curvature * 12, -0.2, 0.2);
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, frame.tangent);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(frame.tangent, right).normalize();
    right.applyAxisAngle(frame.tangent, frame.bank);
    up.applyAxisAngle(frame.tangent, frame.bank);
    frame.right = right;
    frame.up = up;
  }
  const last = frames[n];
  const first = frames[0];
  last.curvature = first.curvature;
  last.bank = first.bank;
  last.point.copy(first.point);
  last.tangent.copy(first.tangent);
  last.right.copy(first.right);
  last.up.copy(first.up);
  return frames;
}

function querySamples(samples, x, z) {
  let best = 0;
  let bestD = Infinity;
  let bestT = 0;
  const last = samples.length - 1;
  for (let i = 0; i < last; i += 1) {
    const a = samples[i].point;
    const b = samples[i + 1].point;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    if (len2 < 1e-6) continue;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
    t = clamp(t, 0, 1);
    const dx = x - (a.x + abx * t);
    const dz = z - (a.z + abz * t);
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
      bestT = t;
    }
  }
  const a = samples[best];
  const b = samples[Math.min(last, best + 1)];
  const t = bestT;
  const point = a.point.clone().lerp(b.point, t);
  const tangent = a.tangent.clone().lerp(b.tangent, t).normalize();
  const right = a.right.clone().lerp(b.right, t).normalize();
  const up = a.up.clone().lerp(b.up, t).normalize();
  const lateral = (x - point.x) * right.x + (z - point.z) * right.z;
  const height = point.y + lateral * right.y;
  const span = b.distance - a.distance || 1;
  return {
    ...a,
    point,
    tangent,
    right,
    up,
    curvature: a.curvature + (b.curvature - a.curvature) * t,
    bank: a.bank + (b.bank - a.bank) * t,
    distance: a.distance + span * t,
    index: best,
    lateral,
    height,
  };
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
