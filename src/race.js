import { clamp, wrapPi } from './util.js';
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
        const drive = isPlayer && input ? { ...input } : aiInput(car, this.cars, circuit);
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

function aiInput(car, cars, circuit) {
  const sample = circuit.query(car.x, car.z);
  const speed = Math.max(car.speed, 0);
  const look = 13 + speed * 0.72;
  const ahead = circuit.atDistance(car.distance + look);
  const blocked = cars.some((other) => {
    if (other === car) return false;
    const dx = other.x - car.x;
    const dz = other.z - car.z;
    const forward = Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
    const side = Math.abs(-Math.cos(car.heading) * dx + Math.sin(car.heading) * dz);
    return forward > 0.5 && forward < 9 && side < 2.3;
  });
  if (blocked) car.lane = car.lane > 0 ? -2.15 : 2.15;

  const targetX = ahead.point.x + ahead.right.x * car.lane;
  const targetZ = ahead.point.z + ahead.right.z * car.lane;
  let diff = wrapPi(Math.atan2(targetX - car.x, targetZ - car.z) - car.heading);
  diff -= clamp((sample.lateral - car.lane) * 0.11, -0.45, 0.45);
  const steer = clamp(diff * 2.15 - (car.yawRate || 0) * 0.42, -1, 1);

  const near = circuit.atDistance(car.distance + 8 + speed * 0.28);
  const curvature = Math.max(Math.abs(ahead.curvature || 0), Math.abs(near.curvature || 0));
  const ridge = circuit.stageId === 'ridge';
  let target = ridge ? 48 : 62;
  if (curvature > 0.12) target = ridge ? 16 : 22;
  else if (curvature > 0.06) target = ridge ? 22 : 30;
  else if (curvature > 0.03) target = ridge ? 29 : 40;
  else if (curvature > 0.014) target = ridge ? 38 : 50;
  if (Math.abs(sample.lateral) > 4.4) target = Math.min(target, ridge ? 21 : 28);
  if (blocked) target = Math.min(target, 36);

  let throttle = 0.94 * car.skill;
  let brake = 0;
  if (speed > target + 0.8) {
    throttle = 0.04;
    brake = clamp((speed - target) / 16, 0, 1);
  }
  return { throttle, brake, steer, handbrake: 0 };
}

export function raceStandings(race) {
  return standings(race.cars);
}
