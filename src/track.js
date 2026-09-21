import * as THREE from 'three';
import { clamp } from './util.js';

export function createTrack(scene, circuit, textures) {
  const road = buildRoad(circuit, textures);
  scene.add(road);

  const shoulders = buildShoulders(circuit);
  scene.add(shoulders);

  const curbs = buildCurbs(circuit);
  scene.add(curbs);

  const barriers = buildBarriers(circuit);
  scene.add(barriers.mesh);

  const lamps = buildLamps(circuit);
  scene.add(lamps);

  const gantry = buildGantry(circuit);
  scene.add(gantry.group);

  const crowd = buildGrandstand(circuit);
  scene.add(crowd);

  const dressing = buildDressing(circuit);
  scene.add(dressing.group);

  const line = buildStartLine(circuit);
  scene.add(line);
  scene.add(buildMarkings(circuit));

  return {
    setLights(mode) {
      const on = mode === 'green' ? 0x39ff7a : 0xff2a2a;
      const intensity = mode === 'off' ? 0.2 : mode === 'green' ? 10 : 6;
      for (const material of gantry.lights) {
        material.color.set(mode === 'green' ? on : 0xff2a2a);
        material.emissive.set(mode === 'green' ? on : 0xff1a1a);
        material.emissiveIntensity = intensity;
      }
    },
    update(dt) {
      dressing.update(dt);
    },
  };
}

function buildRoad(circuit, textures) {
  const { positions, normals, uvs, indices } = ribbon(circuit.samples, -6, 6, 0.06, 0.06);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeTangents();

  const material = new THREE.MeshPhysicalMaterial({
    map: textures.colorMap,
    normalMap: textures.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: textures.roughnessMap,
    roughness: 1,
    metalness: 0.08,
    clearcoat: 0.85,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.5,
    anisotropy: 0.8,
    anisotropyRotation: Math.PI / 2,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function buildShoulders(circuit) {
  const left = ribbon(circuit.samples, -6, -10.4, 0.05, -0.95);
  const right = ribbon(circuit.samples, 6, 10.4, 0.05, -0.95);
  const geo = new THREE.BufferGeometry();
  const positions = left.positions.concat(right.positions);
  const normals = left.normals.concat(right.normals);
  const colors = left.colors.concat(right.colors);
  const offset = left.positions.length / 3;
  const indices = left.indices.concat(right.indices.map((index) => index + offset));
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

function ribbon(samples, left, right, leftLift, rightLift) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const gravel = new THREE.Color(0x6d6458);
  const grass = new THREE.Color(0x5d7a3e);
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const a = s.point.clone().addScaledVector(s.right, left).addScaledVector(s.up, leftLift);
    const b = s.point.clone().addScaledVector(s.right, right).addScaledVector(s.up, rightLift);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    normals.push(s.up.x, s.up.y, s.up.z, s.up.x, s.up.y, s.up.z);
    const v = s.distance / 7;
    uvs.push(0, v, 1, v);
    colors.push(gravel.r, gravel.g, gravel.b, grass.r, grass.g, grass.b);
  }
  const rows = samples.length;
  for (let i = 0; i < rows - 1; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return { positions, normals, uvs, colors, indices };
}

function buildCurbs(circuit) {
  const geo = new THREE.BoxGeometry(0.46, 0.14, 1.15);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.04 });
  const spots = [];
  for (let i = 0; i < circuit.samples.length - 1; i += 2) {
    const s = circuit.samples[i];
    if (Math.abs(s.curvature) < 0.007) continue;
    spots.push({ s, side: 1 });
    spots.push({ s, side: -1 });
  }
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(spots.length, 1));
  const dummy = new THREE.Object3D();
  const red = new THREE.Color(0xc4312c);
  const white = new THREE.Color(0xf2f2f0);
  spots.forEach((spot, index) => {
    const { s, side } = spot;
    dummy.position.copy(s.point).addScaledVector(s.right, side * 6.22).addScaledVector(s.up, 0.12);
    dummy.up.copy(s.up);
    dummy.lookAt(dummy.position.clone().add(s.tangent));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    const stripe = Math.floor(s.distance / 1.7) % 2 === 0;
    mesh.setColorAt(index, stripe ? red : white);
  });
  mesh.count = spots.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildBarriers(circuit) {
  const geo = new THREE.BoxGeometry(0.16, 0.48, 3.4);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb7bcc2,
    metalness: 0.86,
    roughness: 0.32,
    envMapIntensity: 0.7,
  });
  const spots = [];
  for (let i = 0; i < circuit.samples.length - 1; i += 4) {
    const s = circuit.samples[i];
    const seam = Math.min(s.distance, circuit.length - s.distance);
    if (seam < 16) continue;
    spots.push({ s, side: 1 });
    spots.push({ s, side: -1 });
  }
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(spots.length, 1));
  const dummy = new THREE.Object3D();
  spots.forEach((spot, index) => {
    const { s, side } = spot;
    dummy.position.copy(s.point).addScaledVector(s.right, side * 8.15).addScaledVector(s.up, 0.35);
    dummy.up.copy(s.up);
    dummy.lookAt(dummy.position.clone().add(s.tangent));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.count = spots.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh };
}

function buildLamps(circuit) {
  const group = new THREE.Group();
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 5.4, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.6, roughness: 0.4 });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe1b0,
    emissive: 0xffb15e,
    emissiveIntensity: 4.5,
    roughness: 0.35,
  });
  for (let i = 0; i < circuit.samples.length - 1; i += 18) {
    const s = circuit.samples[i];
    const base = s.point.clone().addScaledVector(s.right, 9.3);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.copy(base).addScaledVector(s.up, 2.7);
    pole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.up);
    pole.castShadow = true;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), bulbMat);
    bulb.position.copy(base).addScaledVector(s.up, 5.45).addScaledVector(s.right, -0.7);
    group.add(pole, bulb);
  }
  return group;
}

function buildGantry(circuit) {
  const s = circuit.samples[0];
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2c3038, metalness: 0.7, roughness: 0.38 });
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.45, 6.2, 0.45), metal);
    pillar.position.copy(s.point).addScaledVector(s.right, side * 8.2).addScaledVector(s.up, 3.1);
    pillar.castShadow = true;
    group.add(pillar);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(17.2, 0.38, 0.7), metal);
  beam.position.copy(s.point).addScaledVector(s.up, 6.3);
  orient(beam, s);
  group.add(beam);

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#14171c';
  ctx.fillRect(0, 0, 1024, 160);
  ctx.strokeStyle = '#ffb15a';
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, 1000, 136);
  ctx.fillStyle = '#f4f1ea';
  ctx.font = '600 78px Oswald, Arial Narrow, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('RQCCCING', 512, 86);
  const signMap = new THREE.CanvasTexture(canvas);
  signMap.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(8.2, 1.28),
    new THREE.MeshStandardMaterial({ map: signMap, roughness: 0.6, metalness: 0.1, emissive: 0x22180e, emissiveIntensity: 0.4 }),
  );
  sign.position.copy(s.point).addScaledVector(s.up, 6.15).addScaledVector(s.tangent, 0.5);
  orient(sign, s);
  group.add(sign);

  const lights = [];
  for (let i = 0; i < 5; i += 1) {
    const material = new THREE.MeshStandardMaterial({
      color: 0x3a1010,
      emissive: 0xff1a1a,
      emissiveIntensity: 0.15,
      roughness: 0.4,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), material);
    bulb.position.copy(s.point).addScaledVector(s.right, (i - 2) * 0.55).addScaledVector(s.up, 5.55);
    group.add(bulb);
    lights.push(material);
  }
  return { group, lights };
}

function buildGrandstand(circuit) {
  const s = circuit.atDistance(28);
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8d8680, roughness: 0.82 });
  for (let row = 0; row < 4; row += 1) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(16, 0.7, 2.1), concrete);
    seat.position.copy(s.point)
      .addScaledVector(s.right, 13 + row * 2.2)
      .addScaledVector(s.up, 0.6 + row * 0.7);
    orient(seat, s);
    seat.castShadow = true;
    seat.receiveShadow = true;
    group.add(seat);
  }
  const crowd = crowdTexture();
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 2.2),
    new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.8 }),
  );
  banner.position.copy(s.point).addScaledVector(s.right, 16.5).addScaledVector(s.up, 2.3);
  orient(banner, s);
  group.add(banner);
  return group;
}

function crowdTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2c333c';
  ctx.fillRect(0, 0, 256, 64);
  const palette = ['#f2f2f2', '#e23b2f', '#1f6dff', '#f0c14a', '#111111', '#3ecf8e'];
  for (let i = 0; i < 180; i += 1) {
    ctx.fillStyle = palette[i % palette.length];
    ctx.fillRect((i * 17) % 252, 8 + (i % 5) * 10, 6, 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildDressing(circuit) {
  const group = new THREE.Group();
  const flags = [];
  const messages = ['GOLDEN HOUR', 'HOLD THE APEX', 'RQCCCING'];
  messages.forEach((text, index) => {
    const s = circuit.atDistance(180 + index * 260);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 1.6),
      new THREE.MeshStandardMaterial({ map: labelTexture(text), roughness: 0.55, metalness: 0.08 }),
    );
    board.position.copy(s.point).addScaledVector(s.right, -11).addScaledVector(s.up, 2.4);
    orient(board, s);
    group.add(board);
  });

  for (let i = 0; i < 6; i += 1) {
    const s = circuit.atDistance(8 + i * 3.2);
    const flag = makeFlag(i % 2 === 0 ? 0xc41818 : 0xf4f4f4);
    flag.mesh.position.copy(s.point).addScaledVector(s.right, 10.2).addScaledVector(s.up, 2.1);
    orient(flag.mesh, s);
    group.add(flag.mesh);
    flags.push(flag);
  }

  return {
    group,
    update(dt) {
      for (const flag of flags) flag.update(dt);
    },
  };
}

function labelTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#12151a';
  ctx.fillRect(0, 0, 768, 180);
  ctx.fillStyle = '#ffb15a';
  ctx.fillRect(0, 0, 10, 180);
  ctx.fillStyle = '#f7f4ee';
  ctx.font = '600 72px Oswald, Arial Narrow, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 390, 92);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeFlag(hex) {
  const geo = new THREE.PlaneGeometry(1.4, 0.72, 10, 1);
  const base = geo.attributes.position.array.slice();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.6,
      side: THREE.DoubleSide,
    }),
  );
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5, roughness: 0.4 }),
  );
  pole.position.set(-0.75, -0.7, 0);
  mesh.add(pole);
  let time = Math.random() * 4;
  return {
    mesh,
    update(dt) {
      time += dt;
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        const x = base[i * 3];
        const wave = Math.sin(time * 5 + x * 7) * 0.12 * (x + 0.7);
        pos.setZ(i, base[i * 3 + 2] + wave);
      }
      pos.needsUpdate = true;
    },
  };
}

function buildMarkings(circuit) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xf7f4ee,
    roughness: 0.38,
    metalness: 0.02,
    emissive: 0x3a3328,
    emissiveIntensity: 0.45,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const group = new THREE.Group();
  group.add(markingStrip(circuit.samples, -6.05, -5.62, material));
  group.add(markingStrip(circuit.samples, 5.62, 6.05, material));
  group.add(dashedCenter(circuit.samples, material));
  return group;
}

function markingStrip(samples, left, right, material) {
  const data = ribbon(samples, left, right, 0.11, 0.11);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  geo.setIndex(data.indices);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

function dashedCenter(samples, material) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (Math.floor(a.distance / 8) % 2 !== 0) continue;
    const base = positions.length / 3;
    for (const sample of [a, b]) {
      const left = sample.point.clone().addScaledVector(sample.right, -0.16).addScaledVector(sample.up, 0.11);
      const right = sample.point.clone().addScaledVector(sample.right, 0.16).addScaledVector(sample.up, 0.11);
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      normals.push(sample.up.x, sample.up.y, sample.up.z, sample.up.x, sample.up.y, sample.up.z);
    }
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

function buildStartLine(circuit) {
  const s = circuit.samples[0];
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  for (let x = 0; x < 16; x += 1) {
    for (let y = 0; y < 2; y += 1) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f4f4f4' : '#111111';
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(11.2, 1.4),
    new THREE.MeshStandardMaterial({ map, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  mesh.position.copy(s.point).addScaledVector(s.up, 0.09);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right, s.tangent, s.up));
  mesh.receiveShadow = true;
  return mesh;
}

function orient(mesh, sample) {
  const matrix = new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent);
  mesh.quaternion.setFromRotationMatrix(matrix);
}

export function barrierLimit(lateral) {
  return clamp(Math.abs(lateral), 0, 12);
}
