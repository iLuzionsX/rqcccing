import { clamp, damp, wrapPi } from './util.js';
import { orientCompass } from './compass.js';

// A Group A rally car: the mass has to be persuaded to yaw, stop, and climb.
const MASS = 1420;
const INERTIA = 2920;
const LF = 1.28;
const LR = 1.48;
const WHEELBASE = LF + LR;
const CG_H = 0.6;
const TRACK = 1.52;
const MAX_SPEED = 63;
const WALL = 7.55;
const STEP = 1 / 120;
const G = 9.81;

const SHIFT_UP = [0, 13.5, 24.5, 36, 46, 55, 999];
const GEAR_FORCE = [0, 11200, 9000, 6800, 5200, 4000, 3100];
const ENGINE_BRAKE = [0, 3200, 2200, 1280, 860, 580, 420];
const MU = { asphalt: 1.28, gravel: 0.7, grass: 0.44 };

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
    aiSteer: 0,
    frontOmega: 0,
    rearOmega: 0,
    gear: 1,
    shiftTimer: 0,
    engine: 0,
    brakePressure: 0,
    longG: 0,
    latG: 0,
    longAccel: 0,
    latAccel: 0,
    latSpeed: 0,
    airborne: false,
    airY: 0,
    airVelocity: 0,
    jumps: 0,
    lastJumpId: null,
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
  vehicle.aiSteer = 0;
  vehicle.frontOmega = 0;
  vehicle.rearOmega = 0;
  vehicle.gear = 1;
  vehicle.shiftTimer = 0;
  vehicle.engine = 0;
  vehicle.brakePressure = 0;
  vehicle.longG = 0;
  vehicle.latG = 0;
  vehicle.longAccel = 0;
  vehicle.latAccel = 0;
  vehicle.latSpeed = 0;
  vehicle.airborne = false;
  vehicle.airY = sample.height + 0.02;
  vehicle.airVelocity = 0;
  vehicle.jumps = 0;
  vehicle.lastJumpId = null;
  vehicle.compass = orientCompass(vehicle.heading, sample.up);
}

export function updateVehicle(vehicle, circuit, dt, input, length) {
  const throttle = clamp(input.throttle || 0, 0, 1);
  const brake = clamp(input.brake || 0, 0, 1);
  const handbrake = clamp(input.handbrake || 0, 0, 1);
  const steer = clamp(input.steer || 0, -1, 1);
  // Torque builds slower than it falls: the engine and driveline have inertia.
  vehicle.engine = damp(vehicle.engine, throttle, throttle > vehicle.engine ? 4.4 : 6.8, dt);
  vehicle.brakePressure = damp(vehicle.brakePressure, brake, 9, dt);
  updateGear(vehicle, dt);

  const steps = clamp(Math.ceil(dt / STEP), 1, 8);
  const h = dt / steps;
  const courseLength = length || circuit.length;
  for (let i = 0; i < steps; i += 1) {
    substep(vehicle, circuit, h, {
      throttle: vehicle.engine,
      brake: vehicle.brakePressure,
      handbrake,
      steer,
    }, courseLength);
  }
  updateWheels(vehicle, dt, throttle, handbrake);

  const previousDistance = vehicle.distance;
  const updated = circuit.query(vehicle.x, vehicle.z);
  const delta = forwardDelta(previousDistance, updated.distance, courseLength);
  vehicle.distance = updated.distance;
  if (delta > 0) vehicle.sinceLine += delta;
  vehicle.wrongWay = delta < -0.35 && vehicle.speed > 6 ? vehicle.wrongWay + dt : 0;
  const wrapped = previousDistance > courseLength * 0.72 && updated.distance < courseLength * 0.22;
  if (!vehicle.finished) {
    vehicle.lapTime += dt;
    if (wrapped && delta > 0 && vehicle.sinceLine > courseLength * 0.45) {
      vehicle.completed += 1;
      vehicle.lastLap = vehicle.lapTime;
      vehicle.bestLap = vehicle.bestLap == null ? vehicle.lapTime : Math.min(vehicle.bestLap, vehicle.lapTime);
      vehicle.lapTime = 0;
      vehicle.sinceLine = 0;
    }
  }
  return updated;
}

function substep(vehicle, circuit, h, input, length) {
  const sample = circuit.query(vehicle.x, vehicle.z);
  const startDistance = sample.distance;
  const startHeight = sample.height;
  let vLong = vehicle.vLong;
  let vLat = vehicle.vLat;
  const absLat = Math.abs(sample.lateral);
  const speed = Math.abs(vLong);
  const surface = absLat > 6.6 ? 'grass' : (absLat > 5.9 || circuit.stageId === 'ridge') ? 'gravel' : 'asphalt';
  const muBase = vehicle.airborne ? 0.08 : MU[surface];

  const maxSteer = 0.48 / (1 + speed * 0.036);
  const steerTarget = input.steer * maxSteer;
  vehicle.steerAngle += (steerTarget - vehicle.steerAngle) * (1 - Math.exp(-4.4 * h));

  const slipDen = Math.max(speed, 2.4);
  const slipF = Math.atan2(vLat + vehicle.yawRate * LF, slipDen) - vehicle.steerAngle;
  const slipR = Math.atan2(vLat - vehicle.yawRate * LR, slipDen);
  const longTransfer = clamp((vehicle.longG || 0) * CG_H / (G * WHEELBASE), -0.36, 0.36);
  const latTransfer = clamp(Math.abs(vehicle.latG || 0) * CG_H / (G * TRACK), 0, 0.5);
  const loadSense = 1 - latTransfer * 0.22;
  const loadF = MASS * G * (LR / WHEELBASE) * (1 - longTransfer);
  const loadR = MASS * G * (LF / WHEELBASE) * (1 + longTransfer);
  const counter = input.steer * vehicle.yawRate < -0.1 && Math.abs(vehicle.yawRate) > 0.2;
  const muF = muBase * loadSense * 0.86 * (counter ? 1.08 : 1);
  const muR = muBase * loadSense * 1.08 * (input.handbrake > 0.45 ? 0.34 : 1);

  const drive = wheelDrive(vehicle, input.throttle, vLong, input.brake);
  const brakeSign = Math.sign(vLong || 1);
  let fxF = -brakeSign * input.brake * 7400;
  let fxR = drive - brakeSign * (input.brake * 4000 + input.handbrake * 1600);
  let fyF = tireLat(slipF, loadF, muF);
  let fyR = tireLat(slipR, loadR, muR);
  [fxF, fyF] = frictionCircle(fxF, fyF, muF * loadF);
  [fxR, fyR] = frictionCircle(fxR, fyR, muR * loadR);

  let drag = 0.47 * vLong * Math.abs(vLong);
  if (speed > 0.45) drag += Math.sign(vLong) * 0.016 * MASS * G;
  if (input.throttle < 0.06 && speed > 1) {
    drag += Math.sign(vLong) * ENGINE_BRAKE[vehicle.gear] * (1 - input.throttle / 0.06);
  }
  if (surface === 'grass') drag += 1.2 * vLong * Math.abs(vLong);
  else if (surface === 'gravel') drag += 0.5 * vLong * Math.abs(vLong);
  if (absLat > 5.55 && absLat < 6.75) drag += 0.36 * vLong * Math.abs(vLong);

  const aProp = (fxF + fxR - drag) / MASS;
  const supportUp = vehicle.airborne
    ? flightSurfaceUp(vehicle.heading, vehicle.airVelocity, vLong)
    : sample.up;
  const frame = orientCompass(vehicle.heading, supportUp);
  const grade = vehicle.airborne ? { long: 0, lat: 0 } : surfaceGravity(sample.up, frame);
  const aLong = clamp(aProp + grade.long, -15, 8.5);
  const aLatTires = (fyF + fyR) / MASS;
  const aLat = clamp(aLatTires + grade.lat, -13, 13);
  const yawAcc = clamp((fyF * LF - fyR * LR) / INERTIA, -4.2, 4.2);
  vehicle.longG = aProp;
  vehicle.latG = aLatTires;
  vehicle.slip = slipR;
  vehicle.burning = input.throttle > 0.72 && drive > muR * loadR * 0.9 && speed < 16;

  vLong += (aLong + vLat * vehicle.yawRate) * h;
  vLat += (aLat - vLong * vehicle.yawRate) * h;
  vehicle.yawRate += yawAcc * h;

  const slipMag = Math.max(Math.abs(slipF), Math.abs(slipR));
  const settled = clamp((0.1 - slipMag) / 0.1, 0, 1);
  const speedHold = clamp((speed - 12) / 24, 0, 1) * settled;
  vehicle.yawRate *= Math.exp(-(0.05 + speedHold * 0.55) * h);
  // Past the tire peak the mass should come back straight once the wheel is released.
  const holding = input.steer * Math.sign(vehicle.yawRate || 0);
  if (input.handbrake < 0.2 && slipMag > 0.24 && holding < 0.45) {
    const assist = clamp((slipMag - 0.24) * 1.15, 0, 1);
    vehicle.yawRate *= 1 - assist * 1.5 * h;
    vLat *= 1 - assist * 2.1 * h;
  }

  const slow = clamp((2.2 - Math.abs(vLong)) / 2.2, 0, 1);
  if (slow > 0 && input.handbrake < 0.3) {
    const kin = (vLong / WHEELBASE) * Math.tan(vehicle.steerAngle);
    vehicle.yawRate = vehicle.yawRate * (1 - slow) + kin * slow;
    vLat *= 1 - slow * 0.7;
  }

  if (Math.abs(vLong) < 0.2 && Math.abs(vLat) < 0.2 && input.throttle < 0.04 && input.brake < 0.04) {
    vLong = 0;
    vLat = 0;
    vehicle.yawRate *= 0.5;
  }

  vLong = clamp(vLong, -8, MAX_SPEED + 1);
  vLat = clamp(vLat, -13, 13);
  vehicle.yawRate = clamp(vehicle.yawRate, -2.15, 2.15);
  vehicle.vLong = vLong;
  vehicle.vLat = vLat;
  vehicle.speed = vLong;
  vehicle.heading = wrapPi(vehicle.heading + vehicle.yawRate * h);

  const stepped = orientCompass(vehicle.heading, sample.up);
  vehicle.compass = stepped;
  vehicle.vx = stepped.forward.x * vLong + stepped.right.x * vLat;
  vehicle.vz = stepped.forward.z * vLong + stepped.right.z * vLat;
  vehicle.x += vehicle.vx * h;
  vehicle.z += vehicle.vz * h;
  contain(vehicle, circuit);
  const planted = circuit.query(vehicle.x, vehicle.z);
  if (!vehicle.airborne) {
    const launch = surfaceLaunch(circuit, sample, vLong, length);
    if (launch && vehicle.lastJumpId !== launch.jump.id) {
      vehicle.airborne = true;
      vehicle.airY = startHeight + 0.02;
      vehicle.airVelocity = launch.vy;
      vehicle.jumps += 1;
      vehicle.lastJumpId = launch.jump.id;
    } else if (vehicle.lastJumpId) {
      const previous = circuit.jumps?.find((jump) => jump.id === vehicle.lastJumpId);
      if (!previous) vehicle.lastJumpId = null;
      else {
        const along = (planted.distance - previous.distance + length) % length;
        const signed = along > length * 0.5 ? along - length : along;
        if (signed > 24 || signed < -12) vehicle.lastJumpId = null;
      }
    }
  }
  if (vehicle.airborne) {
    vehicle.airY += vehicle.airVelocity * h;
    vehicle.airVelocity -= G * h;
    const landingHeight = planted.height + 0.02;
    if (vehicle.airY <= landingHeight && vehicle.airVelocity < 0) {
      const impact = clamp(-vehicle.airVelocity / 8, 0.25, 1);
      vehicle.airborne = false;
      vehicle.airY = landingHeight;
      vehicle.airVelocity = 0;
      vehicle.bumpImpulse = impact;
      vehicle.vLong *= 1 - impact * 0.04;
      vehicle.speed = vehicle.vLong;
    }
  } else {
    vehicle.airY = planted.height + 0.02;
    vehicle.airVelocity = 0;
  }
  const flightUp = vehicle.airborne
    ? flightSurfaceUp(vehicle.heading, vehicle.airVelocity, vehicle.vLong)
    : planted.up;
  vehicle.compass = orientCompass(vehicle.heading, flightUp);
  vehicle.longAccel = vehicle.longG;
  vehicle.latAccel = vehicle.latG;
  vehicle.latSpeed = vehicle.vLat;
}

function surfaceLaunch(circuit, sample, vLong, length) {
  if (!circuit.jumps?.length || !circuit.atDistance) return null;
  const ramp = circuit.atDistance(sample.distance - 7);
  const nose = circuit.atDistance(sample.distance + 6);
  const rampSlope = ramp.tangent?.y || 0;
  const noseSlope = nose.tangent?.y || 0;
  const here = sample.tangent?.y || 0;
  // The lip still carries the ramp's upward speed, and the landing has fallen away.
  if (rampSlope < 0.1 || noseSlope > -0.08 || here > rampSlope - 0.08) return null;
  const jump = circuit.jumps.find((candidate) => {
    if (vLong < candidate.minSpeed) return false;
    const along = (sample.distance - candidate.distance + length) % length;
    const signed = along > length * 0.5 ? along - length : along;
    return signed > -2.5 && signed < 7;
  });
  if (!jump) return null;
  return { jump, vy: Math.max(vLong * rampSlope, 0) };
}

function flightSurfaceUp(heading, airVelocity, vLong) {
  const pitch = Math.atan2(airVelocity, Math.max(Math.abs(vLong), 3));
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  return {
    x: Math.sin(heading) * sp,
    y: cp,
    z: Math.cos(heading) * sp,
  };
}

function wheelDrive(vehicle, throttle, vLong, brake) {
  if (vLong < 0.8 && brake > 0.55 && throttle < 0.12) return -3000 * brake;
  const gear = vehicle.gear;
  const low = SHIFT_UP[gear - 1];
  const high = SHIFT_UP[gear];
  const through = clamp((Math.max(vLong, 0) - low) / Math.max(6, high - low), 0, 1);
  const shape = 0.8 + 0.2 * Math.sin(Math.min(through, 0.94) * Math.PI);
  let force = throttle * GEAR_FORCE[gear] * shape;
  if (vehicle.shiftTimer > 0) force *= 0.08;
  const ratio = clamp(Math.max(vLong, 0) / MAX_SPEED, 0, 1);
  force *= 1 - ratio ** 2 * 0.28;
  return force;
}

function surfaceGravity(up, frame) {
  const ux = up?.x || 0;
  const uy = up?.y ?? 1;
  const uz = up?.z || 0;
  const ontoUp = -G * uy;
  const gx = -ux * ontoUp;
  const gy = -G - uy * ontoUp;
  const gz = -uz * ontoUp;
  const f = frame.forward;
  const r = frame.right;
  return {
    long: gx * f.x + gy * f.y + gz * f.z,
    lat: gx * r.x + gy * r.y + gz * r.z,
  };
}

function contain(vehicle, circuit) {
  const sample = circuit.query(vehicle.x, vehicle.z);
  const lateral = sample.lateral;
  const abs = Math.abs(lateral);
  const wall = circuit.stageId === 'ridge' ? 13 : WALL;
  if (abs <= wall) return;
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
  vehicle.x -= sign * rx * (abs - wall);
  vehicle.z -= sign * rz * (abs - wall);
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
    vehicle.shiftTimer = 0.22;
  } else if (vehicle.gear > 1 && speed < SHIFT_UP[vehicle.gear - 1] - 3.5) {
    vehicle.gear -= 1;
    vehicle.shiftTimer = 0.16;
  }
}

function updateWheels(vehicle, dt, throttle, handbrake) {
  const radius = 0.33;
  const ground = vehicle.vLong / radius;
  const spin = vehicle.burning ? ground + throttle * 28 : ground;
  const follow = 1 - Math.exp(-7 * dt);
  vehicle.frontOmega += (ground - vehicle.frontOmega) * follow;
  const rearTarget = handbrake > 0.45 ? 0 : spin;
  const rearFollow = 1 - Math.exp(-(handbrake > 0.45 ? 14 : 5) * dt);
  vehicle.rearOmega += (rearTarget - vehicle.rearOmega) * rearFollow;
}

function tireLat(slip, load, mu) {
  const slipAbs = Math.abs(slip);
  const early = slipAbs / 0.15;
  const shaped = early <= 1 ? early * (1.05 - 0.05 * early) : 1 / (1 + (early - 1) * 0.22);
  const legacyX = slipAbs / 0.17;
  const legacyFalloff = 1 / (1 + Math.max(0, slipAbs - 0.32) * 1.35);
  const legacy = (legacyX / (1 + legacyX)) * (0.7 + 0.3 * legacyFalloff);
  // Earlier peak than the shipped curve, with the same deep-slide grip.
  const grip = legacy * 0.72 + shaped * 0.34;
  return -Math.sign(slip || 0) * grip * mu * load;
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
