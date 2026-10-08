const crypto = require('crypto');
const config = require('./config');

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function rid(prefix, len = 6) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[bytes[i] % ALPHA.length];
  return `${prefix}-${s}`;
}

const nowIso = () => new Date().toISOString();

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

// YYYY-MM-DD in the municipality's timezone
const localDate = (t) => dateFmt.format(new Date(t));
const localTime = (t) => timeFmt.format(new Date(t));

// Great-circle distance in metres between two points given in microdegrees.
function distanceM(lat1, lng1, lat2, lng2) {
  const toRad = (micro) => (Number(micro) / 1e6) * (Math.PI / 180);
  const dLat = toRad(lat2) - toRad(lat1);
  const dLng = toRad(lng2) - toRad(lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Deterministic JSON: object keys sorted recursively, undefined dropped.
function canonical(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(',')}}`;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { rid, nowIso, localDate, localTime, distanceM, canonical, sha256, httpError, delay };
