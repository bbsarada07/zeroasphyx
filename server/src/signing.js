// HMAC signing of probe readings. This must match submitReading() in firmware/sketch.ino exactly:
//   message = sessionId|nonce|deviceId|manholeId|lat|lng|S
//   S       = samples joined by ";" each as d,h2s,ch4,co,o2
//   sig     = lowercase hex HMAC-SHA256(key = per-device secret, message)
const crypto = require('crypto');

function readingMessage(r) {
  const samples = Array.isArray(r.samples) ? r.samples : [];
  const S = samples.map((s) => [s.d, s.h2s, s.ch4, s.co, s.o2].join(',')).join(';');
  return [r.sessionId, r.nonce, r.deviceId, r.manholeId, r.lat, r.lng, S].join('|');
}

function signReading(r, secret) {
  return crypto.createHmac('sha256', String(secret)).update(readingMessage(r)).digest('hex');
}

function verifyReadingSig(r, secret) {
  const given = String(r.sig || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = Buffer.from(signReading(r, secret), 'hex');
  return crypto.timingSafeEqual(expected, Buffer.from(given, 'hex'));
}

module.exports = { readingMessage, signReading, verifyReadingSig };
