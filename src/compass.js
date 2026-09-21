import { clamp } from './util.js';

// Vehicle compass. One right-handed frame for the tires, the body, and the camera.
// Heading 0 faces world +Z and increases toward world +X, which is a right turn.
// +forward is the nose, +right is the car's right, +up is the roof.
// Positive steer yaws the nose toward +right.
// Positive pitch rotation (about +right) drops the nose.
// Positive roll rotation (about +forward) lifts the +right side.

const WORLD_UP = { x: 0, y: 1, z: 0 };
const PITCH_PER_ACCEL = 0.012;
const ROLL_PER_ACCEL = 0.014;

export function orientCompass(heading, surfaceUp = WORLD_UP) {
  const up = normalize(surfaceUp) || WORLD_UP;
  let forward = projectOnPlane({ x: Math.sin(heading), y: 0, z: Math.cos(heading) }, up);
  if (lengthSq(forward) < 1e-8) {
    const fallback = Math.abs(up.z) < 0.85 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    forward = projectOnPlane(fallback, up);
  }
  forward = normalize(forward) || { x: 0, y: 0, z: 1 };
  const right = normalize(cross(up, forward)) || { x: 1, y: 0, z: 0 };
  const frameUp = normalize(cross(forward, right)) || up;
  return { heading, forward, right, up: frameUp };
}

export function bodyAttitude(longAccel = 0, latAccel = 0) {
  return {
    // Forward acceleration throws the body back, so the nose rises.
    pitch: clamp(-longAccel * PITCH_PER_ACCEL, -0.08, 0.09),
    // Lateral acceleration points at the inside of the corner. The body
    // settles onto the outside tires, which lifts the inside (+right in a right turn).
    roll: clamp(latAccel * ROLL_PER_ACCEL, -0.12, 0.12),
  };
}

function projectOnPlane(vector, normal) {
  const along = dot(vector, normal);
  return {
    x: vector.x - normal.x * along,
    y: vector.y - normal.y * along,
    z: vector.z - normal.z * along,
  };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function lengthSq(vector) {
  return dot(vector, vector);
}

function normalize(vector) {
  if (!vector) return null;
  const length = Math.hypot(vector.x || 0, vector.y || 0, vector.z || 0);
  if (length < 1e-8) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}
