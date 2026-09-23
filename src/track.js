import * as THREE from 'three';
import { clamp } from './util.js';
import { BANK_OUTER, surfaceHeight, vergeDrop } from './ground.js';

export function createTrack(scene, circuit, textures) {
  const ridge = circuit.stageId === 'ridge';
  const road = buildRoad(circuit, textures);
  scene.add(road);

  const shoulders = buildShoulders(circuit, textures);
  scene.add(shoulders);

  const bank = buildBank(circuit, textures.grass);
  scene.add(bank);

  if (ridge) {
    scene.add(buildJumpSigns(circuit));
  } else {
    scene.add(buildCurbs(circuit));
    const barriers = buildBarriers(circuit);
    scene.add(barriers.mesh);
    scene.add(buildLamps(circuit));
  }

  const gantry = buildGantry(circuit);
  scene.add(gantry.group);

  if (!ridge) scene.add(buildGrandstand(circuit));

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
  const { positions, normals, uvs, indices } = ribbon(circuit.samples, -6.05, 6.05, 0.05, 0.05, 4.5);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeTangents();

  const ridge = circuit.stageId === 'ridge';
  const surface = ridge ? textures.gravel : textures.asphalt;
  const material = ridge
    ? new THREE.MeshStandardMaterial({
      map: surface.map,
      color: 0xa89074,
      normalMap: surface.normalMap,
      normalScale: new THREE.Vector2(1.35, 1.35),
      roughnessMap: surface.roughnessMap,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.48,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    : new THREE.MeshPhysicalMaterial({
      map: surface.map,
      normalMap: surface.normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: surface.roughnessMap,
      aoMap: surface.aoMap,
      aoMapIntensity: 0.9,
      roughness: 0.58,
      metalness: 0.03,
      clearcoat: 0.16,
      clearcoatRoughness: 0.38,
      envMapIntensity: 0.82,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function buildShoulders(circuit, textures) {
  const left = ribbon(circuit.samples, -5.85, -11.85, 0.03, -0.5, 2);
  const right = ribbon(circuit.samples, 5.85, 11.85, 0.03, -0.5, 2);
  const geo = new THREE.BufferGeometry();
  const positions = left.positions.concat(right.positions);
  const normals = left.normals.concat(right.normals);
  const uvs = left.uvs.concat(right.uvs);
  const offset = left.positions.length / 3;
  const indices = left.indices.concat(right.indices.map((index) => index + offset));
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const shoulderNormals = geo.attributes.normal;
  for (let i = 0; i < shoulderNormals.count; i += 1) {
    if (shoulderNormals.getY(i) < 0) {
      shoulderNormals.setXYZ(i, -shoulderNormals.getX(i), -shoulderNormals.getY(i), -shoulderNormals.getZ(i));
    }
  }
  geo.computeTangents();
  const ridge = circuit.stageId === 'ridge';
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: textures.gravel.map,
      color: ridge ? 0xd7c7aa : 0xffffff,
      normalMap: textures.gravel.normalMap,
      normalScale: new THREE.Vector2(ridge ? 1.15 : 0.8, ridge ? 1.15 : 0.8),
      roughnessMap: textures.gravel.roughnessMap,
      roughness: 1,
      metalness: 0,
      envMapIntensity: ridge ? 0.28 : 0.35,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

function buildBank(circuit, grassMaps) {
  const rings = [11.45, 16.4, 22.2, BANK_OUTER];
  const samples = circuit.samples;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (const side of [-1, 1]) {
    const base = positions.length / 3;
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      rings.forEach((ring, ringIndex) => {
        const lateral = side * ring;
        const x = s.point.x + s.right.x * lateral;
        const z = s.point.z + s.right.z * lateral;
        const lift = ringIndex === 0 ? -0.02 : 0.03 * (1 - ringIndex / (rings.length - 1));
        positions.push(x, surfaceHeight(x, z, circuit) + lift, z);
        uvs.push((ring - rings[0]) / 8, s.distance / 10);
      });
    }
    const cols = rings.length;
    for (let i = 0; i < samples.length - 1; i += 1) {
      for (let ring = 0; ring < cols - 1; ring += 1) {
        const a = base + i * cols + ring;
        indices.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const normals = geo.attributes.normal;
  for (let i = 0; i < normals.count; i += 1) {
    if (normals.getY(i) < 0) normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
  }
  geo.computeTangents();
  const mesh = new THREE.Mesh(geo, grassMaterial(grassMaps));
  mesh.receiveShadow = true;
  return mesh;
}

function grassMaterial(maps) {
  const map = maps.map.clone();
  const normalMap = maps.normalMap.clone();
  const roughnessMap = maps.roughnessMap.clone();
  const aoMap = maps.aoMap.clone();
  for (const texture of [map, normalMap, roughnessMap, aoMap]) {
    texture.repeat.set(1, 1);
    texture.needsUpdate = true;
  }
  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap,
    aoMap,
    aoMapIntensity: 0.55,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.22,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

function ribbon(samples, left, right, leftLift, rightLift, tileMeters = 7) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const gravel = new THREE.Color(0x6d6458);
  const grass = new THREE.Color(0x5d7a3e);
  const span = Math.abs(right - left) / tileMeters;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const a = s.point.clone().addScaledVector(s.right, left);
    const b = s.point.clone().addScaledVector(s.right, right);
    a.y += leftLift;
    b.y += rightLift;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    normals.push(s.up.x, s.up.y, s.up.z, s.up.x, s.up.y, s.up.z);
    const v = s.distance / tileMeters;
    uvs.push(0, v, span, v);
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
  const geo = new THREE.BoxGeometry(0.42, 0.1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.04 });
  const spots = [];
  const samples = circuit.samples;
  for (let i = 0; i < samples.length - 1; i += 1) {
    const s = samples[i];
    if (Math.abs(s.curvature) < 0.006) continue;
    const len = Math.max(0.35, s.point.distanceTo(samples[i + 1].point));
    spots.push({ s, next: samples[i + 1], side: 1, len });
    spots.push({ s, next: samples[i + 1], side: -1, len });
  }
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(spots.length, 1));
  const dummy = new THREE.Object3D();
  const red = new THREE.Color(0xc4312c);
  const white = new THREE.Color(0xf2f2f0);
  spots.forEach((spot, index) => {
    const { s, next, side, len } = spot;
    dummy.position.copy(s.point).lerp(next.point, 0.5).addScaledVector(s.right, side * 6.18);
    dummy.position.y += 0.1;
    dummy.up.copy(s.up);
    dummy.scale.set(1, 1, len);
    dummy.lookAt(dummy.position.clone().add(s.tangent));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    const stripe = Math.floor(s.distance / 1.8) % 2 === 0;
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
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb7bcc2,
    metalness: 0.86,
    roughness: 0.32,
    envMapIntensity: 0.7,
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  group.add(barrierWall(circuit, 7.65, mat));
  group.add(barrierWall(circuit, -7.65, mat));
  return { mesh: group };
}

function barrierWall(circuit, lateral, material) {
  const samples = circuit.samples;
  const length = samples[samples.length - 1].distance;
  const positions = [];
  const indices = [];
  let row = -1;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const seam = Math.min(s.distance, length - s.distance);
    if (seam < 88) {
      row = -1;
      continue;
    }
    const x = s.point.x + s.right.x * lateral;
    const z = s.point.z + s.right.z * lateral;
    const base = s.point.y + s.right.y * lateral - vergeDrop(lateral);
    const index = positions.length / 3;
    positions.push(x, base + 0.02, z, x, base + 0.58, z);
    if (row >= 0) indices.push(row, row + 1, index, row + 1, index + 1, index);
    row = index;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
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
    const base = s.point.clone().addScaledVector(s.right, 9.6);
    base.y -= vergeDrop(9.6);
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
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.45, 6.5, 0.45), metal);
    const lateral = side * 8.2;
    pillar.position.copy(s.point).addScaledVector(s.right, lateral);
    pillar.position.y += -vergeDrop(lateral) + 3.25;
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
  ctx.fillText(circuit.stageId === 'ridge' ? 'RIDGEBREAK RALLY' : 'RQCCCING', 512, 86);
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
  const s = circuit.atDistance(52);
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8d8680, roughness: 0.82 });
  for (let row = 0; row < 4; row += 1) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.62, 18), concrete);
    const lateral = 15.2 + row * 2.2;
    const p = s.point.clone().addScaledVector(s.right, lateral);
    const ground = surfaceHeight(p.x, p.z, circuit);
    seat.position.set(p.x, ground + 0.31 + row * 0.68, p.z);
    orient(seat, s);
    seat.castShadow = true;
    seat.receiveShadow = true;
    group.add(seat);
  }
  const crowd = crowdTexture();
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.2),
    new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.8, side: THREE.DoubleSide }),
  );
  const bannerAt = s.point.clone().addScaledVector(s.right, 21.4);
  banner.position.set(bannerAt.x, surfaceHeight(bannerAt.x, bannerAt.z, circuit) + 2.5, bannerAt.z);
  faceRoad(banner, s, 1);
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
  const messages = circuit.stageId === 'ridge'
    ? ['RIDGE LINE', 'HAIRPIN', 'CREST JUMP']
    : ['GOLDEN HOUR', 'HOLD THE APEX', 'RQCCCING'];
  messages.forEach((text, index) => {
    const s = circuit.atDistance(180 + index * 260);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 1.6),
      new THREE.MeshStandardMaterial({ map: labelTexture(text), roughness: 0.55, metalness: 0.08 }),
    );
    const at = s.point.clone().addScaledVector(s.right, -13.2);
    board.position.set(at.x, surfaceHeight(at.x, at.z, circuit) + 2.35, at.z);
    faceRoad(board, s, -1);
    group.add(board);
  });

  for (let i = 0; i < 6; i += 1) {
    const s = circuit.atDistance(8 + i * 3.2);
    const flag = makeFlag(i % 2 === 0 ? 0xc41818 : 0xf4f4f4);
    flag.mesh.position.copy(s.point).addScaledVector(s.right, 10.2).addScaledVector(s.up, 1.85);
    flag.mesh.position.y -= vergeDrop(10.2);
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

function buildJumpSigns(circuit) {
  const group = new THREE.Group();
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x34383c, metalness: 0.55, roughness: 0.42 });
  const signMaterial = new THREE.MeshStandardMaterial({ color: 0xf2eee4, emissive: 0x24180c, emissiveIntensity: 0.25, roughness: 0.75 });
  const postGeometry = new THREE.CylinderGeometry(0.07, 0.09, 2.2, 8);
  for (const [index, jump] of circuit.jumps.entries()) {
    const sample = circuit.atDistance(jump.distance - 16);
    const lateral = 9.3;
    const base = sample.point.clone().addScaledVector(sample.right, lateral);
    const ground = surfaceHeight(base.x, base.z, circuit);
    const post = new THREE.Mesh(postGeometry, postMaterial);
    post.position.set(base.x, ground + 1.1, base.z);
    post.castShadow = true;
    group.add(post);

    const board = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.1), signMaterial.clone());
    board.position.set(base.x, ground + 2.45, base.z);
    faceRoad(board, sample, 1);
    board.material.map = labelTexture(index === 0 ? 'SWITCHBACK JUMP' : 'EAGLE CREST');
    board.material.color.set(0xffffff);
    group.add(board);
  }
  return group;
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
  group.add(markingStrip(circuit.samples, -6.02, -5.58, material));
  group.add(markingStrip(circuit.samples, 5.58, 6.02, material));
  if (circuit.stageId !== 'ridge') group.add(dashedCenter(circuit.samples, material));
  return group;
}

function markingStrip(samples, left, right, material) {
  const data = ribbon(samples, left, right, 0.085, 0.085);
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
      const left = sample.point.clone().addScaledVector(sample.right, -0.16);
      const right = sample.point.clone().addScaledVector(sample.right, 0.16);
      left.y += 0.085;
      right.y += 0.085;
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
  mesh.position.copy(s.point);
  mesh.position.y += 0.08;
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right, s.tangent, s.up));
  mesh.receiveShadow = true;
  return mesh;
}

function orient(mesh, sample) {
  const matrix = new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent);
  mesh.quaternion.setFromRotationMatrix(matrix);
}

function faceRoad(mesh, sample, side) {
  const towardRoad = sample.right.clone().multiplyScalar(-side);
  const matrix = new THREE.Matrix4().makeBasis(sample.tangent, sample.up, towardRoad);
  mesh.quaternion.setFromRotationMatrix(matrix);
}

export function barrierLimit(lateral) {
  return clamp(Math.abs(lateral), 0, 12);
}
