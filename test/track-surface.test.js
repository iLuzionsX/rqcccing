import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createCircuit } from '../src/circuit.js';
import { buildBank, ribbon } from '../src/track.js';

function faceUp(positions, indices, triangle) {
  const at = (index) => new THREE.Vector3(...positions.slice(index * 3, index * 3 + 3));
  const [a, b, c] = indices.slice(triangle * 3, triangle * 3 + 3).map(at);
  return b.sub(a).cross(c.sub(a)).y;
}

test('road, both shoulders and both banks face the camera from above', () => {
  for (const stage of ['coast', 'ridge']) {
    const circuit = createCircuit(256, stage);
    for (const [left, right] of [[-6.05, 6.05], [-5.85, -11.85], [5.85, 11.85]]) {
      const strip = ribbon(circuit.samples, left, right, 0.05, -0.5);
      // Avoid a steep crest; the geometric winding should agree with the
      // upward surface normal anywhere on either course.
      for (const triangle of [20, 80, 180]) {
        assert.ok(faceUp(strip.positions, strip.indices, triangle) > 0,
          `${stage} strip ${left} → ${right} has a downward-facing triangle`);
      }
    }

    const texture = new THREE.Texture();
    const bank = buildBank(circuit, {
      map: texture, normalMap: texture, roughnessMap: texture, aoMap: texture,
    });
    const positions = Array.from(bank.geometry.attributes.position.array);
    const indices = Array.from(bank.geometry.index.array);
    const trianglesPerSide = (circuit.samples.length - 1) * 3 * 2;
    for (const triangle of [20, 80, trianglesPerSide + 20, trianglesPerSide + 80]) {
      assert.ok(faceUp(positions, indices, triangle) > 0,
        `${stage} bank triangle ${triangle} faces downward`);
    }
  }
});
