// Firmware compatibility tests. firmware/sketch.ino and diagram.json are the source of truth: this
// reads them directly, checks the server config matches, and replays the firmware's own descent
// sampling and signing logic (re-implemented here independently of server/src/signing.js) through
// the real server ingestion path.
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroasphyx-fw-'));
Object.assign(process.env, { ZA_DATA_DIR: dataDir, ZA_MQTT: 'off', ZA_MODE: 'LIVE', ZA_SIM_STEP_MS: '0' });

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { createApp } = require('../src/app');

const FW_DIR = path.join(__dirname, '..', '..', 'firmware');
const sketchPath = path.join(FW_DIR, 'sketch.ino');
const diagramPath = path.join(FW_DIR, 'diagram.json');
const haveFirmware = fs.existsSync(sketchPath);
const sketch = haveFirmware ? fs.readFileSync(sketchPath, 'utf8') : '';
const flat = sketch.replace(/\s+/g, '');
const skip = haveFirmware ? false : 'firmware/sketch.ino not present';

function constant(re, name) {
  const m = sketch.match(re);
  assert.ok(m, `could not find ${name} in sketch.ino`);
  return m[1];
}
const str = (name) => constant(new RegExp(`const\\s+char\\s*\\*\\s*${name}\\s*=\\s*"([^"]*)"`), name);
const int = (name) => Number(constant(new RegExp(`const\\s+(?:unsigned\\s+)?(?:long|int)\\s+${name}\\s*=\\s*(-?\\d+)`), name));

let srv;
before(async () => { if (haveFirmware) srv = await createApp({ port: 0, mqtt: false }); });
after(async () => {
  if (srv) await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('constants in sketch.ino match the server config and seed', { skip }, () => {
  assert.equal(str('PREFIX'), config.mqtt.prefix, 'MQTT topic prefix');
  assert.equal(`mqtt://${str('BROKER')}:${int('BROKER_PORT')}`, config.mqtt.url, 'broker');
  const probe = config.devices.find((d) => d.id === str('PROBE_ID'));
  assert.ok(probe, `server knows ${str('PROBE_ID')}`);
  assert.equal(str('DEVICE_SECRET'), probe.secret, 'probe secret');
  assert.equal(str('BEACON_ID'), config.beaconId, 'beacon id');
  const mh = srv.store.get('manholes', 'MH-001');
  assert.equal(int('LAT'), mh.lat);
  assert.equal(int('LNG'), mh.lng);
  assert.equal(mh.depthCm, 300);
  assert.equal(int('MAX_SAMPLES'), config.descent.maxSamples, 'max samples');
  assert.ok(int('STILL_MS') < config.monitor.stillTimeoutMs, 'device raises MAN_DOWN before the server backup');
  assert.equal(int('TELEMETRY_MS'), 2000);
});

test('topic layout in sketch.ino matches the server', { skip }, () => {
  for (const t of ['"/probe/"+PROBE_ID+"/challenge"', '"/probe/"+PROBE_ID+"/reading"', '"/probe/"+PROBE_ID+"/result"',
    '"/beacon/"+BEACON_ID+"/telemetry"', '"/beacon/"+BEACON_ID+"/alert"', '"/beacon/"+BEACON_ID+"/cmd"']) {
    assert.ok(flat.includes(t), `sketch.ino builds topic ${t}`);
  }
});

test('submitReading() signs exactly the string the server verifies', { skip }, () => {
  // If this fails, the firmware changed: update readingMessage() in server/src/signing.js to match.
  assert.ok(flat.includes('Stringmsg=sessionId+"|"+nonce+"|"+PROBE_ID+"|"+manholeId+"|"+String(LAT)+"|"+String(LNG)+"|"+s;'), 'message field order');
  assert.ok(flat.includes('if(i>0)s+=";";'), 'samples joined by ";"');
  assert.ok(flat.includes('s+=String(samples[i].d)+","+String(samples[i].h2s)+","+String(samples[i].ch4)+","+String(samples[i].co)+","+String(samples[i].o2);'), 'sample field order d,h2s,ch4,co,o2');
  assert.ok(flat.includes('mbedtls_md_info_from_type(MBEDTLS_MD_SHA256)') && flat.includes('"%02x"'), 'lowercase hex HMAC-SHA256');
  for (const k of ['sessionId', 'nonce', 'deviceId', 'manholeId', 'lat', 'lng', 'samples', 'sig']) assert.ok(flat.includes(`doc["${k}"]`), `reading payload has ${k}`);
});

test('device reads permitId from GRANTED results and obeys {siren,end}', { skip }, () => {
  assert.ok(flat.includes('doc["permitId"]|sessionId.c_str()'), 'GRANTED result permitId');
  assert.ok(flat.includes('doc["siren"].is<bool>()') && flat.includes('doc["end"]|false'), 'cmd handling');
  for (const k of ['permitId', 'h2s', 'ch4', 'co', 'o2', 'moving', 'sos']) assert.ok(flat.includes(`doc["${k}"]`), `telemetry has ${k}`);
  for (const t of ['"GAS"', '"SOS"', '"MAN_DOWN"']) assert.ok(flat.includes(`sendAlert(${t})`), `alert ${t}`);
});

// ---- replay the firmware's own logic --------------------------------------------------------------
const arduinoMap = (x, inMin, inMax, outMin, outMax) => Math.trunc(((x - inMin) * (outMax - outMin)) / (inMax - inMin)) + outMin;
function o2Range() {
  const m = sketch.match(/readO2\(\)\s*\{\s*return\s+map\(analogRead\(PIN_O2\),\s*0,\s*4095,\s*(\d+),\s*(\d+)\)/);
  assert.ok(m, 'readO2() map found');
  return [Number(m[1]), Number(m[2])];
}
// Wokwi potentiometer value 0..1023 -> 12-bit ADC
const adcFromPot = (v) => Math.round((Number(v) / 1023) * 4095);

function firmwareSamples(depthPath, pots) {
  const BAND = int('BAND_CM');
  const MAX = int('MAX_SAMPLES');
  const [o2Min, o2Max] = o2Range();
  const gas = {
    h2s: arduinoMap(adcFromPot(pots.h2s), 0, 4095, 0, 100),
    co: arduinoMap(adcFromPot(pots.co), 0, 4095, 0, 200),
    ch4: arduinoMap(adcFromPot(pots.ch4), 0, 4095, 0, 100),
    o2: arduinoMap(adcFromPot(pots.o2), 0, 4095, o2Min, o2Max),
  };
  const samples = [];
  let lastBand = -1;
  for (const d of depthPath) { // loop(): one reading every 200 ms while DESCENDING
    const band = Math.trunc(d / BAND);
    if (band > lastBand && samples.length < MAX) {
      samples.push({ d, h2s: gas.h2s, ch4: gas.ch4, co: gas.co, o2: gas.o2 });
      lastBand = band;
    }
  }
  return samples;
}

function firmwareReading(challenge, samples) {
  const PROBE_ID = str('PROBE_ID');
  const LAT = int('LAT');
  const LNG = int('LNG');
  let s = '';
  samples.forEach((x, i) => { if (i > 0) s += ';'; s += `${x.d},${x.h2s},${x.ch4},${x.co},${x.o2}`; });
  const msg = `${challenge.sessionId}|${challenge.nonce}|${PROBE_ID}|${challenge.manholeId}|${LAT}|${LNG}|${s}`;
  const sig = crypto.createHmac('sha256', str('DEVICE_SECRET')).update(msg).digest('hex');
  // ArduinoJson serialises the same keys the firmware sets
  return JSON.parse(JSON.stringify({
    sessionId: challenge.sessionId, nonce: challenge.nonce, deviceId: PROBE_ID, manholeId: challenge.manholeId,
    lat: LAT, lng: LNG, samples, sig,
  }));
}

function diagramPots() {
  const parts = JSON.parse(fs.readFileSync(diagramPath, 'utf8')).parts;
  const val = (id) => parts.find((p) => p.id === id)?.attrs?.value ?? 0;
  const sonar = parts.find((p) => p.type === 'wokwi-hc-sr04');
  return { pots: { h2s: val('potH2S'), co: val('potCO'), ch4: val('potCH4'), o2: val('potO2') }, startDistance: Number(sonar.attrs.distance) };
}

function startTest() {
  const s = srv.engine.startSession({ manholeId: 'MH-001', workerId: 'W-01', supervisorId: 'S-01', deviceId: str('PROBE_ID') });
  const msg = srv.engine.deviceLog.find((m) => m.topic.endsWith('/challenge'));
  return msg.payload; // exactly what the device receives
}
const ramp = (from, to, step) => { const out = []; for (let d = from; d <= to; d += step) out.push(d); return out; };

test('diagram.json default knob positions are safe and the sonar starts at ~10 cm', { skip }, () => {
  const { pots, startDistance } = diagramPots();
  const [g] = firmwareSamples([10], pots);
  assert.ok(g.h2s < 10 && g.co < 35 && g.ch4 < 10 && g.o2 >= 195 && g.o2 <= 235, JSON.stringify(g));
  assert.equal(startDistance, 10);
});

test('firmware descent 10 -> 280 cm with default knobs is GRANTED, result carries permitId', { skip }, () => {
  srv.engine.reset();
  const challenge = startTest();
  const samples = firmwareSamples(ramp(10, 280, 7), diagramPots().pots);
  assert.ok(samples.length >= 3 && samples.length <= int('MAX_SAMPLES'));
  const res = srv.engine.handleReading(firmwareReading(challenge, samples), { source: 'mqtt', topicDeviceId: str('PROBE_ID') });
  assert.equal(res.decision, 'GRANTED', `${res.reason}: ${res.detail}`);
  const result = srv.engine.deviceLog.find((m) => m.topic.endsWith('/result')).payload;
  assert.equal(result.permitId, res.permitId);
  assert.equal(result.decision, 'GRANTED');
});

test('firmware descent that stops at 230 cm is denied PROBE_NOT_LOWERED', { skip }, () => {
  srv.engine.reset();
  const challenge = startTest();
  const samples = firmwareSamples(ramp(10, 230, 7), diagramPots().pots);
  const res = srv.engine.handleReading(firmwareReading(challenge, samples), { source: 'mqtt' });
  assert.equal(res.reason, 'PROBE_NOT_LOWERED');
});

test('firmware descent with the H2S knob turned up is denied UNSAFE_GAS', { skip }, () => {
  srv.engine.reset();
  const challenge = startTest();
  const samples = firmwareSamples(ramp(10, 280, 7), { ...diagramPots().pots, h2s: 300 });
  const res = srv.engine.handleReading(firmwareReading(challenge, samples), { source: 'mqtt' });
  assert.equal(res.reason, 'UNSAFE_GAS');
  assert.equal(res.gas, 'H2S');
});

test('firmware telemetry/alerts link by permitId; closing publishes {siren:false,end:true}', { skip }, () => {
  srv.engine.reset();
  const challenge = startTest();
  const res = srv.engine.handleReading(firmwareReading(challenge, firmwareSamples(ramp(10, 280, 7), diagramPots().pots)), { source: 'mqtt' });
  const beacon = str('BEACON_ID');
  assert.deepEqual(srv.engine.handleTelemetry(beacon, { permitId: res.permitId, h2s: 0, ch4: 0, co: 0, o2: 200, moving: true, sos: false }), { linked: true });
  srv.engine.handleAlert(beacon, { type: 'MAN_DOWN', permitId: res.permitId });
  assert.equal(srv.store.all('incidents').filter((i) => i.permitId === res.permitId && i.cause === 'MAN_DOWN').length, 1);
  srv.engine.closeJob(res.permitId);
  const cmd = srv.engine.deviceLog.find((m) => m.topic === `${config.mqtt.prefix}/beacon/${beacon}/cmd`);
  assert.deepEqual(cmd.payload, { siren: false, end: true });
});
