/*
 * MOTOR CHANNEL TEST — timing only, no buzzer/LED needed
 *
 * Power on the ESP32 and count seconds on your phone.
 * Tell me what the motor does during each phase:
 *
 *  0 - 4s  : Motor should be STOPPED
 *  4 - 9s  : Channel A runs  (OUT1 / OUT2) — does motor spin?
 *  9 - 11s : Brake / stop
 * 11 - 15s : Channel B runs  (OUT3 / OUT4) — does motor spin?
 * 15s+     : Everything stopped forever
 */

// Channel A
#define IN1 18
#define IN2 19
#define ENA  5

// Channel B
#define IN3 17
#define IN4 16
#define ENB  4

void stopAll() {
  digitalWrite(ENA, LOW); digitalWrite(IN1, LOW); digitalWrite(IN2, LOW);
  digitalWrite(ENB, LOW); digitalWrite(IN3, LOW); digitalWrite(IN4, LOW);
}

void setup() {
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT); pinMode(ENA, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT); pinMode(ENB, OUTPUT);

  // ── Stop everything immediately ───────────────────────────
  stopAll();
  delay(4000);          // 0-4 s : STOPPED — motor must not spin

  // ── Channel A : 5 seconds ─────────────────────────────────
  digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH); digitalWrite(ENA, HIGH);
  delay(5000);          // 4-9 s : does motor spin?

  // brake
  digitalWrite(IN1, HIGH); digitalWrite(IN2, HIGH);
  delay(1000);
  stopAll();
  delay(1000);          // 9-11 s : stopped

  // ── Channel B : 4 seconds ─────────────────────────────────
  digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH); digitalWrite(ENB, HIGH);
  delay(4000);          // 11-15 s : does motor spin?

  // brake
  digitalWrite(IN3, HIGH); digitalWrite(IN4, HIGH);
  delay(1000);
  stopAll();            // 15 s+ : stopped forever
}

void loop() {}
