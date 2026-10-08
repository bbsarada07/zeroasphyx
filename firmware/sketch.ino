// SafeEntry - simulated gas probe + worker beacon on one ESP32 (Wokwi)
// In production these are two separate units. Values here are simulated.

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
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

const int  BAND_CM = 50;                 // take a sample every 50 cm of new depth
const int  MAX_SAMPLES = 8;
const unsigned long STILL_MS = 10000;    // no movement for this long = man down
const unsigned long TELEMETRY_MS = 2000;

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
    state = CHALLENGED;
    Serial.println("[state] CHALLENGED - press START, lower the probe, press START again");
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
      lastMoveMs = millis();
      state = MONITORING;
      Serial.println("[state] MONITORING - permit granted");
    } else {
      leds(false, true);
      beep(400, 1200);
      state = IDLE;
      Serial.print("[state] IDLE - permit DENIED: "); Serial.println(reason);
    }
  } else if (t == tCmd) {
    if (doc["siren"].is<bool>()) setAlarm(doc["siren"].as<bool>());
    if (doc["end"] | false) {
      setAlarm(false);
      leds(false, false);
      state = IDLE;
      Serial.println("[state] IDLE - job closed");
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

  mqtt.setServer(BROKER, BROKER_PORT);
  mqtt.setBufferSize(1024);
  mqtt.setCallback(onMessage);
  connectMqtt();
  Serial.println("[state] IDLE - waiting for a test to be started on the dashboard");
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
      sampleCount = 0; lastBand = -1;
      leds(false, false);
      state = DESCENDING;
      Serial.println("[state] DESCENDING - move the distance slider up gradually");
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
      }
    }
    if (startPressed) submitReading();
  } else if (state == MONITORING) {
    int h2s = readH2S(), ch4 = readCH4(), co = readCO(), o2 = readO2();
    bool moving = digitalRead(PIN_MOVE) == HIGH;
    if (moving) lastMoveMs = now;

    // Local detection: the siren must not depend on the network
    if (gasUnsafe(h2s, ch4, co, o2) && !gasAlertSent) {
      gasAlertSent = true; setAlarm(true); sendAlert("GAS");
    }
    if (sosPressed) { setAlarm(true); sendAlert("SOS"); }
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
    }
  }

  if (alarmOn) {
    tone(PIN_BUZZ, blinkOn ? 1500 : 900);
    digitalWrite(PIN_RED, blinkOn);
    digitalWrite(PIN_GREEN, LOW);
  }
  delay(10);
}
