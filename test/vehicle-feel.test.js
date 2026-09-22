import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCircuit } from '../src/circuit.js';
import { createRace } from '../src/race.js';
import { createVehicle, updateVehicle } from '../src/vehicle.js';

const DT = 1 / 60;

function flatRoad() {
  return {
    length: 8000,
    query(x, z) {
      return {
        lateral: 0,
        tangent: { x: 0, y: 0, z: 1 },
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        point: { x, y: 0, z },
        distance: 0,
        curvature: 0,
      };
    },
  };
}

function gradeRoad(grade) {
  const horizontal = Math.sqrt(Math.max(0, 1 - grade * grade));
  const tangent = { x: 0, y: grade, z: horizontal };
  const up = { x: 0, y: horizontal, z: -grade };
  return {
    length: 8000,
    query(x, z) {
      return {
        lateral: 0,
        tangent,
        right: { x: 1, y: 0, z: 0 },
        up,
        point: { x, y: 0, z },
        distance: 0,
        curvature: 0,
      };
    },
  };
}

function drive(car, road, input, seconds) {
  for (let time = 0; time < seconds; time += DT) {
    updateVehicle(car, road, DT, input, road.length);
  }
  return car;
}

function rolling(speed, gear) {
  const car = createVehicle('player');
  car.vLong = speed;
  car.speed = speed;
  car.vz = speed;
  car.gear = gear;
  car.engine = 0.4;
  return car;
}

test('takes a realistic run to reach 100 km/h and keeps accelerating after', () => {
  const car = drive(createVehicle('player'), flatRoad(), {
    throttle: 1, brake: 0, steer: 0, handbrake: 0,
  }, 8);
  let reached = null;
  const timed = createVehicle('player');
  const road = flatRoad();
  for (let time = 0; time < 10; time += DT) {
    updateVehicle(timed, road, DT, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, road.length);
    if (reached == null && timed.speed >= 100 / 3.6) reached = time;
  }
  assert.ok(reached > 4.6 && reached < 6.6, `0-100 was ${reached?.toFixed(2)}s`);
  assert.ok(car.speed * 3.6 > 115, `speed at 8s was ${(car.speed * 3.6).toFixed(0)} km/h`);
  assert.ok(car.speed * 3.6 < 150, `speed at 8s was ${(car.speed * 3.6).toFixed(0)} km/h`);
});

test('brakes from 100 km/h in a long, weighty stop', () => {
  const road = flatRoad();
  const car = rolling(100 / 3.6, 3);
  const start = car.z;
  let elapsed = 0;
  while (car.speed > 1 && elapsed < 8) {
    updateVehicle(car, road, DT, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, road.length);
    elapsed += DT;
  }
  const distance = car.z - start;
  assert.ok(distance > 38 && distance < 52, `stopping distance was ${distance.toFixed(1)}m`);
  assert.ok(elapsed > 2.5 && elapsed < 4.2, `stopping time was ${elapsed.toFixed(2)}s`);
});

test('yaw builds as the mass takes a set, then straightens when the wheel is released', () => {
  const road = flatRoad();
  const car = rolling(22, 2);
  const yawAt = [];
  let time = 0;
  while (time < 0.5) {
    updateVehicle(car, road, DT, { throttle: 0.5, brake: 0, steer: 1, handbrake: 0 }, road.length);
    time += DT;
    if (Math.abs(time - 0.12) < DT / 2) yawAt.push(Math.abs(car.yawRate));
    if (Math.abs(time - 0.48) < DT / 2) yawAt.push(Math.abs(car.yawRate));
  }
  assert.equal(yawAt.length, 2);
  assert.ok(yawAt[0] < yawAt[1] * 0.55, `yaw jumped from ${yawAt[0].toFixed(3)} to ${yawAt[1].toFixed(3)}`);
  drive(car, road, { throttle: 0.35, brake: 0, steer: 0, handbrake: 0 }, 1.5);
  assert.ok(Math.abs(car.yawRate) < 0.2, `yaw settled at ${car.yawRate.toFixed(3)}`);
  assert.ok(Math.abs(car.slip) < 0.2, `slip settled at ${car.slip.toFixed(3)}`);
});

test('full lock turns the car without spinning it', () => {
  const car = rolling(18, 2);
  drive(car, flatRoad(), { throttle: 0.55, brake: 0, steer: 1, handbrake: 0 }, 1.6);
  assert.ok(car.heading > 0.3 && car.heading < 1.3, `heading changed by ${car.heading.toFixed(2)} rad`);
});

test('a low gear sheds more speed on a closed throttle than a high gear', () => {
  const coast = (gear, speed) => {
    const car = rolling(speed, gear);
    car.engine = 0;
    drive(car, flatRoad(), { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, 2);
    return (speed - car.speed) / 2;
  };
  const second = coast(2, 20);
  const fourth = coast(4, 40);
  assert.ok(second > fourth + 0.2, `2nd decel ${second.toFixed(2)} vs 4th ${fourth.toFixed(2)}`);
});

test('an uphill grade costs speed', () => {
  const input = { throttle: 1, brake: 0, steer: 0, handbrake: 0 };
  const flat = drive(createVehicle('player'), flatRoad(), input, 4);
  const climb = drive(createVehicle('player'), gradeRoad(0.08), input, 4);
  assert.ok(flat.speed - climb.speed > 1.5, `flat ${flat.speed.toFixed(1)} climb ${climb.speed.toFixed(1)}`);
});

test('holds a straight line under power', () => {
  const car = drive(createVehicle('player'), flatRoad(), {
    throttle: 1, brake: 0, steer: 0, handbrake: 0,
  }, 6);
  assert.ok(Math.abs(car.x) < 0.4, `drifted to x ${car.x.toFixed(2)}`);
  assert.ok(Math.abs(car.vLat) < 0.3);
});

test('the handbrake rotates the car instead of only slowing it', () => {
  const car = rolling(16, 2);
  drive(car, flatRoad(), { throttle: 0.2, brake: 0, steer: 0.8, handbrake: 1 }, 1.1);
  assert.ok(car.heading > 0.45, `heading only reached ${car.heading.toFixed(2)}`);
  assert.ok(car.speed * 3.6 < 70, 'handbrake did not scrub speed');
});

test('the field can race the stage without leaving the road', () => {
  const circuit = createCircuit(420);
  const race = createRace(circuit);
  race.phase = 'race';
  let worst = 0;
  for (let time = 0; time < 40; time += DT) {
    race.update(DT, null);
    for (const car of race.cars) {
      worst = Math.max(worst, Math.abs(circuit.query(car.x, car.z).lateral));
    }
  }
  assert.ok(worst < 5.6, `furthest excursion was ${worst.toFixed(2)}m`);
  assert.ok(race.cars.some((car) => car.distance > 400 || car.completed > 0));
});
