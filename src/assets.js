import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareRallyMaterials } from './car.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const base = import.meta.env.BASE_URL;

function assetUrl(path) {
  return `${base}assets/${path}`;
}

function configureTexture(texture, srgb, anisotropy) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return texture;
}

async function loadTexture(loader, path, srgb, anisotropy) {
  const texture = await loader.loadAsync(assetUrl(path));
  return configureTexture(texture, srgb, anisotropy);
}

async function loadMapSet(loader, name, anisotropy, maps) {
  const entries = await Promise.all(maps.map(async ([key, file, srgb]) => {
    const texture = await loadTexture(loader, `textures/${name}_${file}.jpg`, srgb, anisotropy);
    return [key, texture];
  }));
  return Object.fromEntries(entries);
}

export async function loadGameAssets(renderer, stageId = 'coast') {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const textures = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();
  const rgbe = new RGBELoader();
  const ridgeModel = (path) => (stageId === 'ridge' ? gltfLoader.loadAsync(assetUrl(path)) : Promise.resolve(null));

  const [hdr, asphalt, gravel, grass, tree, shrubA, shrubB, grassPatch, rock, boulder, flower, rally, fir, pine, grassTuft, moss, stump, trunk, crate, face] = await Promise.all([
    rgbe.loadAsync(assetUrl('hdri/kiara_1_dawn_2k.hdr')),
    loadMapSet(textures, 'asphalt', anisotropy, [['map', 'diff', true], ['normalMap', 'nor', false], ['roughnessMap', 'rough', false], ['aoMap', 'ao', false]]),
    loadMapSet(textures, 'gravel', anisotropy, [['map', 'diff', true], ['normalMap', 'nor', false], ['roughnessMap', 'rough', false]]),
    loadMapSet(textures, 'grass', anisotropy, [['map', 'diff', true], ['normalMap', 'nor', false], ['roughnessMap', 'rough', false], ['aoMap', 'ao', false]]),
    gltfLoader.loadAsync(assetUrl('models/quiver_tree/quiver_tree_01_1k.gltf')),
    gltfLoader.loadAsync(assetUrl('models/shrub_a/shrub_03_1k.gltf')),
    gltfLoader.loadAsync(assetUrl('models/shrub_b/shrub_04_1k.gltf')),
    gltfLoader.loadAsync(assetUrl('models/grass_patch/grass_medium_02_1k.gltf')),
    gltfLoader.loadAsync(assetUrl('models/rock/rock_09_1k.gltf')),
    gltfLoader.loadAsync(assetUrl('models/boulder/boulder_01_1k.gltf')),
    gltfLoader.loadAsync(assetUrl('models/flower/flower_gazania_1k.gltf')),
    gltfLoader.loadAsync(assetUrl('models/rally/scene.gltf')),
    ridgeModel('models/fir/fir_sapling.glb'),
    ridgeModel('models/pine/pine_sapling.glb'),
    ridgeModel('models/grass_tuft/grass_medium_01_1k.gltf'),
    ridgeModel('models/rock_moss/rock_moss.glb'),
    ridgeModel('models/tree_stump/tree_stump.glb'),
    ridgeModel('models/dead_trunk/dead_tree_trunk.glb'),
    ridgeModel('models/crate/wooden_crate_01_1k.gltf'),
    ridgeModel('models/rock_face/rock_face.glb'),
  ]);

  hdr.mapping = THREE.EquirectangularReflectionMapping;
  grass.map.repeat.set(80, 80);
  grass.normalMap.repeat.set(80, 80);
  grass.roughnessMap.repeat.set(80, 80);
  grass.aoMap.repeat.set(80, 80);
  prepareRallyMaterials(rally);

  return {
    hdr,
    asphalt,
    gravel,
    grass,
    props: { tree, shrubA, shrubB, grassPatch, rock, boulder, flower },
    ridge: stageId === 'ridge' ? { fir, pine, grass: grassTuft, moss, stump, trunk, crate, face } : null,
    rally,
  };
}
