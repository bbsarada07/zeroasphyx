# ZeroAsphyx hardware (Wokwi ESP32)

This folder is the hardware side of ZeroAsphyx: one simulated ESP32 that plays **both** the gas probe (`PROBE-001`) and the worker beacon (`BEACON-001`). In production these would be two separate, certified devices.

| File | What it is |
|---|---|
| `sketch.ino` | Firmware (Arduino C++). The source of truth for the device protocol. |
| `diagram.json` | Wokwi circuit: the parts and their wiring. |
| `libraries.txt` | Arduino libraries Wokwi installs: `PubSubClient`, `ArduinoJson`. |

The server is built to match this firmware. `server/test/firmware.test.js` (part of `npm test`) reads `sketch.ino` and `diagram.json` and fails if the topic prefix, secret, coordinates, signed-string format, sample limits or payload fields drift apart.

---

## Run it in Wokwi

1. Open <https://wokwi.com> → **New project** → **ESP32**.
2. Replace `sketch.ino` and `diagram.json` with the files in this folder.
3. Add a file named `libraries.txt` with the contents of the one here (or add the two libraries from the Library Manager).
4. Press **Start**. Open the serial monitor; you should see:
   ```
   [wifi] connecting.... connected
   [mqtt] connecting... connected
   [state] IDLE - waiting for a test to be started on the dashboard
   ```
5. On the dashboard, set the header to **LIVE (Wokwi)**.

> **Topic prefix:** `PREFIX` (line 10) is `safeentry/TEAMID`, and the server uses the same value by default. Topics on the public broker are shared with anyone using the same prefix, so for an event change it to something unique here **and** set `MQTT_PREFIX` to the same value on the server.

---

## Parts and wiring (`diagram.json`)

| Part | ESP32 pin | Stands in for | Range / behaviour |
|---|---|---|---|
| Potentiometer `potH2S` | D34 (ADC1) | H₂S sensor | 0–100 ppm |
| Potentiometer `potCO` | D35 (ADC1) | CO sensor | 0–200 ppm |
| Potentiometer `potCH4` | D32 (ADC1) | Methane sensor | 0–100 % LEL |
| Potentiometer `potO2` | D33 (ADC1) | Oxygen sensor | 150–250 tenths of a percent (15.0–25.0 %) |
| HC-SR04 `sonar` | TRIG D5, ECHO D18 | Probe depth (cable encoder in production) | distance in cm |
| Push button `btnStart` (green) | D14 | START | press once to begin the descent, again to submit |
| Push button `btnSos` (red) | D13 | Worker SOS | sends an SOS alert |
| Slide switch `swMove` | D4 | Accelerometer | one side = moving, other side = still |
| Buzzer `bz` | D25 | Siren | sounds on local alarm or `{siren:true}` |
| LED `ledG` | D26 | Status | green = permit granted |
| LED `ledR` | D27 | Status | red = denied / alarm |

The gas inputs are on ADC1 pins only, because ADC2 doesn't work while Wi-Fi is on.

**Start positions** (already set in `diagram.json`): H₂S, CO and CH₄ knobs at zero, O₂ knob in the middle (20.0 %), distance 10 cm. All of these are safe.

**Safe limits** (same on the device and the server): H₂S < 10 ppm, CO < 35 ppm, CH₄ < 10 % LEL, 19.5 % ≤ O₂ ≤ 23.5 %.

---

## How the device behaves

```
IDLE ──challenge──▶ CHALLENGED ──START──▶ DESCENDING ──START──▶ WAIT_RESULT ──GRANTED──▶ MONITORING ──{end:true}──▶ IDLE
                                                                      └──DENIED──▶ IDLE
```

1. **CHALLENGED.** The dashboard's *Start pre-entry test* publishes `{sessionId, nonce, manholeId}`. Both LEDs blink.
2. **DESCENDING.** After START, the device reads the depth every 200 ms and records a sample `{d, h2s, ch4, co, o2}` the first time it sees each new 50 cm band, up to **8 samples**. Raise the distance gradually from 10 cm to about **280 cm**.
3. **Submit.** Press START again. The device signs the reading with HMAC-SHA256 and publishes it:
   ```
   message = sessionId|nonce|PROBE-001|manholeId|17385000|78486700|d,h2s,ch4,co,o2;d,h2s,ch4,co,o2;...
   sig     = lowercase hex HMAC-SHA256(key = "probe-001-demo-secret", message)
   ```
   The GPS position is fixed at **MH-001**, so live tests must use MH-001. A test passes there when the deepest sample is at least 240 cm, which in practice means a sample at 250 cm or more.
4. **MONITORING.** On GRANTED the green LED lights. The beacon sends telemetry every 2 s and raises alerts locally, so the siren doesn't depend on the network:
   - any gas outside the safe limits → `GAS` alert (once per job) and siren
   - SOS button → `SOS` alert and siren
   - slide switch on "still" for **10 s** → `MAN_DOWN` alert (once per job) and siren. The server also raises MAN_DOWN after 20 s of `moving:false` as a backup.
5. **Job closed.** The supervisor's *Close job* sends `{siren:false, end:true}`. The device goes quiet and returns to IDLE.

### MQTT topics

Prefix `P` = `PREFIX` in `sketch.ino`. All payloads are JSON with integer values.

| Topic | Direction | Payload |
|---|---|---|
| `P/probe/PROBE-001/challenge` | server → device | `{sessionId, nonce, manholeId}` |
| `P/probe/PROBE-001/reading` | device → server | `{sessionId, nonce, deviceId, manholeId, lat, lng, samples:[{d,h2s,ch4,co,o2}], sig}` |
| `P/probe/PROBE-001/result` | server → device | `{sessionId, decision, reason, permitId}` (`permitId` only when GRANTED) |
| `P/beacon/BEACON-001/telemetry` | device → server | `{permitId, h2s, ch4, co, o2, moving, sos}` every 2 s |
| `P/beacon/BEACON-001/alert` | device → server | `{type: "GAS" \| "SOS" \| "MAN_DOWN", permitId}` |
| `P/beacon/BEACON-001/cmd` | server → device | `{siren:true}` or `{siren:false, end:true}` |

---

## Simulated here vs. needed in production

| Prototype | Production |
|---|---|
| Potentiometers | Certified, calibrated multi-gas detector (H₂S, CO, CH₄/LEL, O₂) with bump-test records |
| Secret compiled into the sketch | Key in a secure element (e.g. ATECC608), never readable from flash |
| HC-SR04 distance as depth | Cable-length encoder on the probe reel, plus a pressure sensor |
| Slide switch as motion | Accelerometer with fall and no-motion detection, worn by the worker |
| Fixed coordinates | Real GNSS fix with accuracy reporting |
| Public broker, no TLS | Private broker with TLS and per-device credentials |
| One board for probe and beacon | Separate probe unit and intrinsically safe worker beacon |
