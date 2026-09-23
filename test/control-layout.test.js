import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clampCenter,
  clearLayout,
  readLayout,
  separateControls,
  writeLayout,
} from '../src/control-layout.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

test('nothing is stored until a control actually moves', () => {
  const storage = memoryStorage();
  assert.equal(readLayout(storage), null);
});

test('saved fractions come back and a broken record is ignored', () => {
  const storage = memoryStorage();
  const layout = {
    wheel: { x: 0.2, y: 0.8 },
    gas: { x: 0.86, y: 0.78 },
    brake: { x: 0.7, y: 0.78 },
    handbrake: { x: 0.78, y: 0.62 },
  };
  assert.equal(writeLayout(storage, layout), true);
  assert.deepEqual(readLayout(storage), layout);
  storage.setItem('rqcccing.controlLayout', JSON.stringify({ wheel: { x: 2, y: 0.5 } }));
  assert.equal(readLayout(storage), null);
  clearLayout(storage);
  assert.equal(readLayout(storage), null);
});

test('a dragged control stays on screen and off the others', () => {
  const fitted = clampCenter(-40, 900, 148, 148, 390, 700, 8);
  assert.ok(fitted.x >= 8 + 74);
  assert.ok(fitted.y <= 700 - 8 - 74);
  const sizes = {
    wheel: { w: 148, h: 148 },
    gas: { w: 82, h: 82 },
    brake: { w: 82, h: 82 },
    handbrake: { w: 64, h: 64 },
  };
  const centers = {
    wheel: { x: 200, y: 500 },
    gas: { x: 210, y: 510 },
    brake: { x: 90, y: 500 },
    handbrake: { x: 200, y: 360 },
  };
  const moved = separateControls('gas', centers, sizes, { w: 390, h: 700 });
  const dx = moved.x - centers.wheel.x;
  const dy = moved.y - centers.wheel.y;
  const minX = (sizes.gas.w + sizes.wheel.w) / 2 * 0.82;
  const minY = (sizes.gas.h + sizes.wheel.h) / 2 * 0.82;
  assert.ok(Math.abs(dx) >= minX - 1 || Math.abs(dy) >= minY - 1, 'gas should not sit on the wheel');
  assert.ok(moved.x > 8 && moved.x < 382);
  assert.ok(moved.y > 8 && moved.y < 692);
});
