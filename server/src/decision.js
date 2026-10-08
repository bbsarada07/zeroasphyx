// Permit decision. Checks run in a fixed order; the first failure is the denial reason.
const config = require('./config');
const { verifyReadingSig } = require('./signing');
const { gasFailures, worstCase, describeFailures } = require('./gas');
const { distanceM } = require('./util');

const deny = (code, detail, extra = {}) => ({ decision: 'DENIED', code, detail, ...extra });

function calibrationExpired(device, now) {
  return new Date(`${device.calibrationDue}T23:59:59+05:30`).getTime() < now.getTime();
}

/**
 * @param r normalised reading {sessionId, nonce, deviceId, manholeId, lat, lng, samples, sig}
 * @returns {decision, code, detail, consumesSession, gas?, maxDepth?, worst?}
 */
function decide(r, store, now = new Date()) {
  // 1. UNKNOWN_DEVICE
  const device = store.get('devices', r.deviceId);
  if (!device || device.type !== 'probe') {
    return deny('UNKNOWN_DEVICE', `Probe "${r.deviceId || '(none)'}" is not registered with the municipality.`);
  }
  // 2. CALIBRATION_EXPIRED
  if (calibrationExpired(device, now)) {
    return deny('CALIBRATION_EXPIRED', `Probe ${device.id} calibration expired on ${device.calibrationDue}. It must be recalibrated before use.`);
  }
  // 3. BAD_SIGNATURE
  if (!verifyReadingSig(r, device.secret)) {
    return deny('BAD_SIGNATURE', 'The digital signature does not match the data. The reading was altered or did not come from this probe.');
  }
  // 4. INVALID_SESSION (missing, too old, nonce mismatch, replay)
  const s = store.get('sessions', r.sessionId);
  if (!s) return deny('INVALID_SESSION', 'No pre-entry test was started for this reading. Start a new test from the dashboard.');
  if (now.getTime() - Date.parse(s.createdAt) > config.session.maxAgeMs) {
    return deny('INVALID_SESSION', `The test session is older than ${config.session.maxAgeMs / 60000} minutes. Start a new test.`);
  }
  if (s.nonce !== r.nonce) return deny('INVALID_SESSION', 'The challenge code in the reading does not match this test session.');
  if (s.nonceUsed) return deny('INVALID_SESSION', 'This reading was already used once. Replayed (copied) readings are rejected.');
  if (s.deviceId !== r.deviceId || s.manholeId !== r.manholeId) {
    return deny('INVALID_SESSION', `The reading is for ${r.deviceId} at ${r.manholeId}, but this test was started for ${s.deviceId} at ${s.manholeId}.`);
  }

  // From here on the session is consumed: one test, one decision.
  const consumed = { consumesSession: true };
  const manhole = store.get('manholes', s.manholeId);

  // 5. WRONG_LOCATION
  const dist = distanceM(r.lat, r.lng, manhole.lat, manhole.lng);
  if (!Number.isFinite(dist) || dist > config.location.maxDistanceM) {
    const where = Number.isFinite(dist) ? `${Math.round(dist)} m away from` : 'without a valid GPS position for';
    return deny('WRONG_LOCATION', `Reading was taken ${where} ${manhole.id} (limit ${config.location.maxDistanceM} m).`, consumed);
  }

  // 6. PROBE_NOT_LOWERED (Proof of Descent)
  const samples = Array.isArray(r.samples) ? r.samples : [];
  const depths = samples.map((x) => Number(x.d));
  const maxDepth = depths.length ? Math.max(...depths.filter(Number.isFinite), 0) : 0;
  const need = Math.ceil(manhole.depthCm * config.descent.minDepthRatio);
  if (samples.length < config.descent.minSamples) {
    return deny('PROBE_NOT_LOWERED', `Only ${samples.length} depth sample(s) recorded. At least ${config.descent.minSamples} are needed to prove the probe went down.`, { ...consumed, maxDepth });
  }
  for (let i = 1; i < depths.length; i++) {
    if (!(depths[i] > depths[i - 1])) {
      return deny('PROBE_NOT_LOWERED', 'Depth did not increase steadily between samples, so the probe was not lowered continuously.', { ...consumed, maxDepth });
    }
  }
  if (!(maxDepth >= need)) {
    return deny('PROBE_NOT_LOWERED', `Probe reached only ${maxDepth} cm. It must reach at least ${need} cm (80% of the ${manhole.depthCm} cm manhole).`, { ...consumed, maxDepth });
  }

  // 7. UNSAFE_GAS (worst case across all samples)
  const worst = worstCase(samples);
  const fails = gasFailures(worst);
  if (fails.length) {
    return deny('UNSAFE_GAS', `Unsafe gas at depth: ${describeFailures(fails)}.`, {
      ...consumed, maxDepth, worst, gas: fails.map((f) => f.gas).join(','),
    });
  }

  return {
    decision: 'GRANTED', code: 'OK', detail: `Safe air confirmed down to ${maxDepth} cm.`, ...consumed, maxDepth, worst,
  };
}

module.exports = { decide, calibrationExpired };
