// SafeEntry - simulated gas probe + worker beacon on one ESP32 (Wokwi)
// In production these are two separate units. Values here are simulated.
// Edge AI: localRiskScore() computes the same compound risk score as the server (server/src/ai.js),
// so the probe warns the worker on its OLED and buzzer even when MQTT is down.

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "mbedtls/md.h"

// ---------- MUST MATCH THE SERVER CONFIG ----------
const char* PREFIX        = "ZeroAsphyx";        // same topic prefix as the server
const char* PROBE_ID      = "PROBE-001";
const char* BEACON_ID     = "BEACON-001";
const char* DEVICE_SECRET = "probe-001-demo-secret";   // same secret as the server's PROBE-001
const long  LAT = 17385000;                             // microdegrees, must sit within 50 m
const long  LNG = 78486700;                             // of the manhole chosen on the dashboard
// --------------------------------------------------

const char* BROKER = "broker.hivemq.com";
const int   BROKER_PORT = 1883;

// Pins (gas inputs on ADC1 only: ADC2 does not work while WiFi is on)
const int PIN_H2S = 34, PIN_CO = 35, PIN_CH4 = 32, PIN_O2 = 33;
const int PIN_TRIG = 5, PIN_ECHO = 18;
const int PIN_START = 14, PIN_SOS = 13, PIN_MOVE = 4;
const int PIN_BUZZ = 25, PIN_GREEN = 26, PIN_RED = 27;
const int PIN_SDA = 21, PIN_SCL = 22;    // SSD1306 OLED, I2C address 0x3C

const int  BAND_CM = 50;                 // take a sample every 50 cm of new depth
const int  MAX_SAMPLES = 8;
const unsigned long STILL_MS = 10000;    // no movement for this long = man down
const unsigned long TELEMETRY_MS = 2000;

// Risk levels (same as the server): 0-39 SAFE, 40-69 CAUTION, 70-100 DANGER
const int RISK_CAUTION = 40, RISK_DANGER = 70;

enum State { IDLE, CHALLENGED, DESCENDING, WAIT_RESULT, MONITORING };
State state = IDLE;

struct Sample { int d, h2s, ch4, co, o2; };
Sample samples[MAX_SAMPLES];
int sampleCount = 0;
int lastBand = -1;

String sessionId, nonce, manholeId, permitId;
String tChallenge, tReading, tResult, tTelemetry, tAlert, tCmd;

bool alarmOn = false, gasAlertSent = false, downAlertSent = false;
bool lastStart = HIGH, lastSos = HIGH;
unsigned long lastMoveMs = 0, lastTelemetryMs = 0, lastSampleMs = 0, lastBlinkMs = 0;
bool blinkOn = false;

// Edge AI and display state
Adafruit_SSD1306 display(128, 64, &Wire, -1);
bool oledOk = false, oledInverted = false, monitorInvert = false;
unsigned long invertUntil = 0, msgUntil = 0;
int lastRisk = -1;                       // risk of the previous descent sample (for the trend)
int monRisk = 0;                         // risk at the previous monitoring cycle
bool riskAlarm = false, sosAlarm = false, serverSiren = false;

WiFiClient net;
PubSubClient mqtt(net);

// ---------- sensors ----------
int readH2S() { return map(analogRead(PIN_H2S), 0, 4095, 0, 100); }    // ppm
int readCO()  { return map(analogRead(PIN_CO),  0, 4095, 0, 200); }    // ppm
int readCH4() { return map(analogRead(PIN_CH4), 0, 4095, 0, 100); }    // % LEL
int readO2()  { return map(analogRead(PIN_O2),  0, 4095, 150, 250); }  // tenths of a percent

int readDepthCm() {
  digitalWrite(PIN_TRIG, LOW);  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000);
  return (int)(us / 58);
}

bool gasUnsafe(int h2s, int ch4, int co, int o2) {
  return h2s >= 10 || co >= 35 || ch4 >= 10 || o2 < 195 || o2 > 235;
}

// ---------- edge AI: compound risk score 0-100 ----------
// How close each gas is to its limit (limits: H2S 10, CO 35, CH4 10, O2 19.5-23.5 %).
// Oxygen deficiency is weighted 3x, excess 2x. A gas past its hard limit is always DANGER (>= 70).
int localRiskScore(int h2s, int ch4, int co, int o2) {
  float risk = h2s * 100.0f / 10;
  risk = fmaxf(risk, co * 100.0f / 35);
  risk = fmaxf(risk, ch4 * 100.0f / 10);
  float o2Risk = 0;
  if (o2 < 195)      o2Risk = (195 - o2) * 100.0f / 195 * 3;
  else if (o2 > 235) o2Risk = (o2 - 235) * 100.0f / 235 * 2;
  risk = fmaxf(risk, o2Risk);
  if (gasUnsafe(h2s, ch4, co, o2)) risk = fmaxf(risk, (float)RISK_DANGER);
  return constrain((int)lroundf(risk), 0, 100);
}

const char* riskLevel(int risk) {
  if (risk >= RISK_DANGER) return "DANGER";
  if (risk >= RISK_CAUTION) return "CAUTION";
  return "SAFE";
}

// ---------- signing ----------
String hmacHex(const String& msg) {
  byte out[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)DEVICE_SECRET, strlen(DEVICE_SECRET));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, out);
  mbedtls_md_free(&ctx);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", out[i]);
  hex[64] = 0;
  return String(hex);
}

// ---------- outputs ----------
void leds(bool green, bool red) {
  digitalWrite(PIN_GREEN, green ? HIGH : LOW);
  digitalWrite(PIN_RED, red ? HIGH : LOW);
}

void beep(int freq, int ms) {
  tone(PIN_BUZZ, freq);
  delay(ms);
  noTone(PIN_BUZZ);
}

void setAlarm(bool on) {
  alarmOn = on;
  if (!on) { noTone(PIN_BUZZ); digitalWrite(PIN_RED, LOW); }
}

// ---------- OLED (128x64, five text lines) ----------
void oledShow(const String& l0, const String& l1 = "", const String& l2 = "", const String& l3 = "", const String& l4 = "") {
  if (!oledOk) return;
  const String* lines[5] = { &l0, &l1, &l2, &l3, &l4 };
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  for (int i = 0; i < 5; i++) { display.setCursor(0, i * 13); display.print(*lines[i]); }
  display.display();
}

// Inverted display = visual shock alert (1 s on a DANGER sample, or while any gas is unsafe when monitoring).
void applyInvert(unsigned long now) {
  if (!oledOk) return;
  bool want = now < invertUntil || (state == MONITORING && monitorInvert);
  if (want != oledInverted) { display.invertDisplay(want); oledInverted = want; }
}

void showDescent(const Sample& s, int risk, const char* trend) {
  char l0[24], l1[24], l2[24], l3[24], l4[24];
  snprintf(l0, sizeof(l0), "DESCENDING  Risk:%d%%", risk);
  snprintf(l1, sizeof(l1), "Depth: %dcm (#%d)", s.d, sampleCount);
  snprintf(l2, sizeof(l2), "H2S:%d CO:%d CH4:%d", s.h2s, s.co, s.ch4);
  snprintf(l3, sizeof(l3), "%s - %s", riskLevel(risk), trend);
  snprintf(l4, sizeof(l4), "O2:%d.%d%%", s.o2 / 10, s.o2 % 10);
  oledShow(l0, l1, l2, l3, l4);
}

void showMonitor(int h2s, int ch4, int co, int o2, int risk) {
  char l0[24], l1[24], l2[24], l3[24], l4[24];
  snprintf(l0, sizeof(l0), "MONITORING  Risk:%d%%", risk);
  snprintf(l1, sizeof(l1), "H2S:%3dppm    %s", h2s, h2s >= 10 ? "!!" : "SAFE");
  snprintf(l2, sizeof(l2), "CO :%3dppm    %s", co, co >= 35 ? "!!" : "SAFE");
  snprintf(l3, sizeof(l3), "CH4:%3d%%LEL   %s", ch4, ch4 >= 10 ? "!!" : "SAFE");
  snprintf(l4, sizeof(l4), "O2 :%2d.%d%%    %s", o2 / 10, o2 % 10, (o2 < 195 || o2 > 235) ? "!!" : "SAFE");
  oledShow(l0, l1, l2, l3, l4);
}

void publishJson(const String& topic, JsonDocument& doc) {
  static char buf[1024];
  serializeJson(doc, buf, sizeof(buf));
  bool ok = mqtt.publish(topic.c_str(), buf);
  Serial.print(ok ? "[pub] " : "[pub FAILED] ");
  Serial.print(topic); Serial.print(" "); Serial.println(buf);
}

void sendAlert(const char* type) {
  JsonDocument doc;
  doc["type"] = type;
  doc["permitId"] = permitId;
  publishJson(tAlert, doc);
}

// ---------- probe: sign and send the descent ----------
void submitReading() {
  String s = "";
  for (int i = 0; i < sampleCount; i++) {
    if (i > 0) s += ";";
    s += String(samples[i].d) + "," + String(samples[i].h2s) + "," + String(samples[i].ch4) + "," +
         String(samples[i].co) + "," + String(samples[i].o2);
  }
  String msg = sessionId + "|" + nonce + "|" + PROBE_ID + "|" + manholeId + "|" +
               String(LAT) + "|" + String(LNG) + "|" + s;

  JsonDocument doc;
  doc["sessionId"] = sessionId;
  doc["nonce"] = nonce;
  doc["deviceId"] = PROBE_ID;
  doc["manholeId"] = manholeId;
  doc["lat"] = LAT;
  doc["lng"] = LNG;
  JsonArray arr = doc["samples"].to<JsonArray>();
  for (int i = 0; i < sampleCount; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["d"] = samples[i].d;
    o["h2s"] = samples[i].h2s;
    o["ch4"] = samples[i].ch4;
    o["co"] = samples[i].co;
    o["o2"] = samples[i].o2;
  }
  doc["sig"] = hmacHex(msg);
  Serial.print("[sign] "); Serial.println(msg);
  publishJson(tReading, doc);
  state = WAIT_RESULT;
  Serial.println("[state] WAIT_RESULT");
}

// Edge AI on each new descent sample: score, OLED, buzzer pattern.
void onDescentSample(const Sample& s) {
  int risk = localRiskScore(s.h2s, s.ch4, s.co, s.o2);
  const char* trend = lastRisk < 0 ? "first" : risk > lastRisk + 2 ? "rising" : risk < lastRisk - 2 ? "falling" : "stable";
  lastRisk = risk;
  showDescent(s, risk, trend);
  Serial.printf("[risk] %d%% %s (%s)\n", risk, riskLevel(risk), trend);
  if (risk >= RISK_DANGER) {
    invertUntil = millis() + 1000;       // visual shock alert for 1 s
    applyInvert(millis());
    for (int i = 0; i < 3; i++) {        // three rapid beeps with the red LED
      digitalWrite(PIN_RED, HIGH);
      beep(1000, 80);
      digitalWrite(PIN_RED, LOW);
      delay(50);
    }
  } else if (risk >= RISK_CAUTION) {
    beep(600, 100);
  }
}

// Edge AI every telemetry cycle while the worker is inside.
void onMonitorCycle(int h2s, int ch4, int co, int o2, unsigned long now) {
  int risk = localRiskScore(h2s, ch4, co, o2);
  monitorInvert = gasUnsafe(h2s, ch4, co, o2);
  if (risk >= RISK_DANGER && monRisk < RISK_DANGER) {
    riskAlarm = true;
    setAlarm(true);
  } else if (risk >= RISK_CAUTION && monRisk < RISK_CAUTION) {
    beep(700, 200);
  } else if (risk < RISK_CAUTION && monRisk >= RISK_CAUTION) {
    // Never silence a man-down, SOS or server-ordered siren just because the gas improved.
    if (!downAlertSent && !sosAlarm && !serverSiren) {
      setAlarm(false);
      riskAlarm = false;
      msgUntil = now + 2000;
      oledShow("SAFE - alarm cleared", "", "Risk back below 40");
    }
  }
  monRisk = risk;
  if (now >= msgUntil) showMonitor(h2s, ch4, co, o2, risk);
}

void resetEdgeState() {
  lastRisk = -1; monRisk = 0;
  riskAlarm = false; sosAlarm = false; serverSiren = false;
  monitorInvert = false; invertUntil = 0; msgUntil = 0;
}

// ---------- incoming messages ----------
void onMessage(char* topic, byte* payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) { Serial.println("[mqtt] bad json"); return; }
  String t(topic);
  Serial.print("[sub] "); Serial.println(t);

  if (t == tChallenge) {
    sessionId = String((const char*)(doc["sessionId"] | ""));
    nonce     = String((const char*)(doc["nonce"] | ""));
    manholeId = String((const char*)(doc["manholeId"] | ""));
    setAlarm(false);
    resetEdgeState();
    state = CHALLENGED;
    Serial.println("[state] CHALLENGED - press START, lower the probe, press START again");
    oledShow("TEST STARTED", "Manhole " + manholeId, "Press START, lower", "the probe, then", "press START again");
  } else if (t == tResult) {
    String sid = String((const char*)(doc["sessionId"] | ""));
    if (sid != sessionId) return;
    String decision = String((const char*)(doc["decision"] | ""));
    String reason   = String((const char*)(doc["reason"] | ""));
    if (decision == "GRANTED") {
      permitId = String((const char*)(doc["permitId"] | sessionId.c_str()));
      leds(true, false);
      beep(1800, 200);
      gasAlertSent = false; downAlertSent = false;
      resetEdgeState();
      lastMoveMs = millis();
      state = MONITORING;
      Serial.println("[state] MONITORING - permit granted");
      oledShow("GRANTED", permitId, "Monitoring worker", "Risk updates every 2s");
    } else {
      leds(false, true);
      beep(400, 1200);
      state = IDLE;
      Serial.print("[state] IDLE - permit DENIED: "); Serial.println(reason);
      oledShow("DENIED", reason, "", "Start a new test on", "the dashboard");
    }
  } else if (t == tCmd) {
    if (doc["siren"].is<bool>()) { serverSiren = doc["siren"].as<bool>(); setAlarm(serverSiren); }
    if (doc["end"] | false) {
      setAlarm(false);
      leds(false, false);
      state = IDLE;
      resetEdgeState();
      Serial.println("[state] IDLE - job closed");
      oledShow("JOB CLOSED", "Siren off", "", "Waiting for the", "next test");
    }
  }
}

void connectMqtt() {
  while (!mqtt.connected()) {
    String cid = "safeentry-" + String((uint32_t)esp_random(), HEX);
    Serial.print("[mqtt] connecting... ");
    if (mqtt.connect(cid.c_str())) {
      Serial.println("connected");
      mqtt.subscribe(tChallenge.c_str());
      mqtt.subscribe(tResult.c_str());
      mqtt.subscribe(tCmd.c_str());
    } else {
      Serial.print("failed, rc="); Serial.println(mqtt.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT); pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_START, INPUT_PULLUP); pinMode(PIN_SOS, INPUT_PULLUP); pinMode(PIN_MOVE, INPUT_PULLUP);
  pinMode(PIN_BUZZ, OUTPUT); pinMode(PIN_GREEN, OUTPUT); pinMode(PIN_RED, OUTPUT);

  Wire.begin(PIN_SDA, PIN_SCL);
  oledOk = display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!oledOk) Serial.println("[oled] not found - continuing without display");
  oledShow("ZeroAsphyx probe", "", "Connecting WiFi...");

  String p(PREFIX);
  tChallenge = p + "/probe/" + PROBE_ID + "/challenge";
  tReading   = p + "/probe/" + PROBE_ID + "/reading";
  tResult    = p + "/probe/" + PROBE_ID + "/result";
  tTelemetry = p + "/beacon/" + BEACON_ID + "/telemetry";
  tAlert     = p + "/beacon/" + BEACON_ID + "/alert";
  tCmd       = p + "/beacon/" + BEACON_ID + "/cmd";

  Serial.print("[wifi] connecting");
  WiFi.begin("Wokwi-GUEST", "", 6);
  while (WiFi.status() != WL_CONNECTED) { delay(250); Serial.print("."); }
  Serial.println(" connected");
  oledShow("ZeroAsphyx probe", "WiFi connected", "Connecting MQTT...");

  mqtt.setServer(BROKER, BROKER_PORT);
  mqtt.setBufferSize(1024);
  mqtt.setCallback(onMessage);
  connectMqtt();
  Serial.println("[state] IDLE - waiting for a test to be started on the dashboard");
  oledShow("ZeroAsphyx   IDLE", "MQTT connected", "", "Start a test on", "the dashboard");
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();
  unsigned long now = millis();

  bool startNow = digitalRead(PIN_START);
  bool startPressed = (lastStart == HIGH && startNow == LOW);
  lastStart = startNow;
  bool sosNow = digitalRead(PIN_SOS);
  bool sosPressed = (lastSos == HIGH && sosNow == LOW);
  lastSos = sosNow;

  if (now - lastBlinkMs > 300) { lastBlinkMs = now; blinkOn = !blinkOn; }

  if (state == CHALLENGED) {
    leds(blinkOn, blinkOn);
    if (startPressed) {
      sampleCount = 0; lastBand = -1; lastRisk = -1;
      leds(false, false);
      state = DESCENDING;
      Serial.println("[state] DESCENDING - move the distance slider up gradually");
      oledShow("DESCENDING  Risk:--", "Lower the probe", "slowly", "", "START again: submit");
    }
  } else if (state == DESCENDING) {
    digitalWrite(PIN_GREEN, blinkOn);
    if (now - lastSampleMs > 200) {
      lastSampleMs = now;
      int d = readDepthCm();
      int band = d / BAND_CM;
      if (band > lastBand && sampleCount < MAX_SAMPLES) {
        samples[sampleCount] = { d, readH2S(), readCH4(), readCO(), readO2() };
        Serial.printf("[sample %d] depth=%dcm h2s=%d ch4=%d co=%d o2=%d\n", sampleCount + 1, d,
                      samples[sampleCount].h2s, samples[sampleCount].ch4,
                      samples[sampleCount].co, samples[sampleCount].o2);
        sampleCount++;
        lastBand = band;
        onDescentSample(samples[sampleCount - 1]);
      }
    }
    if (startPressed) {
      submitReading();
      oledShow("SUBMITTED", String(sampleCount) + " signed samples", "", "Waiting for the", "server's decision");
    }
  } else if (state == MONITORING) {
    int h2s = readH2S(), ch4 = readCH4(), co = readCO(), o2 = readO2();
    bool moving = digitalRead(PIN_MOVE) == HIGH;
    if (moving) lastMoveMs = now;

    // Local detection: the siren must not depend on the network
    if (gasUnsafe(h2s, ch4, co, o2) && !gasAlertSent) {
      gasAlertSent = true; setAlarm(true); sendAlert("GAS");
    }
    if (sosPressed) { sosAlarm = true; setAlarm(true); sendAlert("SOS"); }
    if (!moving && now - lastMoveMs > STILL_MS && !downAlertSent) {
      downAlertSent = true; setAlarm(true); sendAlert("MAN_DOWN");
    }

    if (now - lastTelemetryMs > TELEMETRY_MS) {
      lastTelemetryMs = now;
      JsonDocument doc;
      doc["permitId"] = permitId;
      doc["h2s"] = h2s; doc["ch4"] = ch4; doc["co"] = co; doc["o2"] = o2;
      doc["moving"] = moving;
      doc["sos"] = (sosNow == LOW);
      publishJson(tTelemetry, doc);
      onMonitorCycle(h2s, ch4, co, o2, now);
    }
  }

  if (alarmOn) {
    tone(PIN_BUZZ, blinkOn ? 1500 : 900);
    digitalWrite(PIN_RED, blinkOn);
    digitalWrite(PIN_GREEN, LOW);
  }
  applyInvert(now);
  delay(10);
}
