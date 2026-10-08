// Tamper-evident, hash-chained event log.
// hash = SHA256(prevHash + seq + ts + type + canonicalJSON(data))
const { canonical, sha256, nowIso } = require('./util');

const GENESIS = '0'.repeat(64);

const computeHash = (prevHash, seq, ts, type, data) => sha256(`${prevHash}${seq}${ts}${type}${canonical(data)}`);

function append(store, type, data, ts = nowIso()) {
  const last = store.lastEvent();
  const seq = last ? last.seq + 1 : 1;
  const prevHash = last ? last.hash : GENESIS;
  const clean = JSON.parse(canonical(data || {}));
  const e = { seq, ts, type, data: clean, prevHash, hash: computeHash(prevHash, seq, ts, type, clean) };
  store.appendEvent(e);
  return e;
}

function verify(store) {
  const events = store.readStoredEvents();
  let prev = GENESIS;
  for (const e of events) {
    if (e.prevHash !== prev) {
      return { ok: false, count: events.length, brokenAt: e.seq, reason: 'prevHash does not match the hash of the previous record' };
    }
    if (computeHash(e.prevHash, e.seq, e.ts, e.type, e.data) !== e.hash) {
      return { ok: false, count: events.length, brokenAt: e.seq, reason: 'record contents no longer match its stored hash' };
    }
    prev = e.hash;
  }
  return { ok: true, count: events.length, head: prev };
}

// Demo only: silently edit one stored record (without fixing its hash) so verification can show the break.
function tamper(store) {
  const events = store.allEvents();
  const target = events.find((e) => e.type === 'PERMIT_REVOKED')
    || events.find((e) => e.type === 'PERMIT_DENIED')
    || events[Math.floor(events.length / 2)];
  if (!target) return null;
  const before = target.data;
  let after;
  let description;
  if (target.type === 'PERMIT_REVOKED') {
    after = { ...before, reason: 'Routine close by contractor', gas: [] };
    description = `Rewrote revocation of ${before.permitId}: unsafe-gas reason replaced with "Routine close by contractor".`;
  } else if (target.type === 'PERMIT_DENIED') {
    after = { ...before, reason: 'OK', detail: 'Safe' };
    description = `Rewrote denial for session ${before.sessionId} to look like a pass.`;
  } else {
    after = { ...before, edited: true };
    description = `Edited record #${target.seq}.`;
  }
  store.overwriteEventData(target.seq, after);
  return { seq: target.seq, type: target.type, before, after, description };
}

module.exports = { append, verify, tamper, computeHash, GENESIS };
