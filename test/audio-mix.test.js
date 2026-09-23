import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioAssetUrl, engineRpm, loadAudioFiles, scrubAmount, surfaceKind } from '../src/audio.js';

test('engine rpm follows the gear and drops when the next gear takes over', () => {
  const low = engineRpm(8, 1);
  const high = engineRpm(18, 1);
  assert.ok(high > low + 0.15, `rpm should climb in gear, ${low.toFixed(2)} to ${high.toFixed(2)}`);
  const beforeShift = engineRpm(13.4, 1);
  const afterShift = engineRpm(13.6, 2);
  assert.ok(afterShift < beforeShift - 0.2, `shift should drop rpm ${beforeShift.toFixed(2)} to ${afterShift.toFixed(2)}`);
});

test('a straight roll stays quiet and a slide or handbrake does not', () => {
  assert.equal(scrubAmount(0.02, 0, 16), 0);
  assert.ok(scrubAmount(0.4, 0, 16) > 0.6);
  assert.ok(scrubAmount(0.02, 1, 16) > 0.7);
  assert.equal(scrubAmount(0.5, 1, 0.2), 0);
});

test('sampled audio is requested under the app base, not the domain root', async () => {
  const urls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  try {
    const loaded = await loadAudioFiles();
    assert.equal(loaded.length, 4);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(urls, [
    audioAssetUrl('engine.ogg'),
    audioAssetUrl('squeal.ogg'),
    audioAssetUrl('gravel.ogg'),
    audioAssetUrl('asphalt.ogg'),
  ]);
  for (const url of urls) {
    assert.equal(url.startsWith('/'), false, url);
    assert.match(url, /assets\/audio\/.+\.ogg$/);
  }
});

test('a missing sample rejects the loader so the race can continue without it', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
  try {
    await assert.rejects(loadAudioFiles(), /Missing /);
  } finally {
    globalThis.fetch = original;
  }
});

test('Golden Hour asphalt and Ridgebreak gravel are different surfaces', () => {
  assert.equal(surfaceKind('coast', 0), 'asphalt');
  assert.equal(surfaceKind('ridge', 0), 'gravel');
  assert.equal(surfaceKind('coast', 7), 'grass');
});
