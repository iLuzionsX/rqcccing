import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export function createLighting(scene, renderer, hdr) {
  const sunDirection = new THREE.Vector3();
  const elevation = 12;
  const azimuth = 128;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunDirection.setFromSphericalCoords(1, phi, theta).normalize();

  if (hdr) {
    scene.background = hdr;
    scene.environment = hdr;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    pmrem.dispose();
    scene.environmentIntensity = 1.05;
    if (scene.backgroundRotation) scene.backgroundRotation.y = 1.15;
    if (scene.environmentRotation) scene.environmentRotation.y = 1.15;
  } else {
    const sky = new Sky();
    sky.scale.setScalar(450000);
    sky.frustumCulled = false;
    const uniforms = sky.material.uniforms;
    uniforms.turbidity.value = 10;
    uniforms.rayleigh.value = 2.85;
    uniforms.mieCoefficient.value = 0.012;
    uniforms.mieDirectionalG.value = 0.9;
    uniforms.sunPosition.value.copy(sunDirection);
    scene.add(sky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky);
    scene.environment = pmrem.fromScene(envScene, 0.02, 1, 1000000).texture;
    scene.add(sky);
    pmrem.dispose();
  }

  const sun = new THREE.DirectionalLight(0xffc28a, hdr ? 2.6 : 5.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00018;
  sun.shadow.normalBias = 0.04;
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 280;
  sun.shadow.camera.left = -52;
  sun.shadow.camera.right = 52;
  sun.shadow.camera.top = 52;
  sun.shadow.camera.bottom = -52;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xc5d4e4, 0x6a5344, hdr ? 0.28 : 0.72);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(0x8ea4d6, hdr ? 0.18 : 0.38);
  fill.position.copy(sunDirection).multiplyScalar(-1).add(new THREE.Vector3(0, 0.4, 0));
  scene.add(fill);

  scene.fog = new THREE.FogExp2(hdr ? 0xb7c3cf : 0xd47858, hdr ? 0.0017 : 0.0028);

  function updateShadows(target, mapSize) {
    if (mapSize && sun.shadow.mapSize.x !== mapSize) {
      sun.shadow.mapSize.set(mapSize, mapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.position.copy(target).addScaledVector(sunDirection, 140);
    sun.target.position.copy(target);
    sun.target.updateMatrixWorld();
  }

  return { sun, sunDirection, updateShadows };
}
