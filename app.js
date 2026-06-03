/* ===========================================================
   FaraNight — Thermal Runaway Emulation System
   Acquisition console logic
   =========================================================== */

/* =====================================================================
   TEST CONFIGURATION  —  edit these values
   ---------------------------------------------------------------------
   Each profile (A / B / C) defines:
     - duration  : test length in SECONDS (each profile separate)
     - air        : planned setpoint sine for CH1 (Enclosure Air)
     - propane    : planned setpoint sine for CH2 (Propane Line)
   A planned curve is:   p(t) = offset + amplitude * sin(2*PI*t/period + phase)
   amplitude & offset are the primary tuning vars; period/phase tweak shape.
   Pressure axis is fixed 0–10 bar (gauge).
   ===================================================================== */

const PRESSURE_MIN = 0;     // bar
const PRESSURE_MAX = 10;    // bar
const SAMPLE_RATE  = 10;    // Hz (live samples per second)

// Lead-in hold (seconds) with the solenoids CLOSED: pressures sit at 0 and
// temps at ambient. The solenoids open at t = SOLENOID_DELAY, after which the
// profile runs. Total recorded time = SOLENOID_DELAY + the test's duration.
const SOLENOID_DELAY = 3;   // s
const DEAD_TIME      = 0.1;   // s — quiet hold after solenoids close (pre-open noise profile)

// ---- Per-test durations (seconds) ----
const DURATION_A = 30;
const DURATION_B = 43;
const DURATION_C = 60;

    // label: 'Moli 18650',
    // desc: 'Moli 18650 — Nominal ramp. Low-amplitude air dwell with moderate propane charge cycle.',
    // duration: DURATION_A,
    // //                amplitude  offset  period(s)  phase(rad)
    // air:     { amplitude: 1.2,  offset: 2.0,  period: 45, phase: 0 },
    // propane: { amplitude: 2.0,  offset: 3.0,  period: 45, phase: 0 },

const TESTS = {
  A: {
    label: 'Moli 21700',
    desc: 'Moli 21700 — Nominal ramp. Low-amplitude air dwell with moderate propane charge cycle.',
    duration: DURATION_A,
    //                amplitude  offset  period(s)  phase(rad)
    air:     { amplitude: 1.2,  offset: 2.0,  period: 45, phase: 0 },
    propane: { amplitude: 2.0,  offset: 3.0,  period: 45, phase: 0 },
    //          peak(g/s)  tau(s)  floor(g/s)
    particulate: { peak: 12,  tau: 8,  floor: 0.2 },
  },
  B: {
    label: 'Moli 18650',
    desc: 'Moli 18650 — Elevated cycling. Higher propane amplitude with shorter period to stress the regulator.',
    duration: DURATION_B,
    air:     { amplitude: 1.8,  offset: 2.0,  period: 20, phase: 0.6 },
    propane: { amplitude: 2,  offset: 3.0,  period: 24, phase: 0 },
    particulate: { peak: 16,  tau: 11,  floor: 0.3 },
  },
  C: {
    label: 'Moli 14500',
    desc: 'Moli 14500 — Aggressive overpressure. Maximum amplitudes approaching enclosure limit for runaway onset.',
    duration: DURATION_C,
    air:     { amplitude: 2.2,  offset: 5.5,  period: 18, phase: 0 },
    propane: { amplitude: 2.5,  offset: 7.0,  period: 16, phase: 1.1 },
    particulate: { peak: 19,  tau: 16,  floor: 0.4 },
  },
};

/* =====================================================================
   TEMPERATURE CONFIGURATION  —  edit these values
   ---------------------------------------------------------------------
   One graph, three live lines, all CORRELATED with the propane pressure:
   a 0..1 driver is taken from the planned propane sine, and each channel
   scales toward its own `peak` (°C) with that driver. Flame & sample track
   directly; ambient is a heavily DAMPED follower (low-pass) of the same
   profile — i.e. an offset / scaled-down flame curve — plus random noise.
   Per-channel noise lives in the NOISE CONFIGURATION block below.
   ===================================================================== */

const TEMP_MIN   = 0;      // °C  (y-axis min)
const TEMP_MAX   = 1000;   // °C  (y-axis max)

const TEMP_SERIES = [
  { key: 'flame',   label: 'Flame',   color: '#d9534f', peak: 700 },
  { key: 'sample',  label: 'Sample',  color: '#e0922f', peak: 850 },
  { key: 'ambient', label: 'Ambient', color: '#3d7c98', peak: 280 },
];
const PEAK = Object.fromEntries(TEMP_SERIES.map(s => [s.key, s.peak]));

// Ambient low-pass factor per sample (0..1). It lags the flame: small enough
// that one propane wave doesn't let it fully catch up, so the next wave steps
// it up again. Smaller = laggier / flatter; larger = tracks flame more closely.
const AMBIENT_DAMP      = 0.08;   // rise rate (fast — each wave steps ambient up quickly)
const AMBIENT_DAMP_DOWN = 0.004;  // decay rate (slow — enclosure stays hot between waves)

// Every channel starts here (room temp, °C) and quickly ramps to its region.
const AMBIENT_BASE   = 24;    // °C  — common starting temperature
const TEMP_RISE_TAU  = 2.0;   // s   — rise time constant (smaller = faster onset)

// How deep the propane-driven dip is in the FLAME & SAMPLE curves.
// 0 = no dip (flat plateau at peak), 1 = full dip following the propane sine.
const TEMP_DIP       = 0.6;

/* =====================================================================
   PARTICULATE INJECTION CONFIGURATION  —  edit these values
   ---------------------------------------------------------------------
   Mass rate (g/s) of particulate seeded into the air flow. The planned
   target is an exponential-decay spike: it shoots from 0 to the per-test
   `peak` the instant the solenoids open, then decays toward `floor` with
   the per-test time constant `tau`. Per-test params live in TESTS above.
   ===================================================================== */
const PART_MIN      = 0;     // g/s  (y-axis min)
const PART_MAX      = 20;    // g/s  (y-axis max)
const PART_RISE_TAU = 0.4;   // s    — injection ramp-up (smaller = sharper onset)

/* =====================================================================
   NOISE CONFIGURATION  —  independent, per-channel (edit these)
   ---------------------------------------------------------------------
   Every channel has its own noise magnitude.  Noise is NOT a clean Gaussian
   std-dev: each sample combines a bounded random-walk drift + uniform jitter
   + the occasional random spike, all reseeded every run — so each trace looks
   genuinely erratic and never repeats.
   ===================================================================== */

// --- Post-open (solenoids open, test running) ---
const NOISE_AIR     = 0.40;  // bar
const NOISE_PROPANE = 0.50;  // bar
const NOISE_FLAME   = 25;    // °C
const NOISE_SAMPLE  = 35;    // °C
const NOISE_AMBIENT = 5;     // °C
const NOISE_PART    = 0.45;  // g/s

// --- Pre-open (solenoids closed, lead-in hold) — much quieter ---
const NOISE_PRE_AIR     = 0.04;  // bar
const NOISE_PRE_PROPANE = 0.04;  // bar
const NOISE_PRE_FLAME   = 1.5;   // °C
const NOISE_PRE_SAMPLE  = 1.5;   // °C
const NOISE_PRE_AMBIENT = 0.5;   // °C
const NOISE_PRE_PART    = 0.02;  // g/s

class NoiseGen {
  constructor(amount) { this.amount = amount; this.walk = 0; }
  reset() { this.walk = 0; }
  setAmount(a) { this.amount = a; }
  next() {
    const a = this.amount;
    // bounded random-walk drift — uniform steps that decay back toward zero
    this.walk = clamp(this.walk * 0.88 + (Math.random() * 2 - 1) * a * 0.6, -a * 1.5, a * 1.5);
    // uniform jitter on every sample
    const jitter = (Math.random() * 2 - 1) * a;
    // occasional random spike (~3% of samples)
    const spike = Math.random() < 0.03 ? (Math.random() * 2 - 1) * a * 2.5 : 0;
    return this.walk + jitter + spike;
  }
}

const NOISE = {
  air:     new NoiseGen(NOISE_AIR),
  propane: new NoiseGen(NOISE_PROPANE),
  flame:   new NoiseGen(NOISE_FLAME),
  sample:  new NoiseGen(NOISE_SAMPLE),
  ambient: new NoiseGen(NOISE_AMBIENT),
  part:    new NoiseGen(NOISE_PART),
};

function resetNoise() { Object.values(NOISE).forEach(n => n.reset()); }

// Damped-ambient state, persists across samples within a run.
let ambientTemp = AMBIENT_BASE;

// Generate the three temperatures at elapsed time t. Every channel starts at
// AMBIENT_BASE (room temp) and quickly rises toward its region: a 0..1 onset
// envelope blends from the start temp to the pressure-driven target. Flame &
// sample follow directly; ambient is a heavily damped follower with noise.
function computeTemps(cfg, t) {
  const tt = Math.max(0, t);                                       // hold (t<0) reads ambient
  const crest = cfg.propane.offset + cfg.propane.amplitude;        // propane sine peak
  const driver = clamp(plannedPressure(cfg.propane, tt) / crest, 0, 1);
  const rise = 1 - Math.exp(-tt / TEMP_RISE_TAU);                  // 0 at open, →1 quickly

  // flame & sample follow a dip-scaled driver: TEMP_DIP shrinks the downswing
  // toward the peak (1 = full dip, 0 = none).
  const fsDriver = 1 - TEMP_DIP * (1 - driver);
  const flameTarget  = AMBIENT_BASE + (PEAK.flame  * fsDriver - AMBIENT_BASE) * rise;
  const sampleTarget = AMBIENT_BASE + (PEAK.sample * fsDriver - AMBIENT_BASE) * rise;

  const flame  = clamp(flameTarget  + NOISE.flame.next(),  TEMP_MIN, TEMP_MAX);
  const sample = clamp(sampleTarget + NOISE.sample.next(), TEMP_MIN, TEMP_MAX);

  // ambient: a damped, scaled-down low-pass follower of the FLAME temperature.
  // Tracks both rises and falls so each wave is visible, just heavily lagged.
  const ambientRatio = (PEAK.ambient - AMBIENT_BASE) / (PEAK.flame - AMBIENT_BASE);
  const ambientTarget = AMBIENT_BASE + (flameTarget - AMBIENT_BASE) * ambientRatio;
  const damp = ambientTarget > ambientTemp ? AMBIENT_DAMP : AMBIENT_DAMP_DOWN;
  ambientTemp += (ambientTarget - ambientTemp) * damp;
  const ambient = clamp(ambientTemp + NOISE.ambient.next(), TEMP_MIN, TEMP_MAX);

  return { flame, sample, ambient };
}

/* =====================================================================
   PRESSURE CHART  —  one reusable object, two instances (air / propane)
   ===================================================================== */
class PressureChart {
  constructor(canvas, accent, yLabel, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.accent = accent || '#1c6fa6';
    this.yLabel = yLabel || 'Pressure (bar)';
    this.yMin = opts.yMin ?? PRESSURE_MIN;            // axis range (defaults to pressure)
    this.yMax = opts.yMax ?? PRESSURE_MAX;
    this.curveFn = opts.curveFn || plannedPressure;   // planned-curve generator
    this.planned = [];   // [{t, p}] full planned curve for the active profile
    this.live = [];      // [{t, p}] recorded live samples (empty until START)
    this.duration = 60;
    this.closeMark = null;
    this.dpr = window.devicePixelRatio || 1;

    this.pad = { top: 14, right: 12, bottom: 24, left: 54 };

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.w = Math.max(10, rect.width);
    this.h = Math.max(10, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  // Build the static planned (dotted) curve across the whole timeline, including
  // the closed-solenoid hold at 0 for the first SOLENOID_DELAY seconds.
  setPlanned(channelCfg, duration) {
    const closeAt  = SOLENOID_DELAY + duration;
    const total    = closeAt + DEAD_TIME;
    this.duration  = total;
    this.closeMark = closeAt;
    const step = 0.25; // seconds — smooth planned curve
    const pts = [];
    for (let t = 0; t <= total + 1e-6; t += step) {
      const tp = t - SOLENOID_DELAY;
      pts.push({ t, p: (tp < 0 || t >= closeAt) ? 0 : this.curveFn(channelCfg, tp) });
    }
    this.planned = pts;
    this.draw();
  }

  clearLive() { this.live = []; this.draw(); }
  pushLive(t, p) { this.live.push({ t, p }); }

  // --- coordinate helpers ---
  xToPx(t) {
    const plotW = this.w - this.pad.left - this.pad.right;
    return this.pad.left + (t / this.duration) * plotW;
  }
  yToPx(p) {
    const plotH = this.h - this.pad.top - this.pad.bottom;
    const frac = (p - this.yMin) / (this.yMax - this.yMin);
    return this.pad.top + plotH - frac * plotH;
  }

  draw() {
    const ctx = this.ctx;
    const { top, right, bottom, left } = this.pad;
    const plotW = this.w - left - right;
    const plotH = this.h - top - bottom;
    if (plotW <= 0 || plotH <= 0) return;

    ctx.clearRect(0, 0, this.w, this.h);

    // plot background
    ctx.fillStyle = '#f7f9fb';
    ctx.fillRect(left, top, plotW, plotH);

    // ---- grid + axis labels ----
    ctx.lineWidth = 1;
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#7a8893';
    ctx.strokeStyle = '#e1e6ea';

    // horizontal (pressure) gridlines (5 divisions across the range)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const pStep = (this.yMax - this.yMin) / 5;
    for (let p = this.yMin; p <= this.yMax + 1e-6; p += pStep) {
      const y = this.yToPx(p);
      ctx.beginPath();
      ctx.moveTo(left, y + 0.5);
      ctx.lineTo(left + plotW, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(p), left - 5, y);
    }

    // vertical (time) gridlines
    const tStep = niceTimeStep(this.duration);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= this.duration + 1e-6; t += tStep) {
      const x = this.xToPx(t);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, top + plotH);
      ctx.stroke();
      ctx.fillText(t + 's', x, top + plotH + 5);
    }

    // plot border
    ctx.strokeStyle = '#aab6c2';
    ctx.strokeRect(left + 0.5, top + 0.5, plotW, plotH);

    // ---- solenoid-open marker ----
    drawSolenoidMarker(ctx, this, top, plotH);

    // ---- y-axis label (rotated) ----
    ctx.save();
    ctx.translate(13, top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5d6b76';
    ctx.font = '11px "Segoe UI", Tahoma, sans-serif';
    ctx.fillText(this.yLabel, 0, 0);
    ctx.restore();

    // ---- planned (dotted) ----
    if (this.planned.length) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#8a99a6';
      ctx.lineWidth = 1.5;
      this._stroke(this.planned);
      ctx.restore();
    }

    // ---- live (solid) — only present after START ----
    if (this.live.length) {
      ctx.save();
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      this._stroke(this.live);
      ctx.restore();

      // leading marker
      const last = this.live[this.live.length - 1];
      const mx = this.xToPx(last.t), my = this.yToPx(last.p);
      ctx.fillStyle = this.accent;
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _stroke(pts) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = this.xToPx(pts[i].t);
      const y = this.yToPx(clamp(pts[i].p, this.yMin, this.yMax));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/* =====================================================================
   TEMPERATURE CHART  —  single graph, multiple solid live series
   ===================================================================== */
class TemperatureChart {
  constructor(canvas, series, yMin, yMax, yLabel) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.series = series;
    this.yMin = yMin;
    this.yMax = yMax;
    this.yLabel = yLabel || 'Temperature (°C)';
    this.duration = 60;
    this.closeMark = null;
    this.dpr = window.devicePixelRatio || 1;
    this.pad = { top: 14, right: 12, bottom: 24, left: 58 };

    this.live = {};                       // per-series [{t, p}], empty until START
    series.forEach(s => (this.live[s.key] = []));

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.w = Math.max(10, rect.width);
    this.h = Math.max(10, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  setDuration(d, closeAt) { this.duration = d; this.closeMark = closeAt ?? null; this.draw(); }
  clearLive() { this.series.forEach(s => (this.live[s.key] = [])); this.draw(); }
  pushLive(t, values) {
    this.series.forEach(s => this.live[s.key].push({ t, p: values[s.key] }));
  }

  xToPx(t) {
    const plotW = this.w - this.pad.left - this.pad.right;
    return this.pad.left + (t / this.duration) * plotW;
  }
  yToPx(v) {
    const plotH = this.h - this.pad.top - this.pad.bottom;
    const frac = (v - this.yMin) / (this.yMax - this.yMin);
    return this.pad.top + plotH - frac * plotH;
  }

  draw() {
    const ctx = this.ctx;
    const { top, right, bottom, left } = this.pad;
    const plotW = this.w - left - right;
    const plotH = this.h - top - bottom;
    if (plotW <= 0 || plotH <= 0) return;

    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#f7f9fb';
    ctx.fillRect(left, top, plotW, plotH);

    ctx.lineWidth = 1;
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#7a8893';
    ctx.strokeStyle = '#e1e6ea';

    // y gridlines (every 200 °C)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yStep = (this.yMax - this.yMin) / 5;
    for (let v = this.yMin; v <= this.yMax + 1e-6; v += yStep) {
      const y = this.yToPx(v);
      ctx.beginPath();
      ctx.moveTo(left, y + 0.5);
      ctx.lineTo(left + plotW, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(v), left - 5, y);
    }

    // time gridlines
    const tStep = niceTimeStep(this.duration);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= this.duration + 1e-6; t += tStep) {
      const x = this.xToPx(t);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, top + plotH);
      ctx.stroke();
      ctx.fillText(t + 's', x, top + plotH + 5);
    }

    ctx.strokeStyle = '#aab6c2';
    ctx.strokeRect(left + 0.5, top + 0.5, plotW, plotH);

    // ---- solenoid-open marker ----
    drawSolenoidMarker(ctx, this, top, plotH);

    // ---- y-axis label (rotated) ----
    ctx.save();
    ctx.translate(13, top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5d6b76';
    ctx.font = '11px "Segoe UI", Tahoma, sans-serif';
    ctx.fillText(this.yLabel, 0, 0);
    ctx.restore();

    // each series — solid line, only present after START
    this.series.forEach(s => {
      const pts = this.live[s.key];
      if (!pts.length) return;
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = this.xToPx(pts[i].t);
        const y = this.yToPx(clamp(pts[i].p, this.yMin, this.yMax));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      const last = pts[pts.length - 1];
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(this.xToPx(last.t), this.yToPx(clamp(last.p, this.yMin, this.yMax)), 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
}

/* =====================================================================
   Helpers
   ===================================================================== */
function plannedPressure(cfg, t) {
  return cfg.offset + cfg.amplitude * Math.sin((2 * Math.PI * t) / cfg.period + cfg.phase);
}

// Particulate injection target: exponential-decay spike from 0 → peak → floor.
function plannedParticulate(cfg, t) {
  const onset = 1 - Math.exp(-t / PART_RISE_TAU);          // sharp rise off zero
  const decay = Math.exp(-t / cfg.tau);                    // exponential fall-off
  const peakNow = cfg.floor + (cfg.peak - cfg.floor) * decay;
  return peakNow * onset;
}

// Vertical dashed markers for solenoid open and close events.
function drawSolenoidMarker(ctx, chart, top, plotH) {
  function marker(x, label, side) {
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#c87f0a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, top);
    ctx.lineTo(x + 0.5, top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#c87f0a';
    ctx.font = '9px "Segoe UI", Tahoma, sans-serif';
    ctx.textAlign = side === 'left' ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, side === 'left' ? x - 3 : x + 3, top + 2);
    ctx.restore();
  }
  if (SOLENOID_DELAY > 0 && SOLENOID_DELAY < chart.duration)
    marker(chart.xToPx(SOLENOID_DELAY), 'SOL OPEN', 'right');
  if (chart.closeMark != null && chart.closeMark < chart.duration)
    marker(chart.xToPx(chart.closeMark), 'SOL CLOSE', 'left');
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function niceTimeStep(duration) {
  if (duration <= 30) return 5;
  if (duration <= 90) return 10;
  if (duration <= 300) return 30;
  return 60;
}

function fmtElapsed(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
}

function fmtClock(d) {
  const p = n => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/* =====================================================================
   Application state
   ===================================================================== */
const el = {
  airValue: document.getElementById('airValue'),
  propaneValue: document.getElementById('propaneValue'),
  particulateValue: document.getElementById('particulateValue'),
  flameValue: document.getElementById('flameValue'),
  sampleValue: document.getElementById('sampleValue'),
  ambientValue: document.getElementById('ambientValue'),
  statusPill: document.getElementById('statusPill'),
  elapsedVal: document.getElementById('elapsedVal'),
  durationVal: document.getElementById('durationVal'),
  sampleVal: document.getElementById('sampleVal'),
  progressFill: document.getElementById('progressFill'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  resetBtn: document.getElementById('resetBtn'),
  profileDesc: document.getElementById('profileDesc'),
  activeProfileLabel: document.getElementById('activeProfileLabel'),
  statusBarMsg: document.getElementById('statusBarMsg'),
  clock: document.getElementById('clock'),
  video: document.getElementById('cameraFeed'),
  videoTime: document.getElementById('videoTime'),
  videoStatusLabel: document.getElementById('videoStatusLabel'),
  recIndicator: document.getElementById('recIndicator'),
};

const airChart = new PressureChart(document.getElementById('airChart'), '#1c6fa6');
const propaneChart = new PressureChart(document.getElementById('propaneChart'), '#c24a4a');
const tempChart = new TemperatureChart(document.getElementById('tempChart'), TEMP_SERIES, TEMP_MIN, TEMP_MAX);
const particulateChart = new PressureChart(
  document.getElementById('particulateChart'), '#4a8a5c', 'Injection (g/s)',
  { yMin: PART_MIN, yMax: PART_MAX, curveFn: plannedParticulate }
);

let selectedTest = 'A';
let state = 'idle';        // idle | running | done | stopped
let startTime = 0;
let nextSampleTime = 0;    // elapsed seconds at which to record the next sample
let lastAir = null, lastPropane = null, lastPart = null;
let lastSolenoidOpen  = false;
let lastSolenoidClose = false;
let lastTemps = null;
let rafId = null;

/* =====================================================================
   Profile selection
   ===================================================================== */
function applyProfile(key) {
  selectedTest = key;
  const cfg = TESTS[key];
  airChart.setPlanned(cfg.air, cfg.duration);
  propaneChart.setPlanned(cfg.propane, cfg.duration);
  particulateChart.setPlanned(cfg.particulate, cfg.duration);
  const testClose = SOLENOID_DELAY + cfg.duration;
  tempChart.setDuration(testClose + DEAD_TIME, testClose);
  el.profileDesc.textContent = cfg.desc;
  el.activeProfileLabel.textContent = 'Cell: ' + cfg.label;
  el.durationVal.textContent = fmtElapsed(testClose + DEAD_TIME);
  document.querySelectorAll('.profile-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.test === key);
  });
}

document.querySelectorAll('.profile-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (state === 'running') return;          // locked during a run
    applyProfile(btn.dataset.test);
    resetRun(false);                          // clear any prior live trace
  });
});

/* =====================================================================
   Run control
   ===================================================================== */
function setStatus(s) {
  state = s;
  const map = {
    idle:    ['IDLE', 'status-idle'],
    running: ['RUNNING', 'status-running'],
    done:    ['COMPLETE', 'status-done'],
    stopped: ['STOPPED', 'status-stopped'],
  };
  const [text, cls] = map[s];
  el.statusPill.textContent = text;
  el.statusPill.className = 'control-val status-pill ' + cls;
}

function startTest() {
  if (state === 'running') return;
  resetRun(false);
  const cfg = TESTS[selectedTest];

  setStatus('running');
  startTime = performance.now();
  nextSampleTime = 0;

  el.startBtn.disabled = true;
  el.stopBtn.disabled = false;
  el.resetBtn.disabled = true;
  document.querySelectorAll('.profile-btn').forEach(b => (b.disabled = true));

  el.statusBarMsg.textContent = `Acquisition started — Profile ${cfg.label}, ${cfg.duration}s.`;
  el.recIndicator.textContent = '● REC';
  el.recIndicator.classList.add('is-live');
  el.videoStatusLabel.textContent = 'RECORDING';

  // start camera feed
  el.video.currentTime = 0;
  el.video.play().catch(() => {});

  rafId = requestAnimationFrame(tick);
}

function stopTest(reason) {
  if (state !== 'running') return;
  cancelAnimationFrame(rafId);
  rafId = null;

  setStatus(reason === 'done' ? 'done' : 'stopped');
  el.startBtn.disabled = false;
  el.stopBtn.disabled = true;
  el.resetBtn.disabled = false;
  document.querySelectorAll('.profile-btn').forEach(b => (b.disabled = false));

  el.video.pause();
  el.recIndicator.textContent = '● OFFLINE';
  el.recIndicator.classList.remove('is-live');
  el.videoStatusLabel.textContent = reason === 'done' ? 'TEST COMPLETE' : 'HALTED';
  el.statusBarMsg.textContent =
    reason === 'done'
      ? `Test complete — Profile ${TESTS[selectedTest].label}. ${airChart.live.length} samples acquired.`
      : `Acquisition halted by operator at ${el.elapsedVal.textContent}.`;
}

function resetRun(restoreUI = true) {
  cancelAnimationFrame(rafId);
  rafId = null;
  airChart.clearLive();
  propaneChart.clearLive();
  particulateChart.clearLive();
  tempChart.clearLive();
  resetNoise();
  lastSolenoidOpen  = false;
  lastSolenoidClose = false;
  NOISE.air.setAmount(NOISE_PRE_AIR);
  NOISE.propane.setAmount(NOISE_PRE_PROPANE);
  NOISE.flame.setAmount(NOISE_PRE_FLAME);
  NOISE.sample.setAmount(NOISE_PRE_SAMPLE);
  NOISE.ambient.setAmount(NOISE_PRE_AMBIENT);
  NOISE.part.setAmount(NOISE_PRE_PART);
  ambientTemp = AMBIENT_BASE;
  lastAir = lastPropane = lastPart = null;
  lastTemps = null;
  el.airValue.textContent = '--.- bar';
  el.propaneValue.textContent = '--.- bar';
  el.particulateValue.textContent = '--.- g/s';
  el.flameValue.textContent = '--- °C';
  el.sampleValue.textContent = '--- °C';
  el.ambientValue.textContent = '--- °C';
  el.elapsedVal.textContent = '00:00.0';
  el.sampleVal.textContent = '0';
  el.progressFill.style.width = '0%';

  if (restoreUI) {
    setStatus('idle');
    el.startBtn.disabled = false;
    el.stopBtn.disabled = true;
    el.resetBtn.disabled = false;
    document.querySelectorAll('.profile-btn').forEach(b => (b.disabled = false));
    el.video.pause();
    el.video.currentTime = 0;
    el.recIndicator.textContent = '● OFFLINE';
    el.recIndicator.classList.remove('is-live');
    el.videoStatusLabel.textContent = 'STANDBY';
    el.statusBarMsg.textContent = 'System ready.';
  }
}

/* =====================================================================
   Acquisition loop
   ===================================================================== */
function tick(now) {
  const cfg = TESTS[selectedTest];
  const testClose = SOLENOID_DELAY + cfg.duration;
  const total = testClose + DEAD_TIME;
  const elapsed = (now - startTime) / 1000;
  const t = Math.min(elapsed, total);

  // record samples at the fixed sample rate
  const interval = 1 / SAMPLE_RATE;
  while (nextSampleTime <= t) {
    const st = nextSampleTime;
    const tp = st - SOLENOID_DELAY;                 // profile time (negative = hold)
    const dead = st >= testClose;                   // in post-close dead time?
    const open = tp >= 0 && !dead;                  // solenoids currently open?

    // Switch noise to full at the solenoid-open boundary
    if (!dead && open !== lastSolenoidOpen) {
      lastSolenoidOpen = open;
      NOISE.air.setAmount    (open ? NOISE_AIR     : NOISE_PRE_AIR);
      NOISE.propane.setAmount(open ? NOISE_PROPANE : NOISE_PRE_PROPANE);
      NOISE.flame.setAmount  (open ? NOISE_FLAME   : NOISE_PRE_FLAME);
      NOISE.sample.setAmount (open ? NOISE_SAMPLE  : NOISE_PRE_SAMPLE);
      NOISE.ambient.setAmount(open ? NOISE_AMBIENT : NOISE_PRE_AMBIENT);
      NOISE.part.setAmount   (open ? NOISE_PART    : NOISE_PRE_PART);
    }

    // Switch noise back to quiet once at the solenoid-close boundary
    if (dead && !lastSolenoidClose) {
      lastSolenoidClose = true;
      NOISE.air.setAmount(NOISE_PRE_AIR);
      NOISE.propane.setAmount(NOISE_PRE_PROPANE);
      NOISE.flame.setAmount(NOISE_PRE_FLAME);
      NOISE.sample.setAmount(NOISE_PRE_SAMPLE);
      NOISE.ambient.setAmount(NOISE_PRE_AMBIENT);
      NOISE.part.setAmount(NOISE_PRE_PART);
    }

    const airBase  = open ? plannedPressure(cfg.air, tp)        : 0;
    const propBase = open ? plannedPressure(cfg.propane, tp)    : 0;
    const partBase = open ? plannedParticulate(cfg.particulate, tp) : 0;
    const airP  = clamp(airBase  + NOISE.air.next(),     PRESSURE_MIN, PRESSURE_MAX);
    const propP = clamp(propBase + NOISE.propane.next(), PRESSURE_MIN, PRESSURE_MAX);
    const partP = clamp(partBase + NOISE.part.next(),    PART_MIN,     PART_MAX);
    airChart.pushLive(st, airP);
    propaneChart.pushLive(st, propP);
    particulateChart.pushLive(st, partP);
    lastAir = airP;
    lastPropane = propP;
    lastPart = partP;

    // During dead time freeze temps at end-of-profile value (battery still hot, gas off)
    const tempTp = dead ? cfg.duration : tp;
    const temps = computeTemps(cfg, tempTp);
    tempChart.pushLive(st, temps);
    lastTemps = temps;

    nextSampleTime += interval;
  }

  // readouts
  if (lastAir !== null) el.airValue.textContent = lastAir.toFixed(1) + ' bar';
  if (lastPropane !== null) el.propaneValue.textContent = lastPropane.toFixed(1) + ' bar';
  if (lastPart !== null) el.particulateValue.textContent = lastPart.toFixed(1) + ' g/s';
  if (lastTemps) {
    el.flameValue.textContent = Math.round(lastTemps.flame) + ' °C';
    el.sampleValue.textContent = Math.round(lastTemps.sample) + ' °C';
    el.ambientValue.textContent = Math.round(lastTemps.ambient) + ' °C';
  }
  el.elapsedVal.textContent = fmtElapsed(t);
  el.sampleVal.textContent = String(airChart.live.length);
  el.progressFill.style.width = (100 * t / total).toFixed(1) + '%';

  airChart.draw();
  propaneChart.draw();
  particulateChart.draw();
  tempChart.draw();

  if (elapsed >= total) {
    el.progressFill.style.width = '100%';
    stopTest('done');
    return;
  }
  rafId = requestAnimationFrame(tick);
}

/* =====================================================================
   Video overlay timecode
   ===================================================================== */
el.video.addEventListener('timeupdate', () => {
  const s = Math.floor(el.video.currentTime);
  const p = n => String(n).padStart(2, '0');
  el.videoTime.textContent = p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
});

/* =====================================================================
   Menu actions
   ===================================================================== */
const SAFETY_URL = 'https://imperiallondon.sharepoint.com/:b:/s/DMT2526_13_BatteryRigs-ME/IQCP-kj6OtMgRpQyzsebdyO4AU_GOpV96ySV_9lvz1jej6A?e=JmbEaA';
const PYBAMM_URL = 'https://docs.pybamm.org/';

// File > Save Dataset — export the recorded live traces as a CSV download.
function saveDataset() {
  const n = airChart.live.length;
  if (!n) {
    el.statusBarMsg.textContent = 'Nothing to save — run a test first.';
    return;
  }
  const tl = tempChart.live;
  let csv = 'time_s,air_bar,propane_bar,particulate_gps,flame_C,sample_C,ambient_C\n';
  for (let i = 0; i < n; i++) {
    csv += [
      airChart.live[i].t.toFixed(2),
      airChart.live[i].p.toFixed(3),
      propaneChart.live[i].p.toFixed(3),
      particulateChart.live[i].p.toFixed(3),
      tl.flame[i].p.toFixed(2),
      tl.sample[i].p.toFixed(2),
      tl.ambient[i].p.toFixed(2),
    ].join(',') + '\n';
  }
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const cell = TESTS[selectedTest].label.replace(/\s+/g, '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `faranight_${cell}_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  el.statusBarMsg.textContent = `Dataset saved (${n} samples) — ${a.download}`;
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

document.querySelectorAll('[data-action]').forEach(node => {
  node.addEventListener('click', () => {
    switch (node.dataset.action) {
      case 'save':        saveDataset(); break;
      case 'open-new':    location.reload(); break;
      case 'fullscreen':  toggleFullscreen(); break;
      case 'start':       startTest(); break;
      case 'stop':        stopTest('manual'); break;
      case 'reset':       resetRun(true); break;
      case 'diagnostics': openCalModal(); break;
      case 'safety':      window.open(SAFETY_URL, '_blank', 'noopener'); break;
      case 'help':        window.open(PYBAMM_URL, '_blank', 'noopener'); break;
    }
  });
});

/* =====================================================================
   Diagnostics & Calibration modal
   ===================================================================== */
const SENSORS = [
  { name: 'CH1 — Enclosure Air Pressure', value: 3.04,  unit: 'bar',  dp: 2 },
  { name: 'CH2 — Propane Line Pressure',  value: 5.11,  unit: 'bar',  dp: 2 },
  { name: 'TC-01 — Flame Thermocouple',   value: 642,   unit: '°C',   dp: 0 },
  { name: 'TC-02 — Sample Thermocouple',  value: 318,   unit: '°C',   dp: 0 },
  { name: 'RTD-01 — Ambient',             value: 27.4,  unit: '°C',   dp: 1 },
  { name: 'MF-01 — Propane Mass Flow',    value: 12.6,  unit: 'g/s',  dp: 1 },
  { name: 'O2-01 — Enclosure Oxygen',     value: 20.8,  unit: '%',    dp: 1 },
  { name: 'LC-01 — Sample Load Cell',     value: 1.842, unit: 'kg',   dp: 3 },
  { name: 'VM-01 — Cell Terminal Voltage',value: 3.712, unit: 'V',    dp: 3 },
];

const calModal = document.getElementById('calModal');
const calRows = document.getElementById('calRows');
const calStatus = document.getElementById('calStatus');

function renderCalRows() {
  calRows.innerHTML = '';
  SENSORS.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${s.name}</td>` +
      `<td class="val" id="calVal${i}">${s.value.toFixed(s.dp)} ${s.unit}</td>` +
      `<td><input class="cal-input" type="number" step="any" data-idx="${i}" placeholder="—"></td>`;
    calRows.appendChild(tr);
  });
}

function openCalModal() {
  renderCalRows();
  calStatus.textContent = '';
  calModal.hidden = false;
}
function closeCalModal() { calModal.hidden = true; }

function applyCalibration() {
  let count = 0;
  calModal.querySelectorAll('.cal-input').forEach(inp => {
    const v = parseFloat(inp.value);
    if (!Number.isNaN(v)) {
      const i = +inp.dataset.idx;
      SENSORS[i].value = v;
      document.getElementById('calVal' + i).textContent = v.toFixed(SENSORS[i].dp) + ' ' + SENSORS[i].unit;
      inp.value = '';
      count++;
    }
  });
  calStatus.textContent = count
    ? `${count} sensor${count > 1 ? 's' : ''} calibrated.`
    : 'No values entered.';
}

document.getElementById('calSet').addEventListener('click', applyCalibration);
document.getElementById('calClose').addEventListener('click', closeCalModal);
calModal.addEventListener('click', e => { if (e.target === calModal) closeCalModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !calModal.hidden) closeCalModal(); });

/* =====================================================================
   Wire up + boot
   ===================================================================== */
el.startBtn.addEventListener('click', startTest);
el.stopBtn.addEventListener('click', () => stopTest('manual'));
el.resetBtn.addEventListener('click', () => resetRun(true));

setInterval(() => { el.clock.textContent = fmtClock(new Date()); }, 1000);
el.clock.textContent = fmtClock(new Date());

applyProfile('A');
setStatus('idle');
