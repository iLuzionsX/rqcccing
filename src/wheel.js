import { clamp } from './util.js';

// CarX Drift Racing's on-screen wheel at its default (not a Logitech wheel,
// and not the optional sensitivity slider). The thumb adds angle around the
// center. A new grab does not jump the wheel onto the finger. Full lock is
// a quarter turn, the output is linear, a few degrees in the middle do not
// steer, and releasing the wheel springs it home. Motion on the hub is
// ignored so a thumb crossing the middle cannot flip the angle.
export const WHEEL_LOCK = Math.PI / 2;
export const WHEEL_DEADZONE = 0.04;
export const WHEEL_RETURN = 12;
export const WHEEL_SNAP = 0.008;
export const HUB_FRACTION = 0.28;

export function createWheelState() {
  return { rotation: 0, held: false, lastAngle: 0, pointerId: null, onHub: false };
}

export function pointerSample(clientX, clientY, rect, hubFraction = HUB_FRACTION) {
  const x = clientX - (rect.left + rect.width / 2);
  const y = clientY - (rect.top + rect.height / 2);
  const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
  return {
    angle: Math.atan2(x, -y),
    onHub: Math.hypot(x, y) < radius * hubFraction,
  };
}

export function grabWheel(state, sample) {
  state.held = true;
  state.lastAngle = sample.angle;
  state.onHub = sample.onHub;
  return state;
}

export function dragWheel(state, sample) {
  if (!state.held) return state;
  if (sample.onHub || state.onHub) {
    state.lastAngle = sample.angle;
    state.onHub = sample.onHub;
    return state;
  }
  let delta = sample.angle - state.lastAngle;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  state.lastAngle = sample.angle;
  state.onHub = false;
  state.rotation = clamp(state.rotation + delta, -WHEEL_LOCK, WHEEL_LOCK);
  return state;
}

export function releaseWheel(state) {
  state.held = false;
  state.onHub = false;
  state.pointerId = null;
  return state;
}

export function resetWheel(state) {
  state.rotation = 0;
  state.held = false;
  state.lastAngle = 0;
  state.onHub = false;
  state.pointerId = null;
  return state;
}

export function wheelSteer(rotation) {
  const raw = clamp(rotation / WHEEL_LOCK, -1, 1);
  const mag = Math.abs(raw);
  if (mag <= WHEEL_DEADZONE) return 0;
  return Math.sign(raw) * (mag - WHEEL_DEADZONE) / (1 - WHEEL_DEADZONE);
}

export function springWheel(rotation, dt) {
  if (rotation === 0) return 0;
  const next = rotation * Math.exp(-WHEEL_RETURN * dt);
  return Math.abs(next) < WHEEL_SNAP ? 0 : next;
}
