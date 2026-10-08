# ZeroAsphyx

[![CI](https://github.com/bbsarada07/zeroasphyx/actions/workflows/ci.yml/badge.svg)](https://github.com/bbsarada07/zeroasphyx/actions/workflows/ci.yml)

**No Reading, No Entry, No Payment.**

A sewer and septic-tank entry safety and accountability system:

1. A worker may enter a manhole only with a time-limited digital **entry permit**.
2. The permit is issued only when a **signed gas reading** proves the probe was actually lowered into that manhole and the air is safe.
3. The worker is **monitored during the job** (gas, movement, SOS).
4. The contractor's **bill is blocked** for any job without a clean permit.

Hardware is simulated on Wokwi (ESP32) and talks to the backend over a public MQTT broker. A built-in simulator can stand in for Wokwi at any time.

### Repository layout

```
server/                  Backend: Express API, MQTT bridge, socket.io, SQLite (JSON-file fallback)
  src/config.js          every threshold, timer, broker setting and device key
  test/                  automated tests (scenarios, firmware compatibility, live MQTT)
web/                     Dashboard: React + Vite + Tailwind
firmware/                Hardware: Wokwi ESP32 sketch, circuit and libraries, with its own README
.github/workflows/ci.yml CI: tests + build + production smoke test on Node 20/22, Docker image check
Dockerfile, render.yaml  Deployment: container image and Render blueprint
.env.example             optional environment settings
```

The hardware is documented separately in **[firmware/README.md](firmware/README.md)** (parts, wiring, device behaviour, topics).

---

## 1. Run it locally

Requirements: **Node 20 or newer** and internet access (only needed for the MQTT broker; the simulator works offline).

```bash
npm install
npm run dev
```

- Dashboard: **http://localhost:5173**
- API server: http://localhost:4000 (the Vite dev server proxies `/api` and `/socket.io` to it)

The first start creates `server/data/zeroasphyx.db` with the demo seed. To restore the seed at any time, open **Simulator → Reset demo data** (or `POST /api/demo/reset`).

`better-sqlite3` is an optional dependency. If it can't be installed on a machine, the server automatically falls back to a JSON-file store (`server/data/zeroasphyx.json`) behind the same data-access module. You can force that fallback with `ZA_STORE=json`.

### Tests

```bash
npm test           # 37 automated tests: all 8 simulator scenarios, every denial code, monitoring, payment gate,
                   # audit chain, and firmware compatibility (reads firmware/sketch.ino and diagram.json)
npm run test:mqtt  # live round trip over broker.hivemq.com, with a script playing the ESP32 (exits 2 if the broker is unreachable)
```

`npm test` boots the real server in-process (temporary database, MQTT off, shortened timers) and drives it over HTTP exactly as the simulator drawer does.

---

## 2. Using the dashboard

| Header control | What it does |
|---|---|
| **Role** | Supervisor (Live Operations, Audit, Scoreboard), Municipal Officer (Payments, plus the same views), Public (Verify). There is no real auth. |
| **LIVE (Wokwi) / SIM** | LIVE: the server ingests MQTT messages from Wokwi. SIM: MQTT input is ignored and the simulator scenarios are enabled. |
| **Simulator** | Drawer with the 8 scripted scenarios, the simulated beacon state, the server→device message log, and **Reset demo data**. |

Pages:

- **Live Operations** (`/`): start a pre-entry test, watch the depth and samples, see the big GRANTED / DENIED result, the permit with countdown and QR, live beacon gas tiles, movement and signal, and close the job.
- **Emergency overlay**: full-screen red, a looping Web Audio siren, and the warning in English, Hindi and Telugu (also spoken if the browser has `hi-IN` / `te-IN` voices).
- **Payments** (`/payments`): review the contractor bills.
- **Audit Log** (`/audit`): the hash-chained event log, **Verify chain**, and **Tamper with a record (demo)**.
- **Scoreboard** (`/scoreboard`): per-contractor compliance.
- **Evidence Report** (`/report/{permitId or incidentId}`): one print-friendly page.
- **Public Verify** (`/verify/{permitId}`): mobile-first VALID / EXPIRED / REVOKED / CLOSED / NOT FOUND. Every permit card has a QR code pointing here.

Browsers only allow sound after a user gesture, so **click anywhere on the dashboard once before the demo** to arm the siren. The overlay shows a note if the siren is blocked.

---

## 3. Wokwi (ESP32) setup

1. Go to <https://wokwi.com>, create a new **ESP32** project.
2. Replace the default `sketch.ino` and `diagram.json` with the files from `/firmware`.
3. Add the libraries listed in `firmware/libraries.txt` (Library Manager tab, or add a `libraries.txt` file with the same content).
4. Start the simulation and open the serial monitor. The device joins the `Wokwi-GUEST` Wi-Fi, connects to `mqtt://broker.hivemq.com:1883`, and prints `[state] IDLE - waiting for a test to be started on the dashboard`.
5. On the dashboard, make sure the header shows **LIVE (Wokwi)** and **MQTT connected**.

The firmware is the source of truth. The server's topic prefix, the PROBE-001 secret and the MH-001 coordinates are set to match `sketch.ino`, and `npm test` includes `server/test/firmware.test.js`, which reads `sketch.ino` and `diagram.json` and fails if they drift apart.

> **Use a unique topic prefix before the event.** The firmware ships with `PREFIX = "safeentry/TEAMID"` on a public broker. Any other team running the same template would share those topics, and their devices' messages would reach your dashboard. To change it, edit line 10 of `sketch.ino` (e.g. `"safeentry/hyd-7k3q"`) and start the server with the same value: `MQTT_PREFIX=safeentry/hyd-7k3q npm run dev` (PowerShell: `$env:MQTT_PREFIX="safeentry/hyd-7k3q"; npm run dev`), or change `prefix` in `server/src/config.js`.

### Knob and sensor positions

`diagram.json` already starts every part in a safe position: the three gas knobs at zero, the O₂ knob in the middle (20.0 %), and the distance sensor at 10 cm.

| Part | Stands in for | Safe position |
|---|---|---|
| Potentiometer H₂S (0–100 ppm) | H₂S sensor | **near zero** (fully left); safe below 10 ppm |
| Potentiometer CO (0–200 ppm) | CO sensor | **near zero**; safe below 35 ppm |
| Potentiometer CH₄ (0–100 % LEL) | methane sensor | **near zero**; safe below 10 % LEL |
| Potentiometer O₂ (15.0–25.0 %) | oxygen sensor | **near the middle** (≈ 20.0 %); safe 19.5–23.5 % |
| HC-SR04 distance | depth of the probe | see the descent steps below |
| Slide switch | accelerometer (moving / still) | the position where telemetry shows `"moving":true` (check the serial monitor or the dashboard's Movement tile) |
| START button | starts the probe reading | |
| SOS button | worker SOS | |

### A live pre-entry test

1. Choose **MH-001**, a worker, supervisor and **PROBE-001**, then click **Start pre-entry test**. The device's LEDs blink and the serial monitor shows `[state] CHALLENGED`.
   - Use **MH-001** for live tests: the firmware's GPS position is fixed at MH-001 (17.385000, 78.486700), so the other manholes are denied as WRONG_LOCATION.
2. In Wokwi, click the HC-SR04 and check the distance is **about 10 cm**.
3. Press **START** once. The serial monitor shows `[state] DESCENDING`.
4. Raise the distance slider **gradually to about 280 cm**. The device records a sample the first time it reads a depth in each new 50 cm band (`[sample 1] depth=10cm …`), up to 8 samples. MH-001 needs at least 3 samples and a deepest sample of at least **240 cm** (80 % of 300 cm), so keep going until a sample at **250 cm or more** appears.
5. Press **START again** to sign and submit the reading. The dashboard shows GRANTED or DENIED; the device turns the green LED on (GRANTED, `[state] MONITORING`) or the red LED on (DENIED, back to IDLE).

If the reading is denied, start a new test from the dashboard: each test can be used only once.

During the job, the device streams beacon telemetry every 2 s. Turning a gas knob up revokes the permit (EVACUATE + siren). Setting the slide switch to "still" triggers MAN_DOWN after 10 s on the device; the server raises it after 20 s on its own as a backup. The SOS button raises an SOS incident. The buzzer sounds locally without waiting for the network. Clicking **Close job** sends `{siren:false, end:true}`, which silences the device and returns it to IDLE.

---

## 4. Three-minute demo script

Before you start: **Reset demo data**, click once on the page (arms the siren), and have Wokwi running in LIVE mode. Permits last **3 minutes in the demo** (production would be 30), so close the live job within 3 minutes of GRANTED.

| Time | Do | Say |
|---|---|---|
| 0:00 | Live Operations, Supervisor role | "Workers die from sewer gas. Detectors exist, but nobody enforces their use. ZeroAsphyx does: No Reading, No Entry, No Payment." |
| 0:20 | **Start pre-entry test** on MH-001. In Wokwi: START, raise the distance from 10 to 280 cm, START again | "The probe signs every reading with its own key, and the depth samples prove it actually went down the shaft." |
| 0:50 | GRANTED appears. Scan the QR code with a phone | "A 3-minute permit. Anyone, such as a resident or the police, can scan it: VALID." |
| 1:10 | Point at the live gas tiles, then **Close job** | "The beacon watches the worker the whole time. The supervisor closes the job." |
| 1:20 | Switch to **SIM**, open Simulator, run **Open-air cheat**, then **Replay an old reading** | "Holding the probe in open air: denied, not lowered. Re-sending yesterday's good reading: denied, replay." |
| 1:45 | Run **Man down** | Full-screen alarm and siren. "It tells bystanders in three languages not to go in. Most deaths are would-be rescuers." Click **ACKNOWLEDGE**. |
| 2:10 | Role → **Municipal Officer**, Payments, **Review** all four bills | "Approved: a clean permit. Rejected: no permit at all. Rejected: revoked for H₂S. Today's live job: approved." |
| 2:35 | **Audit Log**: Verify chain (intact) → **Tamper** → Verify chain | "Someone edits the revocation in the database. The chain breaks exactly there, and every payment is refused until it's resolved." |
| 2:55 | **Scoreboard** | "Contractors are ranked on compliance." |

**Phone scanning:** QR codes use the address the dashboard was opened from, unless `PUBLIC_URL` is set. For the QR step, open the dashboard on the laptop through its Wi-Fi address, the **Network** URL that `npm run dev` prints (e.g. `http://192.168.1.4:5173`). Put the phone on the same Wi-Fi; the firewall must allow port 5173. Or use the deployed URL (section 6).

If Wokwi or the broker misbehaves, do the 0:20 step in SIM instead: click **Start pre-entry test**, then **Simulator → Safe descent**. It answers the pending test with a correctly signed reading.

Reset demo data afterwards.

---

## 5. How it works

### MQTT topics (prefix `safeentry/TEAMID` as in `sketch.ino`, JSON payloads)

| Topic | Direction | Payload |
|---|---|---|
| `P/probe/{deviceId}/challenge` | server → device | `{sessionId, nonce, manholeId}` |
| `P/probe/{deviceId}/reading` | device → server | `{sessionId, nonce, deviceId, manholeId, lat, lng, samples:[{d,h2s,ch4,co,o2}], sig}` |
| `P/probe/{deviceId}/result` | server → device | `{sessionId, decision, reason, permitId?}` (reason is the code, `OK` when granted) |
| `P/beacon/{deviceId}/telemetry` | device → server, every 2 s | `{permitId, h2s, ch4, co, o2, moving, sos}` |
| `P/beacon/{deviceId}/alert` | device → server | `{type: MAN_DOWN \| SOS \| GAS, permitId}` |
| `P/beacon/{deviceId}/cmd` | server → device | `{siren:true}` / `{siren:false, end:true}` when the job closes |

Units are integers: ppm for H₂S and CO, % LEL for CH₄, tenths of a percent for O₂ (209 = 20.9 %), cm for depth, microdegrees for lat/lng.

### Signature

`sig` = lowercase hex HMAC-SHA256 with the per-device secret over

```
sessionId|nonce|deviceId|manholeId|lat|lng|S      S = samples joined by ";" each as d,h2s,ch4,co,o2
```

The server builds the same string in `server/src/signing.js` and compares in constant time.

### Permit decision (first failure wins)

`UNKNOWN_DEVICE` → `CALIBRATION_EXPIRED` → `BAD_SIGNATURE` → `INVALID_SESSION` (missing, older than 5 min, wrong nonce, replay) → `WRONG_LOCATION` (> 50 m) → `PROBE_NOT_LOWERED` (< 3 samples, depth not strictly increasing, or max < 80 % of manhole depth) → `UNSAFE_GAS` (worst case over all samples; safe = H₂S < 10, CO < 35, CH₄ < 10, 195 ≤ O₂ ≤ 235).

### Behaviour decisions worth knowing

- **One test, one decision.** A session is consumed only by a correctly signed reading. A forged or altered reading cannot use up someone else's test.
- **One open job at a time.** A new test can't be started while a job is open. Simulator scenarios close or bypass it themselves.
- **Closing a job** turns an ACTIVE permit into CLOSED. A REVOKED or EXPIRED permit keeps that status when the job is closed, so it can never look compliant.
- **Alerts without a valid open permit** are logged and shown as a warning, but don't create an incident or the full-screen alarm.
- **Payment gate:** APPROVED only if, for the bill's manhole and job date, there is a permit that was issued before work began, ended CLOSED, has no incident, **and** the audit chain verifies. Any one clean permit for that manhole and date is enough (e.g. after a re-test).
- **Compliance %** = billed jobs backed by a clean permit ÷ all billed jobs.
- The **live dashboard** shows only the last 30 minutes of activity. Seeded history is visible in reports, payments and the audit log.

### Tamper-evident log

Every significant event is appended to `events {seq, ts, type, data, prevHash, hash}` with
`hash = SHA256(prevHash + seq + ts + type + canonicalJSON(data))`.
`GET /api/audit/verify` re-reads the stored log and returns `{ok:true}` or the first broken `seq`. `POST /api/demo/tamper` (demo only) edits one stored record without fixing its hash.

### Configuration

Everything (thresholds, timers, broker, prefix, device keys, permit validity) is in **`server/src/config.js`**. Environment overrides can be set in the shell, in your hosting dashboard, or in a `.env` file at the repo root (copy `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 4000 | HTTP port |
| `PUBLIC_URL` | address the dashboard was opened from (Render/Railway URL detected automatically) | base URL printed into permit QR codes |
| `MQTT_URL` | `mqtt://broker.hivemq.com:1883` | broker |
| `MQTT_PREFIX` | `safeentry/TEAMID` | topic prefix; must equal `PREFIX` in `sketch.ino` |
| `ZA_MQTT=off` | on | disable MQTT completely |
| `ZA_MODE=SIM` | LIVE | data source at startup |
| `ZA_STORE=json` | sqlite | force the JSON-file store |
| `ZA_DATA_DIR` | `server/data` | where the database lives |

---

## 6. Deployment

ZeroAsphyx deploys as **one service**. Express serves the built dashboard from `web/dist`, the API and socket.io share the same origin, and the server listens on `process.env.PORT`. Health check: `GET /api/health`.

Every push to `main` runs CI. It runs the tests, builds, starts the production service and checks it on Node 20 and 22, and builds and runs the Docker image. A green CI badge at the top means the deployable build works on Linux.

### Option A: Render (blueprint, recommended)

1. Sign in at <https://render.com> with GitHub.
2. **New → Blueprint** → choose this repository. Render reads `render.yaml`:
   - build `npm ci && npm run build`, start `npm start`, health check `/api/health`, Node 20.
3. Click **Apply**. When it's live, open the `https://….onrender.com` URL.

QR codes automatically use Render's public URL (`RENDER_EXTERNAL_URL`). On the free plan the service sleeps after inactivity and the first request takes about a minute; open it before the demo.

### Option B: Docker (any container host: Fly.io, Railway, Cloud Run, a VM)

```bash
docker build -t zeroasphyx .
docker run -p 4000:4000 -e PUBLIC_URL=https://your-domain.example zeroasphyx
```

### Option C: Any Node 20+ host

```bash
npm ci
npm run build
npm start                  # PORT and PUBLIC_URL from the environment
```

- **Build command:** `npm ci && npm run build`. **Start command:** `npm start`.
- The web build tools are regular dependencies, so the build works even where devDependencies are skipped.

### Notes for every host

- **Data:** the database is a local file (`server/data/`). On hosts with ephemeral disks it resets on redeploy or restart, and the server re-seeds the demo automatically when it is empty. Mount a persistent disk at `server/data` (or set `ZA_DATA_DIR`) to keep data.
- **MQTT:** the host must allow outbound TCP 1883 to the broker. If it doesn't, the dashboard still works in **SIM** mode.
- **Secrets:** the device secrets in `server/src/config.js` are **demo values** that match the Wokwi firmware. Don't reuse them for real devices.

---

## 7. What is simulated vs. what production needs

| In this prototype | Production would need |
|---|---|
| Potentiometers stand in for gas sensors | **Certified, calibrated** multi-gas detectors (H₂S, CO, CH₄/LEL, O₂) with bump-test and calibration records |
| Per-device HMAC secret in firmware and in `config.js` | Keys in a **secure element** (e.g. ATECC608) on the device, server keys in a vault/HSM, key rotation |
| HC-SR04 ultrasonic distance as "depth" | A **cable-length encoder** on the probe reel (plus a pressure sensor) to prove descent |
| Slide switch as "moving / still" | An **accelerometer** with fall and no-motion detection worn by the worker |
| Fixed GPS coordinates sent by the device | A real GNSS fix with accuracy reporting |
| Public HiveMQ broker, no TLS | Private broker with TLS, per-device credentials and ACLs |
| Role switcher, no login | Real authentication and authorisation (supervisor, officer, auditor) |
| Hash-chained log in the same database | Periodic anchoring of the chain head to an external timestamping service or write-once storage |
| 3-minute demo permit | 30-minute permits (configurable), re-test on expiry |
| Simulator drawer, tamper and reset endpoints | Removed |

---

## Troubleshooting

- **Port 4000 or 5173 already in use:** stop the other process (an older `npm run dev`), then run it again.
- **Header says "MQTT connecting…":** the network blocks port 1883 or the public broker is down. Switch to **SIM**; everything else keeps working.
- **No siren:** click anywhere on the page once (browser autoplay rule) and check the system volume.
- **Dashboard never reacts to Wokwi:** the header must say **LIVE (Wokwi)**, and `PREFIX` in `sketch.ino` must equal the server's prefix (`npm test` checks this).
- **Wokwi reading is DENIED with `WRONG_LOCATION`:** choose MH-001; the firmware's GPS position is fixed there.
- **Wokwi reading is DENIED with `PROBE_NOT_LOWERED`:** raise the distance until a sample at 250 cm or more is printed before pressing START the second time.
- **Wokwi reading is DENIED with `BAD_SIGNATURE`:** the device secret or the signed string differs from the server's. Compare `submitReading()` in `firmware/sketch.ino` with `readingMessage()` in `server/src/signing.js`, and the secret with `server/src/config.js`.
