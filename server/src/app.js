const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const QRCode = require('qrcode');
const { Server: SocketServer } = require('socket.io');
const config = require('./config');
const audit = require('./audit');
const { Store } = require('./store');
const { Engine } = require('./engine');
const { Simulator } = require('./simulator');
const { startMqtt } = require('./mqttBridge');
const { reviewBill, scoreboard, report, publicVerify } = require('./payments');
const { httpError } = require('./util');

const publicDevice = ({ secret, ...d }) => d; // never expose device secrets

function buildRouter(engine, sim) {
  const store = engine.store;
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => out !== undefined && res.json(out)).catch(next);

  r.get('/health', wrap(() => ({ ok: true, storage: store.kind, mode: engine.mode, mqtt: engine.mqtt })));

  r.get('/config', wrap(() => ({
    permitValidityMs: config.permit.validityMs,
    productionValidityMin: config.permit.productionValidityMin,
    sessionMaxAgeMs: config.session.maxAgeMs,
    noteMaxLength: config.notes.maxLength,
    gas: config.gas,
    descent: config.descent,
    locationMaxDistanceM: config.location.maxDistanceM,
    stillTimeoutMs: config.monitor.stillTimeoutMs,
    signalLostMs: config.monitor.signalLostMs,
    publicUrl: config.publicUrl,
    mqtt: { url: config.mqtt.url, prefix: config.mqtt.prefix },
    beaconId: config.beaconId,
    simDefaults: config.sim.defaults,
  })));

  r.get('/refs', wrap(() => ({
    manholes: store.all('manholes'),
    contractors: store.all('contractors'),
    workers: store.all('workers'),
    supervisors: store.all('supervisors'),
    devices: store.all('devices').map(publicDevice),
  })));

  r.get('/live', wrap(() => engine.liveState({ sim: sim.state() })));

  r.post('/mode', wrap((req) => {
    engine.setMode(req.body && req.body.mode);
    return { mode: engine.mode };
  }));

  // ---- pre-entry test and job
  r.post('/sessions', wrap((req) => engine.startSession(req.body || {})));
  r.get('/permits', wrap(() => store.all('permits')));
  r.get('/permits/:id', wrap((req) => {
    const p = store.get('permits', req.params.id);
    if (!p) throw httpError(404, 'Permit not found');
    return p;
  }));
  r.get('/permits/:id/qr', wrap(async (req) => {
    const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    const url = `${base}/verify/${encodeURIComponent(req.params.id)}`;
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
    return { url, dataUrl };
  }));
  r.get('/permits/:id/notes', wrap((req) => {
    if (!store.get('permits', req.params.id)) throw httpError(404, 'Permit not found');
    return engine.notesFor(req.params.id);
  }));
  r.post('/permits/:id/notes', wrap((req) => engine.addNote(req.params.id, req.body || {})));
  r.post('/permits/:id/close',wrap((req) => engine.closeJob(req.params.id, (req.body && req.body.closedBy) || 'supervisor')));
  r.post('/incidents/:id/ack', wrap((req) => engine.acknowledgeIncident(req.params.id)));
  r.post('/alerts/:id/dismiss', wrap((req) => {
    engine.dismissAlert(req.params.id);
    return { ok: true };
  }));

  // ---- payments, scoreboard, reports
  r.get('/bills', wrap(() => store.all('bills')));
  r.post('/bills/:id/review', wrap((req) => reviewBill(engine, req.params.id)));
  r.get('/scoreboard', wrap(() => scoreboard(store)));
  r.get('/report/:id', wrap((req) => report(store, req.params.id)));
  r.get('/verify/:id', wrap((req) => publicVerify(store, req.params.id)));

  // ---- audit
  r.get('/audit/events', wrap(() => store.allEvents()));
  r.get('/audit/verify', wrap(() => audit.verify(store)));

  // ---- demo controls
  r.post('/demo/tamper', wrap(() => {
    const t = engine.tamper();
    if (!t) throw httpError(409, 'Nothing to tamper with');
    return t;
  }));
  r.post('/demo/reset', wrap(() => {
    engine.reset();
    return { ok: true };
  }));
  r.post('/sim/:scenario', wrap((req) => sim.run(req.params.scenario)));

  r.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return r;
}

function createApp({ port = config.port, mqtt = true } = {}) {
  const store = new Store();
  const engine = new Engine(store);
  const sim = new Simulator(engine);

  const app = express();
  app.set('trust proxy', true); // honour X-Forwarded-Proto/Host behind a hosting platform's proxy
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', buildRouter(engine, sim));

  // Production: serve the built web app (single service).
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist));
    app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server error' });
  });

  const server = http.createServer(app);
  const io = new SocketServer(server, { cors: { origin: true } });
  const snapshot = () => engine.liveState({ sim: sim.state() });
  io.on('connection', (socket) => socket.emit('live', snapshot()));
  engine.on('changed', () => io.emit('live', snapshot()));

  const ticker = setInterval(() => {
    try {
      engine.tick();
    } catch (err) {
      console.error('[tick]', err);
    }
  }, config.monitor.tickMs);

  const mqttClient = mqtt ? startMqtt(engine) : null;

  return new Promise((resolve) => {
    server.listen(port, () => {
      const actual = server.address().port;
      resolve({
        app, server, io, engine, sim, store, port: actual, url: `http://localhost:${actual}`,
        async close() {
          clearInterval(ticker);
          sim.stop();
          if (mqttClient) mqttClient.end(true);
          io.close();
          await new Promise((r) => server.close(() => r()));
          store.close();
        },
      });
    });
  });
}

module.exports = { createApp };
