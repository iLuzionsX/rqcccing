import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { fbm, mulberry32, smoothstep } from './util.js';
import { softCircleTexture } from './materials.js';
import { surfaceHeight, terrainHeight } from './ground.js';

export function createEnvironment(scene, circuit, quality, assets) {
  const terrain = buildTerrain(circuit, quality, assets.grass);
  scene.add(terrain);

  const water = buildLake(circuit, quality);
  scene.add(water);

  if (circuit.stageId === 'ridge' && assets.ridge) dressRidge(scene, circuit, quality, assets);
  else scatterProps(scene, circuit, quality, assets.props);

  const dust = buildDust();
  scene.add(dust.points);

  const glare = buildSunGlare();
  scene.add(glare);

  return {
    water,
    update(dt, camera, sunDirection) {
      water.material.uniforms.time.value += dt;
      dust.update(dt, camera);
      glare.position.copy(camera.position).addScaledVector(sunDirection, 900);
    },
  };
}

function buildTerrain(circuit, quality, grassMaps) {
  const ridge = circuit.stageId === 'ridge';
  const divisions = quality.low ? 160 : 230;
  const geo = new THREE.PlaneGeometry(980, 980, divisions, divisions);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xc4b39a);
  const rock = new THREE.Color(ridge ? 0x8a8175 : 0x9a8d84);
  const valley = new THREE.Color(0x7e8a55);
  const heather = new THREE.Color(0x6d5d68);
  const shore = new THREE.Color(0x6d6458);
  const color = new THREE.Color();
  const stride = divisions + 1;
  const cell = 980 / divisions;

  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z, circuit));
  }
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = pos.getY(i);
    const ix = i % stride;
    const iz = Math.floor(i / stride);
    const hL = pos.getY(iz * stride + Math.max(0, ix - 1));
    const hR = pos.getY(iz * stride + Math.min(divisions, ix + 1));
    const hD = pos.getY(Math.max(0, iz - 1) * stride + ix);
    const hU = pos.getY(Math.min(divisions, iz + 1) * stride + ix);
    const slope = Math.hypot((hR - hL) / (2 * cell), (hU - hD) / (2 * cell));
    const n = fbm(x * 0.02, z * 0.02, 3);
    const dl = Math.hypot(x - circuit.lake.x, z - circuit.lake.z);
    if (ridge) {
      color.copy(valley).multiplyScalar(0.86 + n * 0.28);
      if (h > 22) color.lerp(heather, smoothstep(22, 40, h) * 0.62);
      if (slope > 0.28) color.lerp(rock, smoothstep(0.28, 0.8, slope));
      if (h > 58) color.lerp(new THREE.Color(0xe4e6e8), smoothstep(58, 74, h) * (slope > 0.6 ? 0.2 : 0.85));
      if (dl < circuit.lake.radius + 20) color.lerp(shore, smoothstep(circuit.lake.radius + 20, circuit.lake.radius + 2, dl));
    } else {
      color.setScalar(0.78 + n * 0.22);
      if (h > 7) color.lerp(rock, smoothstep(7, 16, h));
      if (dl < circuit.lake.radius + 22) color.lerp(sand, smoothstep(circuit.lake.radius + 22, circuit.lake.radius + 2, dl));
    }
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv2', geo.getAttribute('uv'));
  geo.computeVertexNormals();
  geo.computeTangents();

  const map = grassMaps.map.clone();
  const normalMap = grassMaps.normalMap.clone();
  const roughnessMap = grassMaps.roughnessMap.clone();
  const aoMap = grassMaps.aoMap.clone();
  const repeat = ridge ? 34 : grassMaps.map.repeat.x;
  for (const texture of [map, normalMap, roughnessMap, aoMap]) texture.repeat.set(repeat, repeat);
  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap,
    aoMap,
    aoMapIntensity: 0.65,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.25,
  });
  if (ridge) addSnowLine(material);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

function addSnowLine(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRidgeHeight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRidgeHeight = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRidgeHeight;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float snowLine = smoothstep(60.0, 76.0, vRidgeHeight);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.92, 0.93), snowLine);`,
      );
  };
}

function buildLake(circuit, quality) {
  const lake = circuit.lake;
  const geo = new THREE.CircleGeometry(lake.radius, 72);
  const water = new Reflector(geo, {
    clipBias: 0.002,
    textureWidth: quality.reflection,
    textureHeight: quality.reflection,
    color: circuit.stageId === 'ridge' ? 0x8eacb8 : 0xc4a090,
    multisample: quality.low ? 0 : 4,
    shader: waterShader(lake),
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(lake.x, lake.y, lake.z);
  water.material.transparent = true;
  water.material.depthWrite = false;
  water.receiveShadow = false;
  water.renderOrder = 2;
  return water;
}

function waterShader(lake) {
  return {
    name: 'LakeReflector',
    uniforms: {
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      time: { value: 0 },
      center: { value: new THREE.Vector2(lake.x, lake.z) },
      radius: { value: lake.radius },
    },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vUv;
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vUv = textureMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform sampler2D tDiffuse;
      uniform float time;
      uniform vec2 center;
      uniform float radius;
      varying vec4 vUv;
      varying vec3 vWorld;

      float blendOverlay(float base, float blend) {
        return base < 0.5 ? (2.0 * base * blend) : (1.0 - 2.0 * (1.0 - base) * (1.0 - blend));
      }
      vec3 blendOverlay(vec3 base, vec3 blend) {
        return vec3(blendOverlay(base.r, blend.r), blendOverlay(base.g, blend.g), blendOverlay(base.b, blend.b));
      }

      void main() {
        float ripple = sin(vWorld.x * 0.42 + time * 1.3) * cos(vWorld.z * 0.37 - time * 0.85);
        ripple += sin((vWorld.x + vWorld.z) * 0.22 + time * 0.6) * 0.6;
        vec4 uv = vUv;
        uv.x += ripple * 0.018 * uv.w;
        uv.y += cos(vWorld.z * 0.31 + time) * 0.014 * uv.w;
        vec3 reflected = texture2DProj(tDiffuse, uv).rgb;
        vec3 col = blendOverlay(reflected, color);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float down = pow(max(viewDir.y, 0.0), 0.55);
        vec3 deep = vec3(0.035, 0.055, 0.062);
        col = mix(col, deep, down * 0.62);
        float shore = length(vWorld.xz - center);
        float foam = smoothstep(0.72, 1.0, ripple) * smoothstep(radius, radius - 7.0, shore);
        col += foam * vec3(1.0, 0.78, 0.62) * 0.18;
        float alpha = smoothstep(radius, radius - 5.0, shore);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
}

function scatterProps(scene, circuit, quality, props) {
  const ridge = circuit.stageId === 'ridge';
  const specs = [
    { gltf: props.tree, count: quality.low ? (ridge ? 20 : 12) : (ridge ? 44 : 26), height: 6.2, clearance: 20, seed: 11 },
    { gltf: props.shrubA, count: quality.low ? (ridge ? 30 : 18) : (ridge ? 64 : 40), height: 1.15, clearance: 15, seed: 19 },
    { gltf: props.shrubB, count: quality.low ? (ridge ? 26 : 16) : (ridge ? 56 : 34), height: 0.85, clearance: 14.5, seed: 23 },
    { gltf: props.grassPatch, count: quality.low ? (ridge ? 42 : 30) : (ridge ? 88 : 70), height: 0.42, clearance: 14, seed: 31 },
    { gltf: props.rock, count: quality.low ? (ridge ? 28 : 14) : (ridge ? 58 : 28), height: 0.9, clearance: 14.5, seed: 37 },
    { gltf: props.boulder, count: quality.low ? (ridge ? 18 : 8) : (ridge ? 34 : 16), height: 2.1, clearance: 18, seed: 41 },
    { gltf: props.flower, count: quality.low ? (ridge ? 14 : 12) : (ridge ? 32 : 28), height: 0.28, clearance: 14, seed: 47 },
  ];
  for (const spec of specs) scatter(scene, circuit, spec);
}

function scatter(scene, circuit, spec) {
  const parts = bakeParts(spec.gltf);
  if (!parts.length) return;
  const bounds = new THREE.Box3();
  for (const part of parts) {
    part.geo.computeBoundingBox();
    bounds.union(part.geo.boundingBox);
  }
  const modelHeight = Math.max(0.001, bounds.max.y - bounds.min.y);
  const meshes = parts.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geo, part.material, spec.count);
    mesh.count = 0;
    const leafy = part.material.transparent || part.material.alphaTest > 0 || part.material.alphaMap;
    mesh.castShadow = !leafy;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });
  const rand = mulberry32(spec.seed);
  const dummy = new THREE.Object3D();
  const heightLimit = circuit.stageId === 'ridge' ? 72 : 22;
  let placed = 0;
  let guard = 0;
  while (placed < spec.count && guard < spec.count * 40) {
    guard += 1;
    const x = (rand() - 0.5) * 760;
    const z = (rand() - 0.5) * 760;
    const q = circuit.query(x, z);
    const dl = Math.hypot(x - circuit.lake.x, z - circuit.lake.z);
    if (Math.abs(q.lateral) < spec.clearance || dl < circuit.lake.radius + 4) continue;
    const y = surfaceHeight(x, z, circuit);
    if (y < circuit.lake.y + 0.15 || y > heightLimit) continue;
    const scale = (spec.height * (0.72 + rand() * 0.55)) / modelHeight;
    dummy.position.set(x, y - bounds.min.y * scale, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    for (const mesh of meshes) mesh.setMatrixAt(placed, dummy.matrix);
    placed += 1;
  }
  for (const mesh of meshes) {
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
}

function dressRidge(scene, circuit, quality, assets) {
  const low = quality.low;
  const props = assets.props;
  const ridge = assets.ridge;
  // Poly Haven ships these as catalog rows (three saplings, a grass strip,
  // a rock set). catalog splits them into single plants before instancing.
  placeAlong(scene, circuit, {
    gltf: ridge.fir,
    catalog: true,
    squash: true,
    spacing: low ? 28 : 16,
    lateral: 16,
    jitter: 4.5,
    height: 7.4,
    scaleJitter: 0.28,
    seed: 3,
    bothSides: true,
    minClear: 13.5,
  });
  placeAlong(scene, circuit, {
    gltf: ridge.pine,
    catalog: true,
    squash: true,
    spacing: low ? 36 : 22,
    lateral: 32,
    jitter: 7,
    height: 11.5,
    scaleJitter: 0.22,
    seed: 9,
    bothSides: true,
    minClear: 22,
  });
  placeAlong(scene, circuit, {
    gltf: ridge.grass,
    catalog: true,
    cutout: true,
    spacing: low ? 26 : 15,
    lateral: 12.4,
    jitter: 2.4,
    height: 0.48,
    scaleJitter: 0.35,
    seed: 15,
    bothSides: true,
    minClear: 11.4,
  });
  placeAlong(scene, circuit, {
    gltf: ridge.moss,
    catalog: true,
    spacing: low ? 70 : 42,
    lateral: 21,
    jitter: 5,
    height: 0.85,
    seed: 21,
    bothSides: true,
    minClear: 15,
  });
  placeAlong(scene, circuit, {
    gltf: ridge.stump,
    spacing: low ? 70 : 48,
    lateral: 17,
    jitter: 4,
    height: 0.85,
    seed: 27,
    bothSides: false,
    minClear: 14,
  });
  placeAlong(scene, circuit, {
    gltf: ridge.trunk,
    spacing: low ? 90 : 64,
    lateral: 26,
    jitter: 5,
    height: 0.42,
    seed: 33,
    bothSides: false,
    minClear: 18,
  });
  placeAlong(scene, circuit, {
    gltf: props.rock,
    spacing: low ? 40 : 26,
    lateral: 15.5,
    jitter: 3,
    height: 0.85,
    seed: 39,
    bothSides: true,
    minClear: 13.4,
  });
  placeAlong(scene, circuit, {
    gltf: props.boulder,
    spacing: low ? 80 : 52,
    lateral: 19,
    jitter: 4,
    height: 1.8,
    seed: 45,
    bothSides: false,
    corners: true,
    minClear: 14,
  });
  placeCliffs(scene, circuit, ridge.face, low ? 3 : 5);
  placeCrates(scene, circuit, ridge.crate);
}

function placeAlong(scene, circuit, spec) {
  const rand = mulberry32(spec.seed);
  const spots = [];
  for (let distance = 70; distance < circuit.length - 55; distance += spec.spacing) {
    const sample = circuit.atDistance(distance + (rand() - 0.5) * spec.spacing * 0.35);
    if (nearJump(circuit, sample.distance, 34)) continue;
    const straight = Math.abs(sample.curvature) < 0.018;
    if (spec.straightOnly && !straight) continue;
    if (spec.corners && straight) continue;
    const sides = spec.bothSides ? [-1, 1] : [outsideOf(sample, circuit.centroid)];
    for (const side of sides) {
      if (spec.bothSides && side !== outsideOf(sample, circuit.centroid) && !straight) continue;
      const lateral = side * (spec.lateral + (rand() - 0.35) * spec.jitter);
      const at = sample.point.clone().addScaledVector(sample.right, lateral);
      const query = circuit.query(at.x, at.z);
      if (Math.abs(query.lateral) < spec.minClear) continue;
      const dl = Math.hypot(at.x - circuit.lake.x, at.z - circuit.lake.z);
      if (dl < circuit.lake.radius + 6) continue;
      const y = surfaceHeight(at.x, at.z, circuit);
      const spread = spec.scaleJitter ?? 0.18;
      spots.push({ x: at.x, y, z: at.z, yaw: rand() * Math.PI * 2, scale: 1 - spread + rand() * spread * 2 });
    }
  }
  if (!spots.length || !spec.gltf) return;
  const variants = spec.catalog ? catalogVariants(spec.gltf, spec.cutout) : [wholeProp(spec.gltf, spec.cutout)];
  if (!variants.length) return;
  const buckets = variants.map(() => []);
  spots.forEach((spot, index) => buckets[index % variants.length].push(spot));
  const dummy = new THREE.Object3D();
  variants.forEach((variant, variantIndex) => {
    const assigned = buckets[variantIndex];
    if (!assigned.length || !variant.parts.length) return;
    const meshes = variant.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geo, part.material, assigned.length);
      const leafy = part.material.transparent || part.material.alphaTest > 0 || part.material.alphaMap;
      mesh.castShadow = !leafy;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    });
    assigned.forEach((spot, index) => {
      const scale = (spec.height * spot.scale) / variant.height;
      dummy.position.set(spot.x, spot.y - variant.minY * scale, spot.z);
      dummy.rotation.set(0, spot.yaw, 0);
      const squash = spec.squash ? 0.82 : 1;
      dummy.scale.set(scale * squash, scale, scale * squash);
      dummy.updateMatrix();
      for (const mesh of meshes) mesh.setMatrixAt(index, dummy.matrix);
    });
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  });
}

function placeCliffs(scene, circuit, gltf, count) {
  if (!gltf) return;
  const sites = [];
  const samples = circuit.samples;
  for (let i = 12; i < samples.length - 12; i += 1) {
    const curvature = Math.abs(samples[i].curvature);
    if (curvature < 0.02) continue;
    if (curvature < Math.abs(samples[i - 6].curvature)) continue;
    const distance = samples[i].distance;
    if (sites.some((site) => Math.min(Math.abs(site.distance - distance), circuit.length - Math.abs(site.distance - distance)) < 140)) continue;
    sites.push(samples[i]);
    if (sites.length >= count) break;
  }
  const parts = bakeParts(gltf);
  if (!parts.length || !sites.length) return;
  const bounds = new THREE.Box3();
  for (const part of parts) {
    part.geo.computeBoundingBox();
    bounds.union(part.geo.boundingBox);
  }
  const modelHeight = Math.max(0.001, bounds.max.y - bounds.min.y);
  const meshes = parts.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geo, part.material, sites.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });
  const dummy = new THREE.Object3D();
  sites.forEach((sample, index) => {
    const side = -outsideOf(sample, circuit.centroid);
    const at = sample.point.clone().addScaledVector(sample.right, side * 22);
    const y = surfaceHeight(at.x, at.z, circuit);
    const scale = 7.2 / modelHeight;
    dummy.position.set(at.x, y - bounds.min.y * scale, at.z);
    dummy.rotation.set(0, Math.atan2(sample.tangent.x, sample.tangent.z), 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    for (const mesh of meshes) mesh.setMatrixAt(index, dummy.matrix);
  });
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
}

function placeCrates(scene, circuit, gltf) {
  if (!gltf) return;
  const sample = circuit.atDistance(48);
  const side = outsideOf(sample, circuit.centroid);
  const parts = bakeParts(gltf);
  if (!parts.length) return;
  const bounds = new THREE.Box3();
  for (const part of parts) {
    part.geo.computeBoundingBox();
    bounds.union(part.geo.boundingBox);
  }
  const modelSize = bounds.getSize(new THREE.Vector3());
  const modelHeight = Math.max(modelSize.x, modelSize.y, modelSize.z, 0.001);
  const spots = [
    [0, 0],
    [1.15, 0.35],
    [0.35, 0.95],
    [2.05, -0.15],
    [-0.9, 0.45],
  ];
  const meshes = parts.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geo, part.material, spots.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });
  const dummy = new THREE.Object3D();
  spots.forEach(([along, extra], index) => {
    const atSample = circuit.atDistance(sample.distance + along);
    const at = atSample.point.clone().addScaledVector(atSample.right, side * (12.2 + extra));
    const y = surfaceHeight(at.x, at.z, circuit);
    const scale = 0.95 / modelHeight;
    dummy.position.set(at.x, y - bounds.min.y * scale, at.z);
    dummy.rotation.set(0, index * 0.7, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    for (const mesh of meshes) mesh.setMatrixAt(index, dummy.matrix);
  });
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
}

function outsideOf(sample, centroid) {
  const side = sample.right.x * (centroid.x - sample.point.x) + sample.right.z * (centroid.z - sample.point.z);
  return side >= 0 ? -1 : 1;
}

function nearJump(circuit, distance, span) {
  return circuit.jumps.some((jump) => {
    const delta = Math.abs(jump.distance - distance);
    return Math.min(delta, circuit.length - delta) < span;
  });
}

function wholeProp(gltf, cutout) {
  const parts = bakeParts(gltf, cutout);
  const bounds = new THREE.Box3();
  for (const part of parts) {
    part.geo.computeBoundingBox();
    bounds.union(part.geo.boundingBox);
  }
  return {
    parts,
    minY: bounds.min.y,
    height: Math.max(0.001, bounds.max.y - bounds.min.y),
  };
}

// One entry per scene child, recentered, so a catalog row becomes separate props.
function catalogVariants(gltf, cutout) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const tops = root.children.length ? root.children : [root];
  const variants = [];
  for (const child of tops) {
    child.updateMatrixWorld(true);
    const parts = [];
    child.traverse((obj) => {
      if (!obj.isMesh) return;
      const geo = obj.geometry.clone();
      geo.applyMatrix4(obj.matrixWorld);
      const source = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      parts.push({ geo, material: preparePropMaterial(source, cutout) });
    });
    if (!parts.length) continue;
    const bounds = new THREE.Box3();
    for (const part of parts) {
      part.geo.computeBoundingBox();
      bounds.union(part.geo.boundingBox);
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const shift = new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z);
    for (const part of parts) part.geo.applyMatrix4(shift);
    variants.push({
      parts,
      minY: 0,
      height: Math.max(0.001, bounds.max.y - bounds.min.y),
    });
  }
  return variants;
}

const preparedMaterials = new WeakMap();

function preparePropMaterial(material, cutout) {
  const cached = preparedMaterials.get(material);
  if (cached) return cached;
  const next = material.clone();
  if (cutout && next.map?.image) punchDarkBackdrop(next);
  else if (next.alphaMap || (next.map && next.transparent)) {
    next.alphaTest = Math.max(next.alphaTest || 0, 0.4);
    next.transparent = false;
    next.depthWrite = true;
    next.side = THREE.DoubleSide;
  }
  next.envMapIntensity = Math.min(next.envMapIntensity || 1, 0.6);
  preparedMaterials.set(material, next);
  return next;
}

// Grass cards are JPEGs with a black backdrop and no alpha. Luminance becomes the cutout.
function punchDarkBackdrop(material) {
  const image = material.map.image;
  const width = image.width || image.videoWidth;
  const height = image.height || image.videoHeight;
  if (!width || !height) return;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i + 3] = luma < 16 ? 0 : Math.min(255, (luma - 16) * 5);
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = material.map.wrapS;
  texture.wrapT = material.map.wrapT;
  texture.anisotropy = material.map.anisotropy || 1;
  material.map = texture;
  material.alphaTest = 0.35;
  material.transparent = false;
  material.depthWrite = true;
  material.side = THREE.DoubleSide;
}

function bakeParts(gltf, cutout = false) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const geo = obj.geometry.clone();
    geo.applyMatrix4(obj.matrixWorld);
    const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    parts.push({ geo, material: preparePropMaterial(material, cutout) });
  });
  return parts;
}

function buildDust() {
  const count = 160;
  const positions = new Float32Array(count * 3);
  const points = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({
      color: 0xffc297,
      size: 0.22,
      map: softCircleTexture(),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  points.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  points.frustumCulled = false;
  const seeds = Array.from({ length: count }, () => ({
    x: Math.random() - 0.5,
    y: Math.random(),
    z: Math.random() - 0.5,
    s: 0.2 + Math.random(),
  }));
  return {
    points,
    update(dt, camera) {
      const pos = points.geometry.attributes.position;
      for (let i = 0; i < count; i += 1) {
        const seed = seeds[i];
        seed.y += dt * seed.s * 0.15;
        if (seed.y > 1) seed.y -= 1;
        pos.setXYZ(
          i,
          camera.position.x + seed.x * 36,
          camera.position.y + seed.y * 12 - 2,
          camera.position.z + seed.z * 36,
        );
      }
      pos.needsUpdate = true;
    },
  };
}

function buildSunGlare() {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softCircleTexture(),
      color: 0xffb15a,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0.28,
    }),
  );
  sprite.scale.set(150, 150, 1);
  sprite.frustumCulled = false;
  sprite.renderOrder = 5;
  return sprite;
}
