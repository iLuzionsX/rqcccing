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
  const blocked = cars.some((other) => {
    if (other === car) return false;
    const dx = other.x - car.x;
    const dz = other.z - car.z;
    const forward = Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
    const side = Math.abs(-Math.cos(car.heading) * dx + Math.sin(car.heading) * dz);
    return forward > 0.5 && forward < 9 && side < 2.3;
  });
  if (blocked) car.lane = car.lane > 0 ? -2.15 : 2.15;

  const steerLook = 20 + speed * 0.5;
  const aim = circuit.atDistance(car.distance + steerLook);
  const aimX = aim.point.x + (aim.right?.x || 0) * car.lane;
  const aimZ = aim.point.z + (aim.right?.z || 0) * car.lane;
  const diff = wrapPi(Math.atan2(aimX - car.x, aimZ - car.z) - car.heading);
  const rawSteer = clamp(diff * 2.6 - (car.yawRate || 0) * 0.2, -1, 1);
  car.aiSteer = damp(car.aiSteer || 0, rawSteer, 12, dt || 1 / 60);

  let kappa = 0;
  const brakeLook = 28 + speed * 1.7;
  for (let aheadOf = 10; aheadOf <= brakeLook; aheadOf += 14) {
    kappa = Math.max(kappa, pathCurvature(circuit, car.distance + aheadOf));
  }
  let target = kappa > 0.00045 ? clamp(Math.sqrt(4.3 / kappa), 18, 38) : 38;
  if (circuit.stageId === 'ridge') target = Math.min(target, kappa > 0.01 ? 20 : 34);
  if ((aim.tangent?.y || 0) > 0.05) target -= 2;
  if (Math.abs(sample.lateral) > 5.2) target = Math.min(target, 16);
  if (blocked) target = Math.min(target, 20);

  let throttle = 0.92 * car.skill;
  let brake = 0;
  if (speed > target + 0.4) {
    throttle = 0;
    brake = clamp((speed - target) / 4.2, 0.3, 1);
  }
  return { throttle, brake, steer: car.aiSteer, handbrake: 0 };
}

function pathCurvature(circuit, distance) {
  const span = 18;
  const a = circuit.atDistance(distance);
  const b = circuit.atDistance(distance + span);
  const headingA = Math.atan2(a.tangent.x, a.tangent.z);
  const headingB = Math.atan2(b.tangent.x, b.tangent.z);
  return Math.abs(wrapPi(headingB - headingA)) / span;
}

export function raceStandings(race) {
  return standings(race.cars);
}
