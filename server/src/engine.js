// The single ingestion path. MQTT messages (LIVE) and simulator scenarios (SIM) both call
// handleReading / handleTelemetry / handleAlert here.
const crypto = require('crypto');
const EventEmitter = require('events');
const config = require('./config');
const audit = require('./audit');
const { decide } = require('./decision');
const { gasFailures, describeFailures } = require('./gas');
const { seed } = require('./seed');
const { rid, nowIso, httpError } = require('./util');

const str = (v) => (v === undefined || v === null ? '' : String(v));
const toBool = (v, dflt) => {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'string') return !['false', '0', 'no', 'off'].includes(v.toLowerCase());
  return Boolean(v);
};
const numOrNull = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const noteOf = (e) => ({ seq: e.seq, ts: e.ts, permitId: e.data.permitId, author: e.data.author, text: e.data.text });

class Engine extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.mode = config.defaultMode;
    this.mqtt = { enabled: config.mqtt.enabled, connected: false, broker: config.mqtt.url, prefix: config.mqtt.prefix };
    this.publisher = null; // set by the MQTT bridge: (topic, payload) => boolean
    this.dataVersion = 0;
    this.resetRuntime();
    if (store.count('manholes') === 0) seed(store);
    // Re-arm monitoring for jobs left open by a previous run.
    for (const p of store.all('permits')) if (p.jobOpen) this.monitor(p.id);
  }

  resetRuntime() {
    this.monitors = new Map();
    this.alerts = [];
    this.latestTelemetry = null;
    this.probeProgress = null;
    this.deviceLog = [];
  }

  // ------------------------------------------------------------------ helpers
  log(type, data, ts) {
    const e = audit.append(this.store, type, data, ts);
    this.dataVersion++;
    return e;
  }

  changed() {
    if (this._changeTimer) return;
    this._changeTimer = setTimeout(() => {
      this._changeTimer = null;
      this.emit('changed');
    }, 25);
  }

  openJob() {
    const open = this.store.all('permits').filter((p) => p.jobOpen);
    return open[open.length - 1] || null;
  }

  monitor(permitId) {
    if (!this.monitors.has(permitId)) {
      this.monitors.set(permitId, { startedAt: Date.now(), lastTelemetryAt: null, stillSince: null, signalLost: false });
    }
    return this.monitors.get(permitId);
  }

  addAlert(type, permitId, message, key = `${type}:${permitId}`) {
    if (this.alerts.some((a) => a.key === key)) return null;
    const alert = { id: rid('A'), key, type, permitId, message, ts: nowIso() };
    this.alerts.push(alert);
    this.changed();
    return alert;
  }

  clearAlerts(pred) {
    this.alerts = this.alerts.filter((a) => !pred(a));
    this.changed();
  }

  dismissAlert(id) {
    this.clearAlerts((a) => a.id === id);
  }

  setMode(mode) {
    if (mode !== 'LIVE' && mode !== 'SIM') throw httpError(400, 'mode must be LIVE or SIM');
    this.mode = mode;
    this.changed();
  }

  setMqttConnected(connected) {
    if (this.mqtt.connected === connected) return;
    this.mqtt.connected = connected;
    this.changed();
  }

  // Server -> device. Goes over MQTT only in LIVE mode; always recorded so the simulator and UI can see it.
  sendToDevice(sub, payload) {
    const topic = `${config.mqtt.prefix}/${sub}`;
    let delivered = false;
    if (this.mode === 'LIVE' && this.publisher) delivered = this.publisher(topic, payload);
    this.deviceLog.unshift({ ts: nowIso(), topic, payload, delivered });
    this.deviceLog.length = Math.min(this.deviceLog.length, 20);
    this.emit('device-msg', sub, payload);
  }

  setProbeProgress(sessionId, samples) {
    this.probeProgress = { sessionId, samples, ts: nowIso() };
    this.changed();
  }

  // ------------------------------------------------------------------ pre-entry test
  startSession({ manholeId, workerId, supervisorId, deviceId }, { allowOpenJob = false } = {}) {
    const manhole = this.store.get('manholes', manholeId);
    const worker = this.store.get('workers', workerId);
    const supervisor = this.store.get('supervisors', supervisorId);
    if (!manhole || !worker || !supervisor || !deviceId) {
      throw httpError(400, 'Choose a valid manhole, worker, supervisor and probe.');
    }
    const open = this.openJob();
    if (open && !allowOpenJob) {
      throw httpError(409, `The job on permit ${open.id} is still open. Close it before starting a new test.`);
    }
    const session = {
      id: rid('S'),
      nonce: crypto.randomBytes(8).toString('hex'),
      manholeId, workerId, supervisorId, contractorId: worker.contractorId, deviceId: String(deviceId),
      createdAt: nowIso(), status: 'PENDING', nonceUsed: false, permitId: null,
    };
    this.store.insert('sessions', session);
    this.log('SESSION_STARTED', {
      sessionId: session.id, manholeId, workerId, supervisorId, contractorId: worker.contractorId,
      deviceId: session.deviceId, nonce: session.nonce,
    });
    this.probeProgress = null;
    this.sendToDevice(`probe/${session.deviceId}/challenge`, { sessionId: session.id, nonce: session.nonce, manholeId });
    this.changed();
    return session;
  }

  handleReading(payload, { source = 'mqtt', topicDeviceId } = {}) {
    if (!payload || typeof payload !== 'object') return null;
    const now = new Date();
    const r = {
      sessionId: str(payload.sessionId),
      nonce: str(payload.nonce),
      deviceId: str(payload.deviceId || topicDeviceId),
      manholeId: str(payload.manholeId),
      lat: payload.lat,
      lng: payload.lng,
      samples: Array.isArray(payload.samples)
        ? payload.samples.map((x) => ({ d: x?.d, h2s: x?.h2s, ch4: x?.ch4, co: x?.co, o2: x?.o2 }))
        : [],
      sig: str(payload.sig).toLowerCase(),
    };
    const readingId = rid('R');
    this.log('READING_RECEIVED', {
      readingId, sessionId: r.sessionId, deviceId: r.deviceId, manholeId: r.manholeId, lat: r.lat, lng: r.lng,
      sampleCount: r.samples.length, sig: r.sig, source,
    });

    const result = decide(r, this.store, now);
    const session = this.store.get('sessions', r.sessionId);
    let permit = null;

    if (result.consumesSession) {
      this.store.update('sessions', session.id, { nonceUsed: true, status: result.decision });
    }

    if (result.decision === 'GRANTED') {
      permit = {
        id: rid('PRM'),
        manholeId: session.manholeId, workerId: session.workerId, supervisorId: session.supervisorId,
        contractorId: session.contractorId, deviceId: r.deviceId, sessionId: session.id, readingId,
        issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + config.permit.validityMs).toISOString(),
        status: 'ACTIVE', jobOpen: true, closedAt: null, closedBy: null, revokedAt: null, revokeReason: null,
      };
      this.store.insert('permits', permit);
      this.store.update('sessions', session.id, { permitId: permit.id });
      this.monitor(permit.id);
      this.log('PERMIT_GRANTED', {
        permitId: permit.id, sessionId: session.id, readingId, manholeId: permit.manholeId, workerId: permit.workerId,
        supervisorId: permit.supervisorId, contractorId: permit.contractorId, deviceId: permit.deviceId,
        issuedAt: permit.issuedAt, expiresAt: permit.expiresAt, maxDepth: result.maxDepth, worst: result.worst,
      });
    } else {
      this.log('PERMIT_DENIED', {
        sessionId: r.sessionId, readingId, deviceId: r.deviceId, manholeId: r.manholeId,
        reason: result.code, detail: result.detail, gas: result.gas,
      });
    }

    const linkedSession = session && session.deviceId === r.deviceId ? session : null;
    const reading = {
      id: readingId, receivedAt: now.toISOString(), source, ...r,
      decision: result.decision, reason: result.code, detail: result.detail, gas: result.gas || null,
      maxDepth: result.maxDepth ?? null, permitId: permit ? permit.id : null,
      sessionConsumed: Boolean(result.consumesSession), contractorId: linkedSession ? linkedSession.contractorId : null,
    };
    this.store.insert('readings', reading);
    if (this.probeProgress && this.probeProgress.sessionId === r.sessionId) this.probeProgress = null;

    const out = { sessionId: r.sessionId, decision: result.decision, reason: result.code };
    if (permit) out.permitId = permit.id;
    this.sendToDevice(`probe/${r.deviceId}/result`, out);
    this.changed();
    return { decision: result.decision, reason: result.code, detail: result.detail, gas: result.gas || null, permitId: out.permitId || null, readingId, sessionId: r.sessionId };
  }

  // ------------------------------------------------------------------ during the job
  handleTelemetry(deviceId, payload) {
    if (!payload || typeof payload !== 'object') return { linked: false };
    const now = Date.now();
    const t = {
      deviceId: str(deviceId), ts: new Date(now).toISOString(), permitId: str(payload.permitId) || null,
      h2s: numOrNull(payload.h2s), ch4: numOrNull(payload.ch4), co: numOrNull(payload.co), o2: numOrNull(payload.o2),
      moving: toBool(payload.moving, true), sos: toBool(payload.sos, false),
    };
    this.latestTelemetry = t;
    const permit = t.permitId ? this.store.get('permits', t.permitId) : null;
    if (!permit || !permit.jobOpen) {
      this.changed();
      return { linked: false };
    }

    this.store.insert('telemetry', { id: rid('T', 8), ...t });
    this.pruneTelemetry(permit.id);
    const mon = this.monitor(permit.id);
    mon.lastTelemetryAt = now;
    if (mon.signalLost) {
      mon.signalLost = false;
      this.clearAlerts((a) => a.permitId === permit.id && a.type === 'SIGNAL_LOST');
      this.log('SIGNAL_RESTORED', { permitId: permit.id });
    }
    if (t.moving) mon.stillSince = null;
    else if (!mon.stillSince) mon.stillSince = now;

    const fails = gasFailures(t);
    if (fails.length) this.revoke(permit.id, fails, 'beacon telemetry');
    if (t.sos) this.createIncident(permit.id, 'SOS', 'beacon telemetry (SOS flag)');
    this.checkStillness(permit.id, now);
    this.changed();
    return { linked: true };
  }

  handleAlert(deviceId, payload) {
    const type = str(payload && payload.type).toUpperCase();
    const permitId = str(payload && payload.permitId) || null;
    if (!['MAN_DOWN', 'SOS', 'GAS'].includes(type)) return { ok: false };
    const permit = permitId ? this.store.get('permits', permitId) : null;
    if (!permit || !permit.jobOpen) {
      const key = `UNLINKED:${type}:${permitId}`;
      if (!this.alerts.some((a) => a.key === key)) {
        this.log('ALERT_UNLINKED', { deviceId: str(deviceId), type, permitId });
        this.addAlert('UNLINKED', null, `${type} alert from ${deviceId} is not linked to an open job (permit ${permitId || 'none'}).`, key);
      }
      return { ok: false, linked: false };
    }
    if (type === 'GAS') {
      const lt = this.latestTelemetry;
      const fails = lt && lt.permitId === permit.id ? gasFailures(lt) : [];
      this.revoke(permit.id, fails, 'device GAS alarm');
      return { ok: true, permitId: permit.id };
    }
    const incident = this.createIncident(permit.id, type, 'device alert');
    return { ok: true, permitId: permit.id, incidentId: incident.id };
  }

  revoke(permitId, fails, source) {
    const p = this.store.get('permits', permitId);
    if (!p) return;
    const detail = fails.length ? describeFailures(fails) : 'Gas alarm raised by the beacon';
    if (p.status === 'ACTIVE' || p.status === 'EXPIRED') {
      this.store.update('permits', p.id, { status: 'REVOKED', revokedAt: nowIso(), revokeReason: detail });
      this.log('PERMIT_REVOKED', {
        permitId: p.id, reason: detail, gas: fails.map((f) => ({ gas: f.gas, value: f.value })), source,
      });
    }
    if (this.addAlert('EVACUATE', p.id, `EVACUATE NOW. ${detail}. Permit ${p.id} revoked.`)) {
      this.sendToDevice(`beacon/${config.beaconId}/cmd`, { siren: true });
    }
    this.changed();
  }

  createIncident(permitId, cause, source) {
    const existing = this.store.all('incidents').find((i) => i.permitId === permitId && i.cause === cause);
    if (existing) return existing;
    const p = this.store.get('permits', permitId);
    const lt = this.latestTelemetry && this.latestTelemetry.permitId === permitId ? this.latestTelemetry : null;
    const incident = {
      id: rid('INC'), permitId, cause, source,
      manholeId: p.manholeId, workerId: p.workerId, supervisorId: p.supervisorId, contractorId: p.contractorId,
      createdAt: nowIso(), acknowledgedAt: null,
      lastReadings: lt ? { ts: lt.ts, h2s: lt.h2s, co: lt.co, ch4: lt.ch4, o2: lt.o2, moving: lt.moving } : null,
    };
    this.store.insert('incidents', incident);
    this.log('INCIDENT', {
      incidentId: incident.id, permitId, cause, source, manholeId: p.manholeId, workerId: p.workerId,
      lastReadings: incident.lastReadings,
    });
    this.sendToDevice(`beacon/${config.beaconId}/cmd`, { siren: true });
    this.emit('incident', incident);
    this.changed();
    return incident;
  }

  acknowledgeIncident(id) {
    const inc = this.store.get('incidents', id);
    if (!inc) throw httpError(404, 'Incident not found');
    if (!inc.acknowledgedAt) {
      this.store.update('incidents', id, { acknowledgedAt: nowIso() });
      this.log('INCIDENT_ACKNOWLEDGED', { incidentId: id, permitId: inc.permitId });
    }
    this.changed();
    return this.store.get('incidents', id);
  }

  closeJob(permitId, closedBy = 'supervisor') {
    const p = this.store.get('permits', permitId);
    if (!p) throw httpError(404, 'Permit not found');
    if (!p.jobOpen) throw httpError(409, `The job on permit ${permitId} is already closed.`);
    // ACTIVE -> CLOSED. A REVOKED or EXPIRED permit keeps that status so it can never look compliant.
    const finalStatus = p.status === 'ACTIVE' ? 'CLOSED' : p.status;
    const updated = this.store.update('permits', p.id, { status: finalStatus, jobOpen: false, closedAt: nowIso(), closedBy });
    this.log('JOB_CLOSED', { permitId: p.id, finalStatus, closedBy });
    this.monitors.delete(p.id);
    this.clearAlerts((a) => a.permitId === p.id);
    this.sendToDevice(`beacon/${config.beaconId}/cmd`, { siren: false, end: true });
    this.changed();
    return updated;
  }

  // Notes live only in the hash-chained audit log, so they can be added but never edited.
  addNote(permitId, { text, author } = {}) {
    const p = this.store.get('permits', permitId);
    if (!p) throw httpError(404, 'Permit not found');
    const body = str(text).trim();
    if (!body) throw httpError(400, 'Write a note before saving.');
    if (body.length > config.notes.maxLength) throw httpError(400, `Notes are limited to ${config.notes.maxLength} characters.`);
    const e = this.log('NOTE_ADDED', { permitId: p.id, text: body, author: str(author).trim().slice(0, 60) || 'Unknown' });
    this.changed();
    return noteOf(e);
  }

  notesFor(permitId) {
    return this.store.allEvents().filter((e) => e.type === 'NOTE_ADDED' && e.data.permitId === permitId).map(noteOf);
  }

  pruneTelemetry(permitId) {
    const rows = this.store.all('telemetry').filter((t) => t.permitId === permitId);
    const extra = rows.length - config.monitor.telemetryKeepPerPermit;
    for (let i = 0; i < extra; i++) this.store.remove('telemetry', rows[i].id);
  }

  checkStillness(permitId, now) {
    const mon = this.monitors.get(permitId);
    if (mon && mon.stillSince && now - mon.stillSince >= config.monitor.stillTimeoutMs) {
      this.createIncident(permitId, 'MAN_DOWN', `server backup: no movement for ${Math.round(config.monitor.stillTimeoutMs / 1000)} s`);
    }
  }

  // Runs every monitor.tickMs: permit expiry, signal loss, stillness backup.
  tick() {
    const now = Date.now();
    for (const p of this.store.all('permits')) {
      if (p.status === 'ACTIVE' && now > Date.parse(p.expiresAt)) {
        this.store.update('permits', p.id, { status: 'EXPIRED' });
        this.log('PERMIT_EXPIRED', { permitId: p.id, expiresAt: p.expiresAt, jobOpen: p.jobOpen });
        if (p.jobOpen) {
          this.addAlert('RETEST_REQUIRED', p.id, `Permit ${p.id} expired while the job is open. Workers must come out. Re-test required.`);
        }
        this.changed();
      }
      if (!p.jobOpen) continue;
      const mon = this.monitor(p.id);
      const last = mon.lastTelemetryAt || mon.startedAt;
      if (!mon.signalLost && now - last > config.monitor.signalLostMs) {
        mon.signalLost = true;
        this.log('SIGNAL_LOST', { permitId: p.id, lastTelemetryAt: mon.lastTelemetryAt ? new Date(mon.lastTelemetryAt).toISOString() : null });
        this.addAlert('SIGNAL_LOST', p.id, `Signal lost from ${config.beaconId} on permit ${p.id}. Check on the worker.`);
      }
      this.checkStillness(p.id, now);
    }
  }

  // ------------------------------------------------------------------ demo controls
  reset() {
    this.store.clear();
    seed(this.store);
    this.resetRuntime();
    this.dataVersion++;
    this.emit('reset');
    this.changed();
  }

  tamper() {
    const result = audit.tamper(this.store);
    this.dataVersion++;
    this.changed();
    return result;
  }

  // ------------------------------------------------------------------ snapshot for the dashboard
  liveState(extra = {}) {
    // Only recent activity belongs on the live dashboard (seeded history stays in reports and the audit log).
    const recent = (ts) => Date.now() - Date.parse(ts) < 30 * 60 * 1000;
    const last = (t) => {
      const all = this.store.all(t);
      const row = all[all.length - 1] || null;
      if (!row) return null;
      const ts = row.createdAt || row.receivedAt || row.issuedAt;
      return row.jobOpen || recent(ts) ? row : null;
    };
    const decorate = (p) => {
      if (!p) return null;
      const mon = this.monitors.get(p.id);
      return {
        ...p,
        monitor: mon ? { lastTelemetryAt: mon.lastTelemetryAt, stillSince: mon.stillSince, signalLost: mon.signalLost } : null,
        incidents: this.store.all('incidents').filter((i) => i.permitId === p.id),
      };
    };
    return {
      serverTime: Date.now(),
      dataVersion: this.dataVersion,
      mode: this.mode,
      mqtt: this.mqtt,
      session: last('sessions'),
      lastResult: last('readings'),
      probeProgress: this.probeProgress,
      job: decorate(this.openJob()),
      lastPermit: decorate(last('permits')),
      telemetry: this.latestTelemetry,
      alerts: this.alerts,
      incidents: this.store.all('incidents').filter((i) => !i.acknowledgedAt),
      deviceLog: this.deviceLog.slice(0, 10),
      ...extra,
    };
  }
}

module.exports = { Engine };
