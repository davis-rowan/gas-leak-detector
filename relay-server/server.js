const express = require("express");
const cors    = require("cors");
const app     = express();

app.use(express.json());
app.use(cors());

// ── In-memory state (single device) ──────────────────────────
let sensor = {
  ppm: 0, temp: 28.5, humidity: 62,
  valve: "open", level: "SAFE", armed: true,
  uptime: 0, lastSeen: null,
};
let pendingCommand = null; // "open" | "close" | null

// ── ESP32 endpoints ───────────────────────────────────────────

// ESP32 posts live sensor data every ~2 s
// Response tells ESP32 if a command is waiting
app.post("/esp/data", (req, res) => {
  sensor = { ...sensor, ...req.body, lastSeen: Date.now() };
  const cmd = pendingCommand;
  pendingCommand = null;          // consume command — deliver once
  res.json({ command: cmd });     // null, "open", or "close"
});

// ── Dashboard endpoints (same paths as local ESP32 API) ──────

// GET /api/sensor — dashboard polls this every second
app.get("/api/sensor", (req, res) => {
  const connected = !!(sensor.lastSeen && Date.now() - sensor.lastSeen < 10000);
  res.json({ ...sensor, connected });
});

// POST /api/valve/open — dashboard sends open command
app.post("/api/valve/open", (req, res) => {
  pendingCommand = "open";
  res.json({ success: true, valve: "opening" });
});

// POST /api/valve/close — dashboard sends close command
app.post("/api/valve/close", (req, res) => {
  pendingCommand = "close";
  res.json({ success: true, valve: "closing" });
});

// GET /api/status
app.get("/api/status", (req, res) => {
  const connected = !!(sensor.lastSeen && Date.now() - sensor.lastSeen < 10000);
  res.json({ valve: sensor.valve, armed: sensor.armed, connected, uptime: sensor.uptime });
});

// Health check
app.get("/", (req, res) => {
  const connected = !!(sensor.lastSeen && Date.now() - sensor.lastSeen < 10000);
  res.json({
    service: "GasGuard Relay Server",
    esp32: connected ? "online" : "offline",
    ppm: sensor.ppm,
    valve: sensor.valve,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GasGuard relay running on port ${PORT}`));
