import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  displayedCountdown,
  formatTime,
  gearLabel,
  readBestLap,
  stageDistanceText,
  writeBestLap,
} from '../src/readout.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

test('the countdown display never climbs past 3', () => {
  assert.equal(displayedCountdown(3.4), '3');
  assert.equal(displayedCountdown(3), '3');
  assert.equal(displayedCountdown(2.01), '3');
  assert.equal(displayedCountdown(2), '2');
  assert.equal(displayedCountdown(1.01), '2');
  assert.equal(displayedCountdown(0.2), '1');
  assert.equal(displayedCountdown(0), '');
});

test('reverse shows R once the car is actually moving backward', () => {
  assert.equal(gearLabel(0, 0, 1), 'N');
  assert.equal(gearLabel(-0.4, -0.4, 1), 'N');
  assert.equal(gearLabel(-8, -8, 1), 'R');
  assert.equal(gearLabel(12, 12, 2), '2');
});

test('one best lap is kept per stage and a slower lap does not replace it', () => {
  const storage = memoryStorage();
  assert.equal(readBestLap(storage, 'coast'), null);
  assert.equal(writeBestLap(storage, 'coast', 88.2), 88.2);
  assert.equal(writeBestLap(storage, 'coast', 91), 88.2);
  assert.equal(writeBestLap(storage, 'ridge', 102.5), 102.5);
  assert.equal(writeBestLap(storage, 'coast', 80.25), 80.25);
  assert.equal(readBestLap(storage, 'coast'), 80.25);
  assert.equal(readBestLap(storage, 'ridge'), 102.5);
  assert.deepEqual(JSON.parse(storage.getItem('rqcccing.bestLap')), {
    coast: 80.25,
    ridge: 102.5,
  });
});

test('stored records that are not a stage id and a time are ignored', () => {
  const storage = memoryStorage({
    'rqcccing.bestLap': JSON.stringify({
      coast: 70,
      ridge: 'fast',
      name: 'Ada',
      ghost: [1, 2, 3],
    }),
  });
  assert.equal(readBestLap(storage, 'coast'), 70);
  assert.equal(readBestLap(storage, 'ridge'), null);
  writeBestLap(storage, 'ridge', 99);
  assert.deepEqual(JSON.parse(storage.getItem('rqcccing.bestLap')), {
    coast: 70,
    ridge: 99,
  });
});

test('a blocked store leaves the session without a saved lap', () => {
  const storage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(readBestLap(storage, 'coast'), null);
  assert.equal(writeBestLap(storage, 'coast', 40), null);
});

test('the garage distance keeps the stage length and appends the saved lap', () => {
  assert.equal(stageDistanceText(2140, null), '2.14 KM');
  assert.equal(stageDistanceText(2140, 83.456), `2.14 KM\nBEST ${formatTime(83.456)}`);
  assert.equal(formatTime(83.456), '1:23.456');
});
