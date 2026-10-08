// Connects the engine to the public MQTT broker. Incoming device messages are only ingested in LIVE mode.
const mqtt = require('mqtt');
const crypto = require('crypto');
const config = require('./config');

function startMqtt(engine) {
  if (!config.mqtt.enabled) {
    console.log('[mqtt] disabled (ZA_MQTT=off)');
    return null;
  }
  const P = config.mqtt.prefix;
  const client = mqtt.connect(config.mqtt.url, {
    clientId: `zeroasphyx-server-${crypto.randomBytes(4).toString('hex')}`,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    clean: true,
  });

  engine.publisher = (topic, payload) => {
    if (!client.connected) return false;
    client.publish(topic, JSON.stringify(payload), { qos: 1 });
    return true;
  };

  let lastError = '';
  client.on('connect', () => {
    console.log(`[mqtt] connected to ${config.mqtt.url}, prefix ${P}`);
    client.subscribe([`${P}/probe/+/reading`, `${P}/beacon/+/telemetry`, `${P}/beacon/+/alert`], { qos: 1 });
    engine.setMqttConnected(true);
  });
  client.on('close', () => engine.setMqttConnected(false));
  client.on('offline', () => engine.setMqttConnected(false));
  client.on('error', (err) => {
    if (err.message !== lastError) console.warn(`[mqtt] ${err.message}`);
    lastError = err.message;
  });

  client.on('message', (topic, buf) => {
    if (engine.mode !== 'LIVE') return;
    const parts = topic.slice(P.length + 1).split('/'); // [probe|beacon, deviceId, kind]
    if (parts.length !== 3) return;
    const [family, deviceId, kind] = parts;
    let payload;
    try {
      payload = JSON.parse(buf.toString('utf8'));
    } catch {
      console.warn(`[mqtt] ignoring non-JSON message on ${topic}`);
      return;
    }
    try {
      if (family === 'probe' && kind === 'reading') engine.handleReading(payload, { source: 'mqtt', topicDeviceId: deviceId });
      else if (family === 'beacon' && kind === 'telemetry') engine.handleTelemetry(deviceId, payload);
      else if (family === 'beacon' && kind === 'alert') engine.handleAlert(deviceId, payload);
    } catch (err) {
      console.error(`[mqtt] failed to handle ${topic}:`, err);
    }
  });

  return client;
}

module.exports = { startMqtt };
