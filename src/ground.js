import { clamp, fbm, lerp, smoothstep } from './util.js';

export const ROAD_HALF = 6;
export const VERGE = 11.6;
export const VERGE_DROP = 0.5;
export const BANK_OUTER = 29;

// Extra world-Y drop from the asphalt edge out to the gravel lip.
export function vergeDrop(lateral) {
  const abs = Math.abs(lateral);
  if (abs <= ROAD_HALF) return 0;
  const t = clamp((abs - ROAD_HALF) / (VERGE - ROAD_HALF), 0, 1);
  return VERGE_DROP * t;
}

export function naturalHeight(x, z, lake) {
  let h = fbm(x * 0.0042, z * 0.0042, 5) * 16 - 2.4;
  h += (fbm(x * 0.018, z * 0.018, 3) - 0.5) * 2.2;
  const dl = Math.hypot(x - lake.x, z - lake.z);
  const shore = smoothstep(lake.radius + 34, lake.radius + 2, dl);
  const submerged = smoothstep(lake.radius + 2, lake.radius * 0.55, dl);
  h = lerp(h, lake.y + 0.12, shore);
  h = lerp(h, lake.y - 1.6, submerged);
  return h;
}

// Visible ground: asphalt plane, gravel lip, then a bank that eases into the hills.
export function surfaceHeight(x, z, circuit, sample = circuit.query(x, z)) {
  const natural = naturalHeight(x, z, circuit.lake);
  const abs = Math.abs(sample.lateral);
  const plane = sample.height;
  if (abs <= VERGE) return plane - vergeDrop(abs);
  const shoulder = plane - VERGE_DROP;
  const rise = natural - shoulder;
  const reach = clamp(18 + Math.abs(rise) * 2.2, 20, 46);
  const t = smoothstep(VERGE, VERGE + reach, abs);
  return lerp(shoulder, natural, t);
}

// Mesh height under the road and bank. A few centimetres down, so the
// coarse grid cannot poke through the ribbons that draw the surface.
export function terrainHeight(x, z, circuit) {
  const sample = circuit.query(x, z);
  const y = surfaceHeight(x, z, circuit, sample);
  const fade = smoothstep(BANK_OUTER, BANK_OUTER - 7, Math.abs(sample.lateral));
  return y - 0.08 * fade;
}
