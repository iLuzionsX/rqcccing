import { clamp, wrapPi } from './util.js';
import { orientCompass } from './compass.js';

const MAX_SPEED = 72;
const HALF_WIDTH = 6;
const MASS = 760;
const INERTIA = 1180;
const WHEELBASE = 2.65;
const FRONT = 1.16;
const REAR = WHEELBASE - FRONT;
const CG_HEIGHT = 0.34;
const TRACK = 1.62;
const GRIP = 1.62;
const GRAVITY = 9.81;

export function createVehicle(kind) {
  return {
    kind,
    x: 0,
    z: 0,
    speed: 0,
    latSpeed: 0,
    yawRate: 0,
    steerAngle: 0,
    longAccel: 0,
    latAccel: 0,
    heading: 0,
    slip: 0,
    compass: orientCompass(0),
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
  vehicle.latSpeed = 0;
  vehicle.yawRate = 0;
  vehicle.steerAngle = 0;
  vehicle.longAccel = 0;
  vehicle.latAccel = 0;
  vehicle.compass = orientCompass(vehicle.heading, sample.up);
}

export function updateVehicle(vehicle, circuit, dt, input, length) {
  const throttle = clamp(input.throttle || 0, 0, 1);
  const brake = clamp(input.brake || 0, 0, 1);
  const handbrake = clamp(input.handbrake || 0, 0, 1);
  const steerInput = clamp(input.steer || 0, -1, 1);
  const previousDistance = vehicle.distance;

  const steps = Math.max(1, Math.ceil(dt / 0.008));
  const step = dt / steps;
  let sample = circuit.query(vehicle.x, vehicle.z);
  for (let i = 0; i < steps; i += 1) {
    sample = integrate(vehicle, circuit, step, throttle, brake, handbrake, steerInput);
  }

  const updated = circuit.query(vehicle.x, vehicle.z);
  vehicle.compass = orientCompass(vehicle.heading, updated.up);
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

function integrate(vehicle, circuit, dt, throttle, brake, handbrake, steerInput) {
  const sample = circuit.query(vehicle.x, vehicle.z);
  const frame = orientCompass(vehicle.heading, sample.up);
  const off = Math.abs(sample.lateral) > HALF_WIDTH + 0.2;
  const drive = readControls(vehicle, frame, dt, throttle, brake, handbrake, steerInput, off);
  applyForces(vehicle, frame, drive, dt);
  vehicle.x += (frame.forward.x * vehicle.speed + frame.right.x * vehicle.latSpeed) * dt;
  vehicle.z += (frame.forward.z * vehicle.speed + frame.right.z * vehicle.latSpeed) * dt;
  vehicle.heading = wrapPi(vehicle.heading + vehicle.yawRate * dt);
  const next = circuit.query(vehicle.x, vehicle.z);
  constrain(vehicle, next, dt);
  if (!Number.isFinite(vehicle.speed) || !Number.isFinite(vehicle.latSpeed) || !Number.isFinite(vehicle.yawRate)) {
    vehicle.speed = 0;
    vehicle.latSpeed = 0;
    vehicle.yawRate = 0;
  }
  return next;
}

function readControls(vehicle, frame, dt, throttle, brake, handbrake, steerInput, off) {
  const speed = vehicle.speed;
  const steerAngle = steerInput * 0.52 / (1 + Math.abs(speed) * 0.015);
  vehicle.steerAngle += (steerAngle - vehicle.steerAngle) * Math.min(1, dt * 10);

  const loads = axleLoads(vehicle, speed, off, handbrake);
  const frontSlip = slipForce(vehicle.latSpeed + vehicle.yawRate * FRONT, speed, vehicle.steerAngle, loads.front);
  const rearSlip = slipForce(vehicle.latSpeed - vehicle.yawRate * REAR, speed, 0, loads.rear);
  const powered = powertrain(speed, throttle, brake);
  const front = clampCircle(frontSlip.fx - powered.brakeFront, frontSlip.fy, loads.front);
  const rear = clampCircle(rearSlip.fx + powered.drive - powered.brakeRear, rearSlip.fy, loads.rear);
  return {
    steerAngle,
    fx: front.fx + rear.fx + powered.free + dragForce(speed, off) + MASS * (-GRAVITY * frame.forward.y),
    fy: front.fy + rear.fy + MASS * (-GRAVITY * frame.right.y),
    yaw: front.fy * FRONT - rear.fy * REAR,
    powered,
  };
}

function applyForces(vehicle, frame, drive, dt) {
  const vLong = vehicle.speed;
  const vLat = vehicle.latSpeed;
  const yawRate = vehicle.yawRate;
  const aLong = drive.fx / MASS;
  const aLat = drive.fy / MASS;
  let yawAccel = drive.yaw / INERTIA;
  const creep = clamp((5.5 - Math.abs(vLong)) / 5.5, 0, 1);
  if (creep > 0 && Math.abs(vLong) > 0.25) {
    yawAccel += drive.steerAngle * creep * Math.sign(vLong) * 4.2;
  }
  yawAccel -= yawRate * 0.35;

  vehicle.speed = clamp(vLong + (aLong + yawRate * vLat) * dt, -9, MAX_SPEED + 4);
  vehicle.latSpeed = clamp(vLat + (aLat - yawRate * vLong) * dt, -28, 28);
  vehicle.yawRate = clamp(yawRate + yawAccel * dt, -2.6, 2.6);
  if (Math.abs(vehicle.speed) < 0.3 && Math.abs(vehicle.latSpeed) < 0.3 && Math.abs(drive.powered.drive + drive.powered.free) < 40) {
    vehicle.yawRate *= 0.88;
  }

  const blend = 1 - Math.exp(-12 * dt);
  vehicle.longAccel += (aLong - (-GRAVITY * frame.forward.y) - vehicle.longAccel) * blend;
  vehicle.latAccel += (aLat - (-GRAVITY * frame.right.y) - vehicle.latAccel) * blend;
  vehicle.slip = Math.atan2(vehicle.latSpeed, Math.max(Math.abs(vehicle.speed), 0.8));
}

function axleLoads(vehicle, speed, off, handbrake) {
  const down = 0.9 * speed * Math.abs(speed);
  const maxShift = MASS * GRAVITY * 0.3;
  const longShift = clamp(MASS * vehicle.longAccel * CG_HEIGHT / WHEELBASE, -maxShift, maxShift);
  const latShift = MASS * vehicle.latAccel * CG_HEIGHT / TRACK * 0.7;
  const mu = off ? 0.38 : GRIP;
  const frontFz = Math.max(280, MASS * GRAVITY * (REAR / WHEELBASE) + down * 0.42 - longShift);
  const rearFz = Math.max(280, MASS * GRAVITY * (FRONT / WHEELBASE) + down * 0.58 + longShift);
  return {
    front: pairCapacity(frontFz, latShift * 0.48, mu),
    rear: pairCapacity(rearFz, latShift * 0.52, mu * (handbrake > 0.5 ? 0.26 : 1)),
  };
}

function pairCapacity(fz, shift, mu) {
  const left = Math.max(0, fz * 0.5 - shift);
  const right = Math.max(0, fz * 0.5 + shift);
  return tireCapacity(left, mu) + tireCapacity(right, mu);
}

function tireCapacity(fz, mu) {
  return fz * mu / (1 + fz * 0.00007);
}

function slipForce(vRight, vForward, steer, capacity) {
  const cosine = Math.cos(steer);
  const sine = Math.sin(steer);
  const wheelRight = vRight * cosine - vForward * sine;
  const wheelForward = vRight * sine + vForward * cosine;
  const speed = Math.hypot(wheelRight, wheelForward);
  if (speed < 0.7 || capacity <= 0) return { fx: 0, fy: 0, slip: 0 };
  const slip = Math.atan2(wheelRight, Math.max(Math.abs(wheelForward), 0.7));
  const response = (slip / 0.16) / (1 + Math.abs(slip / 0.16) * 0.82);
  const lateral = -response * capacity;
  return { fx: lateral * -sine, fy: lateral * cosine, slip };
}

function powertrain(speed, throttle, brake) {
  const ratio = clamp(Math.max(speed, 0) / MAX_SPEED, 0, 1);
  const engine = throttle * MASS * 15.5 * (1 - ratio ** 1.32);
  let drive = engine * 0.7;
  const free = engine * 0.3;
  let brakeFront = 0;
  let brakeRear = 0;
  const braking = brake * MASS * 18;
  if (speed > 0.7) {
    brakeFront = braking * 0.63;
    brakeRear = braking * 0.37;
  } else if (brake > 0.5 && throttle < 0.12) {
    drive -= MASS * 7;
  } else if (speed < -0.3) {
    brakeFront = -braking * 0.45;
    brakeRear = -braking * 0.55;
  }
  return { drive, free, brakeFront, brakeRear };
}

function dragForce(speed, off) {
  const rolling = MASS * 0.16 * Math.sign(speed || 0);
  const aero = 0.34 * speed * Math.abs(speed);
  const dirt = off ? MASS * 1.5 * speed : 0;
  return -rolling - aero - dirt;
}

function clampCircle(fx, fy, capacity) {
  const mag = Math.hypot(fx, fy);
  if (mag <= capacity || mag < 1e-5) return { fx, fy };
  const scale = capacity / mag;
  return { fx: fx * scale, fy: fy * scale };
}

function constrain(vehicle, sample, dt) {
  const lateral = sample.lateral;
  const abs = Math.abs(lateral);
  if (abs > HALF_WIDTH) {
    const over = abs - HALF_WIDTH;
    const drag = Math.exp(-Math.min(over, 4) * 0.85 * dt);
    vehicle.speed *= drag;
    vehicle.latSpeed *= Math.exp(-Math.min(over, 4) * 1.6 * dt);
    vehicle.yawRate *= Math.exp(-Math.min(over, 4) * 0.5 * dt);
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
    vehicle.latSpeed *= 0.9;
    const along = Math.atan2(sample.tangent.x, sample.tangent.z);
    const error = wrapPi(along - vehicle.heading);
    vehicle.heading = wrapPi(vehicle.heading + error * Math.min(1, dt * 2));
    vehicle.yawRate += error * Math.min(1, dt * 2);
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
