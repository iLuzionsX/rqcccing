import { clamp, wrapPi } from './util.js';
import { orientCompass } from './compass.js';

const MASS = 1280;
const INERTIA = 1750;
const LF = 1.22;
const LR = 1.4;
const WHEELBASE = LF + LR;
const MAX_SPEED = 76;
const WALL = 7.55;
const STEP = 1 / 120;

const SHIFT_UP = [0, 16, 28, 41, 53, 64, 999];

export function createVehicle(kind) {
  return {
    kind,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    vLong: 0,
    vLat: 0,
    speed: 0,
    heading: 0,
    yawRate: 0,
    slip: 0,
    steerAngle: 0,
    frontOmega: 0,
    rearOmega: 0,
    gear: 1,
    shiftTimer: 0,
    longG: 0,
    latG: 0,
    longAccel: 0,
    latAccel: 0,
    latSpeed: 0,
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
  vehicle.vLong = 0;
  vehicle.vLat = 0;
  vehicle.vx = 0;
  vehicle.vz = 0;
  vehicle.yawRate = 0;
  vehicle.steerAngle = 0;
  vehicle.frontOmega = 0;
  vehicle.rearOmega = 0;
  vehicle.gear = 1;
  vehicle.shiftTimer = 0;
  vehicle.longG = 0;
  vehicle.latG = 0;
  vehicle.longAccel = 0;
  vehicle.latAccel = 0;
  vehicle.latSpeed = 0;
  vehicle.compass = orientCompass(vehicle.heading, sample.up);
}

export function updateVehicle(vehicle, circuit, dt, input, length) {
  const throttle = clamp(input.throttle || 0, 0, 1);
  const brake = clamp(input.brake || 0, 0, 1);
  const handbrake = clamp(input.handbrake || 0, 0, 1);
  const steer = clamp(input.steer || 0, -1, 1);
  updateGear(vehicle, dt);

  const steps = clamp(Math.ceil(dt / STEP), 1, 8);
  const h = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    substep(vehicle, circuit, h, { throttle, brake, handbrake, steer });
  }
  updateWheels(vehicle, dt, throttle, handbrake);

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

function substep(vehicle, circuit, h, input) {
  const sample = circuit.query(vehicle.x, vehicle.z);
  let vLong = vehicle.vLong;
  let vLat = vehicle.vLat;
  const absLat = Math.abs(sample.lateral);
  const surface = absLat > 6.6 ? 'grass' : absLat > 5.9 ? 'gravel' : 'asphalt';
  const muBase = surface === 'grass' ? 0.52 : surface === 'gravel' ? 0.8 : 1.68;

  const steerAngle = input.steer * (0.5 / (1 + Math.abs(vLong) * 0.01));
  vehicle.steerAngle += (steerAngle - vehicle.steerAngle) * (1 - Math.exp(-14 * h));

  const slipF = Math.atan2(vLat + vehicle.yawRate * LF, Math.max(Math.abs(vLong), 2.2)) - vehicle.steerAngle;
  const slipR = Math.atan2(vLat - vehicle.yawRate * LR, Math.max(Math.abs(vLong), 2.2));
  const transfer = clamp((vehicle.longG || 0) / 12, -0.34, 0.34);
  const loadF = MASS * 9.81 * (LR / WHEELBASE) * (1 - transfer);
  const loadR = MASS * 9.81 * (LF / WHEELBASE) * (1 + transfer);
  const counter = input.steer * vehicle.yawRate < -0.18;
  const muF = muBase * (counter ? 1.16 : 1);
  const muR = muBase * (input.handbrake > 0.45 ? 0.5 : 1);

  const ratio = clamp(Math.max(vLong, 0) / MAX_SPEED, 0, 1);
  let drive = input.throttle * 13600 * (1 - ratio ** 1.45);
  if (vehicle.shiftTimer > 0) drive *= 0.28;
  if (vLong < 0.7 && input.brake > 0.55 && input.throttle < 0.15) drive = -3600 * input.brake;

  let fxF = -Math.sign(vLong || 1) * input.brake * 7800;
  let fxR = drive - Math.sign(vLong || 1) * (input.brake * 9200 + input.handbrake * 700);
  let fyF = tireLat(slipF, loadF, muF);
  let fyR = tireLat(slipR, loadR, muR);
  [fxF, fyF] = frictionCircle(fxF, fyF, muF * loadF);
  [fxR, fyR] = frictionCircle(fxR, fyR, muR * loadR);

  let drag = 0.3 * vLong * Math.abs(vLong) + 16 * vLong;
  if (input.throttle < 0.08 && vLong > 2) drag += 650 + 20 * vLong;
  if (surface === 'grass') drag += 1.05 * vLong * Math.abs(vLong);
  else if (surface === 'gravel') drag += 0.42 * vLong * Math.abs(vLong);
  if (absLat > 5.55 && absLat < 6.75) drag += 0.28 * vLong * Math.abs(vLong);

  const aLong = clamp((fxF + fxR - drag) / MASS, -30, 16);
  const aLat = clamp((fyF + fyR) / MASS, -24, 24);
  const yawAcc = clamp((fyF * LF - fyR * LR) / INERTIA, -7, 7);
  vehicle.longG = aLong;
  vehicle.latG = aLat;
  vehicle.slip = slipR;
  vehicle.burning = input.throttle > 0.65 && drive > muR * loadR * 0.92 && vLong < 28;

  vLong += (aLong + vLat * vehicle.yawRate) * h;
  vLat += (aLat - vLong * vehicle.yawRate) * h;
  vehicle.yawRate += yawAcc * h;
  vehicle.yawRate *= Math.exp(-0.28 * h);

  if (input.handbrake < 0.25 && Math.abs(slipR) > 0.4) {
    const assist = clamp((Math.abs(slipR) - 0.4) * 1.6, 0, 1);
    vLat *= 1 - assist * 4 * h;
    vehicle.yawRate *= 1 - assist * 2.4 * h;
  }

  const slow = clamp((2.5 - Math.abs(vLong)) / 2.5, 0, 1);
  if (slow > 0) {
    const kin = (vLong / WHEELBASE) * Math.tan(vehicle.steerAngle);
    vehicle.yawRate = vehicle.yawRate * (1 - slow) + kin * slow;
    vLat *= 1 - slow * 0.82;
  }

  if (Math.abs(vLong) < 0.12 && Math.abs(vLat) < 0.12 && input.throttle < 0.04 && input.brake < 0.04) {
    vLong = 0;
    vLat = 0;
    vehicle.yawRate *= 0.4;
  }

  vLong = clamp(vLong, -10, 78);
  vLat = clamp(vLat, -20, 20);
  vehicle.yawRate = clamp(vehicle.yawRate, -3.1, 3.1);
  vehicle.vLong = vLong;
  vehicle.vLat = vLat;
  vehicle.speed = vLong;
  vehicle.heading = wrapPi(vehicle.heading + vehicle.yawRate * h);

  const frame = orientCompass(vehicle.heading, sample.up);
  vehicle.compass = frame;
  vehicle.vx = frame.forward.x * vLong + frame.right.x * vLat;
  vehicle.vz = frame.forward.z * vLong + frame.right.z * vLat;
  vehicle.x += vehicle.vx * h;
  vehicle.z += vehicle.vz * h;
  contain(vehicle, circuit);
  const planted = circuit.query(vehicle.x, vehicle.z);
  vehicle.compass = orientCompass(vehicle.heading, planted.up);
  vehicle.longAccel = vehicle.longG;
  vehicle.latAccel = vehicle.latG;
  vehicle.latSpeed = vehicle.vLat;
}

function contain(vehicle, circuit) {
  const sample = circuit.query(vehicle.x, vehicle.z);
  const lateral = sample.lateral;
  const abs = Math.abs(lateral);
  if (abs <= WALL) return;
  const sign = Math.sign(lateral) || 1;
  const rx = sample.right.x;
  const rz = sample.right.z;
  const outward = (vehicle.vx * rx + vehicle.vz * rz) * sign;
  if (outward > 0) {
    vehicle.vx -= rx * sign * outward * 1.25;
    vehicle.vz -= rz * sign * outward * 1.25;
    const loss = Math.min(0.18, outward * 0.012);
    vehicle.vx *= 1 - loss;
    vehicle.vz *= 1 - loss;
  }
  vehicle.x -= sign * rx * (abs - WALL);
  vehicle.z -= sign * rz * (abs - WALL);
  const fwdLat = (Math.sin(vehicle.heading) * rx + Math.cos(vehicle.heading) * rz) * sign;
  if (fwdLat > 0.2) {
    const along = Math.atan2(sample.tangent.x, sample.tangent.z);
    const flipped = wrapPi(along + Math.PI);
    const errA = wrapPi(along - vehicle.heading);
    const errB = wrapPi(flipped - vehicle.heading);
    const err = Math.abs(errA) < Math.abs(errB) ? errA : errB;
    vehicle.heading = wrapPi(vehicle.heading + err * 0.15);
  }
  const sin = Math.sin(vehicle.heading);
  const cos = Math.cos(vehicle.heading);
  vehicle.vLong = vehicle.vx * sin + vehicle.vz * cos;
  vehicle.vLat = vehicle.vx * cos - vehicle.vz * sin;
  vehicle.speed = vehicle.vLong;
}

function updateGear(vehicle, dt) {
  vehicle.shiftTimer = Math.max(0, vehicle.shiftTimer - dt);
  const speed = Math.max(vehicle.vLong, 0);
  if (vehicle.gear < 6 && speed > SHIFT_UP[vehicle.gear] && vehicle.shiftTimer <= 0) {
    vehicle.gear += 1;
    vehicle.shiftTimer = 0.11;
  } else if (vehicle.gear > 1 && speed < SHIFT_UP[vehicle.gear - 1] - 4) {
    vehicle.gear -= 1;
    vehicle.shiftTimer = 0.08;
  }
}

function updateWheels(vehicle, dt, throttle, handbrake) {
  const radius = 0.33;
  const ground = vehicle.vLong / radius;
  const spin = vehicle.burning ? ground + throttle * 28 : ground;
  const follow = 1 - Math.exp(-12 * dt);
  vehicle.frontOmega += (ground - vehicle.frontOmega) * follow;
  const rearTarget = handbrake > 0.45 ? 0 : spin;
  const rearFollow = 1 - Math.exp(-(handbrake > 0.45 ? 22 : 9) * dt);
  vehicle.rearOmega += (rearTarget - vehicle.rearOmega) * rearFollow;
}

function tireLat(slip, load, mu) {
  const x = slip / 0.105;
  const response = x / (1 + Math.abs(x));
  const falloff = 1 / (1 + Math.max(0, Math.abs(slip) - 0.16) * 2.4);
  return -response * mu * load * (0.58 + 0.42 * falloff);
}

function frictionCircle(fx, fy, limit) {
  const mag = Math.hypot(fx, fy);
  if (mag <= limit || mag === 0) return [fx, fy];
  const scale = limit / mag;
  return [fx * scale, fy * scale];
}

function forwardDelta(prev, next, length) {
  let delta = next - prev;
  if (delta > length * 0.5) delta -= length;
  if (delta < -length * 0.5) delta += length;
  return delta;
}

export function separateVehicles(vehicles) {
  const radius = 1.12;
  const half = 1.45;
  for (let i = 0; i < vehicles.length; i += 1) {
    for (let j = i + 1; j < vehicles.length; j += 1) {
      const a = vehicles[i];
      const b = vehicles[j];
      const aSin = Math.sin(a.heading);
      const aCos = Math.cos(a.heading);
      const bSin = Math.sin(b.heading);
      const bCos = Math.cos(b.heading);
      const hit = segmentDistance(
        a.x - aSin * half, a.z - aCos * half, a.x + aSin * half, a.z + aCos * half,
        b.x - bSin * half, b.z - bCos * half, b.x + bSin * half, b.z + bCos * half,
      );
      if (hit.dist >= radius * 2) continue;
      const push = (radius * 2 - hit.dist) * 0.5;
      const nx = hit.x / (hit.dist || 1);
      const nz = hit.z / (hit.dist || 1);
      a.x += nx * push;
      a.z += nz * push;
      b.x -= nx * push;
      b.z -= nz * push;
      const close = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (close < 0) {
        a.vx -= nx * close * 0.5;
        a.vz -= nz * close * 0.5;
        b.vx += nx * close * 0.5;
        b.vz += nz * close * 0.5;
        syncLocal(a);
        syncLocal(b);
      }
    }
  }
}

function syncLocal(vehicle) {
  const sin = Math.sin(vehicle.heading);
  const cos = Math.cos(vehicle.heading);
  vehicle.vLong = vehicle.vx * sin + vehicle.vz * cos;
  vehicle.vLat = vehicle.vx * cos - vehicle.vz * sin;
  vehicle.speed = vehicle.vLong;
}

function segmentDistance(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1x = bx - ax;
  const d1z = bz - az;
  const d2x = dx - cx;
  const d2z = dz - cz;
  const rx = ax - cx;
  const rz = az - cz;
  const a = d1x * d1x + d1z * d1z;
  const e = d2x * d2x + d2z * d2z;
  const f = d2x * rx + d2z * rz;
  let s = 0;
  let t = 0;
  if (a <= 1e-6 && e <= 1e-6) {
    return { x: rx, z: rz, dist: Math.hypot(rx, rz) };
  }
  if (a <= 1e-6) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1z * rz;
    if (e <= 1e-6) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 1e-6 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const hx = ax + d1x * s - (cx + d2x * t);
  const hz = az + d1z * s - (cz + d2z * t);
  return { x: hx, z: hz, dist: Math.hypot(hx, hz) };
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
