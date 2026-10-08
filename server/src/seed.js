// Demo seed: people, places, devices, three historical jobs (with signed readings and a valid
// audit chain) and four contractor bills.
const crypto = require('crypto');
const config = require('./config');
const audit = require('./audit');
const { signReading } = require('./signing');
const { localDate } = require('./util');

const MANHOLES = [
  { id: 'MH-001', address: 'Abids Road, near GPO junction, Hyderabad', lat: 17385000, lng: 78486700, depthCm: 300 },
  { id: 'MH-002', address: 'Ameerpet X Roads, Hyderabad', lat: 17437500, lng: 78448300, depthCm: 250 },
  { id: 'MH-003', address: 'KPHB Colony Phase 3, Kukatpally, Hyderabad', lat: 17494800, lng: 78399600, depthCm: 400 },
];
const CONTRACTORS = [
  { id: 'C-01', name: 'Deccan Sanitation Services' },
  { id: 'C-02', name: 'Musi Drainage Works' },
];
const WORKERS = [
  { id: 'W-01', name: 'Ramesh Kumar', contractorId: 'C-01' },
  { id: 'W-02', name: 'Suresh Naik', contractorId: 'C-01' },
  { id: 'W-03', name: 'Mahesh Yadav', contractorId: 'C-02' },
  { id: 'W-04', name: 'Venkatesh Goud', contractorId: 'C-02' },
];
const SUPERVISORS = [
  { id: 'S-01', name: 'Anitha Reddy' },
  { id: 'S-02', name: 'Farhan Ali' },
];

function seed(store) {
  const day = (offset) => localDate(Date.now() + offset * 86400000);
  const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
  const log = (type, data, ts) => audit.append(store, type, data, ts);

  store.batch(() => {
    for (const m of MANHOLES) store.insert('manholes', m);
    for (const c of CONTRACTORS) store.insert('contractors', c);
    for (const w of WORKERS) store.insert('workers', w);
    for (const s of SUPERVISORS) store.insert('supervisors', s);
    for (const d of config.devices) store.insert('devices', { ...d });

    const probe = store.get('devices', 'PROBE-001');

    function historicalTest({ sessionId, date, start, manhole, worker, supervisor, samples, decision, reason, detail, permitId }) {
      const createdAt = at(date, start);
      const receivedAt = new Date(Date.parse(createdAt) + 70 * 1000).toISOString();
      const session = {
        id: sessionId, nonce: crypto.randomBytes(8).toString('hex'), manholeId: manhole.id, workerId: worker.id,
        supervisorId: supervisor.id, contractorId: worker.contractorId, deviceId: probe.id, createdAt,
        status: decision, nonceUsed: true, permitId: permitId || null,
      };
      store.insert('sessions', session);
      log('SESSION_STARTED', {
        sessionId, manholeId: manhole.id, workerId: worker.id, supervisorId: supervisor.id,
        contractorId: worker.contractorId, deviceId: probe.id, nonce: session.nonce,
      }, createdAt);
      const payload = {
        sessionId, nonce: session.nonce, deviceId: probe.id, manholeId: manhole.id, lat: manhole.lat, lng: manhole.lng, samples,
      };
      payload.sig = signReading(payload, probe.secret);
      const readingId = `R-${sessionId.slice(2)}`;
      log('READING_RECEIVED', {
        readingId, sessionId, deviceId: probe.id, manholeId: manhole.id, lat: manhole.lat, lng: manhole.lng,
        sampleCount: samples.length, sig: payload.sig, source: 'mqtt',
      }, receivedAt);
      store.insert('readings', {
        id: readingId, receivedAt, source: 'mqtt', ...payload, decision, reason, detail, permitId: permitId || null,
        sessionConsumed: true, contractorId: worker.contractorId,
        maxDepth: Math.max(...samples.map((s) => s.d)),
      });
      return { session, readingId, receivedAt };
    }

    function telemetry(permitId, date, rows) {
      rows.forEach(([hhmm, h2s, co, ch4, o2, moving], i) => {
        store.insert('telemetry', {
          id: `T-${permitId.slice(4)}-${i}`, deviceId: config.beaconId, ts: at(date, hhmm), permitId,
          h2s, co, ch4, o2, moving, sos: false,
        });
      });
    }

    // --- Job A (3 days ago): C-02 tried an open-air test at MH-003, was denied, worked anyway, billed (BILL-102).
    const dA = day(-3);
    historicalTest({
      sessionId: 'S-SEEDA1', date: dA, start: '09:40', manhole: MANHOLES[2], worker: WORKERS[2], supervisor: SUPERVISORS[1],
      samples: [{ d: 12, h2s: 0, ch4: 1, co: 2, o2: 209 }, { d: 28, h2s: 0, ch4: 1, co: 2, o2: 209 }, { d: 41, h2s: 1, ch4: 1, co: 3, o2: 208 }],
      decision: 'DENIED', reason: 'PROBE_NOT_LOWERED',
      detail: 'Probe reached only 41 cm. It must reach at least 320 cm (80% of the 400 cm manhole).',
    });
    log('PERMIT_DENIED', {
      sessionId: 'S-SEEDA1', readingId: 'R-SEEDA1', deviceId: 'PROBE-001', manholeId: 'MH-003', reason: 'PROBE_NOT_LOWERED',
      detail: 'Probe reached only 41 cm. It must reach at least 320 cm (80% of the 400 cm manhole).',
    }, at(dA, '09:41'));

    // --- Job B (2 days ago): C-01 did everything right at MH-002 (BILL-101 is approvable).
    const dB = day(-2);
    const pB = 'PRM-H7K2Q9';
    historicalTest({
      sessionId: 'S-SEEDB1', date: dB, start: '10:05', manhole: MANHOLES[1], worker: WORKERS[0], supervisor: SUPERVISORS[0],
      samples: [
        { d: 10, h2s: 1, ch4: 1, co: 3, o2: 209 }, { d: 50, h2s: 1, ch4: 1, co: 3, o2: 208 },
        { d: 100, h2s: 2, ch4: 2, co: 4, o2: 207 }, { d: 150, h2s: 2, ch4: 2, co: 4, o2: 206 },
        { d: 200, h2s: 3, ch4: 2, co: 5, o2: 205 }, { d: 230, h2s: 3, ch4: 3, co: 5, o2: 205 },
      ],
      decision: 'GRANTED', reason: 'OK', detail: 'Safe air confirmed down to 230 cm.', permitId: pB,
    });
    store.insert('permits', {
      id: pB, manholeId: 'MH-002', workerId: 'W-01', supervisorId: 'S-01', contractorId: 'C-01', deviceId: 'PROBE-001',
      sessionId: 'S-SEEDB1', readingId: 'R-SEEDB1', issuedAt: at(dB, '10:06'), expiresAt: at(dB, '10:36'),
      status: 'CLOSED', jobOpen: false, closedAt: at(dB, '10:31'), closedBy: 'S-01', revokedAt: null, revokeReason: null,
    });
    log('PERMIT_GRANTED', {
      permitId: pB, sessionId: 'S-SEEDB1', readingId: 'R-SEEDB1', manholeId: 'MH-002', workerId: 'W-01', supervisorId: 'S-01',
      contractorId: 'C-01', deviceId: 'PROBE-001', issuedAt: at(dB, '10:06'), expiresAt: at(dB, '10:36'), maxDepth: 230,
    }, at(dB, '10:06'));
    telemetry(pB, dB, [
      ['10:08', 2, 4, 2, 207, true], ['10:14', 3, 5, 2, 206, true], ['10:20', 3, 5, 3, 206, true], ['10:28', 2, 4, 2, 207, true],
    ]);
    log('JOB_CLOSED', { permitId: pB, finalStatus: 'CLOSED', closedBy: 'S-01' }, at(dB, '10:31'));

    // --- Job C (yesterday): C-02 at MH-003, H2S spiked mid-job, permit revoked (BILL-103).
    const dC = day(-1);
    const pC = 'PRM-R4M8T1';
    historicalTest({
      sessionId: 'S-SEEDC1', date: dC, start: '11:20', manhole: MANHOLES[2], worker: WORKERS[3], supervisor: SUPERVISORS[1],
      samples: [
        { d: 10, h2s: 1, ch4: 1, co: 2, o2: 209 }, { d: 50, h2s: 1, ch4: 1, co: 3, o2: 208 },
        { d: 100, h2s: 2, ch4: 2, co: 3, o2: 207 }, { d: 150, h2s: 3, ch4: 2, co: 4, o2: 207 },
        { d: 200, h2s: 4, ch4: 3, co: 5, o2: 206 }, { d: 250, h2s: 5, ch4: 3, co: 6, o2: 205 },
        { d: 300, h2s: 6, ch4: 4, co: 6, o2: 204 }, { d: 350, h2s: 7, ch4: 4, co: 7, o2: 203 },
      ],
      decision: 'GRANTED', reason: 'OK', detail: 'Safe air confirmed down to 350 cm.', permitId: pC,
    });
    const revokeReason = 'H₂S 38 ppm (must be below 10 ppm)';
    store.insert('permits', {
      id: pC, manholeId: 'MH-003', workerId: 'W-04', supervisorId: 'S-02', contractorId: 'C-02', deviceId: 'PROBE-001',
      sessionId: 'S-SEEDC1', readingId: 'R-SEEDC1', issuedAt: at(dC, '11:21'), expiresAt: at(dC, '11:51'),
      status: 'REVOKED', jobOpen: false, closedAt: at(dC, '11:41'), closedBy: 'S-02', revokedAt: at(dC, '11:34'), revokeReason,
    });
    log('PERMIT_GRANTED', {
      permitId: pC, sessionId: 'S-SEEDC1', readingId: 'R-SEEDC1', manholeId: 'MH-003', workerId: 'W-04', supervisorId: 'S-02',
      contractorId: 'C-02', deviceId: 'PROBE-001', issuedAt: at(dC, '11:21'), expiresAt: at(dC, '11:51'), maxDepth: 350,
    }, at(dC, '11:21'));
    telemetry(pC, dC, [
      ['11:23', 3, 5, 2, 206, true], ['11:28', 6, 6, 3, 205, true], ['11:33', 14, 8, 4, 203, true], ['11:34', 38, 11, 6, 199, true],
    ]);
    log('PERMIT_REVOKED', { permitId: pC, reason: revokeReason, gas: [{ gas: 'H2S', value: 38 }], source: 'beacon telemetry' }, at(dC, '11:34'));
    log('JOB_CLOSED', { permitId: pC, finalStatus: 'REVOKED', closedBy: 'S-02' }, at(dC, '11:41'));

    // --- Bills
    const bills = [
      { id: 'BILL-101', contractorId: 'C-01', manholeId: 'MH-002', jobDate: dB, amount: 18500 },
      { id: 'BILL-102', contractorId: 'C-02', manholeId: 'MH-003', jobDate: dA, amount: 22000 },
      { id: 'BILL-103', contractorId: 'C-02', manholeId: 'MH-003', jobDate: dC, amount: 24000 },
      { id: 'BILL-104', contractorId: 'C-01', manholeId: 'MH-001', jobDate: day(0), amount: 16000 },
    ];
    for (const b of bills) {
      store.insert('bills', { ...b, status: 'PENDING', reason: null, permitId: null, reviewedAt: null });
    }

    log('DEMO_SEEDED', { manholes: MANHOLES.length, bills: bills.length });
  });
}

module.exports = { seed };
