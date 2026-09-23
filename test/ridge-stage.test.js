import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { crestLift, createCircuit } from '../src/circuit.js';
import { createVehicle, placeVehicle, updateVehicle } from '../src/vehicle.js';
import { clamp, wrapPi } from '../src/util.js';

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

test('both Ridgebreak jumps rise into a lip and drop away on the landing', () => {
  const circuit = createCircuit(512, 'ridge');
  assert.ok(circuit.jumps[1].distance - circuit.jumps[0].distance > 80, 'the crests should stay separate');

  for (const jump of circuit.jumps) {
    const approach = circuit.atDistance(jump.distance - 18).point.y;
    const lip = circuit.atDistance(jump.distance).point.y;
    const landing = circuit.atDistance(jump.distance + 12).point.y;
    assert.ok(lip > approach + 1.4, `${jump.id} should climb into a lip`);
    assert.ok(landing < lip - 1.4, `${jump.id} should fall away after the lip`);
  }
});

test('a car takes off on the crest and lands back on the road', () => {
  const lip = 48;
  const length = 500;
  const sampleAt = (distance) => {
    const z = ((distance % length) + length) % length;
    const along = z - lip;
    const y = crestLift(along);
    const pitch = Math.atan2(crestLift(along + 0.35) - crestLift(along - 0.35), 0.7);
    const ty = Math.sin(pitch);
    const tz = Math.cos(pitch);
    return {
      point: new THREE.Vector3(0, y, z),
      tangent: new THREE.Vector3(0, ty, tz),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, tz, -ty),
      distance: z,
      height: y,
      lateral: 0,
      curvature: 0,
    };
  };
  const circuit = {
    stageId: 'ridge',
    length,
    jumps: [{ id: 'lip', distance: lip, launchSpeed: 8, minSpeed: 1 }],
    query: (_x, z) => sampleAt(z),
    atDistance: (distance) => sampleAt(distance),
  };
  const vehicle = createVehicle('player');
  placeVehicle(vehicle, circuit, 0, 0);

  let sawAirborne = false;
  let peakAir = 0;
  for (let frame = 0; frame < 420; frame += 1) {
    updateVehicle(vehicle, circuit, 1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, circuit.length);
    sawAirborne ||= vehicle.airborne;
    if (vehicle.airborne) peakAir = Math.max(peakAir, vehicle.airY - crestLift(vehicle.z - lip));
  }

  assert.equal(vehicle.jumps, 1);
  assert.ok(sawAirborne, 'the car should leave the road when the crest falls away');
  assert.ok(peakAir > 0.35, 'the car should clear the landing face');
  assert.equal(vehicle.airborne, false, 'the car should settle back onto the road');
  assert.equal(vehicle.airVelocity, 0);
});

test('each crest launches from the lip and lands inside the ridge wall', () => {
  const circuit = createCircuit(420, 'ridge');
  for (const jump of circuit.jumps) {
    const vehicle = createVehicle('player');
    placeVehicle(vehicle, circuit, jump.distance - 28, 0);
    const speed = Math.max(14, jump.minSpeed);
    vehicle.vLong = speed;
    vehicle.speed = speed;
    vehicle.gear = 2;
    vehicle.engine = 0.5;
    vehicle.vx = Math.sin(vehicle.heading) * speed;
    vehicle.vz = Math.cos(vehicle.heading) * speed;

    let sawAirborne = false;
    let worst = 0;
    let clearance = 0;
    for (let frame = 0; frame < 240; frame += 1) {
      const aim = circuit.atDistance(vehicle.distance + 8);
      const diff = wrapPi(Math.atan2(aim.point.x - vehicle.x, aim.point.z - vehicle.z) - vehicle.heading);
      const steer = clamp(diff * 2.1 - vehicle.yawRate * 0.5, -0.7, 0.7);
      updateVehicle(vehicle, circuit, 1 / 60, {
        throttle: vehicle.vLong < speed ? 0.7 : 0.35,
        brake: 0,
        steer,
        handbrake: 0,
      }, circuit.length);
      const sample = circuit.query(vehicle.x, vehicle.z);
      worst = Math.max(worst, Math.abs(sample.lateral));
      if (vehicle.airborne) {
        sawAirborne = true;
        clearance = Math.max(clearance, vehicle.airY - sample.height);
      }
    }

    assert.ok(sawAirborne, `${jump.id} should leave the ground on the lip`);
    assert.ok(vehicle.jumps >= 1, `${jump.id} should count a jump`);
    assert.equal(vehicle.airborne, false, `${jump.id} should land`);
    assert.ok(clearance > 0.3, `${jump.id} clearance was ${clearance.toFixed(2)}m`);
    assert.ok(worst < 13, `${jump.id} left the wall at ${worst.toFixed(2)}m`);
  }
});
