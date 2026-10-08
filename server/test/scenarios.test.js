// Automated scenario tests. Boots the real server in-process (fresh temp database, MQTT off,
// shortened timers) and drives it over HTTP exactly as the dashboard's simulator drawer does.
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroasphyx-test-'));
Object.assign(process.env, {
  ZA_DATA_DIR: dataDir,
  ZA_MQTT: 'off',
  ZA_MODE: 'SIM',
  ZA_SIM_STEP_MS: '0',
  ZA_TELEMETRY_MS: '300',
  ZA_SIGNAL_LOST_MS: '1500',
  ZA_STILL_MS: '1500',
  ZA_PERMIT_VALIDITY_MS: '4000',
});

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { readingMessage, signReading } = require('../src/signing');
const config = require('../src/config');

let srv;
let engine;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const res = await fetch(`${srv.url}/api${p}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, body: json };
}
const get = (p) => api('GET', p).then((r) => r.body);
const post = (p, b) => api('POST', p, b);
const sim = async (name) => {
  const r = await post(`/sim/${name}`);
  assert.equal(r.status, 200, `scenario ${name} failed: ${JSON.stringify(r.body)}`);
  return r.body;
};
async function waitFor(fn, timeoutMs = 5000, label = 'condition') {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

before(async () => {
  srv = await createApp({ port: 0, mqtt: false });
  engine = srv.engine;
});
after(async () => {
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
beforeEach(async () => {
  assert.equal((await post('/demo/reset')).status, 200);
  assert.equal((await post('/mode', { mode: 'SIM' })).status, 200);
});

// ------------------------------------------------------------------ signing format
test('HMAC message string matches the documented firmware format', () => {
  const r = {
    sessionId: 'S-ABC123', nonce: '00ff00ff00ff00ff', deviceId: 'PROBE-001', manholeId: 'MH-001', lat: 17385000, lng: 78486700,
    samples: [{ d: 10, h2s: 1, ch4: 2, co: 3, o2: 209 }, { d: 50, h2s: 1, ch4: 2, co: 4, o2: 208 }],
  };
  const msg = 'S-ABC123|00ff00ff00ff00ff|PROBE-001|MH-001|17385000|78486700|10,1,2,3,209;50,1,2,4,208';
  assert.equal(readingMessage(r), msg);
  const expected = crypto.createHmac('sha256', 'probe-001-demo-secret').update(msg).digest('hex');
  assert.equal(signReading(r, 'probe-001-demo-secret'), expected);
  assert.match(expected, /^[0-9a-f]{64}$/);
});

// ------------------------------------------------------------------ the 8 simulator scenarios
test('scenario: Safe descent -> GRANTED, permit ACTIVE, challenge + result published', async () => {
  const r = await sim('safe-descent');
  assert.equal(r.decision, 'GRANTED');
  assert.equal(r.reason, 'OK');
  assert.ok(r.permitId);
  const permit = await get(`/permits/${r.permitId}`);
  assert.equal(permit.status, 'ACTIVE');
  assert.equal(permit.manholeId, 'MH-001');
  const live = await get('/live');
  const topics = live.deviceLog.map((m) => m.topic);
  assert.ok(topics.includes(`${config.mqtt.prefix}/probe/PROBE-001/challenge`));
  const result = live.deviceLog.find((m) => m.topic.endsWith('/probe/PROBE-001/result'));
  assert.deepEqual(result.payload, { sessionId: r.sessionId, decision: 'GRANTED', reason: 'OK', permitId: r.permitId });
});

test('scenario: Open-air cheat -> DENIED PROBE_NOT_LOWERED', async () => {
  const r = await sim('open-air');
  assert.equal(r.decision, 'DENIED');
  assert.equal(r.reason, 'PROBE_NOT_LOWERED');
  assert.equal(r.permitId, null);
});

test('scenario: Unsafe gas at depth -> DENIED UNSAFE_GAS (H2S)', async () => {
  const r = await sim('unsafe-gas');
  assert.equal(r.decision, 'DENIED');
  assert.equal(r.reason, 'UNSAFE_GAS');
  assert.equal(r.gas, 'H2S');
});

test('scenario: Replay an old reading -> DENIED INVALID_SESSION', async () => {
  const first = await sim('safe-descent');
  assert.equal(first.decision, 'GRANTED');
  const r = await sim('replay');
  assert.equal(r.decision, 'DENIED');
  assert.equal(r.reason, 'INVALID_SESSION');
  assert.match(r.detail, /already used/);
  const permits = await get('/permits');
  assert.equal(permits.filter((p) => p.status === 'ACTIVE').length, 1, 'replay must not create a second permit');
});

test('scenario: Wrong location -> DENIED WRONG_LOCATION', async () => {
  const r = await sim('wrong-location');
  assert.equal(r.decision, 'DENIED');
  assert.equal(r.reason, 'WRONG_LOCATION');
});

test('scenario: Gas spike during job -> permit REVOKED, EVACUATE alert, siren on', async () => {
  const r = await sim('gas-spike');
  assert.equal(r.permitStatus, 'REVOKED');
  const live = await get('/live');
  assert.ok(live.alerts.some((a) => a.type === 'EVACUATE' && a.permitId === r.permitId));
  assert.ok(live.deviceLog.some((m) => m.topic.endsWith('/beacon/BEACON-001/cmd') && m.payload.siren === true));
  const v = await get(`/verify/${r.permitId}`);
  assert.equal(v.status, 'REVOKED');
});

test('scenario: Man down -> one MAN_DOWN incident, siren on, never duplicated', async () => {
  const r = await sim('man-down');
  assert.ok(r.incidentId);
  const again = await sim('man-down');
  assert.equal(again.incidentId, r.incidentId);
  // The simulated beacon keeps reporting moving=false, so the server-side stillness backup also fires; it must dedupe.
  await sleep(2200);
  const live = await get('/live');
  const manDowns = live.incidents.filter((i) => i.permitId === r.permitId && i.cause === 'MAN_DOWN');
  assert.equal(manDowns.length, 1);
  assert.ok(live.deviceLog.some((m) => m.topic.endsWith('/beacon/BEACON-001/cmd') && m.payload.siren === true));
});

test('scenario: SOS -> SOS incident', async () => {
  const r = await sim('sos');
  assert.equal(r.cause, 'SOS');
  const live = await get('/live');
  assert.equal(live.incidents.filter((i) => i.permitId === r.permitId && i.cause === 'SOS').length, 1);
});

// ------------------------------------------------------------------ remaining denial codes and ordering
function signedReading(session, samples, overrides = {}, secret = 'probe-001-demo-secret') {
  const m = engine.store.get('manholes', session.manholeId);
  const r = {
    sessionId: session.id, nonce: session.nonce, deviceId: session.deviceId, manholeId: session.manholeId,
    lat: m.lat, lng: m.lng, samples, ...overrides,
  };
  r.sig = signReading(r, secret);
  return r;
}
const goodSamples = [10, 50, 100, 150, 200, 250, 280].map((d) => ({ d, h2s: 1, ch4: 1, co: 3, o2: 208 }));
const newSession = async (deviceId = 'PROBE-001') => {
  const r = await post('/sessions', { manholeId: 'MH-001', workerId: 'W-02', supervisorId: 'S-02', deviceId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};

test('UNKNOWN_DEVICE: unregistered probe', async () => {
  const s = await newSession('PROBE-999');
  const r = engine.handleReading(signedReading(s, goodSamples, {}, 'whatever'), { source: 'test' });
  assert.equal(r.reason, 'UNKNOWN_DEVICE');
});

test('CALIBRATION_EXPIRED: PROBE-002 is denied even with a perfect descent', async () => {
  await newSession('PROBE-002');
  const r = await sim('safe-descent'); // simulator answers the pending PROBE-002 test, signed with PROBE-002's secret
  assert.equal(r.decision, 'DENIED');
  assert.equal(r.reason, 'CALIBRATION_EXPIRED');
});

test('BAD_SIGNATURE: data altered after signing; checked before the session', async () => {
  const s = await newSession();
  const reading = signedReading(s, goodSamples);
  reading.samples = reading.samples.map((x) => ({ ...x, h2s: 0 }));
  assert.equal(engine.handleReading(reading, { source: 'test' }).reason, 'BAD_SIGNATURE');
  // A bad signature must not burn the session: the genuine reading still works.
  assert.equal(engine.handleReading(signedReading(s, goodSamples), { source: 'test' }).decision, 'GRANTED');
  const forged = signedReading({ ...s, id: 'S-NOPE00' }, goodSamples, {}, 'wrong-secret');
  assert.equal(engine.handleReading(forged, { source: 'test' }).reason, 'BAD_SIGNATURE');
});

test('INVALID_SESSION: missing session, wrong nonce, stale session', async () => {
  const s = await newSession();
  assert.equal(engine.handleReading(signedReading({ ...s, id: 'S-NOPE00' }, goodSamples), { source: 'test' }).reason, 'INVALID_SESSION');
  assert.equal(engine.handleReading(signedReading({ ...s, nonce: 'deadbeefdeadbeef' }, goodSamples), { source: 'test' }).reason, 'INVALID_SESSION');
  engine.store.update('sessions', s.id, { createdAt: new Date(Date.now() - 6 * 60 * 1000).toISOString() });
  const r = engine.handleReading(signedReading(s, goodSamples), { source: 'test' });
  assert.equal(r.reason, 'INVALID_SESSION');
  assert.match(r.detail, /older than 5 minutes/);
});

test('PROBE_NOT_LOWERED: too few samples, non-increasing depth, too shallow', async () => {
  let s = await newSession();
  assert.equal(engine.handleReading(signedReading(s, goodSamples.slice(-2)), { source: 'test' }).reason, 'PROBE_NOT_LOWERED');
  s = await newSession();
  const zigzag = [10, 150, 120, 260].map((d) => ({ d, h2s: 1, ch4: 1, co: 3, o2: 208 }));
  assert.equal(engine.handleReading(signedReading(s, zigzag), { source: 'test' }).reason, 'PROBE_NOT_LOWERED');
  s = await newSession();
  const shallow = [10, 100, 239].map((d) => ({ d, h2s: 1, ch4: 1, co: 3, o2: 208 }));
  assert.equal(engine.handleReading(signedReading(s, shallow), { source: 'test' }).reason, 'PROBE_NOT_LOWERED');
  s = await newSession();
  const exactly80 = [10, 100, 240].map((d) => ({ d, h2s: 1, ch4: 1, co: 3, o2: 208 }));
  assert.equal(engine.handleReading(signedReading(s, exactly80), { source: 'test' }).decision, 'GRANTED');
});

test('UNSAFE_GAS: each gas limit and worst case across samples', async () => {
  const cases = [
    [{ h2s: 10 }, 'H2S'], [{ co: 35 }, 'CO'], [{ ch4: 10 }, 'CH4'], [{ o2: 194 }, 'O2'], [{ o2: 236 }, 'O2'],
  ];
  for (const [bad, gas] of cases) {
    const s = await newSession();
    const samples = goodSamples.map((x, i) => (i === 3 ? { ...x, ...bad } : x));
    const r = engine.handleReading(signedReading(s, samples), { source: 'test' });
    assert.equal(r.reason, 'UNSAFE_GAS', JSON.stringify(bad));
    assert.equal(r.gas, gas);
  }
  const s = await newSession();
  const edge = goodSamples.map((x) => ({ ...x, h2s: 9, co: 34, ch4: 9, o2: 195 }));
  assert.equal(engine.handleReading(signedReading(s, edge), { source: 'test' }).decision, 'GRANTED');
});

test('check order: wrong location is reported before shallow depth and bad gas', async () => {
  const s = await newSession();
  const awful = [10, 20, 30].map((d) => ({ d, h2s: 50, ch4: 1, co: 3, o2: 208 }));
  const r = engine.handleReading(signedReading(s, awful, { lat: 17395000 }), { source: 'test' });
  assert.equal(r.reason, 'WRONG_LOCATION');
});

// ------------------------------------------------------------------ during the job
test('job lifecycle: new test blocked while open; close -> CLOSED + {siren:false,end:true}', async () => {
  const g = await sim('safe-descent');
  const blocked = await post('/sessions', { manholeId: 'MH-002', workerId: 'W-01', supervisorId: 'S-01', deviceId: 'PROBE-001' });
  assert.equal(blocked.status, 409);
  const closed = await post(`/permits/${g.permitId}/close`);
  assert.equal(closed.status, 200);
  assert.equal(closed.body.status, 'CLOSED');
  const live = await get('/live');
  const cmd = live.deviceLog.find((m) => m.topic.endsWith('/beacon/BEACON-001/cmd'));
  assert.deepEqual(cmd.payload, { siren: false, end: true });
  assert.equal(live.job, null);
  assert.equal((await get(`/verify/${g.permitId}`)).status, 'CLOSED');
});

test('beacon telemetry with unsafe gas revokes the permit', async () => {
  const g = await sim('safe-descent');
  await post('/mode', { mode: 'LIVE' }); // stop the simulated beacon; feed telemetry directly
  engine.handleTelemetry('BEACON-001', { permitId: g.permitId, h2s: 3, ch4: 2, co: 40, o2: 207, moving: true, sos: false });
  const p = await get(`/permits/${g.permitId}`);
  assert.equal(p.status, 'REVOKED');
  assert.match(p.revokeReason, /CO 40/);
});

test('server backup: moving=false for the configured time -> MAN_DOWN incident (once)', async () => {
  const g = await sim('safe-descent');
  await post('/mode', { mode: 'LIVE' });
  const t = { permitId: g.permitId, h2s: 1, ch4: 1, co: 3, o2: 208, moving: false, sos: false };
  engine.handleTelemetry('BEACON-001', t);
  await sleep(800);
  engine.handleTelemetry('BEACON-001', t);
  assert.equal((await get('/live')).incidents.length, 0, 'not before the timeout');
  const inc = await waitFor(async () => (await get('/live')).incidents.find((i) => i.permitId === g.permitId), 3000, 'backup incident');
  assert.equal(inc.cause, 'MAN_DOWN');
  assert.match(inc.source, /server backup/);
  engine.handleAlert('BEACON-001', { type: 'MAN_DOWN', permitId: g.permitId });
  assert.equal((await get('/live')).incidents.filter((i) => i.cause === 'MAN_DOWN').length, 1);
});

test('signal lost after silence is a warning, not an incident; restored on next telemetry', async () => {
  const g = await sim('safe-descent');
  await post('/mode', { mode: 'LIVE' }); // no more simulated telemetry
  const lost = await waitFor(async () => (await get('/live')).alerts.find((a) => a.type === 'SIGNAL_LOST'), 4000, 'signal lost');
  assert.equal(lost.permitId, g.permitId);
  assert.equal((await get('/live')).incidents.length, 0);
  engine.handleTelemetry('BEACON-001', { permitId: g.permitId, h2s: 1, ch4: 1, co: 3, o2: 208, moving: true, sos: false });
  assert.ok(!(await get('/live')).alerts.some((a) => a.type === 'SIGNAL_LOST'));
});

test('permit expiry while job is open -> EXPIRED + Re-test required alert', async () => {
  const g = await sim('safe-descent');
  assert.equal((await get(`/verify/${g.permitId}`)).status, 'VALID');
  const alert = await waitFor(async () => (await get('/live')).alerts.find((a) => a.type === 'RETEST_REQUIRED'), 6000, 're-test alert');
  assert.equal(alert.permitId, g.permitId);
  assert.equal((await get(`/permits/${g.permitId}`)).status, 'EXPIRED');
  assert.equal((await get(`/verify/${g.permitId}`)).status, 'EXPIRED');
});

test('alerts from the beacon that carry no valid permit do not create incidents', async () => {
  engine.handleAlert('BEACON-001', { type: 'MAN_DOWN', permitId: '' });
  const live = await get('/live');
  assert.equal(live.incidents.length, 0);
  assert.ok(live.alerts.some((a) => a.type === 'UNLINKED'));
});

// ------------------------------------------------------------------ payment gate
test('payment gate: seeded bills + the live demo bill', async () => {
  const review = async (id) => (await post(`/bills/${id}/review`)).body;
  const b101 = await review('BILL-101');
  assert.equal(b101.status, 'APPROVED', b101.reason);
  const b102 = await review('BILL-102');
  assert.equal(b102.status, 'REJECTED');
  assert.match(b102.reason, /No entry permit/);
  const b103 = await review('BILL-103');
  assert.equal(b103.status, 'REJECTED');
  assert.match(b103.reason, /REVOKED/);
  const early = await review('BILL-104');
  assert.equal(early.status, 'REJECTED');
  assert.match(early.reason, /No entry permit/);

  const g = await sim('safe-descent');
  const open = await review('BILL-104');
  assert.equal(open.status, 'REJECTED');
  assert.match(open.reason, /still open/);
  await post(`/permits/${g.permitId}/close`);
  const b104 = await review('BILL-104');
  assert.equal(b104.status, 'APPROVED', b104.reason);
  assert.equal(b104.permitId, g.permitId);
});

test('payment gate: incident on the live job blocks payment', async () => {
  const r = await sim('man-down');
  await post(`/permits/${r.permitId}/close`);
  const b = (await post('/bills/BILL-104/review')).body;
  assert.equal(b.status, 'REJECTED');
  assert.match(b.reason, /MAN DOWN/);
});

// ------------------------------------------------------------------ audit chain
test('audit chain verifies, tamper breaks it at the edited record, payment then refused', async () => {
  await sim('safe-descent');
  const ok = await get('/audit/verify');
  assert.equal(ok.ok, true);
  const t = (await post('/demo/tamper')).body;
  const broken = await get('/audit/verify');
  assert.equal(broken.ok, false);
  assert.equal(broken.brokenAt, t.seq);
  const b = (await post('/bills/BILL-101/review')).body;
  assert.equal(b.status, 'REJECTED');
  assert.match(b.reason, /integrity check/);
  const events = await get('/audit/events');
  for (const type of ['SESSION_STARTED', 'READING_RECEIVED', 'PERMIT_GRANTED', 'PERMIT_DENIED', 'PERMIT_REVOKED', 'BILL_DECISION']) {
    assert.ok(events.some((e) => e.type === type), `log contains ${type}`);
  }
  await post('/demo/reset');
  assert.equal((await get('/audit/verify')).ok, true);
});

test('evidence report and public verify', async () => {
  const r = await sim('man-down');
  const rep = await get(`/report/${r.incidentId}`);
  assert.equal(rep.permit.id, r.permitId);
  assert.equal(rep.readings[0].sigValid, true);
  assert.ok(rep.events.some((e) => e.type === 'INCIDENT'));
  assert.equal(rep.worker.id, 'W-01');
  assert.equal(rep.probe.secret, undefined);
  assert.equal((await get('/verify/PRM-NOTREAL')).status, 'NOT_FOUND');
  const qr = await get(`/permits/${r.permitId}/qr`);
  assert.match(qr.url, new RegExp(`/verify/${r.permitId}$`));
  assert.match(qr.dataUrl, /^data:image\/png;base64,/);
});

test('scoreboard counts per contractor', async () => {
  const board = await get('/scoreboard');
  const c1 = board.find((c) => c.contractorId === 'C-01');
  const c2 = board.find((c) => c.contractorId === 'C-02');
  assert.equal(c1.jobs, 2);
  assert.equal(c1.compliancePct, 50);
  assert.equal(c2.denials, 1);
  assert.equal(c2.revocations, 1);
  assert.equal(c2.compliancePct, 0);
});

test('simulator refuses to run in LIVE mode', async () => {
  await post('/mode', { mode: 'LIVE' });
  const r = await post('/sim/safe-descent');
  assert.equal(r.status, 409);
});
