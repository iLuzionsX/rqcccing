import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { fbm, mulberry32, smoothstep, lerp } from './util.js';
import { softCircleTexture } from './materials.js';

export function createEnvironment(scene, circuit, quality) {
  const terrain = buildTerrain(circuit, quality);
  scene.add(terrain);

  const water = buildLake(circuit, quality);
  scene.add(water);

  const mountains = buildMountains(circuit);
  scene.add(mountains);

  const forest = buildForest(circuit, quality);
  scene.add(forest.trunks);
  scene.add(forest.foliage);

  const rocks = buildRocks(circuit, quality);
  scene.add(rocks);

  const clouds = buildClouds();
  for (const cloud of clouds.meshes) scene.add(cloud);

  const dust = buildDust();
  scene.add(dust.points);

  const glare = buildSunGlare();
  scene.add(glare);

  return {
    water,
    update(dt, camera, sunDirection) {
      water.material.uniforms.time.value += dt;
      clouds.update(dt);
      dust.update(dt, camera);
      glare.position.copy(camera.position).addScaledVector(sunDirection, 780);
    },
  };
}

function heightAt(x, z, circuit) {
  const lake = circuit.lake;
  let h = fbm(x * 0.0042, z * 0.0042, 5) * 16 - 2.4;
  h += (fbm(x * 0.018, z * 0.018, 3) - 0.5) * 2.2;
  const dl = Math.hypot(x - lake.x, z - lake.z);
  const shore = smoothstep(lake.radius + 30, lake.radius, dl);
  const submerged = smoothstep(lake.radius, lake.radius * 0.62, dl);
  h = lerp(h, lake.y + 0.08, shore);
  h = lerp(h, lake.y - 1.4, submerged);

  const q = circuit.query(x, z);
  const lateral = Math.abs(q.lateral);
  if (lateral < 28) {
    const blend = smoothstep(7.5, 28, lateral);
    h = lerp(q.height - 1.05, h, blend);
  }
  return h;
}

function buildTerrain(circuit, quality) {
  const divisions = quality.low ? 120 : 170;
  const geo = new THREE.PlaneGeometry(980, 980, divisions, divisions);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x4e7a38);
  const dry = new THREE.Color(0x8d7a48);
  const rock = new THREE.Color(0x7a675c);
  const sand = new THREE.Color(0x8d7356);
  const color = new THREE.Color();

  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z, circuit);
    pos.setY(i, h);
    const n = fbm(x * 0.03, z * 0.03, 3);
    const dl = Math.hypot(x - circuit.lake.x, z - circuit.lake.z);
    color.copy(grass).lerp(dry, n);
    if (h > 8) color.lerp(rock, smoothstep(8, 14, h));
    if (dl < circuit.lake.radius + 18) color.lerp(sand, smoothstep(circuit.lake.radius + 18, circuit.lake.radius, dl));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

function buildLake(circuit, quality) {
  const lake = circuit.lake;
  const geo = new THREE.CircleGeometry(lake.radius, 72);
  const water = new Reflector(geo, {
    clipBias: 0.002,
    textureWidth: quality.reflection,
    textureHeight: quality.reflection,
    color: 0xc4a090,
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

function buildMountains(circuit) {
  const geo = new THREE.ConeGeometry(1, 1, 7);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.02,
    flatShading: true,
  });
  const count = 28;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const origin = new THREE.Vector2(-18, 128);
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + (i % 3) * 0.08;
    const radius = 430 + (i % 5) * 28;
    const height = 70 + (i % 7) * 18;
    const width = 46 + (i % 4) * 14;
    dummy.position.set(origin.x + Math.cos(a) * radius, 0, origin.y + Math.sin(a) * radius);
    dummy.scale.set(width, height, width);
    dummy.rotation.y = a;
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.set(i % 2 === 0 ? 0x8a6558 : 0x6e534c).multiplyScalar(0.85 + (i % 5) * 0.05);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function buildForest(circuit, quality) {
  const rand = mulberry32(11);
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.22, 1.8, 5);
  trunkGeo.translate(0, 0.9, 0);
  const foliageGeo = new THREE.ConeGeometry(1.15, 2.8, 6);
  foliageGeo.translate(0, 2.7, 0);
  const trunks = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({ color: 0x4a3428, roughness: 0.9 }),
    quality.trees,
  );
  const foliage = new THREE.InstancedMesh(
    foliageGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86 }),
    quality.trees,
  );
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < quality.trees && guard < quality.trees * 30) {
    guard += 1;
    const x = (rand() - 0.5) * 760;
    const z = (rand() - 0.5) * 760;
    const q = circuit.query(x, z);
    const dl = Math.hypot(x - circuit.lake.x, z - circuit.lake.z);
    if (Math.abs(q.lateral) < 14 || dl < circuit.lake.radius + 6) continue;
    const y = heightAt(x, z, circuit);
    if (y < circuit.lake.y + 0.2 || y > 11) continue;
    const scale = 0.75 + rand() * 1.35;
    dummy.position.set(x, y, z);
    dummy.rotation.y = rand() * Math.PI;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    foliage.setMatrixAt(placed, dummy.matrix);
    tint.set(0x2f6a32).lerp(new THREE.Color(0x6f8f3a), rand());
    foliage.setColorAt(placed, tint);
    placed += 1;
  }
  trunks.count = placed;
  foliage.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  trunks.receiveShadow = true;
  foliage.receiveShadow = true;
  return { trunks, foliage };
}

function buildRocks(circuit, quality) {
  const rand = mulberry32(29);
  const geo = new THREE.DodecahedronGeometry(0.6, 0);
  const mesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x6d625c, roughness: 0.88, flatShading: true }),
    quality.rocks,
  );
  const dummy = new THREE.Object3D();
  let placed = 0;
  let guard = 0;
  while (placed < quality.rocks && guard < quality.rocks * 20) {
    guard += 1;
    const x = (rand() - 0.5) * 700;
    const z = (rand() - 0.5) * 700;
    const q = circuit.query(x, z);
    const dl = Math.hypot(x - circuit.lake.x, z - circuit.lake.z);
    if (Math.abs(q.lateral) < 9.5 || dl < circuit.lake.radius) continue;
    const y = heightAt(x, z, circuit);
    dummy.position.set(x, y + 0.2, z);
    dummy.rotation.set(rand(), rand(), rand());
    dummy.scale.set(0.4 + rand(), 0.25 + rand() * 0.6, 0.4 + rand());
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed += 1;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildClouds() {
  const map = softCircleTexture();
  const meshes = [];
  const material = new THREE.MeshBasicMaterial({
    map,
    color: 0xffd0ae,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    fog: true,
  });
  const seeds = [
    [-40, 78, 40, 90],
    [120, 96, 180, 120],
    [-180, 110, 80, 80],
    [40, 130, 300, 140],
    [-90, 88, 220, 70],
    [200, 120, 40, 100],
    [-220, 140, 200, 110],
  ];
  for (const [x, y, z, scale] of seeds) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(scale, scale * 0.42), material.clone());
    mesh.material.opacity = 0.18 + (scale % 5) * 0.02;
    mesh.position.set(x, y, z);
    mesh.lookAt(0, y - 10, 80);
    meshes.push(mesh);
  }
  return {
    meshes,
    update(dt) {
      for (const mesh of meshes) {
        mesh.position.x += dt * 1.4;
        if (mesh.position.x > 420) mesh.position.x = -420;
      }
    },
  };
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
      opacity: 0.72,
    }),
  );
  sprite.scale.set(150, 150, 1);
  sprite.frustumCulled = false;
  sprite.renderOrder = 5;
  return sprite;
}
