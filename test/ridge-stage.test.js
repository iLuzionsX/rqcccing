import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createCircuit } from '../src/circuit.js';
import { createVehicle, placeVehicle, updateVehicle } from '../src/vehicle.js';

test('Ridgebreak Rally has a high-country route with two ordered jump triggers', () => {
  const circuit = createCircuit(512, 'ridge');

  assert.equal(circuit.stageId, 'ridge');
  assert.equal(circuit.stageName, 'Ridgebreak Rally');
  assert.equal(circuit.jumps.length, 2);
  assert.ok(circuit.length > 900, 'the new course should be a full rally loop');
  assert.ok(circuit.jumps[0].distance < circuit.jumps[1].distance);
  assert.ok(circuit.jumps.every((jump) => jump.minSpeed > 0 && jump.launchSpeed > 0));

  const heights = circuit.samples.map((sample) => sample.point.y);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 45, 'the course should climb and descend through the mountains');
  assert.ok(circuit.samples.filter((sample) => Math.abs(sample.curvature) > 0.025).length > 8, 'the course should include several tight turns');

  let closest = Infinity;
  const samples = circuit.samples;
  for (let i = 0; i < samples.length - 1; i += 3) {
    for (let j = i + 16; j < samples.length - 1; j += 3) {
      const delta = Math.abs(samples[i].distance - samples[j].distance);
      const along = Math.min(delta, circuit.length - delta);
      if (along < 120) continue;
      const separation = Math.hypot(samples[i].point.x - samples[j].point.x, samples[i].point.z - samples[j].point.z);
      if (separation < closest) closest = separation;
    }
  }
  assert.ok(closest > 48, `separate parts of the road should not cross, closest was ${closest.toFixed(1)}m`);

  for (const jump of circuit.jumps) {
    const lip = circuit.atDistance(jump.distance);
    const before = circuit.atDistance(jump.distance - 24);
    const after = circuit.atDistance(jump.distance + 20);
    assert.ok(lip.point.y > before.point.y + 0.7, `${jump.id} should rise into a lip`);
    assert.ok(lip.point.y > after.point.y + 1, `${jump.id} should drop away after the lip`);
  }

  let lakeDistance = Infinity;
  for (const sample of samples) {
    lakeDistance = Math.min(lakeDistance, Math.hypot(sample.point.x - circuit.lake.x, sample.point.z - circuit.lake.z));
  }
  assert.ok(lakeDistance > circuit.lake.radius + 16, 'the tarn should sit beside the road, not on it');
});

test('the coastal course remains the default and has no jump triggers', () => {
  const circuit = createCircuit(256);

  assert.equal(circuit.stageId, 'coast');
  assert.deepEqual(circuit.jumps, []);
});

test('a car takes off at a jump marker and lands back on the road', () => {
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3(0, 0, 1);
  const sampleAt = (z) => ({
    point: new THREE.Vector3(0, 0, z),
    tangent,
    right,
    up,
    distance: z,
    height: 0,
    lateral: 0,
    curvature: 0,
  });
  const circuit = {
    stageId: 'test',
    length: 500,
    jumps: [{ distance: 5, launchSpeed: 10, minSpeed: 1 }],
    query: (_x, z) => sampleAt(z),
    atDistance: (distance) => sampleAt(distance),
  };
  const vehicle = createVehicle('player');
  placeVehicle(vehicle, circuit, 0, 0);

  let sawAirborne = false;
  for (let frame = 0; frame < 240; frame += 1) {
    updateVehicle(vehicle, circuit, 1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, circuit.length);
    sawAirborne ||= vehicle.airborne;
  }

  assert.equal(vehicle.jumps, 1);
  assert.ok(sawAirborne, 'the car should leave the road after the jump marker');
  assert.equal(vehicle.airborne, false, 'the car should settle back onto the road');
  assert.equal(vehicle.airVelocity, 0);
});

test('Ridgebreak crests launch a moving car and it lands on the road', () => {
  const circuit = createCircuit(480, 'ridge');
  const jump = circuit.jumps[1];
  const vehicle = createVehicle('player');
  placeVehicle(vehicle, circuit, jump.distance - 8, 0);
  vehicle.vLong = 24;
  vehicle.speed = 24;

  let sawAirborne = false;
  for (let frame = 0; frame < 400; frame += 1) {
    updateVehicle(vehicle, circuit, 1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, circuit.length);
    sawAirborne ||= vehicle.airborne;
    if (sawAirborne && !vehicle.airborne) break;
  }

  assert.equal(vehicle.jumps, 1);
  assert.ok(sawAirborne, 'the crest should launch the car');
  assert.equal(vehicle.airborne, false, 'the car should be back on the gravel');
});
