// End-to-end LIVE-mode check over the real public broker: this script plays the part of the ESP32
// (probe + beacon) and drives the server through challenge -> signed reading -> GRANTED -> telemetry ->
// MAN_DOWN -> siren -> close -> {siren:false,end:true}. Exits 0 on pass, 1 on failure, 2 if the broker
// is unreachable.
const os = require('os');
const fs = require('fs');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroasphyx-mqtt-'));
Object.assign(process.env, { ZA_DATA_DIR: dataDir, ZA_MODE: 'LIVE', ZA_SIM_STEP_MS: '0' });

const mqtt = require('mqtt');
const config = require('../src/config');
const { createApp } = require('../src/app');
const { signReading } = require('../src/signing');

const P = config.mqtt.prefix;
const step = (msg) => console.log(`  ✔ ${msg}`);

function waitMessage(client, topic, pred = () => true, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { client.off('message', on); reject(new Error(`timeout waiting on ${topic}`)); }, timeoutMs);
    function on(tp, buf) {
      if (tp !== topic) return;
      const payload = JSON.parse(buf.toString());
      if (!pred(payload)) return;
      clearTimeout(t);
      client.off('message', on);
      resolve(payload);
    }
    client.on('message', on);
  });
}

async function main() {
  const srv = await createApp({ port: 0, mqtt: true });
  const device = mqtt.connect(config.mqtt.url, { clientId: `zeroasphyx-fake-esp32-${Date.now()}`, connectTimeout: 10000, reconnectPeriod: 0 });
  const cleanup = async () => {
    device.end(true);
    await srv.close();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  try {
    await new Promise((resolve, reject) => {
      device.once('connect', resolve);
      device.once('error', reject);
      setTimeout(() => reject(new Error('broker connect timeout')), 12000);
    });
  } catch (err) {
    console.log(`SKIP: cannot reach ${config.mqtt.url} (${err.message})`);
    await cleanup();
    process.exit(2);
  }
  step(`fake ESP32 connected to ${config.mqtt.url}`);

  const deadline = Date.now() + 15000;
  while (!srv.engine.mqtt.connected && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  if (!srv.engine.mqtt.connected) throw new Error('server did not connect to the broker');
  step('server connected to the broker');

  await device.subscribeAsync([`${P}/probe/PROBE-001/challenge`, `${P}/probe/PROBE-001/result`, `${P}/beacon/BEACON-001/cmd`], { qos: 0 }); // PubSubClient (firmware) uses QoS 0
  await new Promise((r) => setTimeout(r, 1000)); // let subscriptions settle on the public broker

  const challengeP = waitMessage(device, `${P}/probe/PROBE-001/challenge`);
  const session = srv.engine.startSession({ manholeId: 'MH-001', workerId: 'W-01', supervisorId: 'S-01', deviceId: 'PROBE-001' });
  const challenge = await challengeP;
  if (challenge.sessionId !== session.id || challenge.nonce !== session.nonce || challenge.manholeId !== 'MH-001') throw new Error('bad challenge');
  step(`challenge received over MQTT: ${JSON.stringify(challenge)}`);

  const reading = {
    sessionId: challenge.sessionId, nonce: challenge.nonce, deviceId: 'PROBE-001', manholeId: challenge.manholeId,
    lat: 17385000, lng: 78486700,
    samples: [10, 50, 100, 150, 200, 250, 280].map((d, i) => ({ d, h2s: 1, ch4: 2, co: 3 + (i % 2), o2: 208 })),
  };
  reading.sig = signReading(reading, 'probe-001-demo-secret');
  const resultP = waitMessage(device, `${P}/probe/PROBE-001/result`, (m) => m.sessionId === session.id);
  device.publish(`${P}/probe/PROBE-001/reading`, JSON.stringify(reading), { qos: 0 }); // PubSubClient (firmware) uses QoS 0
  const result = await resultP;
  if (result.decision !== 'GRANTED' || !result.permitId) throw new Error(`expected GRANTED, got ${JSON.stringify(result)}`);
  step(`signed reading published, result received: ${JSON.stringify(result)}`);

  for (let i = 0; i < 2; i++) {
    device.publish(`${P}/beacon/BEACON-001/telemetry`, JSON.stringify({ permitId: result.permitId, h2s: 1, ch4: 2, co: 4, o2: 208, moving: true, sos: false }), { qos: 0 }); // PubSubClient (firmware) uses QoS 0
    await new Promise((r) => setTimeout(r, 1500));
  }
  const tel = srv.store.all('telemetry').filter((t) => t.permitId === result.permitId);
  if (tel.length < 1) throw new Error('telemetry did not reach the server');
  step(`beacon telemetry linked to ${result.permitId} (${tel.length} rows)`);

  const sirenP = waitMessage(device, `${P}/beacon/BEACON-001/cmd`, (m) => m.siren === true);
  device.publish(`${P}/beacon/BEACON-001/alert`, JSON.stringify({ type: 'MAN_DOWN', permitId: result.permitId }), { qos: 0 }); // PubSubClient (firmware) uses QoS 0
  await sirenP;
  const inc = srv.store.all('incidents').find((i) => i.permitId === result.permitId);
  if (!inc || inc.cause !== 'MAN_DOWN') throw new Error('MAN_DOWN incident not created');
  step(`MAN_DOWN alert -> incident ${inc.id} and {siren:true} command received`);

  const endP = waitMessage(device, `${P}/beacon/BEACON-001/cmd`, (m) => m.end === true);
  srv.engine.closeJob(result.permitId);
  const end = await endP;
  if (end.siren !== false) throw new Error('end command must turn the siren off');
  step(`job closed -> ${JSON.stringify(end)} received`);

  await cleanup();
  console.log('PASS: LIVE MQTT round trip works against the public broker.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
