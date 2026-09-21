import { clamp, wrapPi } from './util.js';
import { orientCompass } from './compass.js';
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
  const look = 16 + Math.max(car.speed, 0) * 0.55;
  const ahead = circuit.atDistance(car.distance + look);
  const targetX = ahead.point.x + ahead.right.x * car.lane;
  const targetZ = ahead.point.z + ahead.right.z * car.lane;
  const frame = car.compass || orientCompass(car.heading);
  const desired = Math.atan2(targetX - car.x, targetZ - car.z);
  const diff = wrapPi(desired - car.heading);
  const blocked = cars.some((other) => {
    if (other === car) return false;
    const dx = other.x - car.x;
    const dz = other.z - car.z;
    const forward = frame.forward.x * dx + frame.forward.z * dz;
    const side = Math.abs(frame.right.x * dx + frame.right.z * dz);
    return forward > 0 && forward < 8 && side < 2.1;
  });
  if (blocked) car.lane = car.lane > 0 ? -2.2 : 2.2;

  const curvature = Math.abs(ahead.curvature || 0);
  let throttle = 0.98 * car.skill;
  let brake = 0;
  if (curvature > 0.02 && car.speed > 30) {
    throttle = 0.1;
    brake = car.speed > 38 ? 0.75 : 0.2;
  } else if (curvature > 0.012 && car.speed > 44) {
    throttle = 0.4;
    brake = car.speed > 52 ? 0.35 : 0;
  }
  if (Math.abs(car.slip) > 0.45 && car.speed > 16) throttle = Math.min(throttle, 0.25);
  if (blocked && car.speed > 18) throttle = 0.15;
  return {
    throttle: clamp(throttle, 0, 1),
    brake,
    steer: clamp(diff * 2.1, -1, 1),
    handbrake: 0,
  };
}

export function raceStandings(race) {
  return standings(race.cars);
}
