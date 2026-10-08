const TZ = 'Asia/Kolkata';

export const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
export const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (t) => (t ? `${fmtDate(t)}, ${fmtTime(t)}` : '—');
export const fmtJobDate = (d) => (d ? new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtMoney = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
export const fmtO2 = (o2) => (o2 === null || o2 === undefined ? '—' : (o2 / 10).toFixed(1));
export const shortHash = (h) => (h ? `${h.slice(0, 10)}…` : '—');

export function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function ago(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  return `${Math.floor(s / 60)} min ${s % 60} s ago`;
}

// Plain-language headline for each denial code (the server supplies the specific detail).
export const REASON_HEADLINE = {
  OK: 'Safe to enter',
  UNKNOWN_DEVICE: 'Unregistered probe',
  CALIBRATION_EXPIRED: 'Probe calibration has expired',
  BAD_SIGNATURE: 'Reading was tampered with',
  INVALID_SESSION: 'Not a fresh test (expired or replayed reading)',
  WRONG_LOCATION: 'Reading taken at the wrong place',
  PROBE_NOT_LOWERED: 'Probe was not lowered into the manhole',
  UNSAFE_GAS: 'Unsafe gas inside the manhole',
};

export const GAS = [
  { key: 'h2s', label: 'H₂S', unit: 'ppm', fmt: (v) => v },
  { key: 'co', label: 'CO', unit: 'ppm', fmt: (v) => v },
  { key: 'ch4', label: 'CH₄', unit: '% LEL', fmt: (v) => v },
  { key: 'o2', label: 'O₂', unit: '%', fmt: fmtO2 },
];

export function gasSafe(key, v, g) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return false;
  if (key === 'h2s') return v < g.h2sMax;
  if (key === 'co') return v < g.coMax;
  if (key === 'ch4') return v < g.ch4Max;
  if (key === 'o2') return v >= g.o2Min && v <= g.o2Max;
  return true;
}

export function gasLimitText(key, g) {
  if (key === 'h2s') return `safe below ${g.h2sMax}`;
  if (key === 'co') return `safe below ${g.coMax}`;
  if (key === 'ch4') return `safe below ${g.ch4Max}`;
  return `safe ${g.o2Min / 10}–${g.o2Max / 10}`;
}

const nameOf = (list, id) => (list || []).find((x) => x.id === id)?.name || id || '—';
export const workerName = (refs, id) => nameOf(refs?.workers, id);
export const supervisorName = (refs, id) => nameOf(refs?.supervisors, id);
export const contractorName = (refs, id) => nameOf(refs?.contractors, id);
export const manholeOf = (refs, id) => (refs?.manholes || []).find((m) => m.id === id);

// One-line description of an audit event.
export function summarizeEvent(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'SESSION_STARTED': return `Test ${d.sessionId} at ${d.manholeId} · worker ${d.workerId} · ${d.deviceId} · nonce ${d.nonce}`;
    case 'READING_RECEIVED': return `${d.deviceId} → ${d.sessionId} · ${d.sampleCount} samples · via ${d.source} · sig ${String(d.sig || '').slice(0, 12)}…`;
    case 'PERMIT_GRANTED': return `${d.permitId} for ${d.manholeId} · probe reached ${d.maxDepth} cm · worker ${d.workerId}`;
    case 'PERMIT_DENIED': return `${d.reason} · ${d.detail}`;
    case 'PERMIT_REVOKED': return `${d.permitId} · ${d.reason}`;
    case 'PERMIT_EXPIRED': return `${d.permitId} expired${d.jobOpen ? ' while job open' : ''}`;
    case 'JOB_CLOSED': return `${d.permitId} closed by ${d.closedBy} · final status ${d.finalStatus}`;
    case 'INCIDENT': return `${d.cause} on ${d.permitId} · ${d.source}`;
    case 'INCIDENT_ACKNOWLEDGED': return `${d.incidentId} acknowledged`;
    case 'SIGNAL_LOST': return `Beacon silent on ${d.permitId}`;
    case 'SIGNAL_RESTORED': return `Beacon back on ${d.permitId}`;
    case 'ALERT_UNLINKED': return `${d.type} from ${d.deviceId} with no open job`;
    case 'BILL_DECISION': return `${d.billId} ${d.decision} · ${d.reason}`;
    case 'DEMO_SEEDED': return 'Demo data loaded';
    default: return JSON.stringify(d);
  }
}
