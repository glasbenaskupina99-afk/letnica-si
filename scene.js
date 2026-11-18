// ============================================================================
// LETNICA.SI — KINEMATOGRAFSKI 60FPS POLET SKOZI ČAS (Canvas renderer)
// HiDPI platno · večplastna paralaksa · warp zvezde · velikanske letnice stoletij
// · prehodi obdobij z naslovno karto · vzpon/pristanek z vzmetjo · zlati polet
// ============================================================================

const PREFERS_REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const LANDMARKS = [
  { year: 14, name: "Rimska Emona", type: "emona", h: 50 },
  { year: 394, name: "Bitka pri Mrzli reki", type: "claustra", h: 34 },
  { year: 623, name: "Karantanija · Knežji kamen", type: "karantanija", h: 38 },
  { year: 973, name: "Brižinski spomeniki", type: "brizinski", h: 40 },
  { year: 1165, name: "Blejski otok", type: "bled", h: 58 },
  { year: 1436, name: "Celjski grofje", type: "celje", h: 78 },
  { year: 1550, name: "Trubarjev Katekizem", type: "trubar", h: 46 },
  { year: 1689, name: "Valvasorjeva Slava", type: "valvasor", h: 56 },
  { year: 1846, name: "Južna železnica", type: "train", h: 48 },
  { year: 1895, name: "Aljažev stolp", type: "aljaz", h: 82 },
  { year: 1945, name: "Plečnikovo Tromostovje", type: "plecnik", h: 40 },
  { year: 1991, name: "Samostojna Slovenija", type: "slovenija91", h: 76 },
  { year: 2026, name: "CILJ · SEDANJOST", type: "portal2026", h: 92 }
];

const ERA_GATES = [
  { year: 500, code: "II", name: "SREDNJI VEK" },
  { year: 1450, code: "III", name: "RENESANSA & REFORMACIJA" },
  { year: 1700, code: "IV", name: "INDUSTRIJSKA DOBA" },
  { year: 1945, code: "V", name: "SODOBNA DOBA" }
];

const SKY_PALETTES = [
  { year: 0, top: [22, 12, 42], mid: [104, 44, 74], bot: [238, 142, 76] }, // Antika — rimski zaton
  { year: 500, top: [8, 16, 44], mid: [34, 56, 112], bot: [124, 146, 196] }, // Srednji vek — mesečina
  { year: 1450, top: [32, 20, 64], mid: [118, 56, 104], bot: [242, 154, 94] }, // Renesansa — škrlatni sij
  { year: 1700, top: [18, 30, 44], mid: [62, 90, 104], bot: [206, 142, 92] }, // Industrija — dimna jantarna
  { year: 1945, top: [8, 26, 58], mid: [24, 94, 150], bot: [122, 200, 214] }, // Sodobnost — jasno modro
  { year: 2026, top: [18, 28, 74], mid: [70, 78, 172], bot: [255, 192, 112] } // 2026 — zlata ura
];
const GOLD_SKY = { top: [64, 30, 6], mid: [196, 112, 18], bot: [255, 218, 96] };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mixRGB = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const hash1 = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const ridge = (t) => {
  const v = 1 - Math.abs(Math.sin(t));
  return v * v;
};

const sfx = (name, ...args) => {
  const a = typeof window !== "undefined" && window.LetnicaAudio;
  if (a && typeof a[name] === "function") a[name](...args);
};

// Asimetrična krivulja poleta: kratek silovit pospešek, daljši mehak pristanek
function easeFlight(p) {
  const q = Math.pow(p, 0.82);
  return q < 0.5 ? 8 * q * q * q * q : 1 - Math.pow(-2 * q + 2, 4) / 2;
}

function eraNameForYear(y) {
  if (y < 500) return "I. Antika & Emona";
  if (y < 1450) return "II. Srednji vek & Karantanija";
  if (y < 1700) return "III. Reformacija & Barok";
  if (y < 1945) return "IV. Industrijska doba & Prebujanje";
  return "V. Sodobna Slovenija";
}

// ============================================================================
// ODOMETER (vrteče se številke letnice v kinematografskem napisu)
// ============================================================================
function buildOdometer(el, digits = 4) {
  if (!el) return;
  el.innerHTML = "";
  el.classList.add("odometer");
  el._cols = [];
  for (let i = 0; i < digits; i++) {
    const col = document.createElement("span");
    col.className = "odo-col";
    const strip = document.createElement("span");
    strip.className = "odo-strip";
    for (let d = 0; d <= 10; d++) {
      const cell = document.createElement("span");
      cell.textContent = d % 10;
      strip.appendChild(cell);
    }
    col.appendChild(strip);
    el.appendChild(col);
    el._cols.push({ col, strip });
  }
}

function setOdometer(el, value, speed = 0) {
  if (!el || !el._cols) return;
  const n = el._cols.length;
  const y = Math.max(0, value);
  for (let i = 0; i < n; i++) {
    const k = n - 1 - i; // k = 0 je enica (skrajno desno)
    const pow = Math.pow(10, k);
    let pos;
    if (k === 0) {
      pos = y % 10;
    } else {
      const d = Math.floor(y / pow) % 10;
      const r = y % pow;
      pos = d + Math.max(0, r - (pow - 1));
    }
    const { col, strip } = el._cols[i];
    strip.style.transform = `translateY(${-pos}em)`;
    // Vertikalni »motion blur« s sencami (brez CSS filtra, ki ustvari svetel okvir)
    const smear = k === 0 ? speed * 7 : k === 1 ? speed * 3.5 : 0;
    strip.style.textShadow =
      smear > 0.4
        ? `0 ${smear.toFixed(1)}px ${(smear * 0.9).toFixed(1)}px rgba(255,255,255,0.45), 0 ${(-smear).toFixed(1)}px ${(smear * 0.9).toFixed(1)}px rgba(255,255,255,0.45)`
        : "";
    strip.style.opacity = k <= 1 ? `${1 - speed * (k === 0 ? 0.35 : 0.15)}` : "";
    col.classList.toggle("lead", y < pow && k > 0);
  }
}

// ============================================================================
// RENDERER
// ============================================================================
class EralySceneRenderer {
  constructor(canvasId, isPreview = false) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
    this.isPreview = isPreview;

    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.sizeDirty = true;
    if (this.canvas && "ResizeObserver" in window) {
      new ResizeObserver(() => {
        this.sizeDirty = true;
      }).observe(this.canvas);
    }
    window.addEventListener("resize", () => {
      this.sizeDirty = true;
    });

    this.displayYear = isPreview ? 140 : 0;
    this.fromYear = 0;
    this.targetYear = 0;
    this.flightStart = 0;
    this.flightDuration = 2400;
    this.isFlying = false;
    this.flightKind = "normal"; // "normal" | "golden" | "stall"
    this.onArrive = null;
    this.suppressEvents = false;

    this.goldenGlow = 0;
    this.goldenTarget = 0;
    this.speed = 0; // 0..1 zglajena hitrost
    this.rawSpeed = 0;
    this.flightBlend = 0; // letterbox 0..1
    this.shipDX = 0;
    this.shipPitch = 0;
    this.stallDip = 0;
    this.shake = 0;
    this.flash = 0;
    this.flashColor = [255, 255, 255];
    this.eraBanner = null;
    this.tension = 0; // 0..1 napetost zadnjih sekund odštevalnika
    this.landmarkPulse = {};
    this.arrival = null;
    this.propellerAngle = 0;

    this.particles = [];
    this.speedLines = [];
    this.clouds = [];
    this.stars = [];
    this.lastNow = performance.now();
    this.lastEraName = "";

    this.dom = isPreview
      ? null
      : {
          year: document.getElementById("journey-current-year"),
          fill: document.getElementById("journey-track-fill"),
          eraPill: document.getElementById("stage-era-pill"),
          odo: document.getElementById("fco-year-counter"),
          gain: document.getElementById("fco-gain"),
          stage: document.getElementById("eraly-stage-card"),
          viewport: document.getElementById("eraly-canvas-viewport"),
          overlay: document.getElementById("flight-cinematic-overlay"),
          badge: document.getElementById("fco-badge")
        };
    if (this.dom && this.dom.odo) buildOdometer(this.dom.odo, 4);

    this.cloudSprites = { cool: [], warm: [] };
    this.initAtmosphere();
  }

  // --------------------------------------------------------------------------
  // INICIALIZACIJA
  // --------------------------------------------------------------------------
  initAtmosphere() {
    for (let i = 0; i < 70; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random() * 0.62,
        r: 0.4 + Math.random() * 1.3,
        tw: Math.random() * Math.PI * 2,
        depth: 0.02 + Math.random() * 0.06
      });
    }

    const makeSprite = (seed, tint) => {
      const c = document.createElement("canvas");
      c.width = 240;
      c.height = 100;
      const g = c.getContext("2d");
      const puffs = 6 + Math.floor(hash1(seed) * 4);
      for (let i = 0; i < puffs; i++) {
        const px = 40 + (i / (puffs - 1)) * 160 + (hash1(seed + i * 3.1) - 0.5) * 20;
        const r = 16 + hash1(seed + i * 7.7) * 22 * Math.sin((i / (puffs - 1)) * Math.PI + 0.2);
        const py = 68 - r * 0.55;
        const grad = g.createRadialGradient(px - r * 0.25, py - r * 0.35, r * 0.1, px, py, r);
        grad.addColorStop(0, rgba(tint.hi, 1));
        grad.addColorStop(0.7, rgba(tint.mid, 0.95));
        grad.addColorStop(1, rgba(tint.lo, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(px, py, Math.max(6, r), 0, Math.PI * 2);
        g.fill();
      }
      const base = g.createLinearGradient(0, 50, 0, 80);
      base.addColorStop(0, rgba(tint.mid, 0.8));
      base.addColorStop(1, rgba(tint.lo, 0));
      g.fillStyle = base;
      g.beginPath();
      g.ellipse(120, 70, 92, 10, 0, 0, Math.PI * 2);
      g.fill();
      return c;
    };

    const cool = { hi: [255, 255, 255], mid: [214, 224, 240], lo: [150, 165, 196] };
    const warm = { hi: [255, 246, 226], mid: [255, 206, 150], lo: [214, 120, 90] };
    for (let i = 0; i < 5; i++) {
      this.cloudSprites.cool.push(makeSprite(i * 13.37 + 1, cool));
      this.cloudSprites.warm.push(makeSprite(i * 13.37 + 1, warm));
    }

    for (let i = 0; i < 16; i++) {
      const depth = i < 11 ? 0.08 + Math.random() * 0.3 : 0.75 + Math.random() * 0.4;
      this.clouds.push({
        x: Math.random(),
        y: depth > 0.7 ? 0.05 + Math.random() * 0.25 : 0.06 + Math.random() * 0.42,
        scale: depth > 0.7 ? 0.9 + Math.random() * 0.6 : 0.35 + depth * 0.9 + Math.random() * 0.25,
        depth,
        sprite: i % 5,
        drift: 0.004 + Math.random() * 0.006
      });
    }
    this.clouds.sort((a, b) => a.depth - b.depth);
  }

  resize() {
    if (!this.canvas) return false;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 10 || h < 10) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w !== this.W || h !== this.H || dpr !== this.dpr) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.W = w;
      this.H = h;
      this.dpr = dpr;
    }
    this.sizeDirty = false;
    return true;
  }

  get pxPerYear() {
    return clamp(this.W / 300, 2.0, 3.2);
  }
  get shipBaseX() {
    if (this.isPreview) return this.W * (this.W >= 760 ? 0.72 : 0.64);
    return this.W * (this.W < 520 ? 0.24 : 0.3);
  }
  get groundY() {
    return this.H - (this.isPreview ? 48 : 34);
  }
  get shipScale() {
    if (this.isPreview) return 0.78;
    return this.W < 520 ? 0.78 : 1;
  }

  // --------------------------------------------------------------------------
  // JAVNI API
  // --------------------------------------------------------------------------
  setInstantYear(yearVal, isGolden = false) {
    this.displayYear = yearVal;
    this.fromYear = yearVal;
    this.targetYear = yearVal;
    this.isFlying = false;
    this.onArrive = null;
    this.flightKind = "normal";
    this.goldenGlow = isGolden ? 1 : 0;
    this.goldenTarget = isGolden ? 1 : 0;
    this.eraBanner = null;
    this.arrival = null;
    this.particles.length = 0;
    this.speedLines.length = 0;
    this.speed = 0;
    this.flightBlend = 0;
    this.flash = 0;
    if (this.dom) {
      this.dom.viewport && this.dom.viewport.classList.remove("is-flying");
      this.dom.overlay && this.dom.overlay.classList.remove("visible", "landed");
      this.dom.stage && this.dom.stage.classList.remove("golden-flight", "stall-flight");
    }
    this.updateDomCounters(yearVal, 0);
  }

  triggerFlight(fromYear, toYear, { isExact = false, isTimeout = false, duration = null, silentBadge = false } = {}, onArrive = null) {
    const gain = Math.max(0, toYear - fromYear);
    this.fromYear = fromYear;
    this.targetYear = toYear;
    this.displayYear = fromYear;
    this.flightStart = performance.now();
    this.isFlying = true;
    this.onArrive = onArrive;
    this.suppressEvents = false;
    this.arrival = null;
    this.flightKind = isTimeout || gain <= 0 ? "stall" : isExact ? "golden" : "normal";

    this.tension = 0;
    if (PREFERS_REDUCED_MOTION) {
      this.flightDuration = 650;
    } else if (duration) {
      this.flightDuration = duration;
    } else if (this.flightKind === "stall") {
      this.flightDuration = 1500;
    } else {
      this.flightDuration = 1900 + 1500 * clamp(gain / 700, 0, 1);
    }

    if (this.flightKind === "golden") {
      this.goldenTarget = 1;
      this.flash = 0.7;
      this.flashColor = [255, 236, 170];
      this.shake = 0.6;
    } else {
      this.goldenTarget = 0;
    }
    if (this.flightKind === "stall") {
      this.flash = 0.35;
      this.flashColor = [239, 68, 68];
      this.shake = 0.8;
    }

    if (!this.isPreview) sfx("launch", this.flightKind);

    const d = this.dom;
    if (!d || !d.overlay || silentBadge) return;
    d.stage.classList.toggle("golden-flight", this.flightKind === "golden");
    d.stage.classList.toggle("stall-flight", this.flightKind === "stall");
    d.viewport.classList.add("is-flying");
    d.overlay.classList.remove("landed", "kind-golden", "kind-stall", "kind-normal");
    d.overlay.classList.add("visible", `kind-${this.flightKind}`);

    if (isTimeout) {
      d.badge.textContent = "⏰ Čas je potekel · motor je ugasnil";
    } else if (this.flightKind === "stall") {
      d.badge.textContent = "💨 Preveliko odstopanje · časoplov obstane";
    } else if (this.flightKind === "golden") {
      d.badge.textContent = "⚡ Zlati polet · zadetek v nulo";
    } else {
      d.badge.textContent = "🛸 Polet skozi zgodovino";
    }
    this.updateDomCounters(fromYear, 0);
  }

  skipFlight() {
    if (!this.isFlying) return false;
    this.suppressEvents = true;
    this.flightStart = performance.now() - this.flightDuration;
    return true;
  }

  // --------------------------------------------------------------------------
  // DOM ŠTEVCI (HUD, ravnilo, odometer)
  // --------------------------------------------------------------------------
  updateDomCounters(yearVal, speed = 0) {
    const d = this.dom;
    if (!d) return;
    const rounded = Math.round(yearVal);
    if (d.year) d.year.textContent = `${rounded}`;
    if (d.fill) d.fill.style.width = `${clamp((yearVal / 2026) * 100, 0, 100)}%`;
    if (d.eraPill) {
      const name = `${eraNameForYear(rounded)} · Leto ${rounded}`;
      if (name !== this.lastEraName) {
        d.eraPill.textContent = name;
        this.lastEraName = name;
      }
    }
    if (d.odo) setOdometer(d.odo, this.isFlying ? yearVal : rounded, speed);
    if (d.gain) {
      if (this.flightKind === "stall") {
        d.gain.textContent = "+0 let";
      } else {
        const g = Math.max(0, Math.round(yearVal - this.fromYear));
        d.gain.textContent = `+${g} ${typeof formatYearsWord === "function" ? formatYearsWord(g) : "let"}`;
      }
    }
  }

  // --------------------------------------------------------------------------
  // GLAVNA ZANKA
  // --------------------------------------------------------------------------
  step(now) {
    if (!this.ctx) return;
    if (this.sizeDirty && !this.resize()) return;

    const dt = clamp(now - this.lastNow, 1, 50);
    this.lastNow = now;
    const prevYear = this.displayYear;
    let raw = 0;

    if (this.isPreview) {
      this.displayYear = (this.displayYear + dt * 0.065) % 2026;
      raw = 0.42;
      if (this.displayYear > prevYear) this.detectCrossings(prevYear, this.displayYear, now);
    } else if (this.isFlying) {
      const p = clamp((now - this.flightStart) / this.flightDuration, 0, 1);
      if (this.flightKind !== "stall") {
        this.displayYear = lerp(this.fromYear, this.targetYear, easeFlight(p));
        const pxPerMs = ((this.displayYear - prevYear) * this.pxPerYear) / dt;
        raw = clamp(pxPerMs / 1.5, 0, 1);
        if (!this.suppressEvents) this.detectCrossings(prevYear, this.displayYear, now);
      } else {
        // Motor ugaša: pokašljevanje, padec in ponovna stabilizacija
        this.stallDip = Math.sin(p * Math.PI) * 18;
        if (Math.random() < 0.08) this.shake = Math.max(this.shake, 0.35);
      }
      if (p >= 1) this.land(now);
    }

    const k = 1 - Math.exp(-dt / 140);
    const accel = raw - this.speed;
    this.speed = lerp(this.speed, raw, k);
    this.rawSpeed = raw;

    const flyingVisual = this.isFlying && this.flightKind !== "stall";
    this.flightBlend = lerp(this.flightBlend, flyingVisual ? 1 : 0, 1 - Math.exp(-dt / 260));
    this.shipDX = lerp(this.shipDX, this.speed * 38 * this.shipScale, 1 - Math.exp(-dt / 220));
    const pitchTarget = this.flightKind === "stall" && this.isFlying
      ? 0.12 * Math.sin((now - this.flightStart) * 0.012)
      : clamp(accel * 0.9, -0.16, 0.16) + this.speed * 0.03;
    this.shipPitch = lerp(this.shipPitch, pitchTarget, 1 - Math.exp(-dt / 120));
    if (!this.isFlying) this.stallDip = lerp(this.stallDip, 0, 1 - Math.exp(-dt / 200));

    const gTarget = this.goldenTarget > 0 ? 1 : this.displayYear >= 2026 && !this.isPreview ? 1 : 0;
    if (this.goldenGlow < gTarget) this.goldenGlow = Math.min(1, this.goldenGlow + dt / 380);
    else if (this.goldenGlow > gTarget) this.goldenGlow = Math.max(0, this.goldenGlow - dt / 2600);

    this.flash *= Math.exp(-dt / 230);
    this.shake *= Math.exp(-dt / 210);
    this.propellerAngle += dt * (this.isFlying && this.flightKind === "stall" ? 0.008 : 0.02 + this.speed * 0.06);

    if (this.isFlying && !this.isPreview) {
      this.updateDomCounters(this.displayYear, this.speed);
      sfx("speed", this.flightKind === "stall" ? 0.15 : this.speed);
    }

    this.spawnEffects(now, dt);
    this.drawFrame(now, dt);
  }

  detectCrossings(fromY, toY, now) {
    LANDMARKS.forEach((lm) => {
      if (fromY < lm.year && toY >= lm.year) {
        this.landmarkPulse[lm.type] = now;
        if (!this.isPreview) sfx("landmark");
      }
    });
    if (this.isPreview) return;
    ERA_GATES.forEach((g) => {
      if (fromY < g.year && toY >= g.year) {
        this.eraBanner = { code: g.code, name: g.name, t0: now };
        sfx("eraGate");
        this.flash = Math.max(this.flash, 0.45);
        this.flashColor = this.flightKind === "golden" ? [255, 230, 160] : [190, 230, 255];
        this.shake = Math.max(this.shake, 0.5);
      }
    });
  }

  land(now) {
    this.isFlying = false;
    this.displayYear = this.targetYear;
    const kind = this.flightKind;
    this.arrival = { t0: now, kind };
    this.goldenTarget = 0;
    if (!this.isPreview) sfx("land", kind);

    const sx = this.shipBaseX + this.shipDX;
    const sy = this.shipY(now);
    if (kind === "golden") {
      this.flash = 0.85;
      this.flashColor = [255, 226, 140];
      this.shake = 0.9;
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * Math.PI * 2;
        const v = 1.6 + Math.random() * 3.2;
        this.particles.push({
          x: sx, y: sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          size: 1.5 + Math.random() * 2.5, life: 1, decay: 0.012 + Math.random() * 0.012,
          color: Math.random() > 0.4 ? [253, 224, 71] : [255, 255, 255], glow: true, gravity: 0.03
        });
      }
    } else if (kind === "normal") {
      this.shake = Math.max(this.shake, 0.3);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        this.particles.push({
          x: sx, y: sy + 10, vx: Math.cos(a) * 1.6, vy: Math.sin(a) * 0.8,
          size: 2 + Math.random() * 2, life: 0.8, decay: 0.02,
          color: [134, 239, 172], glow: true, gravity: 0
        });
      }
    }

    if (this.dom) {
      this.updateDomCounters(this.targetYear, 0);
      if (this.dom.overlay) this.dom.overlay.classList.add("landed");
      setTimeout(() => {
        if (this.isFlying) return;
        this.dom.viewport && this.dom.viewport.classList.remove("is-flying");
        this.dom.overlay && this.dom.overlay.classList.remove("visible");
      }, 1100);
    }

    const cb = this.onArrive;
    this.onArrive = null;
    if (cb) setTimeout(cb, PREFERS_REDUCED_MOTION ? 0 : 160);
  }

  shipY(now) {
    const hover = Math.sin(now * 0.0021) * 4 + Math.sin(now * 0.0047) * 1.5;
    const lift = -this.speed * 10;
    const base = this.isPreview ? (this.W >= 760 ? 0.36 : 0.2) : 0.44;
    return this.H * base + hover + lift + this.stallDip;
  }

  // --------------------------------------------------------------------------
  // DELCI, HITROSTNE ČRTE
  // --------------------------------------------------------------------------
  spawnEffects(now, dt) {
    const s = this.shipScale;
    const sx = this.shipBaseX + this.shipDX;
    const sy = this.shipY(now);
    const nozzleX = sx - 30 * s;
    const nozzleY = sy + 27 * s;
    const f = dt / 16.67;

    if (this.isFlying && this.flightKind === "stall") {
      if (Math.random() < 0.22 * f) {
        this.particles.push({
          x: nozzleX, y: nozzleY, vx: -0.6 - Math.random(), vy: -0.4 - Math.random() * 0.5,
          size: 3 + Math.random() * 4, grow: 0.12, life: 0.7, decay: 0.012,
          color: [100, 116, 139], glow: false, gravity: -0.005
        });
      }
    } else if (this.speed > 0.04 || this.isPreview) {
      const golden = this.goldenGlow > 0.4;
      const count = Math.round((1 + this.speed * 3) * f * (golden ? 1.5 : 1));
      for (let i = 0; i < count; i++) {
        const col = golden
          ? Math.random() > 0.35 ? [253, 224, 71] : [255, 255, 255]
          : Math.random() > 0.45 ? [52, 211, 153] : [96, 165, 250];
        this.particles.push({
          x: nozzleX + (Math.random() - 0.5) * 4,
          y: nozzleY + (Math.random() - 0.5) * 5,
          vx: -(1.5 + this.speed * 9 + Math.random() * 2),
          vy: (Math.random() - 0.5) * 0.9,
          size: (golden ? 1.8 : 1.4) + Math.random() * 2.2,
          life: 1, decay: 0.022 + Math.random() * 0.02,
          color: col, glow: true, gravity: 0
        });
      }
    } else if (Math.random() < 0.05 * f) {
      // mirovanje: rahel dim iz dimnika
      this.particles.push({
        x: nozzleX, y: nozzleY - 2, vx: -0.3, vy: -0.35,
        size: 2, grow: 0.06, life: 0.4, decay: 0.006,
        color: [203, 213, 225], glow: false, gravity: 0
      });
    }

    if (this.speed > 0.22 && !PREFERS_REDUCED_MOTION && !this.isPreview) {
      const n = this.speed * 1.6 * f;
      for (let i = 0; i < Math.floor(n) + (Math.random() < n % 1 ? 1 : 0); i++) {
        this.speedLines.push({
          x: this.W + 40,
          y: 12 + Math.random() * (this.groundY - 20),
          len: 50 + Math.random() * 180 * this.speed,
          v: 18 + Math.random() * 26,
          a: 0.08 + Math.random() * 0.22 * this.speed
        });
      }
    }
    for (let i = this.speedLines.length - 1; i >= 0; i--) {
      const l = this.speedLines[i];
      l.x -= l.v * f * (0.4 + this.speed);
      if (l.x + l.len < -20) this.speedLines.splice(i, 1);
    }
    if (this.particles.length > 420) this.particles.splice(0, this.particles.length - 420);
  }

  // --------------------------------------------------------------------------
  // NEBO
  // --------------------------------------------------------------------------
  getSky(y) {
    let p1 = SKY_PALETTES[0];
    let p2 = SKY_PALETTES[SKY_PALETTES.length - 1];
    for (let i = 0; i < SKY_PALETTES.length - 1; i++) {
      if (y >= SKY_PALETTES[i].year && y <= SKY_PALETTES[i + 1].year) {
        p1 = SKY_PALETTES[i];
        p2 = SKY_PALETTES[i + 1];
        break;
      }
    }
    const t = smoothstep(0, 1, (y - p1.year) / Math.max(1, p2.year - p1.year));
    let top = mixRGB(p1.top, p2.top, t);
    let mid = mixRGB(p1.mid, p2.mid, t);
    let bot = mixRGB(p1.bot, p2.bot, t);
    const g = this.goldenGlow;
    if (g > 0.001) {
      top = mixRGB(top, GOLD_SKY.top, g);
      mid = mixRGB(mid, GOLD_SKY.mid, g);
      bot = mixRGB(bot, GOLD_SKY.bot, g);
    }
    return { top, mid, bot };
  }

  // --------------------------------------------------------------------------
  // IZRIS SLIČICE
  // --------------------------------------------------------------------------
  drawFrame(now, dt) {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    const gY = this.groundY;
    const ppy = this.pxPerYear;
    const worldPx = this.displayYear * ppy;
    const shipX = this.shipBaseX;
    const sky = this.getSky(this.displayYear);
    const g = this.goldenGlow;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // 1. Nebo
    const skyGrad = ctx.createLinearGradient(0, 0, 0, gY);
    skyGrad.addColorStop(0, rgba(sky.top));
    skyGrad.addColorStop(0.55, rgba(sky.mid));
    skyGrad.addColorStop(1, rgba(sky.bot));
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // 2. Zvezde (ob hitrosti se raztegnejo v warp črte)
    const lum = sky.top[0] * 0.3 + sky.top[1] * 0.59 + sky.top[2] * 0.11;
    const starVis = clamp(1.25 - lum / 45, 0.12, 1) * (1 - g * 0.7);
    if (starVis > 0.02) {
      const span = W * 1.4;
      const stretch = this.speed * 70;
      ctx.lineCap = "round";
      this.stars.forEach((st) => {
        const sx = (((st.x * span - worldPx * st.depth) % span) + span) % span - W * 0.2;
        const sy = st.y * gY;
        const a = starVis * (0.35 + 0.45 * Math.sin(now * 0.0025 + st.tw) ** 2);
        if (stretch > 3) {
          ctx.strokeStyle = `rgba(255,255,255,${a})`;
          ctx.lineWidth = st.r;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + stretch * (st.depth / 0.08), sy);
          ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(255,255,255,${a})`;
          ctx.beginPath();
          ctx.arc(sx, sy, st.r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // 3. Sonce / zlati disk z žarki
    this.drawSun(ctx, now, sky);

    // ---- KAMERA (tresenje + rahel zoom-out ob hitrosti) ----
    ctx.save();
    const shakeAmt = PREFERS_REDUCED_MOTION ? 0 : this.shake * 5;
    const zoom = 1 - this.speed * 0.06;
    const cx = shipX;
    const cy = H * 0.6;
    ctx.translate(cx + (Math.random() - 0.5) * shakeAmt, cy + (Math.random() - 0.5) * shakeAmt);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    const mL = -W * 0.12;
    const mR = W * 1.12;

    // 4. Velikanske letnice stoletij v ozadju — stoletja letijo mimo
    this.drawCenturyGhosts(ctx, shipX, gY, ppy);

    // 5. Oddaljeni oblaki
    this.drawClouds(ctx, now, worldPx, sky, false);

    // 6. Gorske plasti (Julijske Alpe) z zračno perspektivo
    const farCol = mixRGB(mixRGB(sky.mid, sky.top, 0.35), [20, 26, 46], 0.35);
    this.drawRange(ctx, mL, mR, gY, worldPx * 0.12, farCol, sky.bot, 0.55, (x) =>
      34 + 46 * ridge(x * 0.0032 + 1.3) + 18 * ridge(x * 0.0107 + 4.1) + 6 * Math.sin(x * 0.05)
    , true);
    const midCol = mixRGB(sky.top, [12, 16, 30], 0.45);
    this.drawRange(ctx, mL, mR, gY, worldPx * 0.3, midCol, sky.bot, 0.3, (x) =>
      22 + 26 * ridge(x * 0.0049 + 2.7) + 9 * Math.sin(x * 0.019 + 0.7)
    , true);

    // 7. Vrata obdobij
    ERA_GATES.forEach((gate) => {
      const gx = shipX + (gate.year - this.displayYear) * ppy;
      if (gx > mL - 60 && gx < mR + 60) this.drawEraGate(ctx, gx, gY, gate, now);
    });

    // 8. Bližnji griči z gozdom
    const nearCol = mixRGB([9, 13, 24], sky.top, 0.22);
    this.drawHills(ctx, mL, mR, gY, worldPx * 0.62, nearCol, sky);

    // 9. Mejniki
    LANDMARKS.forEach((lm) => {
      const lx = shipX + (lm.year - this.displayYear) * ppy;
      if (lx > mL - 160 && lx < mR + 160) this.drawLandmark(ctx, lx, gY, lm, now, sky);
    });

    // 10. Tla in časovna tirnica
    this.drawGround(ctx, mL, mR, gY, ppy, shipX, sky);

    // 11. Senca časoplova
    const sY = this.shipY(now);
    const sxShip = shipX + this.shipDX;
    const alt = clamp((gY - sY) / H, 0.1, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.32 * (1 - alt * 0.6)})`;
    ctx.beginPath();
    ctx.ellipse(sxShip - 4, gY + 4, 44 * this.shipScale * (1.1 - alt * 0.5), 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 12. Delci in časoplov
    this.drawParticles(ctx, dt);
    this.drawArrivalRing(ctx, now, sxShip, sY);
    this.drawTimeAirship(ctx, now, sxShip, sY);

    // 13. Bližnji oblaki pred kamero
    this.drawClouds(ctx, now, worldPx, sky, true);

    // 14. Hitrostne črte
    if (this.speedLines.length) {
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      this.speedLines.forEach((l) => {
        const grad = ctx.createLinearGradient(l.x, 0, l.x + l.len, 0);
        const c = g > 0.4 ? "253,230,138" : "220,240,255";
        grad.addColorStop(0, `rgba(${c},${l.a})`);
        grad.addColorStop(1, `rgba(${c},0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(l.x + l.len, l.y);
        ctx.stroke();
      });
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();
    // ---- KONEC KAMERE ----

    // 15. Naslovna karta obdobja
    this.drawEraBanner(ctx, now);

    // 16. Blisk
    if (this.flash > 0.01) {
      ctx.fillStyle = rgba(this.flashColor, this.flash * 0.55);
      ctx.fillRect(0, 0, W, H);
    }

    // 16b. Napetost zadnjih sekund: utripajoč rdeč rob
    if (this.tension > 0.01 && !this.isFlying) {
      const pulse = 0.55 + 0.45 * Math.sin(now * 0.012);
      const tg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      tg.addColorStop(0, "rgba(239,68,68,0)");
      tg.addColorStop(1, `rgba(239,68,68,${0.6 * this.tension * pulse})`);
      ctx.fillStyle = tg;
      ctx.fillRect(0, 0, W, H);
    }

    // 17. Vinjeta
    const vig = ctx.createRadialGradient(W * 0.45, H * 0.5, Math.min(W, H) * 0.35, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, `rgba(0,0,0,${0.28 + this.speed * 0.32})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    // 18. Kinematografski letterbox
    if (this.flightBlend > 0.01 && !this.isPreview) {
      const bh = 15 * this.flightBlend;
      ctx.fillStyle = "#020409";
      ctx.fillRect(0, 0, W, bh);
      ctx.fillRect(0, H - bh, W, bh);
    }
  }

  drawSun(ctx, now, sky) {
    const W = this.W;
    const H = this.H;
    const g = this.goldenGlow;
    const sx = W * 0.8;
    const sy = H * 0.3 + (1 - this.displayYear / 2026) * H * 0.08;
    const r = 18 + g * 10;

    if (g > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(sx, sy);
      ctx.rotate(now * 0.00012);
      const rays = 14;
      for (let i = 0; i < rays; i++) {
        ctx.rotate((Math.PI * 2) / rays);
        const grad = ctx.createLinearGradient(0, 0, 0, -H * 1.1);
        grad.addColorStop(0, `rgba(255,230,140,${0.22 * g})`);
        grad.addColorStop(1, "rgba(255,230,140,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-5, 0);
        ctx.lineTo(-26, -H * 1.1);
        ctx.lineTo(26, -H * 1.1);
        ctx.lineTo(5, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    const halo = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 4.2);
    halo.addColorStop(0, rgba(mixRGB(sky.bot, [255, 250, 220], 0.6), 0.55));
    halo.addColorStop(1, rgba(sky.bot, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 4.2, 0, Math.PI * 2);
    ctx.fill();

    const disc = ctx.createRadialGradient(sx - r * 0.3, sy - r * 0.3, 1, sx, sy, r);
    disc.addColorStop(0, "rgba(255,255,240,1)");
    disc.addColorStop(1, rgba(mixRGB(sky.bot, [255, 236, 170], 0.5), 0.95));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawCenturyGhosts(ctx, shipX, gY, ppy) {
    const startC = Math.floor((this.displayYear - (shipX / ppy) * 1.2) / 100) * 100;
    const endC = this.displayYear + (this.W / ppy) * 1.2;
    const fontSize = Math.round(clamp(this.H * 0.36, 52, 110));
    ctx.save();
    ctx.font = `900 ${fontSize}px Fraunces, Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let c = Math.max(0, startC); c <= Math.min(2000, endC); c += 100) {
      const x = shipX + (c - this.displayYear) * ppy;
      const near = 1 - smoothstep(0, this.W * 0.5, Math.abs(x - this.W * 0.5));
      const a = (0.045 + this.speed * 0.16) * (0.5 + 0.5 * near);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillText(`${c}`, x, gY - 62);
    }
    ctx.restore();
  }

  drawClouds(ctx, now, worldPx, sky, foreground) {
    const W = this.W;
    const span = W + 520;
    const warm = clamp((sky.bot[0] - sky.bot[2]) / 140, 0, 1);
    this.clouds.forEach((cl) => {
      const fg = cl.depth > 0.7;
      if (fg !== foreground) return;
      const w = 240 * cl.scale;
      const h = 100 * cl.scale;
      const x = ((((cl.x * span - worldPx * cl.depth - now * cl.drift * cl.depth * 6) % span) + span) % span) - 260;
      const y = cl.y * this.groundY;
      const baseA = fg ? 0.16 + this.speed * 0.12 : 0.18 + cl.depth * 0.55;
      if (warm < 0.98) {
        ctx.globalAlpha = baseA * (1 - warm);
        ctx.drawImage(this.cloudSprites.cool[cl.sprite], x, y, w, h);
      }
      if (warm > 0.02) {
        ctx.globalAlpha = baseA * warm;
        ctx.drawImage(this.cloudSprites.warm[cl.sprite], x, y, w, h);
      }
    });
    ctx.globalAlpha = 1;
  }

  drawRange(ctx, x0, x1, gY, scroll, col, hazeCol, hazeAmt, heightFn, rim) {
    const step = 6;
    ctx.beginPath();
    ctx.moveTo(x0, gY + 2);
    const pts = [];
    for (let x = x0; x <= x1 + step; x += step) {
      const y = gY - heightFn(x + scroll);
      pts.push([x, y]);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(x1 + step, gY + 2);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, gY - 110, 0, gY);
    grad.addColorStop(0, rgba(col));
    grad.addColorStop(1, rgba(mixRGB(col, hazeCol, hazeAmt)));
    ctx.fillStyle = grad;
    ctx.fill();

    if (rim) {
      ctx.strokeStyle = rgba(mixRGB(hazeCol, [255, 255, 255], 0.3), 0.22);
      ctx.lineWidth = 1;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }

  drawHills(ctx, x0, x1, gY, scroll, col, sky) {
    const hFn = (x) => 10 + 9 * Math.sin(x * 0.0081 + 0.4) + 5 * Math.sin(x * 0.023 + 2.2);
    this.drawRange(ctx, x0, x1, gY, scroll, col, sky.bot, 0.12, hFn, false);
    // Smreke
    const spacing = 15;
    const startI = Math.floor((x0 + scroll) / spacing);
    const endI = Math.ceil((x1 + scroll) / spacing);
    ctx.fillStyle = rgba(mixRGB(col, [0, 0, 0], 0.25));
    for (let i = startI; i <= endI; i++) {
      const r = hash1(i * 1.731);
      if (r < 0.45) continue;
      const wx = i * spacing + hash1(i * 9.1) * 8;
      const x = wx - scroll;
      const baseY = gY - hFn(wx) + 3;
      const th = 8 + r * 14;
      const tw = th * 0.42;
      ctx.beginPath();
      ctx.moveTo(x, baseY - th);
      ctx.lineTo(x + tw, baseY);
      ctx.lineTo(x - tw, baseY);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawEraGate(ctx, x, gY, gate, now) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const pulse = 0.75 + 0.25 * Math.sin(now * 0.004 + gate.year);
    const beam = ctx.createLinearGradient(x - 26, 0, x + 26, 0);
    beam.addColorStop(0, "rgba(56,189,248,0)");
    beam.addColorStop(0.5, `rgba(125,211,252,${0.22 * pulse})`);
    beam.addColorStop(1, "rgba(56,189,248,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(x - 26, 0, 52, gY);

    const core = ctx.createLinearGradient(0, 0, 0, gY);
    core.addColorStop(0, "rgba(186,230,253,0)");
    core.addColorStop(0.6, `rgba(186,230,253,${0.5 * pulse})`);
    core.addColorStop(1, `rgba(224,242,254,${0.9 * pulse})`);
    ctx.fillStyle = core;
    ctx.fillRect(x - 1, 0, 2, gY);

    // Rune / iskre, ki se dvigajo ob vratih
    for (let i = 0; i < 6; i++) {
      const t = ((now * 0.0004 + i / 6 + gate.year * 0.01) % 1);
      const py = gY - t * (gY - 20);
      ctx.fillStyle = `rgba(186,230,253,${(1 - t) * 0.7})`;
      ctx.beginPath();
      ctx.arc(x + Math.sin(t * 12 + i) * 7, py, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Napisna tablica
    const label = `${gate.code}. ${gate.name}`;
    ctx.font = "800 9.5px Inter, system-ui, sans-serif";
    const tw = ctx.measureText(label).width + 16;
    const ty = this.isPreview ? 10 : 62;
    ctx.fillStyle = "rgba(8,14,28,0.78)";
    ctx.strokeStyle = "rgba(125,211,252,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, ty, tw, 17, 8.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e0f2fe";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x, ty + 9);
    ctx.textBaseline = "alphabetic";
  }

  drawGround(ctx, x0, x1, gY, ppy, shipX, sky) {
    const H = this.H;
    const grd = ctx.createLinearGradient(0, gY, 0, H);
    grd.addColorStop(0, "#0a1020");
    grd.addColorStop(1, "#04070f");
    ctx.fillStyle = grd;
    ctx.fillRect(x0, gY, x1 - x0, H - gY + 40);

    // Tirnica časa (z odsevom neba)
    const g = this.goldenGlow;
    const railCol = g > 0.3 ? [251, 191, 36] : mixRGB([56, 189, 248], sky.bot, 0.25);
    ctx.fillStyle = rgba(railCol, 0.16 + this.speed * 0.2);
    ctx.fillRect(x0, gY - 2, x1 - x0, 5);
    ctx.fillStyle = rgba(mixRGB(railCol, [255, 255, 255], 0.4), 0.95);
    ctx.fillRect(x0, gY - 0.5, x1 - x0, 1.5);

    // Napredek: zlato obarvan del tirnice za časoplovom
    if (!this.isPreview) {
      ctx.fillStyle = "rgba(251,191,36,0.55)";
      const startX = shipX + (0 - this.displayYear) * ppy;
      ctx.fillRect(Math.max(x0, startX), gY - 0.5, Math.max(0, shipX - Math.max(x0, startX)), 1.5);
    }

    // Oznake desetletij / stoletij
    const y0 = Math.max(0, Math.floor((this.displayYear - (shipX - x0) / ppy) / 10) * 10);
    const y1 = Math.min(2030, this.displayYear + (x1 - shipX) / ppy);
    ctx.textAlign = "center";
    ctx.font = "700 9px Inter, system-ui, sans-serif";
    for (let yr = y0; yr <= y1; yr += 10) {
      const tx = shipX + (yr - this.displayYear) * ppy;
      const isC = yr % 100 === 0;
      const isH = yr % 50 === 0;
      const len = isC ? 9 : isH ? 6 : 3;
      const near = 1 - smoothstep(0, 140, Math.abs(tx - shipX));
      ctx.fillStyle = isC
        ? `rgba(226,232,240,${0.7 + near * 0.3})`
        : `rgba(148,163,184,${isH ? 0.55 : 0.3})`;
      ctx.fillRect(tx - 0.5, gY + 2, isC ? 1.5 : 1, len);
      if (isH && !this.isPreview) {
        ctx.fillStyle = isC ? `rgba(226,232,240,${0.75 + near * 0.25})` : "rgba(148,163,184,0.5)";
        ctx.fillText(`${yr}`, tx, gY + 22);
      }
    }

    // Kazalec pod časoplovom (trenutno leto)
    if (!this.isPreview) {
      ctx.fillStyle = g > 0.3 ? "#fbbf24" : "#fde68a";
      ctx.beginPath();
      ctx.moveTo(shipX, gY + 1);
      ctx.lineTo(shipX - 4, gY + 8);
      ctx.lineTo(shipX + 4, gY + 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  // --------------------------------------------------------------------------
  // MEJNIKI SLOVENSKE ZGODOVINE
  // --------------------------------------------------------------------------
  drawLandmark(ctx, x, gY, lm, now, sky) {
    const body = rgba(mixRGB([14, 20, 36], sky.top, 0.2));
    const rim = rgba(mixRGB(sky.bot, [255, 255, 255], 0.25), 0.55);
    const win = "rgba(255,200,110,0.95)";
    const stone = rgba(mixRGB([30, 38, 58], sky.bot, 0.12));

    ctx.save();
    ctx.translate(x, gY);
    ctx.fillStyle = body;
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1;
    const fillStroke = () => {
      ctx.fill();
      ctx.stroke();
    };

    switch (lm.type) {
      case "emona": {
        ctx.beginPath();
        ctx.moveTo(-30, 0);
        ctx.lineTo(-30, -38);
        ctx.lineTo(30, -38);
        ctx.lineTo(30, 0);
        ctx.lineTo(11, 0);
        ctx.lineTo(11, -18);
        ctx.arc(0, -18, 11, 0, Math.PI, true);
        ctx.lineTo(-11, 0);
        ctx.closePath();
        fillStroke();
        ctx.fillStyle = stone;
        ctx.fillRect(-34, -46, 68, 8);
        ctx.strokeRect(-34, -46, 68, 8);
        for (const cx of [-24, 24]) {
          ctx.fillRect(cx - 2.5, -38, 5, 38);
        }
        break;
      }
      case "claustra": {
        ctx.beginPath();
        ctx.moveTo(-44, 0);
        ctx.lineTo(-44, -24);
        for (let i = -44; i < 44; i += 11) {
          ctx.lineTo(i, -30);
          ctx.lineTo(i + 5.5, -30);
          ctx.lineTo(i + 5.5, -24);
          ctx.lineTo(i + 11, -24);
        }
        ctx.lineTo(44, 0);
        ctx.closePath();
        fillStroke();
        ctx.fillRect(-10, -36, 20, 36);
        ctx.strokeRect(-10, -36, 20, 36);
        break;
      }
      case "karantanija": {
        ctx.fillStyle = stone;
        ctx.beginPath();
        ctx.roundRect(-22, -10, 44, 10, 2);
        fillStroke();
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(-9, -10);
        ctx.lineTo(-7, -28);
        ctx.lineTo(7, -28);
        ctx.lineTo(9, -10);
        ctx.closePath();
        fillStroke();
        ctx.beginPath();
        ctx.moveTo(-16, -28);
        ctx.quadraticCurveTo(-18, -38, -10, -36);
        ctx.lineTo(10, -36);
        ctx.quadraticCurveTo(18, -38, 16, -28);
        ctx.closePath();
        fillStroke();
        break;
      }
      case "brizinski": {
        ctx.fillStyle = stone;
        ctx.fillRect(-3, -18, 6, 18);
        ctx.beginPath();
        ctx.moveTo(-26, -18);
        ctx.quadraticCurveTo(-13, -26, 0, -20);
        ctx.quadraticCurveTo(13, -26, 26, -18);
        ctx.lineTo(24, -38);
        ctx.quadraticCurveTo(12, -44, 0, -38);
        ctx.quadraticCurveTo(-12, -44, -24, -38);
        ctx.closePath();
        ctx.fillStyle = "rgba(245,230,200,0.92)";
        fillStroke();
        ctx.strokeStyle = "rgba(90,60,30,0.6)";
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(-20, -34 + i * 4);
          ctx.lineTo(-5, -34 + i * 4);
          ctx.moveTo(5, -34 + i * 4);
          ctx.lineTo(20, -34 + i * 4);
          ctx.stroke();
        }
        break;
      }
      case "bled": {
        const water = ctx.createLinearGradient(0, -6, 0, 2);
        water.addColorStop(0, rgba(mixRGB(sky.bot, [40, 120, 160], 0.5), 0.75));
        water.addColorStop(1, "rgba(10,30,50,0.9)");
        ctx.fillStyle = water;
        ctx.beginPath();
        ctx.ellipse(0, -1, 54, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.ellipse(0, -4, 30, 10, 0, Math.PI, 0);
        fillStroke();
        ctx.fillRect(-14, -24, 20, 14);
        ctx.strokeRect(-14, -24, 20, 14);
        ctx.beginPath();
        ctx.moveTo(-16, -24);
        ctx.lineTo(-4, -32);
        ctx.lineTo(8, -24);
        ctx.closePath();
        fillStroke();
        ctx.fillRect(8, -44, 7, 34);
        ctx.strokeRect(8, -44, 7, 34);
        ctx.beginPath();
        ctx.moveTo(7, -44);
        ctx.lineTo(11.5, -58);
        ctx.lineTo(16, -44);
        ctx.closePath();
        fillStroke();
        ctx.fillStyle = win;
        ctx.fillRect(-8, -19, 3, 4);
        ctx.fillRect(10.5, -38, 2, 3);
        break;
      }
      case "celje": {
        ctx.beginPath();
        ctx.moveTo(-36, 0);
        ctx.lineTo(-30, -14);
        ctx.lineTo(30, -14);
        ctx.lineTo(36, 0);
        ctx.closePath();
        ctx.fillStyle = stone;
        fillStroke();
        ctx.fillStyle = body;
        ctx.fillRect(-26, -36, 52, 22);
        ctx.strokeRect(-26, -36, 52, 22);
        ctx.fillRect(-30, -60, 16, 46);
        ctx.strokeRect(-30, -60, 16, 46);
        ctx.fillRect(14, -52, 14, 38);
        ctx.strokeRect(14, -52, 14, 38);
        for (const [tx, ty, tw] of [[-30, -60, 16], [14, -52, 14], [-26, -36, 52]]) {
          for (let i = 0; i < tw; i += 5) ctx.fillRect(tx + i, ty - 4, 3, 4);
        }
        ctx.fillStyle = win;
        ctx.fillRect(-24, -50, 3, 5);
        ctx.fillRect(19, -42, 3, 5);
        ctx.fillRect(-6, -30, 3, 4);
        ctx.fillRect(4, -30, 3, 4);
        // Tri zlate zvezde Celjskih
        ctx.fillStyle = "#fbbf24";
        ctx.shadowColor = "rgba(251,191,36,0.9)";
        ctx.shadowBlur = 8;
        for (const [sx, sy] of [[-8, -70], [8, -70], [0, -80]]) this.starPath(ctx, sx, sy, 4, 1.8);
        ctx.shadowBlur = 0;
        break;
      }
      case "trubar": {
        // Tiskarska stiskalnica + odprta knjiga
        ctx.fillRect(-22, -40, 5, 40);
        ctx.fillRect(17, -40, 5, 40);
        ctx.fillRect(-24, -44, 48, 6);
        ctx.strokeRect(-24, -44, 48, 6);
        ctx.fillRect(-2, -38, 4, 14);
        ctx.fillRect(-14, -24, 28, 5);
        ctx.fillStyle = stone;
        ctx.fillRect(-20, -12, 40, 12);
        ctx.strokeRect(-20, -12, 40, 12);
        ctx.fillStyle = "rgba(245,230,200,0.92)";
        ctx.fillRect(-12, -17, 24, 5);
        break;
      }
      case "valvasor": {
        ctx.fillRect(-28, -40, 56, 40);
        ctx.strokeRect(-28, -40, 56, 40);
        for (const cx of [-28, 28]) {
          ctx.beginPath();
          ctx.ellipse(cx, -22, 8, 26, 0, Math.PI, 0);
          ctx.fillRect(cx - 8, -22, 16, 22);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx - 9, -46);
          ctx.lineTo(cx, -58);
          ctx.lineTo(cx + 9, -46);
          ctx.closePath();
          fillStroke();
        }
        ctx.beginPath();
        ctx.moveTo(-22, -40);
        ctx.lineTo(0, -52);
        ctx.lineTo(22, -40);
        ctx.closePath();
        fillStroke();
        ctx.fillStyle = win;
        for (let i = -16; i <= 12; i += 9) {
          ctx.fillRect(i, -32, 3, 5);
          ctx.fillRect(i, -20, 3, 5);
        }
        break;
      }
      case "train": {
        // Viadukt + parna lokomotiva z dimom
        ctx.fillStyle = stone;
        ctx.beginPath();
        ctx.moveTo(-50, 0);
        ctx.lineTo(-50, -22);
        ctx.lineTo(50, -22);
        ctx.lineTo(50, 0);
        for (let ax = 30; ax >= -30; ax -= 30) {
          ctx.lineTo(ax + 10, 0);
          ctx.arc(ax, 0, 10, 0, Math.PI, true);
        }
        ctx.lineTo(-50, 0);
        ctx.closePath();
        fillStroke();
        ctx.fillStyle = body;
        ctx.fillRect(-20, -38, 30, 14);
        ctx.strokeRect(-20, -38, 30, 14);
        ctx.fillRect(10, -44, 14, 20);
        ctx.strokeRect(10, -44, 14, 20);
        ctx.fillRect(-16, -46, 5, 8);
        ctx.fillStyle = win;
        ctx.fillRect(14, -40, 6, 5);
        ctx.fillStyle = "#94a3b8";
        for (const wx of [-14, -2, 16]) {
          ctx.beginPath();
          ctx.arc(wx, -24, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < 4; i++) {
          const t = ((now * 0.0006 + i * 0.25) % 1);
          ctx.fillStyle = `rgba(203,213,225,${0.45 * (1 - t)})`;
          ctx.beginPath();
          ctx.arc(-13.5 - t * 26, -50 - t * 22, 3 + t * 7, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "aljaz": {
        // Triglav s snežno kapo in Aljaževim stolpom
        ctx.beginPath();
        ctx.moveTo(-58, 0);
        ctx.lineTo(-34, -38);
        ctx.lineTo(-24, -32);
        ctx.lineTo(0, -72);
        ctx.lineTo(20, -44);
        ctx.lineTo(30, -50);
        ctx.lineTo(58, 0);
        ctx.closePath();
        fillStroke();
        ctx.fillStyle = "rgba(241,245,249,0.92)";
        ctx.beginPath();
        ctx.moveTo(0, -72);
        ctx.lineTo(-12, -52);
        ctx.lineTo(-5, -55);
        ctx.lineTo(0, -50);
        ctx.lineTo(6, -56);
        ctx.lineTo(12, -54);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#cbd5e1";
        ctx.fillRect(-3, -82, 6, 10);
        ctx.beginPath();
        ctx.moveTo(-5, -82);
        ctx.lineTo(0, -88);
        ctx.lineTo(5, -82);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(0, -95, 7, 4);
        ctx.fillRect(0, -95, 1, 8);
        break;
      }
      case "plecnik": {
        // Tromostovje z balustrado in svetilkami
        ctx.fillStyle = stone;
        ctx.beginPath();
        ctx.moveTo(-54, 0);
        ctx.lineTo(-54, -16);
        ctx.lineTo(54, -16);
        ctx.lineTo(54, 0);
        ctx.lineTo(26, 0);
        ctx.quadraticCurveTo(0, -12, -26, 0);
        ctx.closePath();
        fillStroke();
        ctx.fillStyle = body;
        for (let bx = -50; bx <= 50; bx += 6) ctx.fillRect(bx, -24, 2.5, 8);
        ctx.fillRect(-54, -26, 108, 3);
        for (const lx of [-40, 0, 40]) {
          ctx.fillRect(lx - 1, -40, 2, 14);
          ctx.fillStyle = win;
          ctx.shadowColor = "rgba(255,200,110,0.9)";
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(lx, -42, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = body;
        }
        break;
      }
      case "slovenija91": {
        ctx.fillStyle = "#cbd5e1";
        ctx.fillRect(-1.5, -76, 3, 76);
        const wave = (t) => Math.sin(now * 0.006 + t * 5) * 3;
        const fw = 40;
        const fh = 24;
        const bands = [[255, 255, 255], [0, 82, 180], [237, 28, 36]];
        bands.forEach((c, bi) => {
          ctx.fillStyle = rgba(c);
          ctx.beginPath();
          const yA = -74 + (bi * fh) / 3;
          const yB = yA + fh / 3;
          ctx.moveTo(1.5, yA);
          for (let i = 0; i <= 10; i++) ctx.lineTo(1.5 + (fw * i) / 10, yA + wave(i / 10) * (i / 10));
          for (let i = 10; i >= 0; i--) ctx.lineTo(1.5 + (fw * i) / 10, yB + wave(i / 10) * (i / 10));
          ctx.closePath();
          ctx.fill();
        });
        // Grb (poenostavljen ščit s Triglavom)
        ctx.fillStyle = "#0052b4";
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(6, -72);
        ctx.lineTo(16, -72);
        ctx.lineTo(16, -64);
        ctx.quadraticCurveTo(11, -59, 6, -64);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(7, -64);
        ctx.lineTo(11, -69);
        ctx.lineTo(15, -64);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = stone;
        ctx.fillRect(-10, -4, 20, 4);
        break;
      }
      case "portal2026": {
        ctx.globalCompositeOperation = "lighter";
        const cy = -46;
        const halo = ctx.createRadialGradient(0, cy, 10, 0, cy, 70);
        halo.addColorStop(0, "rgba(251,191,36,0.45)");
        halo.addColorStop(1, "rgba(251,191,36,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, cy, 70, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 3; i++) {
          ctx.strokeStyle = `rgba(253,224,71,${0.9 - i * 0.25})`;
          ctx.lineWidth = 3 - i;
          ctx.beginPath();
          const r = 32 + i * 5;
          const a0 = now * 0.002 * (i % 2 ? -1 : 1) + i;
          ctx.ellipse(0, cy, r * 0.75, r, 0, a0, a0 + Math.PI * 1.6);
          ctx.stroke();
        }
        for (let i = 0; i < 10; i++) {
          const a = now * 0.003 + (i / 10) * Math.PI * 2;
          ctx.fillStyle = "rgba(255,255,255,0.8)";
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 22, cy + Math.sin(a) * 30, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
        break;
      }
      default: {
        ctx.fillRect(-14, -40, 28, 40);
      }
    }
    ctx.restore();

    this.drawLandmarkLabel(ctx, x, gY, lm, now);
  }

  starPath(ctx, x, y, R, r) {
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? R : r;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }

  drawLandmarkLabel(ctx, x, gY, lm, now) {
    const pulseT0 = this.landmarkPulse[lm.type];
    const age = pulseT0 ? now - pulseT0 : Infinity;
    const pulse = age < 1400 ? 1 - age / 1400 : 0;
    const shipX = this.shipBaseX + this.shipDX;
    const dist = Math.abs(x - shipX);
    let a = (0.4 + 0.6 * smoothstep(40, 140, dist)) * (1 - this.speed * 0.55);
    a = Math.max(a, pulse);
    if (a < 0.03) return;

    const isGoal = lm.type === "portal2026";
    const topY = gY - lm.h - (this.isPreview ? 8 : 14);
    const yearTxt = isGoal ? "🎯 2026" : `${lm.year}`;
    const nameTxt = lm.name;
    const scale = 1 + pulse * 0.18;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x, topY);
    ctx.scale(scale, scale);
    ctx.font = "800 10px Inter, system-ui, sans-serif";
    const yw = ctx.measureText(yearTxt).width;
    ctx.font = "600 10px Inter, system-ui, sans-serif";
    const nw = this.isPreview ? 0 : ctx.measureText(nameTxt).width;
    const pad = 7;
    const gap = nw ? 6 : 0;
    const total = yw + nw + gap + pad * 2;

    ctx.fillStyle = isGoal ? "rgba(251,191,36,0.95)" : "rgba(8,13,26,0.82)";
    ctx.strokeStyle = isGoal ? "#fef08a" : pulse > 0 ? `rgba(253,224,71,${0.5 + pulse * 0.5})` : "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-total / 2, -16, total, 17, 8.5);
    ctx.fill();
    ctx.stroke();

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = "800 10px Inter, system-ui, sans-serif";
    ctx.fillStyle = isGoal ? "#0b0f17" : "#fbbf24";
    ctx.fillText(yearTxt, -total / 2 + pad, -7.5);
    if (nw) {
      ctx.font = "600 10px Inter, system-ui, sans-serif";
      ctx.fillStyle = isGoal ? "#0b0f17" : "#e2e8f0";
      ctx.fillText(nameTxt, -total / 2 + pad + yw + gap, -7.5);
    }
    ctx.restore();

    if (pulse > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(253,224,71,${pulse * 0.8})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, gY, 20 + (1 - pulse) * 60, 4 + (1 - pulse) * 10, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --------------------------------------------------------------------------
  // DELCI
  // --------------------------------------------------------------------------
  drawParticles(ctx, dt) {
    const f = dt / 16.67;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * f;
      p.y += p.vy * f;
      p.vy += (p.gravity || 0) * f;
      p.vx *= Math.pow(0.985, f);
      if (p.grow) p.size += p.grow * f;
      p.life -= p.decay * f;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      if (p.glow) {
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = rgba(p.color, p.life * 0.25);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(p.color, p.life);
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = rgba(p.color, p.life * 0.6);
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  drawArrivalRing(ctx, now, x, y) {
    if (!this.arrival) return;
    const age = now - this.arrival.t0;
    if (age > 900) {
      this.arrival = null;
      return;
    }
    const t = age / 900;
    const kind = this.arrival.kind;
    const col = kind === "golden" ? [253, 224, 71] : kind === "stall" ? [248, 113, 113] : [110, 231, 183];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba(col, (1 - t) * 0.85);
    ctx.lineWidth = 3 * (1 - t) + 0.5;
    ctx.beginPath();
    ctx.arc(x, y, 20 + t * (kind === "golden" ? 140 : 80), 0, Math.PI * 2);
    ctx.stroke();
    if (kind === "golden") {
      ctx.strokeStyle = rgba([255, 255, 255], (1 - t) * 0.6);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 10 + t * 90, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // ČASOPLOV
  // --------------------------------------------------------------------------
  drawTimeAirship(ctx, now, x, y) {
    const s = this.shipScale;
    const g = this.goldenGlow > 0.3;
    const stalling = this.isFlying && this.flightKind === "stall";
    const jitter = stalling ? (Math.random() - 0.5) * 1.6 : 0;

    ctx.save();
    ctx.translate(x + jitter, y);
    ctx.rotate(this.shipPitch);
    ctx.scale(s, s);

    // Topel sij svetilke pod gondolo
    const lamp = ctx.createRadialGradient(0, 34, 2, 0, 34, 48);
    lamp.addColorStop(0, g ? "rgba(253,224,71,0.35)" : "rgba(255,200,120,0.22)");
    lamp.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = lamp;
    ctx.beginPath();
    ctx.arc(0, 34, 48, 0, Math.PI * 2);
    ctx.fill();

    // Plamen potisnika
    if ((this.speed > 0.05 && !stalling) || this.isPreview) {
      const flen = 10 + this.speed * 46 + Math.random() * 7;
      ctx.globalCompositeOperation = "lighter";
      const fg = ctx.createLinearGradient(-30, 0, -30 - flen, 0);
      fg.addColorStop(0, "rgba(255,255,255,0.95)");
      fg.addColorStop(0.3, g ? "rgba(253,224,71,0.9)" : "rgba(52,211,153,0.85)");
      fg.addColorStop(1, g ? "rgba(245,158,11,0)" : "rgba(59,130,246,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(-29, 23);
      ctx.quadraticCurveTo(-30 - flen * 0.6, 21, -30 - flen, 27);
      ctx.quadraticCurveTo(-30 - flen * 0.6, 33, -29, 31);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }

    // Repne plavuti
    const finGrad = ctx.createLinearGradient(-60, -26, -40, 18);
    finGrad.addColorStop(0, g ? "#fde68a" : "#f59e0b");
    finGrad.addColorStop(1, g ? "#b45309" : "#9a3412");
    ctx.fillStyle = finGrad;
    ctx.strokeStyle = "rgba(15,23,42,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-38, -16);
    ctx.lineTo(-62, -30);
    ctx.quadraticCurveTo(-60, -16, -50, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-38, 2);
    ctx.lineTo(-62, 16);
    ctx.quadraticCurveTo(-60, 2, -50, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Vrvi
    ctx.strokeStyle = "rgba(203,213,225,0.85)";
    ctx.lineWidth = 1;
    for (const rx of [-22, -8, 8, 22]) {
      ctx.beginPath();
      ctx.moveTo(rx, 10);
      ctx.lineTo(rx * 0.72, 22);
      ctx.stroke();
    }

    // Balon (trup)
    const hull = ctx.createLinearGradient(0, -30, 0, 14);
    if (g) {
      hull.addColorStop(0, "#fff7cc");
      hull.addColorStop(0.45, "#fbbf24");
      hull.addColorStop(1, "#92400e");
    } else {
      hull.addColorStop(0, "#ffffff");
      hull.addColorStop(0.5, "#dbe3ee");
      hull.addColorStop(1, "#7c8aa3");
    }
    ctx.fillStyle = hull;
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(0, -8, 50, 21, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.clip();
    // Rebra
    ctx.strokeStyle = g ? "rgba(146,64,14,0.35)" : "rgba(51,65,85,0.25)";
    ctx.lineWidth = 1;
    for (const rx of [-30, -12, 6, 24]) {
      ctx.beginPath();
      ctx.ellipse(rx, -8, 6, 21, 0, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    }
    // Pas
    ctx.fillStyle = g ? "#b45309" : "#d97706";
    ctx.fillRect(-52, -11, 104, 6);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(-52, -11, 104, 1.2);
    // Odsev
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.ellipse(-8, -21, 28, 4.5, -0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.ellipse(0, -8, 50, 21, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Nosna kapa
    ctx.fillStyle = g ? "#fde047" : "#f59e0b";
    ctx.beginPath();
    ctx.arc(48, -8, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Tri zvezde na pasu
    ctx.fillStyle = "#fef08a";
    for (const sx of [-14, 0, 14]) this.starPath(ctx, sx, -8, 3, 1.3);

    // Gondola
    const gond = ctx.createLinearGradient(0, 21, 0, 35);
    gond.addColorStop(0, "#92400e");
    gond.addColorStop(1, "#451a03");
    ctx.fillStyle = gond;
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.roundRect(-23, 21, 46, 13, [3, 3, 7, 7]);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,210,120,0.95)";
    for (const wx of [-13, -3]) {
      ctx.beginPath();
      ctx.arc(wx, 28, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Popotnik s šalom
    ctx.fillStyle = "#10b981";
    ctx.fillRect(8, 15, 7, 7);
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(11.5, 12, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.ellipse(11.5, 9, 4.6, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(9.2, 5.5, 4.6, 3.5);
    // šal plapola glede na hitrost
    const scarfLen = 8 + this.speed * 16;
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.moveTo(9, 15.5);
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      ctx.lineTo(9 - t * scarfLen, 15.5 + Math.sin(now * 0.02 + t * 6) * (1 + this.speed * 2.5) * t + t * (1 - this.speed) * 5);
    }
    for (let i = 6; i >= 0; i--) {
      const t = i / 6;
      ctx.lineTo(9 - t * scarfLen, 18 + Math.sin(now * 0.02 + t * 6) * (1 + this.speed * 2.5) * t + t * (1 - this.speed) * 5);
    }
    ctx.closePath();
    ctx.fill();
    // daljnogled
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(14, 13);
    ctx.lineTo(21, 11);
    ctx.stroke();

    // Propeler (disk zabrisa ob hitrosti)
    ctx.translate(-27, 27);
    const spin = Math.cos(this.propellerAngle);
    if (this.speed > 0.15 && !stalling) {
      ctx.fillStyle = `rgba(226,232,240,${0.12 + this.speed * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 2.5, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, -spin * 11);
    ctx.lineTo(0, spin * 11);
    ctx.stroke();
    ctx.fillStyle = "#475569";
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // NASLOVNA KARTA OBDOBJA
  // --------------------------------------------------------------------------
  drawEraBanner(ctx, now) {
    const b = this.eraBanner;
    if (!b) return;
    const age = now - b.t0;
    const dur = 1700;
    if (age > dur) {
      this.eraBanner = null;
      return;
    }
    const inT = smoothstep(0, 220, age);
    const outT = 1 - smoothstep(dur - 380, dur, age);
    const a = inT * outT;
    const W = this.W;
    const cy = this.H * 0.68;

    ctx.save();
    const band = ctx.createLinearGradient(0, 0, W, 0);
    band.addColorStop(0, "rgba(2,6,16,0)");
    band.addColorStop(0.5, `rgba(2,6,16,${0.72 * a})`);
    band.addColorStop(1, "rgba(2,6,16,0)");
    ctx.fillStyle = band;
    ctx.fillRect(0, cy - 26, W, 52);

    // Svetlobni sweep
    const sweepX = lerp(-W * 0.2, W * 1.2, smoothstep(0, 900, age));
    const sweep = ctx.createLinearGradient(sweepX - 80, 0, sweepX + 80, 0);
    sweep.addColorStop(0, "rgba(186,230,253,0)");
    sweep.addColorStop(0.5, `rgba(186,230,253,${0.7 * a})`);
    sweep.addColorStop(1, "rgba(186,230,253,0)");
    ctx.fillStyle = sweep;
    ctx.fillRect(0, cy - 26, W, 1.2);
    ctx.fillRect(0, cy + 25, W, 1.2);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = a;
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "800 9.5px Inter, system-ui, sans-serif";
    ctx.fillText(`VSTOP V OBDOBJE ${b.code}`.split("").join(String.fromCharCode(8202)), W / 2, cy - 11);
    const spread = (1 - inT) * 8;
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${W < 520 ? 19 : 26}px Fraunces, Georgia, serif`;
    ctx.shadowColor = "rgba(125,211,252,0.8)";
    ctx.shadowBlur = 14;
    ctx.fillText(b.name, W / 2 + spread, cy + 8);
    ctx.restore();
  }
}
