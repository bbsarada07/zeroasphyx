// Payment gate, contractor scoreboard, evidence report and public verification.
const config = require('./config');
const audit = require('./audit');
const { verifyReadingSig } = require('./signing');
const { localDate, localTime, nowIso, httpError } = require('./util');

function permitsForJob(store, manholeId, jobDate) {
  return store.all('permits').filter((p) => p.manholeId === manholeId && localDate(p.issuedAt) === jobDate);
}

const incidentsFor = (store, permitId) => store.all('incidents').filter((i) => i.permitId === permitId);

// Was the permit in hand before any work was monitored on it?
function grantedBeforeWork(store, p) {
  const first = store.all('telemetry').find((t) => t.permitId === p.id);
  return !first || Date.parse(p.issuedAt) <= Date.parse(first.ts);
}

const isClean = (store, p) => p.status === 'CLOSED' && incidentsFor(store, p.id).length === 0 && grantedBeforeWork(store, p);

// Evaluates the permit side of the gate (no chain check). Returns {ok, reason, permitId}.
function evaluatePermits(store, bill) {
  const mh = bill.manholeId;
  const candidates = permitsForJob(store, mh, bill.jobDate);
  if (!candidates.length) {
    return { ok: false, permitId: null, reason: `No entry permit was issued for ${mh} on ${bill.jobDate}. No Reading, No Entry, No Payment.` };
  }
  const clean = candidates.find((p) => isClean(store, p));
  if (clean) return { ok: true, permitId: clean.id, permit: clean };

  const p = candidates[candidates.length - 1];
  const incs = incidentsFor(store, p.id);
  let reason;
  if (incs.length) {
    reason = `Permit ${p.id} has a recorded ${incs.map((i) => i.cause.replace('_', ' ')).join(' and ')} incident. Payment is held until the incident is investigated.`;
  } else if (p.status === 'REVOKED') {
    reason = `Permit ${p.id} was REVOKED during the job because of unsafe gas: ${p.revokeReason || 'gas alarm'}. Workers were exposed to unsafe air.`;
  } else if (p.status === 'EXPIRED') {
    reason = `Permit ${p.id} expired before the job was closed. A re-test was required and not done.`;
  } else if (p.jobOpen) {
    reason = `The job on permit ${p.id} is still open. The supervisor must close it before the bill can be paid.`;
  } else if (!grantedBeforeWork(store, p)) {
    reason = `Permit ${p.id} was issued after work had already started.`;
  } else {
    reason = `Permit ${p.id} did not end CLOSED (status ${p.status}).`;
  }
  return { ok: false, permitId: p.id, reason };
}

function reviewBill(engine, billId) {
  const store = engine.store;
  const bill = store.get('bills', billId);
  if (!bill) throw httpError(404, 'Bill not found');
  const ev = evaluatePermits(store, bill);
  let decision = 'REJECTED';
  let reason = ev.reason;
  if (ev.ok) {
    const chain = audit.verify(store);
    if (!chain.ok) {
      reason = `The audit log failed its integrity check at record #${chain.brokenAt}, so the evidence for this job cannot be trusted.`;
    } else {
      const p = ev.permit;
      const reading = store.get('readings', p.readingId);
      decision = 'APPROVED';
      reason = `Permit ${p.id} was issued at ${localTime(p.issuedAt)} after a signed safe reading${reading && reading.maxDepth ? ` down to ${reading.maxDepth} cm` : ''}, `
        + `and the job was closed at ${localTime(p.closedAt)} with no incidents. Audit chain verified (${chain.count} records).`;
    }
  }
  const updated = store.update('bills', bill.id, { status: decision, reason, permitId: ev.permitId, reviewedAt: nowIso() });
  engine.log('BILL_DECISION', { billId: bill.id, contractorId: bill.contractorId, manholeId: bill.manholeId, jobDate: bill.jobDate, decision, reason, permitId: ev.permitId });
  engine.changed();
  return updated;
}

function scoreboard(store) {
  return store.all('contractors').map((c) => {
    const bills = store.all('bills').filter((b) => b.contractorId === c.id);
    const permits = store.all('permits').filter((p) => p.contractorId === c.id);
    const denials = store.all('readings').filter((r) => r.contractorId === c.id && r.decision === 'DENIED');
    const incidents = store.all('incidents').filter((i) => i.contractorId === c.id);
    const compliantJobs = bills.filter((b) => evaluatePermits(store, b).ok).length;
    return {
      contractorId: c.id,
      name: c.name,
      jobs: bills.length,
      compliantJobs,
      permitsGranted: permits.length,
      denials: denials.length,
      revocations: permits.filter((p) => p.status === 'REVOKED').length,
      incidents: incidents.length,
      rejectedBills: bills.filter((b) => b.status === 'REJECTED').length,
      compliancePct: bills.length ? Math.round((100 * compliantJobs) / bills.length) : 100,
    };
  });
}

const publicDevice = (d) => (d ? { id: d.id, type: d.type, label: d.label, calibrationDue: d.calibrationDue } : null);

function report(store, id) {
  let permit = store.get('permits', id);
  let focusIncident = null;
  if (!permit) {
    focusIncident = store.get('incidents', id);
    if (focusIncident) permit = store.get('permits', focusIncident.permitId);
  }
  if (!permit) throw httpError(404, `No permit or incident with id ${id}`);

  const session = store.get('sessions', permit.sessionId);
  const readings = store.all('readings').filter((r) => r.sessionId === permit.sessionId).map((r) => {
    const device = store.get('devices', r.deviceId);
    return { ...r, sigValid: device ? verifyReadingSig(r, device.secret) : false };
  });
  const incidents = incidentsFor(store, permit.id);
  const incidentIds = new Set(incidents.map((i) => i.id));
  const readingIds = new Set(readings.map((r) => r.id));
  const events = store.allEvents().filter((e) => {
    const d = e.data || {};
    return d.permitId === permit.id || (session && d.sessionId === session.id) || incidentIds.has(d.incidentId) || readingIds.has(d.readingId);
  });
  const telemetry = store.all('telemetry').filter((t) => t.permitId === permit.id);
  const bills = store.all('bills').filter((b) => b.permitId === permit.id
    || (b.manholeId === permit.manholeId && b.jobDate === localDate(permit.issuedAt)));
  return {
    generatedAt: nowIso(),
    focus: focusIncident ? { kind: 'incident', id: focusIncident.id } : { kind: 'permit', id: permit.id },
    permit,
    session,
    manhole: store.get('manholes', permit.manholeId),
    worker: store.get('workers', permit.workerId),
    supervisor: store.get('supervisors', permit.supervisorId),
    contractor: store.get('contractors', permit.contractorId),
    probe: publicDevice(store.get('devices', permit.deviceId)),
    beacon: publicDevice(store.get('devices', config.beaconId)),
    readings,
    incidents,
    telemetry: telemetry.slice(-30),
    telemetryCount: telemetry.length,
    events,
    notes: events.filter((e) => e.type === 'NOTE_ADDED').map((e) => ({ seq: e.seq, ts: e.ts, author: e.data.author, text: e.data.text })),
    bills,
    chain: audit.verify(store),
  };
}

function publicVerify(store, id) {
  const p = store.get('permits', id);
  if (!p) return { status: 'NOT_FOUND', permitId: id };
  let status = p.status;
  if (status === 'ACTIVE') status = Date.now() <= Date.parse(p.expiresAt) ? 'VALID' : 'EXPIRED';
  const m = store.get('manholes', p.manholeId);
  return {
    status,
    permitId: p.id,
    manhole: m ? { id: m.id, address: m.address } : { id: p.manholeId },
    issuedAt: p.issuedAt,
    expiresAt: p.expiresAt,
    closedAt: p.closedAt,
    revokedAt: p.revokedAt,
    checkedAt: nowIso(),
  };
}

module.exports = { reviewBill, scoreboard, report, publicVerify, evaluatePermits };
