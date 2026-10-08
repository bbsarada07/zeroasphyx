// ZeroAsphyx server configuration — every threshold, timer, broker setting and device key lives here.
// Environment variables only override what a deployment (or the automated test) needs to change.
const fs = require('fs');
const path = require('path');

// Optional .env at the repo root (see .env.example). Variables already set in the environment win.
const envFile = path.join(__dirname, '..', '..', '.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

module.exports = {
  port: num(env.PORT, 4000),
  // Base URL printed into permit QR codes (points at the Public Verify page). When unset, the server
  // uses the address the dashboard was opened from (localhost:5173 in development, the LAN IP from a phone).
  publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '')).replace(/\/+$/, '') || null,
  timezone: 'Asia/Kolkata',

  // Storage: better-sqlite3 if it loads, otherwise a JSON file behind the same data-access module.
  storage: env.ZA_STORE || 'sqlite',
  dataDir: env.ZA_DATA_DIR || path.join(__dirname, '..', 'data'),
  webDist: path.join(__dirname, '..', '..', 'web', 'dist'),

  mqtt: {
    enabled: env.ZA_MQTT !== 'off',
    url: env.MQTT_URL || 'mqtt://broker.hivemq.com:1883',
    // Must equal PREFIX in firmware/sketch.ino (the firmware is the source of truth).
    prefix: env.MQTT_PREFIX || 'ZeroAsphyx',
  },

  // Data source at startup: 'LIVE' = Wokwi over MQTT, 'SIM' = simulator panel.
  defaultMode: env.ZA_MODE === 'SIM' ? 'SIM' : 'LIVE',

  permit: {
    validityMs: num(env.ZA_PERMIT_VALIDITY_MS, 3 * 60 * 1000), // demo: 3 minutes
    productionValidityMin: 30, // shown in the UI: production permits would last 30 minutes
  },
  session: {
    maxAgeMs: 5 * 60 * 1000, // challenge/nonce lifetime
  },
  location: {
    maxDistanceM: 50,
  },
  notes: {
    maxLength: 1000,
  },
  descent: {
    minSamples: 3,
    minDepthRatio: 0.8, // max sample depth must reach 80% of the manhole's registered depth
    maxSamples: 8,
  },
  // Safe = h2s < 10 ppm, co < 35 ppm, ch4 < 10 %LEL, 195 <= o2 <= 235 (tenths of a percent)
  gas: {
    h2sMax: 10,
    coMax: 35,
    ch4Max: 10,
    o2Min: 195,
    o2Max: 235,
  },
  monitor: {
    stillTimeoutMs: num(env.ZA_STILL_MS, 20 * 1000), // server-side man-down backup
    signalLostMs: num(env.ZA_SIGNAL_LOST_MS, 15 * 1000),
    telemetryIntervalMs: num(env.ZA_TELEMETRY_MS, 2000), // simulated beacon cadence
    tickMs: 500,
    telemetryKeepPerPermit: 300,
  },

  beaconId: 'BEACON-001',
  devices: [
    { id: 'PROBE-001', type: 'probe', label: 'Gas probe 1', secret: 'probe-001-demo-secret', calibrationDue: '2027-12-31' },
    { id: 'PROBE-002', type: 'probe', label: 'Gas probe 2', secret: 'probe-002-demo-secret', calibrationDue: '2025-06-30' },
    { id: 'BEACON-001', type: 'beacon', label: 'Worker beacon 1', secret: 'beacon-001-demo-secret', calibrationDue: '2027-12-31' },
  ],

  sim: {
    stepDelayMs: num(env.ZA_SIM_STEP_MS, 450), // pause between simulated depth samples (animation only)
    defaults: { manholeId: 'MH-001', workerId: 'W-01', supervisorId: 'S-01', deviceId: 'PROBE-001' },
  },
};
