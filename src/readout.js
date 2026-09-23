const BEST_LAP_KEY = 'rqcccing.bestLap';

export function formatTime(value) {
  if (value == null || !Number.isFinite(value)) return '--:--.---';
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

export function displayedCountdown(countdown) {
  const n = Math.min(3, Math.ceil(countdown));
  return n > 0 ? String(n) : '';
}

export function gearLabel(speed, vLong, gear) {
  if (Math.abs(speed) < 0.7) return 'N';
  if (vLong < 0) return 'R';
  return String(gear || 1);
}

export function stageDistanceText(lengthMeters, bestSeconds) {
  const distance = `${(Number(lengthMeters) / 1000).toFixed(2)} KM`;
  if (!validLap(bestSeconds)) return distance;
  return `${distance}\nBEST ${formatTime(bestSeconds)}`;
}

export function readBestLap(storage, stageId) {
  if (!validStageId(stageId)) return null;
  try {
    const time = readBestLaps(storage)[stageId];
    return time == null ? null : time;
  } catch {
    return null;
  }
}

export function writeBestLap(storage, stageId, lapTime) {
  if (!validStageId(stageId) || !validLap(lapTime)) return readBestLap(storage, stageId);
  let laps;
  try {
    laps = readBestLaps(storage);
  } catch {
    return null;
  }
  const previous = laps[stageId];
  if (previous != null && lapTime >= previous) return previous;
  laps[stageId] = lapTime;
  try {
    storage.setItem(BEST_LAP_KEY, JSON.stringify(laps));
  } catch {
    return previous ?? null;
  }
  return lapTime;
}

function readBestLaps(storage) {
  const raw = storage.getItem(BEST_LAP_KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const laps = {};
  for (const [stageId, time] of Object.entries(parsed)) {
    if (!validStageId(stageId) || !validLap(time)) continue;
    laps[stageId] = time;
  }
  return laps;
}

function validStageId(stageId) {
  return typeof stageId === 'string' && stageId.length > 0;
}

function validLap(lapTime) {
  return typeof lapTime === 'number' && Number.isFinite(lapTime) && lapTime > 0;
}
