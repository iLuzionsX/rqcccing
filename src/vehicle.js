import { clamp, wrapPi } from './util.js';

const MAX_SPEED = 70;
const HALF_WIDTH = 6;

export function createVehicle(kind) {
  return {
    kind,
    x: 0,
    z: 0,
    speed: 0,
    heading: 0,
    slip: 0,
    distance: 0,
    sinceLine: 0,
    completed: 0,
    lapTime: 0,
    bestLap: null,
    lastLap: null,
    wrongWay: 0,
    finished: false,
    finishTime: null,
  };
}

export function placeVehicle(vehicle, circuit, distance, lateral) {
  const sample = circuit.atDistance(distance);
  vehicle.x = sample.point.x + sample.right.x * lateral;
  vehicle.z = sample.point.z + sample.right.z * lateral;
  vehicle.heading = Math.atan2(sample.tangent.x, sample.tangent.z);
  vehicle.distance = sample.distance;
  vehicle.slip = 0;
  vehicle.speed = 0;
}

export function updateVehicle(vehicle, circuit, dt, input, length) {
  const throttle = clamp(input.throttle || 0, 0, 1);
  const brake = clamp(input.brake || 0, 0, 1);
  const handbrake = clamp(input.handbrake || 0, 0, 1);
  const steerInput = clamp(input.steer || 0, -1, 1);
  const sample = circuit.query(vehicle.x, vehicle.z);
  const off = Math.abs(sample.lateral) > HALF_WIDTH + 0.3;

  const speedRatio = clamp(Math.max(vehicle.speed, 0) / MAX_SPEED, 0, 1);
  let force = throttle * 16 * (1 - speedRatio ** 1.35);
  force -= vehicle.speed * 0.012;
  if (vehicle.speed > 0.4) force -= brake * 34 + handbrake * 8;
  else if (brake > 0.5 && throttle < 0.2) force -= 8;
  if (off) force -= vehicle.speed * 1.6;
  vehicle.speed = clamp(vehicle.speed + force * dt, -9, MAX_SPEED);

  const steerAngle = steerInput * 0.4 / (1 + Math.max(vehicle.speed, 0) * 0.028);
  const turnSpeed = Math.max(Math.abs(vehicle.speed), 7) * Math.sign(vehicle.speed || 1);
  const yawRate = (turnSpeed / 2.7) * Math.tan(steerAngle) * (handbrake > 0.5 ? 1.5 : 1);
  vehicle.heading = wrapPi(vehicle.heading + yawRate * dt);

  const grip = off ? 2.4 : handbrake > 0.5 ? 1.35 : 7.5;
  const targetSlip = handbrake > 0.5 ? -steerAngle * 0.9 : -steerAngle * 0.18;
  vehicle.slip += (targetSlip - vehicle.slip) * (1 - Math.exp(-grip * dt));
  const move = vehicle.heading + vehicle.slip;
  vehicle.x += Math.sin(move) * vehicle.speed * dt;
  vehicle.z += Math.cos(move) * vehicle.speed * dt;

  const next = circuit.query(vehicle.x, vehicle.z);
  constrain(vehicle, next, dt);

  const previousDistance = vehicle.distance;
  const updated = circuit.query(vehicle.x, vehicle.z);
  const delta = forwardDelta(previousDistance, updated.distance, length);
  vehicle.distance = updated.distance;
  if (delta > 0) vehicle.sinceLine += delta;
  vehicle.wrongWay = delta < -0.35 && vehicle.speed > 6 ? vehicle.wrongWay + dt : 0;
  const wrapped = previousDistance > length * 0.72 && updated.distance < length * 0.22;
  if (!vehicle.finished) {
    vehicle.lapTime += dt;
    if (wrapped && delta > 0 && vehicle.sinceLine > length * 0.45) {
      vehicle.completed += 1;
      vehicle.lastLap = vehicle.lapTime;
      vehicle.bestLap = vehicle.bestLap == null ? vehicle.lapTime : Math.min(vehicle.bestLap, vehicle.lapTime);
      vehicle.lapTime = 0;
      vehicle.sinceLine = 0;
    }
  }
  return updated;
}

function constrain(vehicle, sample, dt) {
  const lateral = sample.lateral;
  const abs = Math.abs(lateral);
  if (abs > HALF_WIDTH) {
    const over = abs - HALF_WIDTH;
    vehicle.speed *= Math.exp(-Math.min(over, 4) * 0.85 * dt);
    const push = Math.min(over, 5) * 2.4 * dt;
    const sign = Math.sign(lateral) || 1;
    vehicle.x -= sign * sample.right.x * push;
    vehicle.z -= sign * sample.right.z * push;
  }
  if (abs > HALF_WIDTH + 2.15) {
    const sign = Math.sign(lateral) || 1;
    const limit = HALF_WIDTH + 2.05;
    const centerX = sample.point.x + sample.right.x * sign * limit;
    const centerZ = sample.point.z + sample.right.z * sign * limit;
    vehicle.x += (centerX - vehicle.x) * Math.min(1, dt * 6);
    vehicle.z += (centerZ - vehicle.z) * Math.min(1, dt * 6);
    vehicle.speed *= 0.96;
    const along = Math.atan2(sample.tangent.x, sample.tangent.z);
    vehicle.heading = wrapPi(vehicle.heading + wrapPi(along - vehicle.heading) * Math.min(1, dt * 2));
  }
}

function forwardDelta(prev, next, length) {
  let delta = next - prev;
  if (delta > length * 0.5) delta -= length;
  if (delta < -length * 0.5) delta += length;
  return delta;
}

export function separateVehicles(vehicles) {
  const radius = 1.2;
  for (let i = 0; i < vehicles.length; i += 1) {
    for (let j = i + 1; j < vehicles.length; j += 1) {
      const a = vehicles[i];
      const b = vehicles[j];
      let dx = a.x - b.x;
      let dz = a.z - b.z;
      const dist = Math.hypot(dx, dz) || 0.0001;
      if (dist >= radius * 2) continue;
      const push = (radius * 2 - dist) * 0.5;
      dx /= dist;
      dz /= dist;
      a.x += dx * push;
      a.z += dz * push;
      b.x -= dx * push;
      b.z -= dz * push;
      a.speed *= 0.985;
      b.speed *= 0.985;
    }
  }
}

export function standings(vehicles) {
  return vehicles
    .map((vehicle, index) => ({ vehicle, index }))
    .sort((a, b) => {
      const as = a.vehicle.completed * 100000 + a.vehicle.distance;
      const bs = b.vehicle.completed * 100000 + b.vehicle.distance;
      return bs - as;
    });
}
