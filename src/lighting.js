import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export function createLighting(scene, renderer) {
  const sunDirection = new THREE.Vector3();
  const elevation = 4.6;
  const azimuth = 214;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunDirection.setFromSphericalCoords(1, phi, theta).normalize();

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
  const envTarget = pmrem.fromScene(envScene, 0.02, 1, 1000000);
  scene.add(sky);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 1;
  pmrem.dispose();

  const sun = new THREE.DirectionalLight(0xffc084, 5.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00018;
  sun.shadow.normalBias = 0.035;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 260;
  sun.shadow.camera.left = -48;
  sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48;
  sun.shadow.camera.bottom = -48;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xffc39a, 0x3a2a22, 0.72);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(0x8ea4d6, 0.38);
  fill.position.copy(sunDirection).multiplyScalar(-1).add(new THREE.Vector3(0, 0.4, 0));
  scene.add(fill);

  scene.fog = new THREE.FogExp2(0xd47858, 0.0028);

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

  return { sun, sunDirection, updateShadows, sky };
}
