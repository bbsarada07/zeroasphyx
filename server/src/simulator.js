// Scripted scenarios for SIM mode. Every scenario feeds the exact same engine ingestion functions the
// MQTT bridge uses, with readings signed by the real per-device secrets.
const config = require('./config');
const { signReading } = require('./signing');
const { httpError, delay } = require('./util');

const SCENARIOS = {
  'safe-descent': 'Safe descent',
  'open-air': 'Open-air cheat (no descent)',
  'unsafe-gas': 'Unsafe gas at depth',
  replay: 'Replay an old reading',
  'wrong-location': 'Wrong location',
  'gas-spike': 'Gas spike during job',
  'man-down': 'Man down',
  sos: 'SOS',
};

const freshBeacon = () => ({ h2s: 1, co: 4, ch4: 2, o2: 208, moving: true, sos: false, siren: false, spiked: false });
const jitter = (n) => Math.round(Math.random() * n);

class Simulator {
  constructor(engine) {
    this.engine = engine;
    this.beacon = freshBeacon();
    this.running = null;
    this.lastRun = null;
    engine.on('device-msg', (sub, payload) => {
      if (!sub.startsWith(`beacon/${config.beaconId}/cmd`)) return;
      if (payload.end) this.beacon = freshBeacon();
      else if ('siren' in payload) this.beacon.siren = Boolean(payload.siren);
    });
    engine.on('reset', () => {
      this.beacon = freshBeacon();
      this.lastRun = null;
    });
    this.timer = setInterval(() => this.beat(), config.monitor.telemetryIntervalMs);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); }

  state() {
    return { scenarios: SCENARIOS, running: this.running, lastRun: this.lastRun, beacon: this.beacon };
  }

  // Simulated BEACON-001: telemetry every 2 s while a job is open (SIM mode only).
  telemetryPayload(permitId) {
    const b = this.beacon;
    return {
      permitId,
      h2s: b.spiked ? b.h2s : b.h2s + jitter(1),
      ch4: b.spiked ? b.ch4 : b.ch4 + jitter(1),
      co: b.spiked ? b.co : b.co + jitter(2),
      o2: b.spiked ? b.o2 : b.o2 - jitter(2),
      moving: b.moving,
      sos: b.sos,
    };
  }

  beat() {
    if (this.engine.mode !== 'SIM') return;
    const job = this.engine.openJob();
    if (!job) return;
    this.engine.handleTelemetry(config.beaconId, this.telemetryPayload(job.id));
  }

  async run(name) {
    if (!SCENARIOS[name]) throw httpError(404, `Unknown scenario "${name}"`);
    if (this.engine.mode !== 'SIM') throw httpError(409, 'Switch the data source to SIM to run simulator scenarios.');
    if (this.running) throw httpError(409, `Scenario "${SCENARIOS[this.running]}" is still running.`);
    this.running = name;
    this.engine.changed();
    try {
      const fn = {
        'safe-descent': () => this.safeDescent(),
        'open-air': () => this.openAir(),
        'unsafe-gas': () => this.unsafeGas(),
        replay: () => this.replay(),
        'wrong-location': () => this.wrongLocation(),
        'gas-spike': () => this.gasSpike(),
        'man-down': () => this.manDown(),
        sos: () => this.sos(),
      }[name];
      const result = { scenario: name, label: SCENARIOS[name], ...(await fn()) };
      this.lastRun = { ...result, ts: new Date().toISOString() };
      return result;
    } finally {
      this.running = null;
      this.engine.changed();
    }
  }

  // ------------------------------------------------------------------ probe helpers
  // Use the pending test started from Live Operations if there is one, else start one with defaults.
  sessionForTest({ allowOpenJob }) {
    const sessions = this.engine.store.all('sessions');
    const s = sessions[sessions.length - 1];
    const fresh = s && s.status === 'PENDING' && !s.nonceUsed && Date.now() - Date.parse(s.createdAt) < config.session.maxAgeMs;
    if (fresh) return s;
    return this.engine.startSession(config.sim.defaults, { allowOpenJob });
  }

  descentDepths(depthCm) {
    const target = Math.round((depthCm * 0.93) / 10) * 10;
    const bands = [10];
    for (let d = 50; d < target; d += 50) bands.push(d);
    bands.push(target);
    const max = config.descent.maxSamples;
    if (bands.length <= max) return bands;
    return Array.from({ length: max }, (_, i) => bands[Math.round((i * (bands.length - 1)) / (max - 1))]);
  }

  // gasAt(i, n) -> {h2s, ch4, co, o2}
  buildSamples(depths, gasAt) {
    return depths.map((d, i) => ({ d, ...gasAt(i, depths.length) }));
  }

  async submit(session, samples, { latOffset = 0 } = {}) {
    const manhole = this.engine.store.get('manholes', session.manholeId);
    const device = this.engine.store.get('devices', session.deviceId);
    for (let i = 0; i < samples.length; i++) {
      this.engine.setProbeProgress(session.id, samples.slice(0, i + 1));
      if (config.sim.stepDelayMs) await delay(config.sim.stepDelayMs);
    }
    const payload = {
      sessionId: session.id, nonce: session.nonce, deviceId: session.deviceId, manholeId: session.manholeId,
      lat: manhole.lat + latOffset, lng: manhole.lng, samples,
    };
    payload.sig = signReading(payload, device ? device.secret : 'unregistered');
    return this.engine.handleReading(payload, { source: 'sim' });
  }

  safeGas = (i) => ({ h2s: 1 + (i > 3 ? 1 : 0), ch4: 1 + (i > 4 ? 1 : 0), co: 3 + (i % 2), o2: 209 - i });

  // ------------------------------------------------------------------ scenarios
  async safeDescent() {
    const open = this.engine.openJob();
    if (open) this.engine.closeJob(open.id, 'simulator (new safe descent)');
    const s = this.sessionForTest({ allowOpenJob: false });
    const manhole = this.engine.store.get('manholes', s.manholeId);
    const res = await this.submit(s, this.buildSamples(this.descentDepths(manhole.depthCm), this.safeGas));
    if (res.decision === 'GRANTED') this.beacon = freshBeacon();
    return res;
  }

  async openAir() {
    // Probe held at the surface: a few samples, never goes down the shaft.
    const s = this.sessionForTest({ allowOpenJob: true });
    const samples = [10, 30, 45].map((d, i) => ({ d, h2s: 0, ch4: 1, co: 2 + i, o2: 209 }));
    return this.submit(s, samples);
  }

  async unsafeGas() {
    const s = this.sessionForTest({ allowOpenJob: true });
    const manhole = this.engine.store.get('manholes', s.manholeId);
    const samples = this.buildSamples(this.descentDepths(manhole.depthCm), (i, n) => ({
      h2s: Math.round(2 + 26 * (i / (n - 1)) ** 2), ch4: 2 + Math.floor(i / 2), co: 4 + i, o2: 207 - i,
    }));
    return this.submit(s, samples);
  }

  async wrongLocation() {
    const s = this.sessionForTest({ allowOpenJob: true });
    const manhole = this.engine.store.get('manholes', s.manholeId);
    // ~500 m north of the registered manhole
    return this.submit(s, this.buildSamples(this.descentDepths(manhole.depthCm), this.safeGas), { latOffset: 4500 });
  }

  async replay() {
    const pick = () => [...this.engine.store.all('readings')].reverse().find((r) => r.sessionConsumed && r.source !== 'sim-replay' && r.sig);
    let old = pick();
    if (!old) {
      await this.safeDescent();
      old = pick();
    }
    const payload = {
      sessionId: old.sessionId, nonce: old.nonce, deviceId: old.deviceId, manholeId: old.manholeId,
      lat: old.lat, lng: old.lng, samples: old.samples, sig: old.sig,
    };
    const res = this.engine.handleReading(payload, { source: 'sim-replay' });
    return { ...res, replayedReadingId: old.id };
  }

  // ------------------------------------------------------------------ beacon scenarios
  async ensureJob() {
    let job = this.engine.openJob();
    if (!job) {
      const res = await this.safeDescent();
      job = this.engine.openJob();
      if (!job) throw httpError(500, `Could not open a job for this scenario (${res.reason}).`);
    }
    return job;
  }

  async gasSpike() {
    const job = await this.ensureJob();
    Object.assign(this.beacon, { h2s: 42, co: 18, ch4: 6, o2: 201, spiked: true });
    this.engine.handleTelemetry(config.beaconId, this.telemetryPayload(job.id));
    this.engine.handleAlert(config.beaconId, { type: 'GAS', permitId: job.id });
    const permit = this.engine.store.get('permits', job.id);
    return { permitId: job.id, permitStatus: permit.status, alert: 'EVACUATE' };
  }

  async manDown() {
    const job = await this.ensureJob();
    this.beacon.moving = false;
    this.engine.handleTelemetry(config.beaconId, this.telemetryPayload(job.id));
    const res = this.engine.handleAlert(config.beaconId, { type: 'MAN_DOWN', permitId: job.id });
    return { permitId: job.id, incidentId: res.incidentId, cause: 'MAN_DOWN' };
  }

  async sos() {
    const job = await this.ensureJob();
    this.beacon.sos = true;
    const res = this.engine.handleAlert(config.beaconId, { type: 'SOS', permitId: job.id });
    this.engine.handleTelemetry(config.beaconId, this.telemetryPayload(job.id));
    return { permitId: job.id, incidentId: res.incidentId, cause: 'SOS' };
  }
}

module.exports = { Simulator, SCENARIOS };
