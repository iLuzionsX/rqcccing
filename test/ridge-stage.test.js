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
