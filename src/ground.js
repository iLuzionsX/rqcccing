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

// Ridge ground follows the loop: the inside climbs into the massif, the
// outside falls toward the tarn, and nearby roads share one blended height
// so two legs of the stage do not tear a wall between them.
function ridgeNatural(x, z, circuit, nearest) {
  const samples = circuit.samples;
  const center = circuit.centroid;
  let weight = 0;
  let height = 0;
  let inward = 0;
  const step = Math.max(1, Math.floor((samples.length - 1) / 120));
  for (let i = 0; i < samples.length - 1; i += step) {
    const sample = samples[i];
    const dx = x - sample.point.x;
    const dz = z - sample.point.z;
    const influence = Math.exp(-(dx * dx + dz * dz) / (2 * 64 * 64));
    if (influence < 0.004) continue;
    weight += influence;
    height += sample.point.y * influence;
    const lateral = dx * sample.right.x + dz * sample.right.z;
    const centerSide = (center.x - sample.point.x) * sample.right.x + (center.z - sample.point.z) * sample.right.z;
    inward += Math.sign(lateral * centerSide || 1) * influence;
  }
  // Fall back to the centerline, not the banked plane. Far from the loop the
  // plane's lateral term runs away and builds a wall at the edge of the map.
  const roadY = weight > 0 ? height / weight : nearest.point.y;
  const inside = inward >= 0;
  const dist = Math.abs(nearest.lateral);
  const detail = fbm(x * 0.012, z * 0.012, 4);
  const broad = fbm(x * 0.0034, z * 0.0034, 3);
  let h;
  if (inside) {
    const climb = 1 - Math.exp(-Math.max(0, dist - 8) / 72);
    h = roadY + climb * (12 + broad * 7) + (detail - 0.5) * 1.8;
  } else {
    const fall = 1 - Math.exp(-Math.max(0, dist - 8) / 90);
    h = roadY - fall * (5.5 + broad * 3.2) + (detail - 0.4) * 2.8;
  }
  const lake = circuit.lake;
  const dl = Math.hypot(x - lake.x, z - lake.z);
  h = lerp(h, lake.y + 0.06, smoothstep(lake.radius + 22, lake.radius + 1.4, dl));
  h = lerp(h, lake.y - 1.25, smoothstep(lake.radius + 1.4, lake.radius * 0.4, dl));
  // The loop sits in the middle of the terrain mesh. Beyond it the ground
  // eases down so the high crest does not become a plateau at the map edge.
  const far = smoothstep(160, 340, dist);
  h = lerp(h, 5 + broad * 3.2, far);
  return h;
}

// Visible ground: asphalt plane, gravel lip, then a bank that eases into the hills.
export function surfaceHeight(x, z, circuit, sample = circuit.query(x, z)) {
  const ridge = circuit.stageId === 'ridge';
  const natural = ridge ? ridgeNatural(x, z, circuit, sample) : naturalHeight(x, z, circuit.lake);
  const abs = Math.abs(sample.lateral);
  const plane = sample.height;
  if (abs <= VERGE) return plane - vergeDrop(abs);
  const shoulder = plane - VERGE_DROP;
  const reach = ridge ? 24 : clamp(18 + Math.abs(natural - shoulder) * 2.2, 20, 46);
  const t = smoothstep(VERGE, VERGE + reach, abs);
  return lerp(shoulder, natural, t);
}

// Mesh height under the road and bank. A few centimetres down, so the
// coarse grid cannot poke through the ribbons that draw the surface.
export function terrainHeight(x, z, circuit) {
  const sample = circuit.query(x, z);
  const y = surfaceHeight(x, z, circuit, sample);
  const outer = circuit.bankOuter || BANK_OUTER;
  const fade = smoothstep(outer, outer - 7, Math.abs(sample.lateral));
  return y - 0.08 * fade;
}
