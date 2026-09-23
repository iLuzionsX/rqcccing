import { clamp, damp, wrapPi } from './util.js';
import { createVehicle, placeVehicle, updateVehicle, separateVehicles, standings } from './vehicle.js';

const LANES = [0, -2.5, 2.5, -1.2, 1.3, 0.6];

export function createRace(circuit) {
  const cars = LANES.map((_, index) => createVehicle(index === 0 ? 'player' : 'ai'));
  cars.forEach((car, index) => {
    const row = Math.floor(index / 2);
    const lateral = index % 2 === 0 ? -2.15 : 2.15;
    placeVehicle(car, circuit, circuit.length - 18 - row * 8, lateral);
    car.lane = LANES[index];
    car.skill = 0.9 + (index === 0 ? 0 : (index % 5) * 0.025);
  });

  return {
    cars,
    phase: 'title',
    countdown: 3.4,
    elapsed: 0,
    finishedOrder: [],
    update(dt, input, locked) {
      if (this.phase === 'countdown') {
        this.countdown -= dt;
        if (this.countdown <= 0) this.phase = 'race';
      }
      const racing = this.phase === 'race' || this.phase === 'finish';
      if (!racing) return;
      this.elapsed += this.phase === 'race' ? dt : 0;
      this.cars.forEach((car, index) => {
        const isPlayer = index === 0;
        const drive = isPlayer && input ? { ...input } : aiInput(car, this.cars, circuit, dt);
        if (this.phase === 'finish' && isPlayer) drive.throttle = 0.15;
        updateVehicle(car, circuit, dt, drive, circuit.length);
        if (car.completed >= 3 && !car.finished) {
          car.finished = true;
          car.finishTime = this.elapsed;
          this.finishedOrder.push(index);
          if (isPlayer) this.phase = 'finish';
        }
      });
      separateVehicles(this.cars);
    },
  };
}

function aiInput(car, cars, circuit, dt) {
  const sample = circuit.query(car.x, car.z);
  const speed = Math.max(car.speed, 0);
  const ridge = circuit.stageId === 'ridge';
  const blocked = cars.some((other) => {
    if (other === car) return false;
    const dx = other.x - car.x;
    const dz = other.z - car.z;
    const forward = Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
    const side = Math.abs(-Math.cos(car.heading) * dx + Math.sin(car.heading) * dz);
    return forward > 0.5 && forward < 9 && side < 2.3;
  });
  if (blocked) car.lane = car.lane > 0 ? (ridge ? -1.15 : -2.15) : (ridge ? 1.15 : 2.15);

  let kappa = 0;
  const brakeLook = ridge ? 26 + speed * 1.35 : 28 + speed * 1.7;
  const brakeStep = ridge ? 5 : 14;
  for (let aheadOf = ridge ? 3 : 10; aheadOf <= brakeLook; aheadOf += brakeStep) {
    kappa = Math.max(kappa, pathCurvature(circuit, car.distance + aheadOf, ridge ? 8 : 18));
  }
  const lane = ridge ? clamp(car.lane, -1.35, 1.35) * (kappa > 0.07 ? 0.15 : 1) : car.lane;
  const steerLook = ridge ? clamp(5.5 + speed * 0.12, 5.5, 11) : 20 + speed * 0.5;
  const aim = circuit.atDistance(car.distance + steerLook);
  const aimX = aim.point.x + (aim.right?.x || 0) * lane;
  const aimZ = aim.point.z + (aim.right?.z || 0) * lane;
  const diff = wrapPi(Math.atan2(aimX - car.x, aimZ - car.z) - car.heading);
  let rawSteer;
  if (ridge) {
    const road = Math.atan2(aim.tangent.x, aim.tangent.z);
    const headingError = wrapPi(road - car.heading);
    const latErr = sample.lateral - lane;
    rawSteer = headingError * 1.35 - Math.atan2(latErr * 1.1, Math.max(speed, 7)) - (car.yawRate || 0) * 0.85;
    if (Math.sign(rawSteer) === Math.sign(car.yawRate || 0) && Math.abs(car.yawRate || 0) > 0.4) rawSteer *= 0.4;
    rawSteer = clamp(rawSteer, -1, 1);
  } else {
    rawSteer = clamp(diff * 2.6 - (car.yawRate || 0) * 0.2, -1, 1);
  }
  car.aiSteer = damp(car.aiSteer || 0, rawSteer, ridge ? 9 : 12, dt || 1 / 60);

  let target = kappa > 0.00045 ? clamp(Math.sqrt(4.3 / kappa), 18, 38) : 38;
  if (ridge) {
    const mu = 0.4;
    const hold = kappa > 0.012 ? Math.sqrt((mu * 9.81) / kappa) : 34;
    const floor = kappa > 0.09 ? 5.2 : 6.4;
    target = clamp(hold * 0.78, floor, 32);
    const latAbs = Math.abs(sample.lateral);
    if (latAbs > 2.6) target = Math.min(target, 15);
    if (latAbs > 4.2) target = Math.min(target, 9);
    target = Math.max(target, crestCarry(circuit, car.distance, kappa));
  }
  if ((aim.tangent?.y || 0) > 0.05) target -= 2;
  if (Math.abs(sample.lateral) > (ridge ? 6.4 : 5.2)) target = Math.min(target, ridge ? 8 : 16);
  if (blocked) target = Math.min(target, ridge ? 14 : 20);

  let throttle = 0.92 * car.skill;
  let brake = 0;
  if (speed > target + (ridge ? 0.25 : 0.4)) {
    throttle = 0;
    brake = clamp((speed - target) / (ridge ? 3.1 : 4.2), ridge ? 0.45 : 0.3, 1);
  } else if (ridge && speed < target - 1.5) {
    throttle = Math.min(1, 0.72 * car.skill + 0.28);
  }
  return { throttle, brake, steer: car.aiSteer, handbrake: 0 };
}

// Keep enough speed to leave a crest, then let the landing corner pull the target back down.
function crestCarry(circuit, distance, upcomingKappa) {
  if (!circuit.jumps?.length || upcomingKappa > 0.055) return 0;
  const length = circuit.length;
  let carry = 0;
  for (const jump of circuit.jumps) {
    let along = (distance - jump.distance + length) % length;
    if (along > length * 0.5) along -= length;
    if (along > -34 && along < 6) carry = Math.max(carry, jump.minSpeed + 1.2);
  }
  return carry;
}

function pathCurvature(circuit, distance, span = 18) {
  const a = circuit.atDistance(distance);
  const b = circuit.atDistance(distance + span);
  const headingA = Math.atan2(a.tangent.x, a.tangent.z);
  const headingB = Math.atan2(b.tangent.x, b.tangent.z);
  return Math.abs(wrapPi(headingB - headingA)) / span;
}

export function raceStandings(race) {
  return standings(race.cars);
}
