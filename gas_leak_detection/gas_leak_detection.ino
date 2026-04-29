/*
 * ============================================================
 *  IoT-Enabled Smart Gas Detection and Autonomous Shut-off System
 *  Platform  : ESP32
 *  Team      : Aravind B (231101011), Kanishk H (231101036),
 *              Davis Rowan V (231101016)  |  Batch 57
 *  Guide     : Shankar E
 *  Institute : Rajalakshmi Engineering College (Autonomous), Chennai
 *  Dept      : Mechanical Engineering
 * ============================================================
 *
 *  WIFI SETUP (captive portal)
 *  ─────────────────────────────────────────────────────────
 *  1. Power on the ESP32.
 *  2. If no WiFi credentials are saved, it broadcasts:
 *       SSID : GasDetector-Setup  (no password)
 *  3. Connect your phone/laptop → setup page opens at 192.168.4.1
 *  4. Pick your WiFi network, enter password, Save.
 *  5. ESP32 saves to flash and reboots into normal operation.
 *  To change WiFi later: hold Reset button 3 s while powering on.
 *
 *  WEB DASHBOARD API  (served on port 80)
 *  ─────────────────────────────────────────────────────────
 *  GET  /api/sensor       → live gas PPM, valve state, uptime
 *  POST /api/valve/open   → open the valve remotely
 *  POST /api/valve/close  → close the valve remotely
 *  GET  /api/status       → system armed state
 *  GET  /                 → shows ESP32 IP address hint page
 *
 *  HARDWARE CONNECTIONS
 *  ─────────────────────────────────────────────────────────
 *  Component              ESP32 Pin   Notes
 *  ─────────────────────────────────────────────────────────
 *  MQ-6          AO       GPIO 34     ADC1 — safe with WiFi on
 *  MQ-6          DO       GPIO 35     Digital threshold output
 *  L298N         IN1      GPIO 18     Motor direction A
 *  L298N         IN2      GPIO 19     Motor direction B
 *  L298N         ENA      GPIO 5      PWM speed (or jumper HIGH)
 *  Active Buzzer (+)      GPIO 23     3.3 V active buzzer
 *  Red  LED (+ 220Ω)      GPIO 25     Danger indicator
 *  Green LED (+ 220Ω)     GPIO 26     Safe indicator
 *  Reset Button           GPIO 27     Pull-up; short to GND
 *  LCD SDA (I²C)          GPIO 21
 *  LCD SCL (I²C)          GPIO 22
 *
 *  ⚠  VOLTAGE WARNING
 *     MQ-6 AO can output up to 5 V. Add a 10kΩ/10kΩ voltage
 *     divider between AO and GPIO 34.
 *
 *  REQUIRED LIBRARIES
 *  ─────────────────────────────────────────────────────────
 *  • WiFiManager           (Tzapu)
 *  • LiquidCrystal_I2C     (Frank de Brabander)
 *  • UniversalTelegramBot  (Brian Lough)
 *  • ArduinoJson           (Benoit Blanchon)
 *  • Blynk                 (Volodymyr Shymanskyy)
 *  WebServer.h is built into the ESP32 core — no install needed.
 * ============================================================
 */

#define BLYNK_TEMPLATE_ID    "TMPLxxxxxxxx"
#define BLYNK_TEMPLATE_NAME  "Gas Leak Detector"
#define BLYNK_AUTH_TOKEN     "YOUR_BLYNK_TOKEN"
#define BLYNK_PRINT          Serial

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <UniversalTelegramBot.h>
#include <ArduinoJson.h>
#include <BlynkSimpleEsp32.h>

// ============================================================
//  CREDENTIALS
// ============================================================
#define TELEGRAM_BOT_TOKEN  "YOUR_BOT_TOKEN_HERE"
#define TELEGRAM_CHAT_ID    "YOUR_CHAT_ID_HERE"

// ── Cloud relay (fill in after deploying relay-server/) ──────
// Leave empty ("") to disable relay and use local WebServer only
#define RELAY_SERVER_URL    "https://gas-leak-detector-1znc.onrender.com"

// ============================================================
//  PINS
// ============================================================
#define PIN_GAS_ANALOG      34
#define PIN_GAS_DIGITAL     35
#define PIN_MOTOR_IN1       18
#define PIN_MOTOR_IN2       19
#define PIN_MOTOR_ENA        5
#define PIN_BUZZER          23
#define PIN_LED_RED         25
#define PIN_LED_GREEN       26
#define PIN_RESET_BUTTON    27

// ============================================================
//  THRESHOLDS  (raw ADC 0-4095, mapped to 0-1000 PPM for API)
//  Adjust after calibrating your MQ-6 in your environment.
//  Formula: PPM_display = raw / 4095.0 * 1000
//  WARNING → 300 PPM display  |  DANGER → 800 PPM display
// ============================================================
#define THRESHOLD_WARNING   1229   // ≈ 300 PPM
#define THRESHOLD_DANGER    3276   // ≈ 800 PPM

// ============================================================
//  MOTOR  — 100 RPM motor, 10 revolutions per valve move
//  10 rev ÷ 100 RPM × 60 000 ms = 6 000 ms
// ============================================================
#define MOTOR_REVOLUTIONS   10
#define MOTOR_RPM           100
#define MOTOR_RUN_TIME      ((MOTOR_REVOLUTIONS * 60000UL) / MOTOR_RPM)   // 6000 ms

// ============================================================
//  TIMING
// ============================================================
#define INTERVAL_SENSOR_READ    500
#define COOLDOWN_TELEGRAM      30000
#define BUZZER_BEEP_PERIOD      300
#define WIFI_RESET_HOLD_MS     3000

// ============================================================
//  LCD
// ============================================================
#define LCD_I2C_ADDR   0x27
#define LCD_COLS        16
#define LCD_ROWS         2

// ============================================================
//  SYSTEM STATE
// ============================================================
enum GasLevel { SAFE, WARNING, DANGER };

GasLevel currentLevel  = SAFE;
bool     valveOpen     = true;
bool     systemArmed   = true;
float    displayPPM    = 0;   // 0-1000 scale sent to dashboard

// Non-blocking motor state
bool          motorRunning   = false;
unsigned long motorStartTime = 0;
bool          motorTargetOpen = true;

unsigned long lastSensorRead   = 0;
unsigned long lastTelegramSent = 0;
unsigned long lastBuzzerToggle = 0;
unsigned long lastRelayPost    = 0;
bool          buzzerOn         = false;

// ============================================================
//  OBJECTS
// ============================================================
LiquidCrystal_I2C    lcd(LCD_I2C_ADDR, LCD_COLS, LCD_ROWS);
WebServer            httpServer(80);
WiFiClientSecure     telegramTLS;
UniversalTelegramBot bot(TELEGRAM_BOT_TOKEN, telegramTLS);

// ============================================================
//  FORWARD DECLARATIONS
// ============================================================
void     startWiFiPortal();
void     setupWebServer();
void     postToRelay();
void     sendCORS();
void     handleRoot();
void     handleSensorAPI();
void     handleValveOpenAPI();
void     handleValveCloseAPI();
void     handleStatusAPI();
void     handleOptions();
int      readGasSensor();
GasLevel classifyReading(int raw);
void     startValveMove(bool shouldOpen);
void     motorStop();
void     handleBuzzerLEDs(GasLevel level);
void     sendTelegramAlert(GasLevel level, int raw);
void     checkResetButton();
void     updateLCD(GasLevel level, int raw);
void     lcdMsg(const char* line0, const char* line1);

// ============================================================
//  BLYNK CALLBACKS
// ============================================================
BLYNK_CONNECTED() {
  Blynk.virtualWrite(V2, valveOpen   ? 255 : 0);
  Blynk.virtualWrite(V3, systemArmed ? 255 : 0);
}

BLYNK_WRITE(V4) {
  int cmd = param.asInt();
  if (cmd == 1) {
    if (currentLevel == DANGER || !systemArmed) {
      Serial.println(F(">>> REMOTE: Valve open DENIED."));
      Blynk.virtualWrite(V4, 0);
      if (WiFi.status() == WL_CONNECTED)
        bot.sendMessage(TELEGRAM_CHAT_ID,
          "⛔ Remote valve open DENIED: DANGER or disarmed.", "");
      return;
    }
    Serial.println(F(">>> REMOTE: Opening valve via Blynk."));
    startValveMove(true);
  } else {
    Serial.println(F(">>> REMOTE: Closing valve via Blynk."));
    startValveMove(false);
  }
}

BLYNK_WRITE(V5) {
  if (param.asInt() != 1) return;
  if (systemArmed) return;

  int raw = readGasSensor();
  if (classifyReading(raw) == SAFE) {
    systemArmed = true;
    startValveMove(true);
    Blynk.virtualWrite(V3, 255);
    Blynk.virtualWrite(V4, 1);
    if (WiFi.status() == WL_CONNECTED)
      bot.sendMessage(TELEGRAM_CHAT_ID,
        "✅ System remotely reset. Gas SAFE. Valve reopening.", "");
  } else {
    if (WiFi.status() == WL_CONNECTED)
      bot.sendMessage(TELEGRAM_CHAT_ID,
        "⛔ Remote reset DENIED: gas still detected.", "");
  }
}

// ============================================================
//  SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  Serial.println(F("\n=== Smart Gas Detection System — Booting ==="));

  pinMode(PIN_GAS_DIGITAL,  INPUT);
  pinMode(PIN_MOTOR_IN1,    OUTPUT);
  pinMode(PIN_MOTOR_IN2,    OUTPUT);
  pinMode(PIN_MOTOR_ENA,    OUTPUT);
  pinMode(PIN_BUZZER,       OUTPUT);
  pinMode(PIN_LED_RED,      OUTPUT);
  pinMode(PIN_LED_GREEN,    OUTPUT);
  pinMode(PIN_RESET_BUTTON, INPUT_PULLUP);

  digitalWrite(PIN_BUZZER,    LOW);
  digitalWrite(PIN_LED_RED,   LOW);
  digitalWrite(PIN_LED_GREEN, HIGH);
  motorStop();

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcdMsg("  Gas Detector  ", "  Booting...    ");

  // Hold reset on boot → wipe WiFi creds
  if (digitalRead(PIN_RESET_BUTTON) == LOW) {
    lcdMsg("Hold to reset   ", "WiFi settings...");
    unsigned long held = millis();
    while (digitalRead(PIN_RESET_BUTTON) == LOW) {
      if (millis() - held >= WIFI_RESET_HOLD_MS) {
        lcdMsg("Clearing WiFi   ", "credentials...  ");
        WiFiManager wm;
        wm.resetSettings();
        delay(1500);
        break;
      }
    }
  }

  startWiFiPortal();
  setupWebServer();

  lcdMsg("Connecting to   ", "Blynk cloud...  ");
  Blynk.config(BLYNK_AUTH_TOKEN);
  Blynk.connect(8000);
  telegramTLS.setInsecure();

  // Open valve on boot
  startValveMove(true);

  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_LED_RED, HIGH);
    digitalWrite(PIN_BUZZER,  HIGH);
    delay(100);
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_BUZZER,  LOW);
    delay(100);
  }

  lcdMsg("  System Ready  ", "                ");
  Serial.print(F("Web dashboard: http://"));
  Serial.println(WiFi.localIP());
}

// ============================================================
//  MAIN LOOP
// ============================================================
void loop() {
  Blynk.run();
  httpServer.handleClient();

  unsigned long now = millis();

  // ── Sensor read cycle ──────────────────────────────────────
  if (now - lastSensorRead >= INTERVAL_SENSOR_READ) {
    lastSensorRead = now;

    int raw = readGasSensor();
    displayPPM = (raw / 4095.0f) * 1000.0f;
    GasLevel newLevel = classifyReading(raw);

    if (newLevel != currentLevel) {
      currentLevel = newLevel;

      if (currentLevel == DANGER) {
        // Alarm buzzer: 5 short beeps (~2 seconds) before closing valve
        for (int i = 0; i < 5; i++) {
          digitalWrite(PIN_BUZZER, HIGH); delay(200);
          digitalWrite(PIN_BUZZER, LOW);  delay(200);
        }
        startValveMove(false);
        systemArmed = false;
        Blynk.virtualWrite(V3, 0);
        Blynk.virtualWrite(V4, 0);
        if (now - lastTelegramSent >= COOLDOWN_TELEGRAM) {
          sendTelegramAlert(currentLevel, raw);
          lastTelegramSent = now;
        }
      } else if (currentLevel == WARNING) {
        if (now - lastTelegramSent >= COOLDOWN_TELEGRAM) {
          sendTelegramAlert(currentLevel, raw);
          lastTelegramSent = now;
        }
      } else if (currentLevel == SAFE && !valveOpen && systemArmed) {
        startValveMove(true);
      }
    }

    handleBuzzerLEDs(currentLevel);
    updateLCD(currentLevel, raw);

    Serial.printf("[%8lu ms] Gas: %4d (%.0f PPM)  Level: %-7s  Valve: %s  Armed: %s\n",
      now, raw, displayPPM,
      (currentLevel == DANGER) ? "DANGER" : (currentLevel == WARNING) ? "WARNING" : "SAFE",
      valveOpen   ? "OPEN  " : "CLOSED",
      systemArmed ? "YES"    : "NO");

    Blynk.virtualWrite(V0, (int)displayPPM);
    Blynk.virtualWrite(V1,
      (currentLevel == DANGER)  ? "DANGER"  :
      (currentLevel == WARNING) ? "WARNING" : "SAFE");
    Blynk.virtualWrite(V2, valveOpen   ? 255 : 0);
    Blynk.virtualWrite(V3, systemArmed ? 255 : 0);
  }

  checkResetButton();

  // ── Push to cloud relay every 2 s ────────────────────────
  if (strlen(RELAY_SERVER_URL) > 0 && now - lastRelayPost >= 2000) {
    lastRelayPost = now;
    postToRelay();
  }
}

// ============================================================
//  WIFI CAPTIVE PORTAL
// ============================================================
void startWiFiPortal() {
  WiFiManager wm;
  wm.setTitle("Gas Leak Detector — WiFi Setup");
  wm.setAPCallback([](WiFiManager*) {
    Serial.println(F("Portal open: GasDetector-Setup / 192.168.4.1"));
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("Connect to WiFi:");
    lcd.setCursor(0, 1); lcd.print("GasDetector-Setup");
  });
  wm.setSaveConfigCallback([]() {
    lcdMsg("Credentials     ", "saved! Joining..");
  });
  wm.setConnectTimeout(15);
  wm.setConfigPortalTimeout(0);

  lcdMsg("Connecting WiFi ", "Please wait...  ");
  if (!wm.autoConnect("GasDetector-Setup")) {
    lcdMsg("WiFi failed!    ", "Restarting...   ");
    delay(2000);
    ESP.restart();
  }

  Serial.print(F("WiFi connected. IP: "));
  Serial.println(WiFi.localIP());
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("WiFi Connected!");
  lcd.setCursor(0, 1); lcd.print(WiFi.localIP());
  delay(3000);
}

// ============================================================
//  WEB SERVER SETUP
// ============================================================
void setupWebServer() {
  httpServer.on("/",                HTTP_GET,     handleRoot);
  httpServer.on("/api/sensor",      HTTP_GET,     handleSensorAPI);
  httpServer.on("/api/status",      HTTP_GET,     handleStatusAPI);
  httpServer.on("/api/valve/open",  HTTP_POST,    handleValveOpenAPI);
  httpServer.on("/api/valve/close", HTTP_POST,    handleValveCloseAPI);
  // Handle browser CORS preflight
  httpServer.on("/api/sensor",      HTTP_OPTIONS, handleOptions);
  httpServer.on("/api/status",      HTTP_OPTIONS, handleOptions);
  httpServer.on("/api/valve/open",  HTTP_OPTIONS, handleOptions);
  httpServer.on("/api/valve/close", HTTP_OPTIONS, handleOptions);
  httpServer.begin();
  Serial.printf("HTTP server started on http://%s\n", WiFi.localIP().toString().c_str());
}

// ── CORS headers (allow dashboard from any origin) ───────────
void sendCORS() {
  httpServer.sendHeader("Access-Control-Allow-Origin",  "*");
  httpServer.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  httpServer.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleOptions() {
  sendCORS();
  httpServer.send(204);
}

// ── Root page — IP address reminder ─────────────────────────
void handleRoot() {
  sendCORS();
  String ip = WiFi.localIP().toString();
  String html = "<!DOCTYPE html><html><body style='font-family:monospace;background:#0a0e17;color:#e2e8f0;padding:40px'>"
    "<h2>⚙️ GasGuard ESP32</h2>"
    "<p>API base: <b>http://" + ip + "</b></p>"
    "<ul>"
    "<li>GET  /api/sensor</li>"
    "<li>GET  /api/status</li>"
    "<li>POST /api/valve/open</li>"
    "<li>POST /api/valve/close</li>"
    "</ul>"
    "<p>Enter <b>" + ip + "</b> in the dashboard IP field.</p>"
    "</body></html>";
  httpServer.send(200, "text/html", html);
}

// ── GET /api/sensor ─────────────────────────────────────────
void handleSensorAPI() {
  sendCORS();
  const char* levelStr =
    (currentLevel == DANGER)  ? "DANGER"  :
    (currentLevel == WARNING) ? "WARNING" : "SAFE";
  const char* valveStr = motorRunning ? "moving" : (valveOpen ? "open" : "closed");

  char json[200];
  snprintf(json, sizeof(json),
    "{\"ppm\":%.1f,\"temp\":28.5,\"humidity\":62,"
    "\"valve\":\"%s\",\"level\":\"%s\",\"armed\":%s,\"uptime\":%lu}",
    displayPPM, valveStr, levelStr,
    systemArmed ? "true" : "false",
    millis() / 1000UL);
  httpServer.send(200, "application/json", json);
}

// ── GET /api/status ─────────────────────────────────────────
void handleStatusAPI() {
  sendCORS();
  char json[120];
  snprintf(json, sizeof(json),
    "{\"valve\":\"%s\",\"armed\":%s,\"uptime\":%lu,\"ip\":\"%s\"}",
    valveOpen ? "open" : "closed",
    systemArmed ? "true" : "false",
    millis() / 1000UL,
    WiFi.localIP().toString().c_str());
  httpServer.send(200, "application/json", json);
}

// ── POST /api/valve/open ─────────────────────────────────────
void handleValveOpenAPI() {
  sendCORS();
  if (currentLevel == DANGER || !systemArmed) {
    httpServer.send(403, "application/json",
      "{\"success\":false,\"reason\":\"DANGER or disarmed\"}");
    return;
  }
  startValveMove(true);
  httpServer.send(200, "application/json",
    "{\"success\":true,\"valve\":\"opening\"}");
  Serial.println(F(">>> API: Valve open command received."));
}

// ── POST /api/valve/close ────────────────────────────────────
void handleValveCloseAPI() {
  sendCORS();
  startValveMove(false);
  httpServer.send(200, "application/json",
    "{\"success\":true,\"valve\":\"closing\"}");
  Serial.println(F(">>> API: Valve close command received."));
}

// ============================================================
//  GAS SENSOR READ  (5-sample average)
// ============================================================
int readGasSensor() {
  long sum = 0;
  for (int i = 0; i < 5; i++) { sum += analogRead(PIN_GAS_ANALOG); delay(10); }
  return (int)(sum / 5);
}

// ============================================================
//  CLASSIFY READING
// ============================================================
GasLevel classifyReading(int raw) {
  bool digitalDetect = (digitalRead(PIN_GAS_DIGITAL) == LOW);
  if (raw >= THRESHOLD_DANGER || (digitalDetect && raw >= THRESHOLD_WARNING)) return DANGER;
  if (raw >= THRESHOLD_WARNING) return WARNING;
  return SAFE;
}

// ============================================================
//  MOTOR STOP
// ============================================================
void motorStop() {
  // Active brake: hold both IN pins HIGH, then kill ENA.
  // Works even if ENA has a hardware jumper (IN1=IN2=HIGH brakes regardless).
  digitalWrite(PIN_MOTOR_IN1, HIGH);
  digitalWrite(PIN_MOTOR_IN2, HIGH);
  digitalWrite(PIN_MOTOR_ENA, LOW);
  digitalWrite(PIN_MOTOR_IN1, LOW);
  digitalWrite(PIN_MOTOR_IN2, LOW);
}

// ============================================================
//  START VALVE MOVE  (blocking — runs motor then stops)
//  OPEN  → anti-clockwise : IN1=LOW,  IN2=HIGH
//  CLOSE → clockwise      : IN1=HIGH, IN2=LOW
//  If directions are reversed, swap the OUT1/OUT2 wires on L298N.
// ============================================================
void startValveMove(bool shouldOpen) {
  if (valveOpen == shouldOpen) return;  // already in target position

  digitalWrite(PIN_MOTOR_ENA, HIGH);
  if (shouldOpen) {
    Serial.println(F(">>> VALVE: OPEN — anti-clockwise, 10 rev."));
    digitalWrite(PIN_MOTOR_IN1, LOW);
    digitalWrite(PIN_MOTOR_IN2, HIGH);
  } else {
    Serial.println(F(">>> VALVE: CLOSE — clockwise, 10 rev."));
    digitalWrite(PIN_MOTOR_IN1, HIGH);
    digitalWrite(PIN_MOTOR_IN2, LOW);
  }

  delay(MOTOR_RUN_TIME);   // run for exactly 10 revolutions, then stop

  motorStop();
  valveOpen = shouldOpen;
  Blynk.virtualWrite(V2, valveOpen ? 255 : 0);
  Serial.println(valveOpen ? F(">>> VALVE: Now OPEN") : F(">>> VALVE: Now CLOSED"));
}

// ============================================================
//  BUZZER AND LEDS
// ============================================================
void handleBuzzerLEDs(GasLevel level) {
  unsigned long now = millis();
  switch (level) {
    case SAFE:
      digitalWrite(PIN_LED_GREEN, HIGH);
      digitalWrite(PIN_LED_RED,   LOW);
      digitalWrite(PIN_BUZZER,    LOW);
      buzzerOn = false;
      break;
    case WARNING:
      digitalWrite(PIN_LED_GREEN, LOW);
      if (now - lastBuzzerToggle >= BUZZER_BEEP_PERIOD * 2) {
        lastBuzzerToggle = now;
        buzzerOn = !buzzerOn;
        digitalWrite(PIN_LED_RED, buzzerOn ? HIGH : LOW);
        digitalWrite(PIN_BUZZER,  buzzerOn ? HIGH : LOW);
      }
      break;
    case DANGER:
      digitalWrite(PIN_LED_GREEN, LOW);
      digitalWrite(PIN_LED_RED,   HIGH);
      digitalWrite(PIN_BUZZER,    LOW);   // buzzer already beeped at detection
      break;
  }
}

// ============================================================
//  LCD UPDATE
// ============================================================
void updateLCD(GasLevel level, int raw) {
  char line0[17];
  snprintf(line0, sizeof(line0), "Gas:%-4d%5.0fPPM", raw, displayPPM);
  lcd.setCursor(0, 0); lcd.print(line0);

  const char* statusStr;
  switch (level) {
    case SAFE:    statusStr = "SAFE    "; break;
    case WARNING: statusStr = "WARNING "; break;
    case DANGER:  statusStr = "DANGER! "; break;
    default:      statusStr = "        "; break;
  }
  char line1[17];
  const char* valveLabel = motorRunning ? "VLV:MOVE" : (valveOpen ? "VLV:OPEN" : "VLV:SHUT");
  snprintf(line1, sizeof(line1), "%-8s%s", statusStr, valveLabel);
  lcd.setCursor(0, 1); lcd.print(line1);
}

// ============================================================
//  LCD HELPER
// ============================================================
void lcdMsg(const char* line0, const char* line1) {
  lcd.setCursor(0, 0); lcd.print(line0);
  lcd.setCursor(0, 1); lcd.print(line1);
}

// ============================================================
//  TELEGRAM ALERT
// ============================================================
void sendTelegramAlert(GasLevel level, int raw) {
  if (WiFi.status() != WL_CONNECTED) { Serial.println(F("Telegram skipped.")); return; }
  float pct = (raw / 4095.0f) * 100.0f;
  String msg;
  if (level == DANGER) {
    msg  = "🚨 *GAS LEAK DANGER ALERT* 🚨\n";
    msg += "━━━━━━━━━━━━━━━━━━━━\n";
    msg += "⚡ *Automatic valve shut-off activated!*\n";
    msg += "📊 Gas: " + String((int)displayPPM) + " PPM (" + String(pct, 1) + "% ADC)\n";
    msg += "🔬 Sensor: MQ-6 (LPG / Butane / Propane)\n";
    msg += "🌐 Dashboard: http://" + WiFi.localIP().toString() + "\n\n";
    msg += "⚠️ *Please:*\n";
    msg += "  1. Do NOT switch electrical appliances\n";
    msg += "  2. Open windows immediately\n";
    msg += "  3. Evacuate if smell is strong\n";
    msg += "  4. Call 101 (Fire) / 19 (LPG helpline)\n\n";
    msg += "Press RESET button or use dashboard after area is safe.";
  } else {
    msg  = "⚠️ *Gas Warning — Elevated Level*\n";
    msg += "━━━━━━━━━━━━━━━━━━━━\n";
    msg += "📊 Gas: " + String((int)displayPPM) + " PPM (" + String(pct, 1) + "% ADC)\n";
    msg += "🔬 Sensor: MQ-6 (LPG / Butane / Propane)\n";
    msg += "🌐 Dashboard: http://" + WiFi.localIP().toString() + "\n\n";
    msg += "Please check the gas connection and ventilate.";
  }
  Serial.print(F("Sending Telegram... "));
  bool sent = bot.sendMessage(TELEGRAM_CHAT_ID, msg, "Markdown");
  Serial.println(sent ? F("OK") : F("FAILED"));
}

// ============================================================
//  CLOUD RELAY POST
//  Posts sensor data to the relay server and reads back any
//  pending valve command queued from the web dashboard.
// ============================================================
void postToRelay() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure relayClient;
  relayClient.setInsecure();   // skip TLS cert verify for relay

  HTTPClient http;
  String url = String(RELAY_SERVER_URL) + "/esp/data";
  if (!http.begin(relayClient, url)) return;

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(4000);
  relayClient.setTimeout(4);   // 4-second socket-level timeout (connect + read)

  char body[220];
  snprintf(body, sizeof(body),
    "{\"ppm\":%.1f,\"temp\":28.5,\"humidity\":62,"
    "\"valve\":\"%s\",\"level\":\"%s\",\"armed\":%s,\"uptime\":%lu}",
    displayPPM,
    motorRunning ? "moving" : (valveOpen ? "open" : "closed"),
    (currentLevel == DANGER) ? "DANGER" : (currentLevel == WARNING) ? "WARNING" : "SAFE",
    systemArmed ? "true" : "false",
    millis() / 1000UL);

  int code = http.POST(body);

  if (code == 200) {
    String resp = http.getString();
    // Parse pending command ("open" / "close" / null)
    if (resp.indexOf("\"open\"") >= 0) {
      if (currentLevel != DANGER && systemArmed) {
        Serial.println(F(">>> RELAY: Open command received."));
        startValveMove(true);
      }
    } else if (resp.indexOf("\"close\"") >= 0) {
      Serial.println(F(">>> RELAY: Close command received."));
      startValveMove(false);
    }
  }
  http.end();
}

// ============================================================
//  MANUAL RESET BUTTON
// ============================================================
void checkResetButton() {
  if (digitalRead(PIN_RESET_BUTTON) != LOW) return;
  delay(50);
  if (digitalRead(PIN_RESET_BUTTON) != LOW) return;
  Serial.println(F(">>> RESET button pressed."));
  if (!systemArmed) {
    int raw = readGasSensor();
    if (classifyReading(raw) == SAFE) {
      systemArmed = true;
      startValveMove(true);
      Blynk.virtualWrite(V3, 255);
      Blynk.virtualWrite(V4, 1);
      Serial.println(F("System re-armed. Valve reopening."));
      if (WiFi.status() == WL_CONNECTED)
        bot.sendMessage(TELEGRAM_CHAT_ID,
          "✅ System manually reset. Gas safe. Valve reopening.", "");
    } else {
      Serial.println(F("Reset denied — gas still detected!"));
      for (int i = 0; i < 3; i++) {
        digitalWrite(PIN_BUZZER, HIGH); delay(100);
        digitalWrite(PIN_BUZZER, LOW);  delay(100);
      }
    }
  }
  while (digitalRead(PIN_RESET_BUTTON) == LOW) delay(10);
}
