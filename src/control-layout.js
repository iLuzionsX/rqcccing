import { clamp } from './util.js';

export const CONTROL_IDS = ['wheel', 'gas', 'brake', 'handbrake'];
export const LAYOUT_KEY = 'rqcccing.controlLayout';

export function readLayout(storage) {
  try {
    const raw = storage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const layout = {};
    for (const id of CONTROL_IDS) {
      const point = parsed?.[id];
      if (!unit(point?.x) || !unit(point?.y)) return null;
      layout[id] = { x: point.x, y: point.y };
    }
    return layout;
  } catch {
    return null;
  }
}

export function writeLayout(storage, layout) {
  const stored = {};
  for (const id of CONTROL_IDS) {
    const point = layout?.[id];
    if (!unit(point?.x) || !unit(point?.y)) return false;
    stored[id] = { x: point.x, y: point.y };
  }
  storage.setItem(LAYOUT_KEY, JSON.stringify(stored));
  return true;
}

export function clearLayout(storage) {
  storage.removeItem(LAYOUT_KEY);
}

export function clampCenter(x, y, width, height, viewWidth, viewHeight, margin = 8) {
  const halfW = Math.min(width / 2, Math.max(0, viewWidth / 2 - margin));
  const halfH = Math.min(height / 2, Math.max(0, viewHeight / 2 - margin));
  return {
    x: clamp(x, margin + halfW, Math.max(margin + halfW, viewWidth - margin - halfW)),
    y: clamp(y, margin + halfH, Math.max(margin + halfH, viewHeight - margin - halfH)),
  };
}

export function separateControls(movedId, centers, sizes, view, margin = 8) {
  const next = { x: centers[movedId].x, y: centers[movedId].y };
  for (let pass = 0; pass < 10; pass += 1) {
    let pushed = false;
    for (const id of CONTROL_IDS) {
      if (id === movedId || !centers[id]) continue;
      const minX = (sizes[movedId].w + sizes[id].w) / 2 * 0.82;
      const minY = (sizes[movedId].h + sizes[id].h) / 2 * 0.82;
      const dx = next.x - centers[id].x;
      const dy = next.y - centers[id].y;
      const overlapX = minX - Math.abs(dx);
      const overlapY = minY - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      if (overlapX < overlapY) next.x += Math.sign(dx || 1) * (overlapX + 8);
      else next.y += Math.sign(dy || 1) * (overlapY + 8);
      pushed = true;
    }
    const fitted = clampCenter(next.x, next.y, sizes[movedId].w, sizes[movedId].h, view.w, view.h, margin);
    next.x = fitted.x;
    next.y = fitted.y;
    if (!pushed) break;
  }
  return next;
}

function unit(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
