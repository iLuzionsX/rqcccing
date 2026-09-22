import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCircuit } from '../src/circuit.js';
import { createRace } from '../src/race.js';
import { createVehicle, updateVehicle } from '../src/vehicle.js';

const DT = 1 / 120;

function straightRoad(stageId) {
  return {
    length: 8000,
    stageId,
    query(x, z) {
      return {
        lateral: 0,
        tangent: { x: 0, y: 0, z: 1 },
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        point: { x, y: 0, z },
        height: 0,
        distance: z,
        curvature: 0,
      };
    },
  };
}

function rolling(speed, gear = 3) {
  const car = createVehicle('player');
  car.vLong = speed;
  car.speed = speed;
  car.vz = speed;
  car.gear = gear;
  car.engine = 0.4;
  return car;
}

function drive(car, road, input, seconds, dt = DT) {
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    updateVehicle(car, road, dt, input, road.length);
  }
  return car;
}

test('turn-in builds useful grip and the car settles after steering is released', () => {
  const road = straightRoad();
  const car = rolling(22, 2);
  drive(car, road, { throttle: 0.4, brake: 0, steer: 0.55, handbrake: 0 }, 0.5);

  const peakLateralG = Math.abs(car.latG) / 9.81;
  assert.ok(peakLateralG > 0.7 && peakLateralG < 1.2, `turn-in reached ${peakLateralG.toFixed(2)} g`);
  assert.ok(car.yawRate > 0.4, `yaw response was ${car.yawRate.toFixed(3)} rad/s`);

  let recoveryTime = null;
  for (let elapsed = 0; elapsed < 2.5; elapsed += DT) {
    updateVehicle(car, road, DT, { throttle: 0.4, brake: 0, steer: 0, handbrake: 0 }, road.length);
    if (recoveryTime == null
      && Math.abs(car.yawRate) < 0.1
      && Math.abs(car.slip) < 0.05
      && Math.abs(car.vLat) < 0.5) {
      recoveryTime = elapsed;
    }
  }
  assert.ok(recoveryTime != null, 'yaw and tire slip should settle within 2.5 seconds');
});

test('left and right steering produce matching responses', () => {
  const road = straightRoad();
  const left = drive(rolling(18, 2), road, { throttle: 0.55, brake: 0, steer: 0.5, handbrake: 0 }, 0.8);
  const right = drive(rolling(18, 2), road, { throttle: 0.55, brake: 0, steer: -0.5, handbrake: 0 }, 0.8);

  assert.ok(left.heading > 0 && right.heading < 0);
  assert.ok(Math.abs(left.heading + right.heading) < 0.03, `headings were ${left.heading.toFixed(3)} and ${right.heading.toFixed(3)}`);
  assert.ok(Math.abs(left.yawRate + right.yawRate) < 0.03, `yaw rates were ${left.yawRate.toFixed(3)} and ${right.yawRate.toFixed(3)}`);
});

test('handling stays consistent at 30, 60, and 120 updates per second', () => {
  const results = [30, 60, 120].map((fps) => {
    const road = straightRoad();
    const car = rolling(22);
    drive(car, road, { throttle: 0.4, brake: 0, steer: 0.35, handbrake: 0 }, 2, 1 / fps);
    return car;
  });

  for (const car of results.slice(1)) {
    assert.ok(Math.abs(car.speed - results[0].speed) < 0.03);
    assert.ok(Math.abs(car.yawRate - results[0].yawRate) < 0.03);
    assert.ok(Math.abs(car.heading - results[0].heading) < 0.03);
  }
});

test('the Ridgebreak gravel stage gives up grip progressively', () => {
  const asphalt = drive(rolling(18), straightRoad(), { throttle: 0.15, brake: 0, steer: 0.3, handbrake: 0 }, 1.5);
  const gravel = drive(rolling(18), straightRoad('ridge'), { throttle: 0.15, brake: 0, steer: 0.3, handbrake: 0 }, 1.5);
  const asphaltG = Math.abs(asphalt.latG);
  const gravelG = Math.abs(gravel.latG);

  assert.ok(gravelG < asphaltG * 0.8, `gravel ${gravelG.toFixed(2)} m/s² vs asphalt ${asphaltG.toFixed(2)} m/s²`);
  assert.ok(gravelG > asphaltG * 0.4, `gravel should remain controllable, got ${gravelG.toFixed(2)} m/s²`);
});

test('Ridgebreak AI stays inside the mountain runoff while it learns the switchbacks', () => {
  const circuit = createCircuit(420, 'ridge');
  const race = createRace(circuit);
  race.phase = 'race';
  let worstExcursion = 0;

  for (let frame = 0; frame < 60 * 60; frame += 1) {
    race.update(1 / 60, null);
    for (const car of race.cars) {
      worstExcursion = Math.max(worstExcursion, Math.abs(circuit.query(car.x, car.z).lateral));
    }
  }

  assert.ok(worstExcursion < 13, `furthest excursion was ${worstExcursion.toFixed(2)}m`);
  assert.ok(race.cars.some((car) => car.distance > 500), 'the field should keep progressing around the stage');
});
