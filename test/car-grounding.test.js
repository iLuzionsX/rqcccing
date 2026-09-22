import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createCar } from '../src/car.js';

const carNames = [
  'Subaru Impreza',
  'Lancia Delta',
  'Audi Quattro',
  'Peugeot 205',
  'Toyota Celica',
  'Ford Escort RS1800',
];

const previousDocument = global.document;
global.document = {
  createElement() {
    const gradient = { addColorStop() {} };
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          createRadialGradient() { return gradient; },
          fillRect() {},
        };
      },
    };
  },
};

after(() => {
  if (previousDocument === undefined) delete global.document;
  else global.document = previousDocument;
});

function rallyFixture() {
  const scene = new THREE.Group();
  const rootNode = new THREE.Group();
  rootNode.name = 'RootNode';
  scene.add(rootNode);

  for (const [index, name] of carNames.entries()) {
    const body = new THREE.Group();
    body.name = name;
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(1.7 + index * 0.025, 0.65 + index * 0.01, 3.2 + index * 0.07),
      new THREE.MeshStandardMaterial(),
    );
    chassis.position.y = 0.42 + index * 0.01;
    body.add(chassis);
    rootNode.add(body);

    const wheelPositions = [
      [-0.76, 1.12],
      [0.76, 1.12],
      [-0.76, -1.12],
      [0.76, -1.12],
    ];
    for (const [wheelIndex, [x, z]] of wheelPositions.entries()) {
      const wheel = new THREE.Group();
      wheel.name = 'Wheel_' + wheelIndex;
      wheel.position.set(x, 0.22 + index * 0.005, z);
      const radius = 0.34 + index * 0.003;
      const tireGeometry = new THREE.CylinderGeometry(radius, radius, 0.18, 12);
      tireGeometry.rotateZ(Math.PI / 2);
      wheel.add(new THREE.Mesh(tireGeometry, new THREE.MeshStandardMaterial()));
      rootNode.add(wheel);
    }
  }

  scene.updateMatrixWorld(true);
  return { scene };
}

test('grounds each rally car by its lowest tire point', () => {
  const gltf = rallyFixture();

  for (const name of carNames) {
    const model = createCar(gltf, name);
    model.root.updateMatrixWorld(true);

    const tireBounds = new THREE.Box3();
    for (const spinner of model.spinners) tireBounds.expandByObject(spinner);

    assert.equal(model.spinners.length, 4, name + ' should keep four independent wheels');
    assert.ok(
      Math.abs(tireBounds.min.y) < 1e-6,
      name + ' tire bottoms should meet the ground, got y=' + tireBounds.min.y,
    );
  }
});
