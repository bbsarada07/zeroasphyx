// AI predictive risk engine: a compound risk score (0–100) and gas-vs-depth trend extrapolation that
// predicts the depth at which the air becomes unsafe, before the worker gets there.
// firmware/sketch.ino computes the same score on the probe (localRiskScore) so the edge warns even offline.

const GASES = ['h2s', 'co', 'ch4', 'o2'];
const TREND_THRESHOLD = 0.01; // |slope| per cm (1 ppm per metre) below which a gas counts as stable
const BREACH_FLOOR = 70; // a gas past its hard limit is always DANGER, whatever the formula says

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const levelOf = (score) => (score >= 70 ? 'DANGER' : score >= 40 ? 'CAUTION' : 'SAFE');

// How close one gas is to its limit, in percent. Missing values count as 100 (fail-safe).
function gasPct(key, v, g) {
  if (!Number.isFinite(v)) return 100;
  if (key === 'h2s') return (v / g.h2sMax) * 100;
  if (key === 'co') return (v / g.coMax) * 100;
  if (key === 'ch4') return (v / g.ch4Max) * 100;
  if (v < g.o2Min) return ((g.o2Min - v) / g.o2Min) * 100 * 3; // oxygen deficiency: weighted 3x
  if (v > g.o2Max) return ((v - g.o2Max) / g.o2Max) * 100 * 2; // oxygen excess: weighted 2x
  return 0;
}

function breached(key, v, g) {
  if (!Number.isFinite(v)) return true;
  if (key === 'o2') return v < g.o2Min || v > g.o2Max;
  return v >= g[`${key}Max`];
}

// Score from the current point; any breach in `history` lifts that gas to the DANGER floor.
function compound(point, history, g) {
  let worstGas = GASES[0];
  let worst = -Infinity;
  for (const key of GASES) {
    let pct = gasPct(key, num(point[key]), g);
    if (history.some((p) => breached(key, num(p[key]), g))) pct = Math.max(pct, BREACH_FLOOR);
    if (pct > worst) {
      worst = pct;
      worstGas = key;
    }
  }
  const score = clamp(Math.round(worst), 0, 100);
  return { score, level: levelOf(score), worstGas };
}

// Least-squares line value = a + b * depth. Null when it can't be fitted.
function fitLine(points) {
  if (points.length < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const my = points.reduce((s, p) => s + p.y, 0) / points.length;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

const stableTrends = () => Object.fromEntries(GASES.map((k) => [k, { rate: 0, direction: 'stable' }]));

/**
 * Descent assessment.
 * @param samples [{d, h2s, ch4, co, o2}] in descent order
 * @param gasCfg  config.gas limits
 */
function assess(samples, gasCfg) {
  const list = Array.isArray(samples) ? samples : [];
  if (!list.length) {
    // No measurements: nothing can be called safe.
    return { score: 100, level: 'DANGER', trends: stableTrends(), predictedSafeDepth: null, worstGas: null };
  }
  const { score, level, worstGas } = compound(list[list.length - 1], list, gasCfg);
  if (list.length < 2) return { score, level, trends: stableTrends(), predictedSafeDepth: null, worstGas };

  const trends = {};
  const crossings = [];
  for (const key of GASES) {
    const pts = list.map((s) => ({ x: num(s.d), y: num(s[key]) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const line = fitLine(pts);
    const b = line ? line.b : 0;
    const direction = b > TREND_THRESHOLD ? 'rising' : b < -TREND_THRESHOLD ? 'falling' : 'stable';
    trends[key] = { rate: Math.round(b * 10000) / 10000, direction };

    // Extrapolate only gases moving toward their limit: H2S/CO/CH4 rising, O2 falling (or rising past max).
    const toward = key === 'o2' ? direction !== 'stable' : direction === 'rising';
    if (!line || !toward) continue;
    const limit = key === 'o2' ? (b < 0 ? gasCfg.o2Min : gasCfg.o2Max) : gasCfg[`${key}Max`];
    const depth = (limit - line.a) / b;
    if (Number.isFinite(depth)) crossings.push(Math.max(0, Math.round(depth)));
  }
  const predictedSafeDepth = crossings.length ? Math.min(...crossings) : null;
  return { score, level, trends, predictedSafeDepth, worstGas };
}

/** Single telemetry point while monitoring: score only, no trend. */
function assessMonitor(reading, gasCfg) {
  const point = reading || {};
  return { ...compound(point, [point], gasCfg), trends: null, predictedSafeDepth: null };
}

module.exports = { assess, assessMonitor };
