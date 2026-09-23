import assert from 'node:assert/strict';
import { test } from 'node:test';
import { engineRpm, scrubAmount, surfaceKind } from '../src/audio.js';

test('engine rpm follows the gear and drops when the next gear takes over', () => {
  const low = engineRpm(8, 1);
  const high = engineRpm(18, 1);
  assert.ok(high > low + 0.15, `rpm should climb in gear, ${low.toFixed(2)} to ${high.toFixed(2)}`);
  const beforeShift = engineRpm(13.4, 1);
  const afterShift = engineRpm(13.6, 2);
  assert.ok(afterShift < beforeShift - 0.2, `shift should drop rpm ${beforeShift.toFixed(2)} to ${afterShift.toFixed(2)}`);
});

test('a straight roll stays quiet and a slide or handbrake does not', () => {
  assert.equal(scrubAmount(0.02, 0, 16), 0);
  assert.ok(scrubAmount(0.4, 0, 16) > 0.6);
  assert.ok(scrubAmount(0.02, 1, 16) > 0.7);
  assert.equal(scrubAmount(0.5, 1, 0.2), 0);
});

test('Golden Hour asphalt and Ridgebreak gravel are different surfaces', () => {
  assert.equal(surfaceKind('coast', 0), 'asphalt');
  assert.equal(surfaceKind('ridge', 0), 'gravel');
  assert.equal(surfaceKind('coast', 7), 'grass');
});
