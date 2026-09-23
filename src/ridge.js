import * as THREE from 'three';
import { surfaceHeight } from './ground.js';

// Posts, caution boards, crest paint, and wheel tracks for the gravel stage.
export function buildRidgeCourse(circuit) {
  const group = new THREE.Group();
  group.add(buildWheelTracks(circuit));
  group.add(buildCrestPaint(circuit));
  group.add(buildPosts(circuit));
  group.add(buildChevrons(circuit));
  group.add(buildJumpSigns(circuit));
  group.add(buildServiceSign(circuit));
  return group;
}

function buildWheelTracks(circuit) {
  const material = new THREE.MeshStandardMaterial({
    color: 0x3c362f,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const group = new THREE.Group();
  group.add(trackStrip(circuit.samples, -1.7, -0.55, 0.07, material));
  group.add(trackStrip(circuit.samples, 0.55, 1.7, 0.07, material));
  return group;
}

function buildCrestPaint(circuit) {
  const group = new THREE.Group();
  const yellow = stripeMaterial(0xf0c31a);
  const black = stripeMaterial(0x1c1c1c);
  const geo = new THREE.BoxGeometry(10.4, 0.035, 0.72);
  for (const jump of circuit.jumps) {
    for (let i = 0; i < 6; i += 1) {
      const sample = circuit.atDistance(jump.distance - 18 + i * 2.5);
      const mesh = new THREE.Mesh(geo, i % 2 === 0 ? yellow : black);
      mesh.position.copy(sample.point).addScaledVector(sample.up, 0.09);
      orient(mesh, sample);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

function buildPosts(circuit) {
  const geo = new THREE.CylinderGeometry(0.04, 0.055, 1.35, 7);
  const material = new THREE.MeshStandardMaterial({
    map: stakeTexture(),
    roughness: 0.62,
    metalness: 0.02,
  });
  const spacing = 26;
  const count = Math.ceil(circuit.length / spacing) + circuit.jumps.length * 8 + 8;
  const mesh = new THREE.InstancedMesh(geo, material, count);
  const dummy = new THREE.Object3D();
  let placed = 0;
  const put = (sample, lateral) => {
    const at = sample.point.clone().addScaledVector(sample.right, lateral);
    const ground = surfaceHeight(at.x, at.z, circuit);
    dummy.position.set(at.x, ground + 0.68, at.z);
    dummy.quaternion.identity();
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed += 1;
  };
  for (let distance = 12; distance < circuit.length - 12; distance += spacing) {
    const sample = circuit.atDistance(distance);
    put(sample, outsideSign(sample, circuit.centroid) * 7.6);
  }
  for (const jump of circuit.jumps) {
    for (const ahead of [-16, -6, 8]) {
      const sample = circuit.atDistance(jump.distance + ahead);
      put(sample, -7.35);
      put(sample, 7.35);
    }
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildChevrons(circuit) {
  const group = new THREE.Group();
  const map = chevronTexture();
  const material = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.62,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 0.5, metalness: 0.4 });
  for (const sample of cornerSites(circuit)) {
    const side = outsideSign(sample, circuit.centroid);
    for (let i = 0; i < 3; i += 1) {
      const atSample = circuit.atDistance(sample.distance - 4 + i * 4.2);
      const lateral = side * (8.6 + i * 1.5);
      const at = atSample.point.clone().addScaledVector(atSample.right, lateral);
      const ground = surfaceHeight(at.x, at.z, circuit);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), material);
      board.position.set(at.x, ground + 1.15, at.z);
      faceRoad(board, atSample, side);
      board.castShadow = true;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.3, 6), postMaterial);
      post.position.set(at.x, ground + 0.65, at.z);
      post.castShadow = true;
      group.add(board, post);
    }
  }
  return group;
}

function buildJumpSigns(circuit) {
  const group = new THREE.Group();
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2e32, metalness: 0.45, roughness: 0.48 });
  for (const jump of circuit.jumps) {
    const sample = circuit.atDistance(jump.distance - 24);
    const side = outsideSign(sample, circuit.centroid);
    const at = sample.point.clone().addScaledVector(sample.right, side * 9.4);
    const ground = surfaceHeight(at.x, at.z, circuit);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 8), postMaterial);
    post.position.set(at.x, ground + 1.2, at.z);
    post.castShadow = true;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 2.15),
      new THREE.MeshStandardMaterial({
        map: cautionTexture(jump.id === 'eagle-crest' ? 'EAGLE CREST' : 'SWITCHBACK'),
        roughness: 0.7,
      }),
    );
    board.position.set(at.x, ground + 2.35, at.z);
    faceRoad(board, sample, side);
    board.castShadow = true;
    group.add(post, board);
  }
  return group;
}

function buildServiceSign(circuit) {
  const sample = circuit.atDistance(42);
  const side = outsideSign(sample, circuit.centroid);
  const at = sample.point.clone().addScaledVector(sample.right, side * 11.5);
  const ground = surfaceHeight(at.x, at.z, circuit);
  const group = new THREE.Group();
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 2.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2e32, metalness: 0.4, roughness: 0.5 }),
  );
  post.position.set(at.x, ground + 1.1, at.z);
  post.castShadow = true;
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 1.15),
    new THREE.MeshStandardMaterial({ map: serviceTexture(), roughness: 0.62 }),
  );
  board.position.set(at.x, ground + 2.15, at.z);
  faceRoad(board, sample, side);
  group.add(post, board);
  return group;
}

function cornerSites(circuit) {
  const samples = circuit.samples;
  const sites = [];
  for (let i = 10; i < samples.length - 10; i += 1) {
    const curvature = Math.abs(samples[i].curvature);
    if (curvature < 0.02) continue;
    if (curvature < Math.abs(samples[i - 5].curvature) || curvature < Math.abs(samples[i + 5].curvature)) continue;
    const distance = samples[i].distance;
    const crowded = sites.some((site) => {
      const delta = Math.abs(site.distance - distance);
      return Math.min(delta, circuit.length - delta) < 90;
    });
    if (crowded) continue;
    if (distance < 80 || distance > circuit.length - 80) continue;
    sites.push(samples[i]);
  }
  return sites.slice(0, 6);
}

function outsideSign(sample, centroid) {
  const side = sample.right.x * (centroid.x - sample.point.x) + sample.right.z * (centroid.z - sample.point.z);
  return side >= 0 ? -1 : 1;
}

function trackStrip(samples, left, right, lift, material) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const a = sample.point.clone().addScaledVector(sample.right, left);
    const b = sample.point.clone().addScaledVector(sample.right, right);
    a.y += lift;
    b.y += lift;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    normals.push(sample.up.x, sample.up.y, sample.up.z, sample.up.x, sample.up.y, sample.up.z);
  }
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

function stakeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  for (let band = 0; band < 8; band += 1) {
    ctx.fillStyle = band % 2 === 0 ? '#e36a1d' : '#f4f1ea';
    ctx.fillRect(0, band * 16, 32, 16);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function stripeMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

function orient(mesh, sample) {
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent));
}

function faceRoad(mesh, sample, side) {
  const towardRoad = sample.right.clone().multiplyScalar(-side);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(sample.tangent, sample.up, towardRoad));
}

function chevronTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f2c21a';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#161616';
  ctx.lineWidth = 18;
  ctx.strokeRect(12, 12, 232, 232);
  ctx.lineWidth = 28;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(58, 48);
  ctx.lineTo(128, 118);
  ctx.lineTo(198, 48);
  ctx.moveTo(58, 118);
  ctx.lineTo(128, 188);
  ctx.lineTo(198, 118);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function cautionTexture(title) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f0c31a';
  ctx.fillRect(0, 0, 512, 320);
  ctx.strokeStyle = '#161616';
  ctx.lineWidth = 18;
  ctx.strokeRect(14, 14, 484, 292);
  ctx.beginPath();
  ctx.moveTo(256, 48);
  ctx.lineTo(392, 168);
  ctx.lineTo(120, 168);
  ctx.closePath();
  ctx.lineWidth = 16;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(196, 168);
  ctx.lineTo(256, 118);
  ctx.lineTo(316, 168);
  ctx.stroke();
  ctx.fillStyle = '#161616';
  ctx.font = '700 54px Oswald, Arial Narrow, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 236);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function serviceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b2420';
  ctx.fillRect(0, 0, 640, 200);
  ctx.fillStyle = '#d7e2c8';
  ctx.fillRect(0, 0, 16, 200);
  ctx.font = '600 78px Oswald, Arial Narrow, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SERVICE', 336, 100);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
