import { useState, useEffect, useRef, useCallback } from "react";

const THRESHOLDS = { safe: 300, warning: 600, danger: 800, critical: 950 };

const getGasStatus = (ppm) => {
  if (ppm < THRESHOLDS.safe) return { label: "SAFE", color: "#22c55e", bg: "rgba(34,197,94,0.1)" };
  if (ppm < THRESHOLDS.warning) return { label: "ELEVATED", color: "#eab308", bg: "rgba(234,179,8,0.1)" };
  if (ppm < THRESHOLDS.danger) return { label: "WARNING", color: "#f97316", bg: "rgba(249,115,22,0.1)" };
  return { label: "DANGER", color: "#ef4444", bg: "rgba(239,68,68,0.15)" };
};

const formatTime = (d) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
const formatDate = (d) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const GaugeArc = ({ ppm, max = 1000 }) => {
  const pct = Math.min(ppm / max, 1);
  const status = getGasStatus(ppm);
  const startAngle = -225, totalSweep = 270;
  const angle = startAngle + totalSweep * pct;
  const r = 88, cx = 120, cy = 120;
  const polarToCart = (a) => ({ x: cx + r * Math.cos((a * Math.PI) / 180), y: cy + r * Math.sin((a * Math.PI) / 180) });
  const arcPath = (from, to) => {
    const s = polarToCart(from), e = polarToCart(to);
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
  };
  const ticks = [0, 200, 400, 600, 800, 1000];
  return (
    <svg viewBox="0 0 240 200" style={{ width: "100%", maxWidth: 320 }}>
      <path d={arcPath(startAngle, startAngle + totalSweep)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" strokeLinecap="round" />
      <path d={arcPath(startAngle, startAngle + totalSweep * 0.3)} fill="none" stroke="rgba(34,197,94,0.25)" strokeWidth="14" strokeLinecap="round" />
      <path d={arcPath(startAngle + totalSweep * 0.3, startAngle + totalSweep * 0.6)} fill="none" stroke="rgba(234,179,8,0.25)" strokeWidth="14" strokeLinecap="round" />
      <path d={arcPath(startAngle + totalSweep * 0.6, startAngle + totalSweep * 0.8)} fill="none" stroke="rgba(249,115,22,0.25)" strokeWidth="14" strokeLinecap="round" />
      <path d={arcPath(startAngle + totalSweep * 0.8, startAngle + totalSweep)} fill="none" stroke="rgba(239,68,68,0.25)" strokeWidth="14" strokeLinecap="round" />
      {pct > 0.005 && <path d={arcPath(startAngle, angle)} fill="none" stroke={status.color} strokeWidth="14" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 8px ${status.color}80)`, transition: "all 0.5s ease" }} />}
      {ticks.map((v) => {
        const a = startAngle + totalSweep * (v / max);
        const inner = { x: cx + (r - 16) * Math.cos((a * Math.PI) / 180), y: cy + (r - 16) * Math.sin((a * Math.PI) / 180) };
        const outer = { x: cx + (r + 4) * Math.cos((a * Math.PI) / 180), y: cy + (r + 4) * Math.sin((a * Math.PI) / 180) };
        const label = { x: cx + (r - 28) * Math.cos((a * Math.PI) / 180), y: cx + (r - 28) * Math.sin((a * Math.PI) / 180) };
        return (
          <g key={v}>
            <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
            <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="'JetBrains Mono', monospace">{v}</text>
          </g>
        );
      })}
      <text x={cx} y={cy - 8} textAnchor="middle" fill={status.color} fontSize="38" fontWeight="800" fontFamily="'JetBrains Mono', monospace" style={{ transition: "fill 0.3s" }}>{Math.round(ppm)}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="11" fontFamily="'JetBrains Mono', monospace">PPM</text>
      <text x={cx} y={cy + 34} textAnchor="middle" fill={status.color} fontSize="13" fontWeight="700" letterSpacing="2" fontFamily="'JetBrains Mono', monospace">{status.label}</text>
    </svg>
  );
};

const Sparkline = ({ data, width = 260, height = 50 }) => {
  if (data.length < 2) return null;
  const max = Math.max(...data, 400), min = Math.min(...data, 0), range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4)}`).join(" ");
  const status = getGasStatus(data[data.length - 1]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }}>
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={status.color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={status.color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={pts} fill="none" stroke={status.color} strokeWidth="1.5" opacity="0.8" />
      <polyline points={`0,${height} ${pts} ${width},${height}`} fill="url(#sparkFill)" stroke="none" />
    </svg>
  );
};

export default function GasMonitorDashboard() {
  // ── Live mode vs Demo mode ─────────────────────────────────
  const [liveMode, setLiveMode] = useState(false);
  const [espIP, setEspIP] = useState(() => localStorage.getItem("gasDetectorIP") || "");
  const [ipInput, setIpInput] = useState(() => localStorage.getItem("gasDetectorIP") || "");

  // ── Sensor state ───────────────────────────────────────────
  const [gasPPM, setGasPPM] = useState(180);
  const [valveOpen, setValveOpen] = useState(true);
  const [valveMoving, setValveMoving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState([]);
  const [history, setHistory] = useState([180]);
  const [autoShutoff, setAutoShutoff] = useState(true);
  const [shutoffThreshold, setShutoffThreshold] = useState(800);
  const [alerts, setAlerts] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [simMode, setSimMode] = useState("normal");
  const [temp, setTemp] = useState(28.5);
  const [humidity, setHumidity] = useState(62);
  const intervalRef = useRef(null);
  const alertSoundRef = useRef(false);

  const addLog = useCallback((type, message, ppm) => {
    setLogs((prev) => [{ id: Date.now(), time: new Date(), type, message, ppm }, ...prev].slice(0, 200));
  }, []);

  const addAlert = useCallback((message, severity) => {
    const id = Date.now();
    setAlerts((prev) => [{ id, message, severity, time: new Date() }, ...prev].slice(0, 20));
    setTimeout(() => setAlerts((prev) => prev.filter((a) => a.id !== id)), 8000);
  }, []);

  // ── Save IP when confirmed ─────────────────────────────────
  const confirmIP = () => {
    const ip = ipInput.trim();
    if (!ip) return;
    localStorage.setItem("gasDetectorIP", ip);
    setEspIP(ip);
    setLiveMode(true);
    addAlert(`Connecting to ESP32 at ${ip}`, "info");
  };

  // ── Live mode: poll ESP32 every second ────────────────────
  useEffect(() => {
    if (!liveMode || !espIP) return;
    clearInterval(intervalRef.current);

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`http://${espIP}/api/sensor`, {
          signal: AbortSignal.timeout(2000),
        });
        const data = await res.json();
        setGasPPM(data.ppm ?? 0);
        if (data.temp != null) setTemp(data.temp);
        if (data.humidity != null) setHumidity(data.humidity);
        setValveOpen(data.valve === "open");
        setValveMoving(data.valve === "moving");
        setConnected(true);
        setHistory((prev) => [...prev.slice(-59), data.ppm ?? 0]);
      } catch {
        setConnected(false);
      }
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [liveMode, espIP]);

  // ── Demo mode: simulate sensor data ───────────────────────
  useEffect(() => {
    if (liveMode) return;
    clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      setGasPPM((prev) => {
        let next;
        const noise = (Math.random() - 0.5) * 30;
        if (simMode === "leak") {
          next = Math.min(prev + Math.random() * 15 + 3, 980);
        } else if (simMode === "spike") {
          next = prev > 850 ? prev - Math.random() * 40 : prev + Math.random() * 80;
          if (prev > 900) setSimMode("normal");
        } else {
          const target = valveOpen ? 160 + Math.sin(Date.now() / 10000) * 40 : Math.max(prev - 8, 50);
          next = prev + (target - prev) * 0.08 + noise;
        }
        return Math.max(50, Math.min(next, 999));
      });
      setTemp((p) => p + (Math.random() - 0.5) * 0.3);
      setHumidity((p) => Math.max(40, Math.min(85, p + (Math.random() - 0.5) * 0.5)));
    }, 800);

    return () => clearInterval(intervalRef.current);
  }, [liveMode, simMode, valveOpen]);

  // ── History + threshold check (both modes) ────────────────
  useEffect(() => {
    if (liveMode) return; // live mode updates history from fetch
    setHistory((prev) => [...prev.slice(-59), gasPPM]);
    if (gasPPM >= THRESHOLDS.danger && !alertSoundRef.current) {
      addAlert(`Gas level critical: ${Math.round(gasPPM)} PPM`, "danger");
      addLog("danger", `Gas concentration reached ${Math.round(gasPPM)} PPM`, gasPPM);
      alertSoundRef.current = true;
      if (autoShutoff && valveOpen && gasPPM >= shutoffThreshold) {
        setValveOpen(false);
        addLog("shutoff", `AUTO SHUT-OFF triggered at ${Math.round(gasPPM)} PPM`, gasPPM);
        addAlert("AUTO SHUT-OFF ACTIVATED", "critical");
        setSimMode("normal");
      }
    } else if (gasPPM >= THRESHOLDS.warning && gasPPM < THRESHOLDS.danger) {
      if (Math.random() < 0.02) addLog("warning", `Elevated gas: ${Math.round(gasPPM)} PPM`, gasPPM);
    }
    if (gasPPM < THRESHOLDS.warning) alertSoundRef.current = false;
  }, [gasPPM, liveMode, autoShutoff, shutoffThreshold, valveOpen, addAlert, addLog]);

  // ── Periodic logging ──────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => addLog("info", `Reading: ${Math.round(gasPPM)} PPM`, gasPPM), 15000);
    return () => clearInterval(t);
  }, [gasPPM, addLog]);

  // ── Valve toggle ──────────────────────────────────────────
  const toggleValve = async () => {
    if (valveMoving) return;

    if (liveMode && espIP) {
      const endpoint = valveOpen ? "close" : "open";
      setValveMoving(true);
        try {
          const res = await fetch(`http://${espIP}/api/valve/${endpoint}`, {
            method: "POST",
            signal: AbortSignal.timeout(5000),
          });
          const data = await res.json();
          if (data.success) {
            setValveMoving(data.valve === "moving");
            addLog(endpoint === "open" ? "open" : "shutoff",
              `Valve ${endpoint === "open" ? "OPEN" : "CLOSE"} command sent to ESP32`, gasPPM);
            addAlert(`Valve ${endpoint.toUpperCase()} command sent`, endpoint === "open" ? "info" : "warning");
          } else {
            setValveMoving(false);
            addAlert(`Valve command denied: ${data.reason || "unknown"}`, "danger");
          }
        } catch {
          setConnected(false);
          setValveMoving(false);
          addAlert("Failed to reach ESP32", "danger");
        }
        return;
      }

    // Demo mode
    const next = !valveOpen;
    setValveOpen(next);
    addLog(next ? "open" : "shutoff", `Valve manually ${next ? "OPENED" : "CLOSED"} (demo)`, gasPPM);
    addAlert(`Valve ${next ? "OPENED" : "CLOSED"} (demo)`, next ? "info" : "warning");
    if (!next) setSimMode("normal");
  };

  const status = getGasStatus(gasPPM);
  const dangerPulse = gasPPM >= THRESHOLDS.danger;

  const cardStyle = {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 16, padding: "20px 24px", backdropFilter: "blur(20px)",
  };

  const logTypeColors = { info: "#64748b", warning: "#eab308", danger: "#ef4444", shutoff: "#ef4444", open: "#22c55e" };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e17", backgroundImage: "radial-gradient(ellipse at 20% 50%, rgba(16,185,129,0.04) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(59,130,246,0.04) 0%, transparent 50%)", color: "#e2e8f0", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "16px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.008) 2px, rgba(255,255,255,0.008) 4px)", pointerEvents: "none", zIndex: 1 }} />

      {/* Alert toasts */}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 100, display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
        {alerts.map((a) => (
          <div key={a.id} style={{ background: a.severity === "critical" ? "rgba(239,68,68,0.95)" : a.severity === "danger" ? "rgba(239,68,68,0.85)" : a.severity === "warning" ? "rgba(234,179,8,0.85)" : "rgba(34,197,94,0.85)", color: "#fff", padding: "12px 18px", borderRadius: 12, fontSize: 13, fontWeight: 600, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animation: "slideIn 0.3s ease" }}>
            {a.severity === "critical" && "🚨 "}{a.message}
            <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>{formatTime(a.time)}</div>
          </div>
        ))}
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", position: "relative", zIndex: 2 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 26 }}>⚙️</span>
              <span style={{ background: "linear-gradient(135deg, #22c55e, #3b82f6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>GasGuard</span>
              <span style={{ fontSize: 13, fontWeight: 400, color: "#64748b", marginLeft: 4 }}>IoT Monitor</span>
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#475569", fontFamily: "'JetBrains Mono', monospace" }}>
              ESP32 · MQ-6 Sensor · v2.0
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {/* Live / Demo mode badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 20, background: liveMode ? "rgba(34,197,94,0.1)" : "rgba(234,179,8,0.1)", border: `1px solid ${liveMode ? "rgba(34,197,94,0.3)" : "rgba(234,179,8,0.3)"}` }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: liveMode ? (connected ? "#22c55e" : "#ef4444") : "#eab308", boxShadow: `0 0 6px ${liveMode ? (connected ? "#22c55e" : "#ef4444") : "#eab308"}` }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: liveMode ? (connected ? "#22c55e" : "#ef4444") : "#eab308" }}>
                {liveMode ? (connected ? "LIVE" : "DISCONNECTED") : "DEMO"}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#475569", fontFamily: "'JetBrains Mono', monospace" }}>
              {formatDate(new Date())} · {formatTime(new Date())}
            </div>
          </div>
        </div>

        {/* ESP32 Connection Bar */}
        <div style={{ ...cardStyle, marginBottom: 16, background: "rgba(59,130,246,0.04)", border: `1px solid ${liveMode ? "rgba(34,197,94,0.2)" : "rgba(59,130,246,0.15)"}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6", letterSpacing: 1, whiteSpace: "nowrap" }}>ESP32 IP</span>
            <input
              value={ipInput}
              onChange={(e) => setIpInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmIP()}
              placeholder="192.168.x.x"
              style={{ flex: 1, minWidth: 140, maxWidth: 200, padding: "7px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, outline: "none" }}
            />
            <button onClick={confirmIP} style={{ padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, background: "linear-gradient(135deg, #22c55e, #16a34a)", color: "#fff" }}>
              Connect Live
            </button>
            <button onClick={() => { setLiveMode(false); setConnected(false); }} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,0.05)", color: "#94a3b8" }}>
              Demo Mode
            </button>
            {liveMode && espIP && (
              <span style={{ fontSize: 11, color: "#475569", fontFamily: "'JetBrains Mono', monospace" }}>
                → http://{espIP}
              </span>
            )}
          </div>
          {liveMode && !connected && (
            <div style={{ marginTop: 10, fontSize: 11, color: "#f97316", fontFamily: "'JetBrains Mono', monospace" }}>
              ⚠ Cannot reach ESP32. Make sure you are on the same WiFi network and open the dashboard from a local HTTP tab (not HTTPS).
            </div>
          )}
        </div>

        {/* Main grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

          {/* Gauge */}
          <div style={{ ...cardStyle, gridColumn: "1 / 2", textAlign: "center", border: dangerPulse ? "1px solid rgba(239,68,68,0.3)" : cardStyle.border, animation: dangerPulse ? "dangerPulse 1.5s ease infinite" : "none" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 2, marginBottom: 8 }}>GAS CONCENTRATION</div>
            <GaugeArc ppm={gasPPM} />
            <div style={{ marginTop: 8 }}>
              <Sparkline data={history} />
              <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>Last 60 readings</div>
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Valve Control */}
            <div style={{ ...cardStyle, border: !valveOpen ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(34,197,94,0.15)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 2, marginBottom: 14 }}>VALVE CONTROL</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: valveMoving ? "rgba(234,179,8,0.15)" : valveOpen ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)", display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${valveMoving ? "#eab308" : valveOpen ? "#22c55e" : "#ef4444"}`, boxShadow: `0 0 20px ${valveMoving ? "rgba(234,179,8,0.2)" : valveOpen ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`, transition: "all 0.4s ease" }}>
                  <span style={{ fontSize: 24 }}>{valveMoving ? "🔄" : valveOpen ? "🟢" : "🔴"}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: valveMoving ? "#eab308" : valveOpen ? "#22c55e" : "#ef4444" }}>
                    {valveMoving ? "MOVING..." : valveOpen ? "VALVE OPEN" : "VALVE CLOSED"}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {liveMode ? "ESP32 controlled" : "Demo mode"}
                  </div>
                </div>
              </div>
              <button
                onClick={toggleValve}
                disabled={valveMoving}
                style={{ width: "100%", marginTop: 16, padding: "14px", borderRadius: 12, border: "none", cursor: valveMoving ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 800, letterSpacing: 1, color: "#fff", background: valveMoving ? "linear-gradient(135deg, #475569, #334155)" : valveOpen ? "linear-gradient(135deg, #dc2626, #b91c1c)" : "linear-gradient(135deg, #16a34a, #15803d)", boxShadow: valveMoving ? "none" : valveOpen ? "0 4px 20px rgba(220,38,38,0.3)" : "0 4px 20px rgba(22,163,74,0.3)", transition: "all 0.3s ease", opacity: valveMoving ? 0.7 : 1 }}
              >
                {valveMoving ? "⏳  MOTOR MOVING..." : valveOpen ? "🛑  EMERGENCY SHUT-OFF" : "✅  OPEN VALVE"}
              </button>
            </div>

            {/* Environment */}
            <div style={cardStyle}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 2, marginBottom: 12 }}>ENVIRONMENT</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "12px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>TEMPERATURE</div>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: "#f59e0b" }}>{temp.toFixed(1)}°C</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "12px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>HUMIDITY</div>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: "#3b82f6" }}>{humidity.toFixed(0)}%</div>
                </div>
              </div>
            </div>
          </div>

          {/* Settings row */}
          <div style={{ ...cardStyle, gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
              {/* Auto shut-off — only in demo mode */}
              {!liveMode && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 2 }}>AUTO SHUT-OFF</div>
                    <button onClick={() => setAutoShutoff(!autoShutoff)} style={{ width: 48, height: 26, borderRadius: 13, border: "none", cursor: "pointer", position: "relative", background: autoShutoff ? "#22c55e" : "#334155", transition: "background 0.3s" }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: autoShutoff ? 25 : 3, transition: "left 0.3s", boxShadow: "0 2px 4px rgba(0,0,0,0.3)" }} />
                    </button>
                    <span style={{ fontSize: 12, color: autoShutoff ? "#22c55e" : "#64748b" }}>{autoShutoff ? "Enabled" : "Disabled"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>Threshold:</span>
                    {[600, 700, 800, 900].map((v) => (
                      <button key={v} onClick={() => setShutoffThreshold(v)} style={{ padding: "5px 12px", borderRadius: 8, border: shutoffThreshold === v ? "1px solid rgba(59,130,246,0.4)" : "1px solid transparent", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", background: shutoffThreshold === v ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.05)", color: shutoffThreshold === v ? "#60a5fa" : "#64748b" }}>
                        {v}
                      </button>
                    ))}
                    <span style={{ fontSize: 11, color: "#64748b" }}>PPM</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>Simulate:</span>
                    {[["normal", "Normal"], ["leak", "Leak 🔥"], ["spike", "Spike ⚡"]].map(([mode, label]) => (
                      <button key={mode} onClick={() => { setSimMode(mode); if (!valveOpen && mode !== "normal") setValveOpen(true); }} style={{ padding: "5px 12px", borderRadius: 8, border: simMode === mode ? "1px solid rgba(239,68,68,0.3)" : "1px solid transparent", cursor: "pointer", fontSize: 11, fontWeight: 600, background: simMode === mode ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.05)", color: simMode === mode ? "#f87171" : "#64748b" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {liveMode && (
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  ✅ Auto shut-off is managed autonomously by the ESP32 at 800 PPM. Use the button above for manual override.
                </div>
              )}
            </div>
          </div>

          {/* Log */}
          <div style={{ ...cardStyle, gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 2 }}>DATA LOG <span style={{ color: "#475569", fontWeight: 400 }}>({logs.length})</span></div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setShowLogs(!showLogs)} style={{ padding: "5px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#94a3b8", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                  {showLogs ? "Collapse" : "Expand"}
                </button>
                <button onClick={() => { setLogs([]); addAlert("Logs cleared", "info"); }} style={{ padding: "5px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#94a3b8", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                  Clear
                </button>
              </div>
            </div>
            <div style={{ maxHeight: showLogs ? 300 : 140, overflow: "auto", transition: "max-height 0.4s ease", scrollbarWidth: "thin", scrollbarColor: "#1e293b transparent" }}>
              {logs.length === 0 ? (
                <div style={{ textAlign: "center", padding: 24, color: "#334155", fontSize: 13 }}>No events logged yet</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {["TIME", "TYPE", "PPM", "EVENT"].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: "#475569", fontWeight: 600, fontSize: 10, letterSpacing: 1 }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                        <td style={{ padding: "6px 8px", fontFamily: "'JetBrains Mono', monospace", color: "#64748b", fontSize: 11 }}>{formatTime(log.time)}</td>
                        <td style={{ padding: "6px 8px" }}>
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: `${logTypeColors[log.type]}20`, color: logTypeColors[log.type], letterSpacing: 0.5, textTransform: "uppercase" }}>{log.type}</span>
                        </td>
                        <td style={{ padding: "6px 8px", fontFamily: "'JetBrains Mono', monospace", color: getGasStatus(log.ppm).color, fontWeight: 600, fontSize: 12 }}>{Math.round(log.ppm)}</td>
                        <td style={{ padding: "6px 8px", color: "#94a3b8", fontSize: 12 }}>{log.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 10, color: "#334155", fontFamily: "'JetBrains Mono', monospace" }}>
          BATCH 57 · REC Mechanical Engineering · Design Thinking &amp; Innovation · GE23627
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap');
        @keyframes slideIn { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes dangerPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); } 50% { box-shadow: 0 0 30px 4px rgba(239,68,68,0.15); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }
      `}</style>
    </div>
  );
}
