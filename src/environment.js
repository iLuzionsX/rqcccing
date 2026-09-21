import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { fbm, mulberry32, smoothstep, lerp } from './util.js';
import { softCircleTexture } from './materials.js';

export function createEnvironment(scene, circuit, quality, assets) {
  const terrain = buildTerrain(circuit, quality, assets.grass);
  scene.add(terrain);

  const water = buildLake(circuit, quality);
  scene.add(water);

  scatterProps(scene, circuit, quality, assets.props);

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

function buildTerrain(circuit, quality, grassMaps) {
  const divisions = quality.low ? 140 : 190;
  const geo = new THREE.PlaneGeometry(980, 980, divisions, divisions);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xc4b39a);
  const rock = new THREE.Color(0x9a8d84);
  const color = new THREE.Color();

  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z, circuit);
    pos.setY(i, h);
    const n = fbm(x * 0.02, z * 0.02, 3);
    const dl = Math.hypot(x - circuit.lake.x, z - circuit.lake.z);
    color.setScalar(0.78 + n * 0.22);
    if (h > 7) color.lerp(rock, smoothstep(7, 16, h));
    if (dl < circuit.lake.radius + 22) color.lerp(sand, smoothstep(circuit.lake.radius + 22, circuit.lake.radius + 2, dl));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv2', geo.getAttribute('uv'));
  geo.computeVertexNormals();
  geo.computeTangents();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: grassMaps.map,
      normalMap: grassMaps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: grassMaps.roughnessMap,
      aoMap: grassMaps.aoMap,
      aoMapIntensity: 0.65,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.25,
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

function scatterProps(scene, circuit, quality, props) {
  const specs = [
    { gltf: props.tree, count: quality.low ? 12 : 26, height: 6.2, clearance: 16, seed: 11 },
    { gltf: props.shrubA, count: quality.low ? 18 : 40, height: 1.15, clearance: 11, seed: 19 },
    { gltf: props.shrubB, count: quality.low ? 16 : 34, height: 0.85, clearance: 10.5, seed: 23 },
    { gltf: props.grassPatch, count: quality.low ? 30 : 70, height: 0.42, clearance: 8.2, seed: 31 },
    { gltf: props.rock, count: quality.low ? 14 : 28, height: 0.9, clearance: 9.2, seed: 37 },
    { gltf: props.boulder, count: quality.low ? 8 : 16, height: 2.1, clearance: 13, seed: 41 },
    { gltf: props.flower, count: quality.low ? 12 : 28, height: 0.28, clearance: 8.6, seed: 47 },
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
  let placed = 0;
  let guard = 0;
  while (placed < spec.count && guard < spec.count * 40) {
    guard += 1;
    const x = (rand() - 0.5) * 760;
    const z = (rand() - 0.5) * 760;
    const q = circuit.query(x, z);
    const dl = Math.hypot(x - circuit.lake.x, z - circuit.lake.z);
    if (Math.abs(q.lateral) < spec.clearance || dl < circuit.lake.radius + 4) continue;
    const y = heightAt(x, z, circuit);
    if (y < circuit.lake.y + 0.15 || y > 14) continue;
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

function bakeParts(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const geo = obj.geometry.clone();
    geo.applyMatrix4(obj.matrixWorld);
    const material = obj.material;
    if (Array.isArray(material)) {
      parts.push({ geo, material: material[0] });
      return;
    }
    if (material.alphaMap || (material.map && material.transparent)) {
      material.alphaTest = Math.max(material.alphaTest || 0, 0.4);
      material.transparent = false;
      material.depthWrite = true;
      material.side = THREE.DoubleSide;
    }
    material.envMapIntensity = Math.min(material.envMapIntensity || 1, 0.6);
    parts.push({ geo, material });
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
