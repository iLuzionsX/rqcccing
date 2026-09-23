import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  WHEEL_LOCK,
  createWheelState,
  dragWheel,
  grabWheel,
  pointerSample,
  releaseWheel,
  springWheel,
  wheelSteer,
} from '../src/wheel.js';

const rect = { left: 20, top: 400, width: 148, height: 148 };

function at(degrees, radius = 60) {
  const rad = degrees * Math.PI / 180;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return {
    x: cx + Math.sin(rad) * radius,
    y: cy - Math.cos(rad) * radius,
  };
}

test('full lock is a quarter turn and the output is linear past a small deadzone', () => {
  assert.ok(Math.abs(WHEEL_LOCK - Math.PI / 2) < 1e-9);
  assert.equal(wheelSteer(0), 0);
  assert.equal(wheelSteer(WHEEL_LOCK * 0.03), 0);
  assert.equal(wheelSteer(-WHEEL_LOCK * 0.03), 0);
  const half = wheelSteer(WHEEL_LOCK / 2);
  assert.ok(half > 0.45 && half < 0.5, `half lock should be just under 0.5, got ${half}`);
  assert.equal(wheelSteer(WHEEL_LOCK), 1);
  assert.equal(wheelSteer(-WHEEL_LOCK), -1);
  assert.equal(wheelSteer(WHEEL_LOCK * 2), 1);
});

test('a grab keeps the current angle and a drag adds the finger motion', () => {
  const state = createWheelState();
  state.rotation = 0.4;
  const grabbed = grabWheel(state, pointerSample(at(80).x, at(80).y, rect));
  assert.equal(grabbed.rotation, 0.4);
  assert.equal(grabbed.held, true);

  const moved = dragWheel(grabbed, pointerSample(at(80 + 40).x, at(80 + 40).y, rect));
  assert.ok(Math.abs(moved.rotation - (0.4 + 40 * Math.PI / 180)) < 0.02);
});

test('the wheel stops at a quarter turn and does not wrap past lock', () => {
  const state = grabWheel(createWheelState(), pointerSample(at(0).x, at(0).y, rect));
  dragWheel(state, pointerSample(at(70).x, at(70).y, rect));
  dragWheel(state, pointerSample(at(140).x, at(140).y, rect));
  assert.equal(state.rotation, WHEEL_LOCK);
  dragWheel(state, pointerSample(at(100).x, at(100).y, rect));
  assert.ok(state.rotation < WHEEL_LOCK);
  assert.ok(state.rotation > 0);
});

test('crossing the bottom of the wheel does not spin it a full turn', () => {
  const state = grabWheel(createWheelState(), pointerSample(at(170).x, at(170).y, rect));
  dragWheel(state, pointerSample(at(-170).x, at(-170).y, rect));
  assert.ok(Math.abs(state.rotation - (20 * Math.PI / 180)) < 0.05, state.rotation);
});

test('a thumb on the hub does not flip the wheel', () => {
  const state = grabWheel(createWheelState(), pointerSample(at(20).x, at(20).y, rect));
  dragWheel(state, pointerSample(at(50).x, at(50).y, rect));
  const held = state.rotation;
  const center = pointerSample(rect.left + rect.width / 2, rect.top + rect.height / 2, rect);
  assert.equal(center.onHub, true);
  dragWheel(state, center);
  assert.equal(state.rotation, held);
  dragWheel(state, pointerSample(at(50).x, at(50).y, rect));
  assert.equal(state.rotation, held);
});

test('letting go springs the wheel back to center', () => {
  const state = releaseWheel({ ...createWheelState(), rotation: WHEEL_LOCK, held: true });
  assert.equal(state.held, false);
  let rotation = state.rotation;
  for (let i = 0; i < 20; i += 1) rotation = springWheel(rotation, 1 / 60);
  assert.ok(Math.abs(rotation) < WHEEL_LOCK * 0.15, rotation);
  rotation = springWheel(0.005, 1 / 60);
  assert.equal(rotation, 0);
});
