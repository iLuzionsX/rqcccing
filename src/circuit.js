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
    samples = refitFrames(samples, jumps, length);
    length = samples[samples.length - 1].distance;
  }

  return {
    curve,
    samples,
    length,
    halfWidth: 6,
    stageId: stage.id,
    stageName: stage.name,
    stageDescription: stage.description,
    lake: stage.lake,
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
      description: 'A high-country rally loop with tight switchbacks, exposed ridgelines, and two proper jumps.',
      lake: { x: -286, z: 74, radius: 43, y: 0.4 },
      points: ridgePoints(),
      jumps: [
        // minSpeed gates the lip. The vertical speed comes from the crest slope.
        { id: 'switchback-drop', waypoint: 7, launchSpeed: 8.1, minSpeed: 13 },
        { id: 'eagle-crest', waypoint: 16, launchSpeed: 9.2, minSpeed: 15 },
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

// Height added along a jump, measured from the lip. The approach still
// points upward at the lip; the landing falls away faster than a car at
// the jump's minimum speed can follow.
export function crestLift(along) {
  const approach = 22;
  const drop = 16;
  const tail = 34;
  const height = 3.4;
  const dropSlope = 0.26;
  if (along < -approach || along > drop + tail) return 0;
  if (along <= 0) {
    const t = (along + approach) / approach;
    return height * t * t;
  }
  if (along <= drop) return height - dropSlope * along;
  const t = (along - drop) / tail;
  const fade = t * t * (3 - 2 * t);
  return (height - dropSlope * drop) * (1 - fade);
}

function raiseCrests(samples, jumps, length) {
  const base = samples.map((sample) => sample.point.y);
  for (let i = 0; i < samples.length; i += 1) {
    let lift = 0;
    for (const jump of jumps) {
      let along = samples[i].distance - jump.distance;
      if (along > length * 0.5) along -= length;
      if (along < -length * 0.5) along += length;
      lift += crestLift(along);
    }
    samples[i].point.y = base[i] + lift;
  }
}

function refitFrames(samples, jumps, length) {
  const n = samples.length - 1;
  for (let i = 0; i < n; i += 1) {
    if (!onCrest(samples[i].distance, jumps, length)) continue;
    const prev = samples[(i - 1 + n) % n].point;
    const next = samples[(i + 1) % n].point;
    const raised = next.clone().sub(prev).normalize();
    const heading = Math.atan2(samples[i].tangent.x, samples[i].tangent.z);
    const pitch = Math.asin(clamp(raised.y, -0.55, 0.55));
    const cp = Math.cos(pitch);
    samples[i].tangent.set(Math.sin(heading) * cp, Math.sin(pitch), Math.cos(heading) * cp);
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

function onCrest(distance, jumps, length) {
  for (const jump of jumps) {
    let along = distance - jump.distance;
    if (along > length * 0.5) along -= length;
    if (along < -length * 0.5) along += length;
    if (along >= -26 && along <= 56) return true;
  }
  return false;
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
  return [
    [-175, 5, -235], [-92, 6, -235], [0, 9, -232], [73, 15, -216],
    [112, 25, -170], [118, 34, -100], [91, 42, -42], [42, 46, -26],
    [6, 43, -62], [35, 34, -101], [-20, 28, -128], [-76, 31, -97],
    [-104, 39, -41], [-76, 48, 13], [-22, 53, 33], [34, 57, 21],
    [82, 63, 47], [137, 61, 34], [179, 54, -5], [165, 47, -53],
    [121, 40, -81], [145, 31, -128], [163, 22, -180], [122, 13, -238],
    [65, 8, -285], [0, 6, -292], [-86, 5, -290], [-154, 4, -276],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
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
