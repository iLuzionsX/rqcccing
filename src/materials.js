import * as THREE from 'three';
import { fbm } from './util.js';

export function createAsphaltTextures() {
  const size = 512;
  const color = document.createElement('canvas');
  color.width = size;
  color.height = size;
  const ctx = color.getContext('2d', { willReadFrequently: true });
  const image = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = new Uint8ClampedArray(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const n = fbm(u * 38, v * 38, 4);
      const grit = fbm(u * 140, v * 90, 2);
      height[y * size + x] = n * 0.65 + grit * 0.35;

      const edge = u < 0.07 || u > 0.93;
      const dashBand = Math.abs(u - 0.5) < 0.012;
      const dashOn = (y % 64) < 34;
      const grooveL = Math.abs(u - 0.33) < 0.055;
      const grooveR = Math.abs(u - 0.67) < 0.055;
      const i = (y * size + x) * 4;

      if (edge) {
        image.data[i] = 236;
        image.data[i + 1] = 236;
        image.data[i + 2] = 232;
        rough[y * size + x] = 210;
      } else if (dashBand && dashOn) {
        image.data[i] = 214;
        image.data[i + 1] = 196;
        image.data[i + 2] = 150;
        rough[y * size + x] = 190;
      } else {
        const shade = 28 + n * 18 + grit * 10 - (grooveL || grooveR ? 10 : 0);
        image.data[i] = shade + 4;
        image.data[i + 1] = shade + 3;
        image.data[i + 2] = shade + 2;
        const polished = grooveL || grooveR ? 42 : 86;
        rough[y * size + x] = polished + grit * 40;
      }
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const normal = normalFromHeight(height, size, 5.5);
  const roughness = document.createElement('canvas');
  roughness.width = size;
  roughness.height = size;
  const rctx = roughness.getContext('2d');
  const rimage = rctx.createImageData(size, size);
  for (let i = 0; i < rough.length; i += 1) {
    const g = rough[i];
    rimage.data[i * 4] = g;
    rimage.data[i * 4 + 1] = g;
    rimage.data[i * 4 + 2] = g;
    rimage.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(rimage, 0, 0);

  const colorMap = new THREE.CanvasTexture(color);
  const normalMap = new THREE.CanvasTexture(normal);
  const roughnessMap = new THREE.CanvasTexture(roughness);
  for (const texture of [colorMap, normalMap, roughnessMap]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
  }
  colorMap.colorSpace = THREE.SRGBColorSpace;
  normalMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  return { colorMap, normalMap, roughnessMap };
}

function normalFromHeight(height, size, strength) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const l = height[y * size + ((x - 1 + size) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const d = height[((y - 1 + size) % size) * size + x];
      const u = height[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      image.data[i] = (nx * 0.5 + 0.5) * 255;
      image.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      image.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function paintMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.62,
    roughness: 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.045,
    envMapIntensity: 1.55,
  });
}

export function glassMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x071018,
    metalness: 1,
    roughness: 0.035,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 2.4,
  });
}

export function carbonMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x141414,
    metalness: 0.72,
    roughness: 0.42,
    envMapIntensity: 0.8,
  });
}

export function rubberMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x141414,
    metalness: 0,
    roughness: 0.86,
  });
}

export function chromeMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xd5d8de,
    metalness: 1,
    roughness: 0.16,
    envMapIntensity: 1.7,
  });
}

export function softCircleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
