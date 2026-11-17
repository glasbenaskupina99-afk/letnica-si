// ============================================================================
// LETNICA.SI — IGRALNI POGON + ERALY.IO 60FPS ANIMIRANI ČASOPLOV (0 ➔ 2026)
// ============================================================================

const STORAGE_KEY = "letnica_si_state_v2";
const EPOCH_START = new Date(2026, 9, 15);
const ROUND_TIME_LIMIT_MS = 20000; // 20 sekund na vprašanje

const state = {
  theme: "dark",
  view: "menu", // "menu" | "game" | "archive"
  mode: "daily", // "daily" | "freeplay"
  activeDateKey: null,
  activeDayNumber: 1,
  events: [],
  currentRound: 0, // 0..4
  guesses: [],
  roundSubmitted: false,
  freeplayEra: "all",
  journeyYear: 0,

  // 20-sekundni odštevalnik
  timerInterval: null,
  roundDeadline: 0,

  // Trajni podatki v localStorage
  dailyHistory: {},
  streak: 0,
  lastCompletedDate: null
};

// ============================================================================
// ERALY.IO ANIMIRANI POGON (ČASOPLOV, 5 ZGODOVINSKIH NEB IN SLOVENSKI MEJNIKI)
// ============================================================================
const LANDMARKS = [
  { year: 14, label: "14 · Rimska Emona", type: "emona" },
  { year: 394, label: "394 · Bitka pri Mrzli reki", type: "claustra" },
  { year: 623, label: "623 · Karantanija & Knežji kamen", type: "karantanija" },
  { year: 973, label: "973 · Brižinski spomeniki", type: "brizinski" },
  { year: 1165, label: "1165 · Samostani & Blejski otok", type: "bled" },
  { year: 1436, label: "1436 · Celjski grofje", type: "celje" },
  { year: 1550, label: "1550 · Trubarjev Katekizem", type: "trubar" },
  { year: 1689, label: "1689 · Valvasorjeva Slava", type: "valvasor" },
  { year: 1846, label: "1846 · Južna železnica", type: "train" },
  { year: 1895, label: "1895 · Aljažev stolp & Rusjan", type: "aljaz" },
  { year: 1945, label: "1945 · Plečnikova Ljubljana", type: "plecnik" },
  { year: 1991, label: "1991 · Samostojna Slovenija", type: "slovenija91" },
  { year: 2026, label: "🎯 LETO 2026 · SEDANJOST", type: "portal2026" }
];

const ERA_GATES = [
  { year: 500, name: "II. SREDNJI VEK" },
  { year: 1450, name: "III. RENESANSA & REFORMACIJA" },
  { year: 1700, name: "IV. INDUSTRIJSKA DOBA" },
  { year: 1945, name: "V. SODOBNA DOBA" },
  { year: 2026, name: "🎯 CILJ: LETO 2026" }
];

class EralySceneRenderer {
  constructor(canvasId, isPreview = false) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
    this.isPreview = isPreview;

    this.displayYear = isPreview ? 140 : 0;
    this.fromYear = 0;
    this.targetYear = 0;
    this.flightStartTime = 0;
    this.flightDuration = 2350;
    this.isFlying = false;
    this.goldenGlow = 0; // 0..1 (1 = Eraly Golden Sky ob točnem zadetku!)
    this.sputterMode = false;

    this.propellerAngle = 0;
    this.particles = [];
    this.clouds = [];
    this.stars = [];

    this.initAtmosphere();
  }

  initAtmosphere() {
    for (let i = 0; i < 48; i++) {
      this.stars.push({
        x: Math.random() * 1000,
        y: Math.random() * 115,
        r: 0.7 + Math.random() * 1.5,
        twinkle: Math.random() * Math.PI * 2
      });
    }
    for (let i = 0; i < 18; i++) {
      this.clouds.push({
        x: Math.random() * 1600,
        y: 18 + Math.random() * 88,
        w: 58 + Math.random() * 68,
        h: 16 + Math.random() * 14,
        speed: 0.15 + Math.random() * 0.25
      });
    }
  }

  setInstantYear(yearVal, isGolden = false) {
    this.displayYear = yearVal;
    this.fromYear = yearVal;
    this.targetYear = yearVal;
    this.isFlying = false;
    this.sputterMode = false;
    this.goldenGlow = isGolden ? 1 : 0;
    this.updateDomCounters(yearVal);
  }

  triggerFlight(fromYear, toYear, { isExact = false, isTimeout = false } = {}) {
    this.fromYear = fromYear;
    this.targetYear = toYear;
    this.flightStartTime = performance.now();
    this.isFlying = true;
    this.sputterMode = isTimeout || toYear <= fromYear;
    this.flightDuration = this.sputterMode ? 1200 : 2400;

    if (isExact) {
      this.goldenGlow = 1;
    }

    const stageCard = document.getElementById("eraly-stage-card");
    const viewport = document.getElementById("eraly-canvas-viewport");
    const overlay = document.getElementById("flight-cinematic-overlay");
    const badgeEl = document.getElementById("fco-badge");
    const gainEl = document.getElementById("fco-gain");

    if (stageCard && viewport && overlay) {
      stageCard.classList.toggle("golden-flight", isExact);
      viewport.classList.add("is-flying");
      overlay.classList.add("visible");

      const gain = Math.max(0, toYear - fromYear);
      if (isTimeout) {
        badgeEl.textContent = "⏰ POTEKEL ČAS (20 S)";
        gainEl.textContent = "ČASOPLOV OBSTANE (+0 LET)";
        gainEl.style.color = "#ef4444";
      } else if (isExact) {
        badgeEl.textContent = "⚡ ZLATI POLET — ZADETEK V NULO!";
        gainEl.textContent = `+${gain} LET POSPEŠKA`;
        gainEl.style.color = "#fbbf24";
      } else {
        badgeEl.textContent = "🛸 POLET SKOZI ZGODOVINO";
        gainEl.textContent = `+${gain} LET NAPREJ`;
        gainEl.style.color = "#34d399";
      }
    }
  }

  updateDomCounters(yearVal) {
    if (this.isPreview) return;
    const rounded = Math.round(yearVal);
    const currYearEl = document.getElementById("journey-current-year");
    const fillEl = document.getElementById("journey-track-fill");
    const eraPillEl = document.getElementById("stage-era-pill");
    const fcoCounter = document.getElementById("fco-year-counter");

    if (currYearEl) currYearEl.textContent = `${rounded}`;
    if (fcoCounter) fcoCounter.textContent = `LETO ${rounded}`;
    if (fillEl) {
      const pct = Math.max(0, Math.min(100, (rounded / 2026) * 100));
      fillEl.style.width = `${pct}%`;
    }
    if (eraPillEl) {
      eraPillEl.textContent = `${this.getEraNameForYear(rounded)} · Leto ${rounded}`;
    }
  }

  getEraNameForYear(y) {
    if (y < 500) return "I. Antika & Emona";
    if (y < 1450) return "II. Srednji vek & Karantanija";
    if (y < 1700) return "III. Reformacija & Barok";
    if (y < 1945) return "IV. Industrijska doba & Prebujanje";
    return "V. Sodobna Slovenija";
  }

  getSkyPalette(y) {
    // 5 barvnih palet neba po vzoru Eraly.io
    const palettes = [
      { year: 0, top: [26, 15, 38], mid: [98, 42, 58], bot: [214, 118, 56] },      // Antika
      { year: 500, top: [13, 25, 54], mid: [30, 62, 112], bot: [84, 130, 175] },   // Srednji vek
      { year: 1450, top: [30, 20, 56], mid: [92, 45, 98], bot: [204, 128, 60] },   // Zgodnji novi vek
      { year: 1700, top: [18, 33, 44], mid: [45, 82, 96], bot: [168, 108, 72] },   // Industrijska doba
      { year: 1945, top: [8, 26, 44], mid: [16, 76, 98], bot: [24, 175, 135] },    // Sodobna doba
      { year: 2026, top: [14, 34, 60], mid: [26, 110, 138], bot: [245, 185, 45] }  // 2026
    ];

    let p1 = palettes[0];
    let p2 = palettes[palettes.length - 1];
    for (let i = 0; i < palettes.length - 1; i++) {
      if (y >= palettes[i].year && y <= palettes[i + 1].year) {
        p1 = palettes[i];
        p2 = palettes[i + 1];
        break;
      }
    }

    const span = Math.max(1, p2.year - p1.year);
    const t = Math.max(0, Math.min(1, (y - p1.year) / span));

    const lerp = (a, b, f) => Math.round(a + (b - a) * f);
    const lerpArr = (c1, c2, f) => [
      lerp(c1[0], c2[0], f),
      lerp(c1[1], c2[1], f),
      lerp(c1[2], c2[2], f)
    ];

    let top = lerpArr(p1.top, p2.top, t);
    let mid = lerpArr(p1.mid, p2.mid, t);
    let bot = lerpArr(p1.bot, p2.bot, t);

    // Če je aktiviran Eraly Zlati polet (goldenGlow > 0), prelij nebo v zlato!
    if (this.goldenGlow > 0.01) {
      const gTop = [48, 28, 4];
      const gMid = [165, 94, 12];
      const gBot = [253, 208, 55];
      top = lerpArr(top, gTop, this.goldenGlow);
      mid = lerpArr(mid, gMid, this.goldenGlow);
      bot = lerpArr(bot, gBot, this.goldenGlow);
    }

    return {
      top: `rgb(${top.join(",")})`,
      mid: `rgb(${mid.join(",")})`,
      bot: `rgb(${bot.join(",")})`
    };
  }

  step(now) {
    if (!this.ctx || !this.canvas) return;

    // V predogledu menija naj časoplov nežno potuje od leta 0 do 2026
    if (this.isPreview) {
      this.displayYear = (this.displayYear + 1.15) % 2026;
      this.propellerAngle += 0.35;
      this.drawFrame(now, 0.55);
      return;
    }

    let flightSpeed = 0.08;
    if (this.isFlying) {
      const elapsed = now - this.flightStartTime;
      const progress = Math.min(1, elapsed / this.flightDuration);
      // Gladka S-krivulja pospeška in pristanka
      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      this.displayYear = this.fromYear + (this.targetYear - this.fromYear) * eased;
      this.updateDomCounters(this.displayYear);

      flightSpeed = this.sputterMode ? 0.05 : 0.85 * Math.sin(progress * Math.PI) + 0.2;

      // Ustvari delce za časoplovom med letom
      this.spawnFlightParticles(flightSpeed);

      if (progress >= 1) {
        this.isFlying = false;
        this.displayYear = this.targetYear;
        this.updateDomCounters(this.targetYear);

        setTimeout(() => {
          const viewport = document.getElementById("eraly-canvas-viewport");
          const overlay = document.getElementById("flight-cinematic-overlay");
          if (viewport) viewport.classList.remove("is-flying");
          if (overlay) overlay.classList.remove("visible");
        }, 650);
      }
    } else {
      // Po koncu zlatega poleta naj zlato nebo počasi zbledi, razen če smo na 2026
      if (this.goldenGlow > 0 && this.displayYear < 2026) {
        this.goldenGlow = Math.max(0, this.goldenGlow - 0.004);
      }
    }

    this.propellerAngle += this.isFlying && !this.sputterMode ? 0.65 : 0.18;
    this.drawFrame(now, flightSpeed);
  }

  spawnFlightParticles(flightSpeed) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const shipX = w * 0.28;
    const shipY = h * 0.42;

    if (this.sputterMode) {
      if (Math.random() < 0.35) {
        this.particles.push({
          x: shipX - 48,
          y: shipY + 14,
          vx: -1.2 - Math.random() * 1.5,
          vy: -0.6 - Math.random() * 0.8,
          size: 4 + Math.random() * 5,
          alpha: 0.75,
          color: "#64748b",
          type: "smoke"
        });
      }
      return;
    }

    const count = this.goldenGlow > 0.4 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: shipX - 52 + (Math.random() * 8 - 4),
        y: shipY + 12 + (Math.random() * 10 - 5),
        vx: -(3.2 + flightSpeed * 5 + Math.random() * 2.5),
        vy: (Math.random() - 0.5) * 1.4,
        size: this.goldenGlow > 0.4 ? 3.5 + Math.random() * 3.5 : 2.5 + Math.random() * 3,
        alpha: 1,
        color:
          this.goldenGlow > 0.4
            ? Math.random() > 0.3
              ? "#fde047"
              : "#f59e0b"
            : Math.random() > 0.4
            ? "#34d399"
            : "#60a5fa",
        type: "spark"
      });
    }
  }

  drawFrame(now, flightSpeed) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Pretvori leto (0..2026) v svetovno X koordinato (0..5400 px)
    const worldX = (this.displayYear / 2026) * 5400;
    const shipScreenX = w * 0.28;

    // 1. NEBO GLEDE NA ZGODOVINSKO OBDOBJE
    const sky = this.getSkyPalette(this.displayYear);
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, sky.top);
    skyGrad.addColorStop(0.58, sky.mid);
    skyGrad.addColorStop(1, sky.bot);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. ZVEZDE IN SONČNI SIJ
    ctx.save();
    this.stars.forEach((st) => {
      const sx = ((st.x - worldX * 0.05) % w + w) % w;
      const alpha = 0.25 + 0.35 * Math.sin(now * 0.003 + st.twinkle);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(sx, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // Sončni/zlati disk na obzorju
    const sunX = w * 0.76;
    const sunY = h * 0.34;
    const sunRadius = this.goldenGlow > 0.3 ? 44 : 30;
    const sunGrad = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, sunRadius * 2.1);
    sunGrad.addColorStop(0, this.goldenGlow > 0.3 ? "rgba(254, 240, 138, 0.95)" : "rgba(253, 224, 71, 0.7)");
    sunGrad.addColorStop(1, "rgba(253, 224, 71, 0)");
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunRadius * 2.1, 0, Math.PI * 2);
    ctx.fill();

    // 3. OBLAKI V PARALAKSI
    ctx.save();
    this.clouds.forEach((cl) => {
      const cx = ((cl.x - worldX * 0.22 - now * 0.01 * cl.speed) % (w + 180) + (w + 180)) % (w + 180) - 90;
      ctx.fillStyle =
        this.goldenGlow > 0.3
          ? "rgba(254, 243, 199, 0.22)"
          : "rgba(255, 255, 255, 0.13)";
      ctx.beginPath();
      ctx.roundRect(cx, cl.y, cl.w, cl.h, 12);
      ctx.fill();
    });
    ctx.restore();

    // 4. OZADJE: JULIJSKE ALPE IN SILHUETA TRIGLAVA (Paralaksa 0.35)
    this.drawAlpineSilhouette(ctx, w, h, worldX * 0.35);

    // 5. PREHODNA VRATA OBDOBIJ (ERA GATES)
    ERA_GATES.forEach((gate) => {
      const gx = shipScreenX + ((gate.year - this.displayYear) / 2026) * 5400;
      if (gx > -80 && gx < w + 80) {
        this.drawEraGate(ctx, gx, h, gate.name, gate.year === 2026);
      }
    });

    // 6. SLOVENSKI ZGODOVINSKI MEJNIKI NA TLEH (0 – 2026)
    const groundY = h - 26;
    LANDMARKS.forEach((lm) => {
      const lx = shipScreenX + ((lm.year - this.displayYear) / 2026) * 5400;
      if (lx > -140 && lx < w + 140) {
        this.drawLandmark(ctx, lx, groundY, lm);
      }
    });

    // Tla in tirnica časovne poti
    ctx.fillStyle = "#090f1c";
    ctx.fillRect(0, groundY, w, h - groundY);
    ctx.strokeStyle = this.goldenGlow > 0.3 ? "#fbbf24" : "#38bdf8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    // Desetletne oznake na tleh, ki drsijo pod časoplovom
    ctx.fillStyle = "rgba(148, 163, 184, 0.55)";
    ctx.font = "bold 9px Inter, sans-serif";
    const startTickYear = Math.max(0, Math.floor((this.displayYear - 180) / 50) * 50);
    const endTickYear = Math.min(2050, startTickYear + 450);
    for (let yTick = startTickYear; yTick <= endTickYear; yTick += 50) {
      const tx = shipScreenX + ((yTick - this.displayYear) / 2026) * 5400;
      if (tx >= 0 && tx <= w) {
        ctx.fillRect(tx, groundY, 1.5, 6);
        ctx.fillText(`${yTick}`, tx - 10, groundY + 17);
      }
    }

    // 7. DELCI ZA ČASOPLOVOM
    this.updateAndDrawParticles(ctx);

    // 8. GLAVNI ČASOPLOV (AIRSHIP) S POPOTNIKOM NA KROVU
    const hoverOffset = Math.sin(now * 0.0055) * 4.5;
    const pitchAngle = this.isFlying && !this.sputterMode ? 0.045 : 0;
    this.drawTimeAirship(ctx, shipScreenX, h * 0.41 + hoverOffset, pitchAngle, flightSpeed);
  }

  drawAlpineSilhouette(ctx, w, h, scrollX) {
    const baseH = h - 26;
    ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
    ctx.beginPath();
    ctx.moveTo(0, baseH);
    for (let x = 0; x <= w + 40; x += 40) {
      const worldPos = x + scrollX;
      const peak =
        Math.sin(worldPos * 0.006) * 28 +
        Math.cos(worldPos * 0.015) * 18 +
        42;
      ctx.lineTo(x, baseH - peak);
    }
    ctx.lineTo(w, baseH);
    ctx.closePath();
    ctx.fill();
  }

  drawEraGate(ctx, x, h, label, isGoal) {
    ctx.save();
    const grad = ctx.createLinearGradient(x, 0, x, h - 26);
    if (isGoal) {
      grad.addColorStop(0, "rgba(251, 191, 36, 0.05)");
      grad.addColorStop(0.5, "rgba(251, 191, 36, 0.55)");
      grad.addColorStop(1, "rgba(251, 191, 36, 0.9)");
    } else {
      grad.addColorStop(0, "rgba(56, 189, 248, 0)");
      grad.addColorStop(0.5, "rgba(56, 189, 248, 0.25)");
      grad.addColorStop(1, "rgba(56, 189, 248, 0.55)");
    }
    ctx.strokeStyle = grad;
    ctx.lineWidth = isGoal ? 4 : 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(x, 12);
    ctx.lineTo(x, h - 26);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = isGoal ? "#fbbf24" : "rgba(15, 23, 42, 0.85)";
    ctx.strokeStyle = isGoal ? "#fef08a" : "rgba(56, 189, 248, 0.5)";
    ctx.lineWidth = 1;
    const bw = isGoal ? 128 : 138;
    ctx.beginPath();
    ctx.roundRect(x - bw / 2, 12, bw, 18, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isGoal ? "#0b0f17" : "#e2e8f0";
    ctx.font = "bold 9.5px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x, 24);
    ctx.restore();
  }

  drawLandmark(ctx, x, groundY, lm) {
    ctx.save();
    ctx.fillStyle = "#1e293b";
    ctx.strokeStyle = "rgba(248, 250, 252, 0.3)";
    ctx.lineWidth = 1.2;

    switch (lm.type) {
      case "emona": {
        // Rimski slavolok in stebri Emone
        ctx.fillRect(x - 24, groundY - 38, 48, 38);
        ctx.clearRect(x - 10, groundY - 24, 20, 24);
        ctx.fillRect(x - 28, groundY - 44, 56, 6);
        break;
      }
      case "karantanija": {
        // Knežji kamen (jonski kapitel)
        ctx.fillRect(x - 14, groundY - 26, 28, 26);
        ctx.fillRect(x - 19, groundY - 32, 38, 6);
        break;
      }
      case "celje": {
        // Grad Celjskih grofov in 3 zlate zvezde
        ctx.fillRect(x - 26, groundY - 34, 52, 34);
        ctx.fillRect(x - 26, groundY - 52, 14, 18);
        ctx.fillRect(x + 12, groundY - 48, 14, 14);
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(x - 8, groundY - 60, 2.5, 0, Math.PI * 2);
        ctx.arc(x + 8, groundY - 60, 2.5, 0, Math.PI * 2);
        ctx.arc(x, groundY - 68, 2.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "train": {
        // Viadukt in parna lokomotiva Južne železnice
        ctx.fillRect(x - 32, groundY - 28, 64, 8);
        ctx.fillRect(x - 26, groundY - 20, 10, 20);
        ctx.fillRect(x - 4, groundY - 20, 10, 20);
        ctx.fillRect(x + 18, groundY - 20, 10, 20);
        break;
      }
      case "aljaz": {
        // Triglav in Aljažev stolp
        ctx.beginPath();
        ctx.moveTo(x - 38, groundY);
        ctx.lineTo(x - 16, groundY - 42);
        ctx.lineTo(x, groundY - 62);
        ctx.lineTo(x + 16, groundY - 42);
        ctx.lineTo(x + 38, groundY);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#94a3b8";
        ctx.fillRect(x - 3, groundY - 72, 6, 10);
        break;
      }
      case "portal2026": {
        // Zlati ciljni portal 2026
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, groundY - 35, 32, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      default: {
        // Zgodovinski stolp / obeležje
        ctx.fillRect(x - 14, groundY - 40, 28, 40);
        ctx.beginPath();
        ctx.moveTo(x - 16, groundY - 40);
        ctx.lineTo(x, groundY - 56);
        ctx.lineTo(x + 16, groundY - 40);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Napis mejnika
    ctx.fillStyle = lm.year === 2026 ? "#fbbf24" : "#cbd5e1";
    ctx.font = "bold 10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(lm.label, x, groundY - 76);
    ctx.restore();
  }

  updateAndDrawParticles(ctx) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= 0.024;

      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawTimeAirship(ctx, x, y, pitchAngle, flightSpeed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(pitchAngle);

    // 1. Plamen potisnika ob pospeševanju
    if ((this.isFlying && !this.sputterMode) || this.isPreview) {
      const flameLen = 18 + flightSpeed * 26 + Math.random() * 8;
      const flameGrad = ctx.createLinearGradient(-44, 14, -44 - flameLen, 14);
      flameGrad.addColorStop(0, "#ffffff");
      flameGrad.addColorStop(0.4, this.goldenGlow > 0.3 ? "#fbbf24" : "#34d399");
      flameGrad.addColorStop(1, "rgba(245, 158, 11, 0)");
      ctx.fillStyle = flameGrad;
      ctx.beginPath();
      ctx.moveTo(-42, 9);
      ctx.lineTo(-42 - flameLen, 14);
      ctx.lineTo(-42, 19);
      ctx.closePath();
      ctx.fill();
    }

    // 2. Zadnje krmilo / stabilizator
    ctx.fillStyle = "#b45309";
    ctx.beginPath();
    ctx.moveTo(-36, -12);
    ctx.lineTo(-54, -24);
    ctx.lineTo(-48, 0);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-36, 4);
    ctx.lineTo(-54, 15);
    ctx.lineTo(-48, -2);
    ctx.closePath();
    ctx.fill();

    // 3. Glavni balon časoplova (zračna ladja v slogu Eraly.io)
    const hullGrad = ctx.createLinearGradient(0, -28, 0, 14);
    if (this.goldenGlow > 0.3) {
      hullGrad.addColorStop(0, "#fef08a");
      hullGrad.addColorStop(0.55, "#f59e0b");
      hullGrad.addColorStop(1, "#92400e");
    } else {
      hullGrad.addColorStop(0, "#f8fafc");
      hullGrad.addColorStop(0.5, "#e2e8f0");
      hullGrad.addColorStop(1, "#94a3b8");
    }

    ctx.fillStyle = hullGrad;
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -6, 48, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Okrasni pas v barvah slovenske zgodovine / zlata
    ctx.fillStyle = this.goldenGlow > 0.3 ? "#b45309" : "#d97706";
    ctx.fillRect(-45, -9, 90, 6);

    // Tri zlate zvezde na trupu časoplova
    ctx.fillStyle = "#fbbf24";
    [-14, 0, 14].forEach((sx) => {
      ctx.beginPath();
      ctx.arc(sx, -16, 2.6, 0, Math.PI * 2);
      ctx.fill();
    });

    // 4. Vrvi med balonom in gondolo
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1.3;
    [-20, -6, 8, 22].forEach((rx) => {
      ctx.beginPath();
      ctx.moveTo(rx, 14);
      ctx.lineTo(rx * 0.75, 28);
      ctx.stroke();
    });

    // 5. Gondola časoplova
    ctx.fillStyle = "#78350f";
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-24, 26, 48, 14, 5);
    ctx.fill();
    ctx.stroke();

    // 6. Lik popotnika na krovu gondole (gleda naprej proti letu 2026!)
    // Glava popotnika
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(12, 19, 4.5, 0, Math.PI * 2);
    ctx.fill();
    // Trup in šal, ki plapola v vetru
    ctx.fillStyle = "#10b981";
    ctx.fillRect(9, 23, 6, 6);
    // Daljnogled / roka naprej
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(15, 21);
    ctx.lineTo(23, 19);
    ctx.stroke();

    // 7. Vrteči se propeler zadaj
    const bladeLen = Math.cos(this.propellerAngle) * 11;
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-42, 14 - bladeLen);
    ctx.lineTo(-42, 14 + bladeLen);
    ctx.stroke();

    ctx.restore();
  }
}

let gameScene = null;
let menuScene = null;

function startAnimationLoop() {
  function loop(now) {
    if (state.view === "menu" && menuScene) {
      menuScene.step(now);
    } else if (state.view === "game" && gameScene) {
      gameScene.step(now);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// ============================================================================
// POMOŽNE FUNKCIJE ZA DATUME IN DETERMINISTIČNO SEME (SEED)
// ============================================================================
function formatDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatSlovenianDate(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return `${d}. ${m}. ${y}`;
}

function getDayNumberFromDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const diffDays = Math.floor((target - EPOCH_START) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, diffDays);
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getDailyEventsForDateKey(dateKey) {
  const rng = seededRandom(hashString("LETNICA_SI_" + dateKey));
  const chosen = [];

  for (let eraId = 1; eraId <= 5; eraId++) {
    const pool = SLOVENIAN_EVENTS.filter((e) => e.era === eraId);
    const idx = Math.floor(rng() * pool.length);
    chosen.push(pool[idx]);
  }

  return chosen.sort((a, b) => a.year - b.year);
}

function getFreeplayEvents(eraFilter) {
  if (eraFilter === "all") {
    const chosen = [];
    for (let eraId = 1; eraId <= 5; eraId++) {
      const subPool = SLOVENIAN_EVENTS.filter((e) => e.era === eraId);
      const pick = subPool[Math.floor(Math.random() * subPool.length)];
      chosen.push(pick);
    }
    return chosen.sort((a, b) => a.year - b.year);
  }

  const pool = SLOVENIAN_EVENTS.filter((e) => String(e.era) === String(eraFilter));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 5);
}

// ============================================================================
// TOČKOVANJE IN IZRAČUN POLETA OD LETA 0 DO LETA 2026
// (Do leta 2026 priletiš ZGOLJ, če zadeneš vseh 5 letnic točno v nulo!)
// ============================================================================
function calculateScore(guessYear, actualYear, eraId) {
  const diff = Math.abs(guessYear - actualYear);
  if (diff === 0) {
    return { points: 1000, tier: "tier-perfect", emoji: "🎯" };
  }

  const scaleByEra = {
    1: 95,
    2: 45,
    3: 24,
    4: 15,
    5: 9
  };
  const halfLife = scaleByEra[eraId] || 25;

  const rawPoints = Math.round(1000 * Math.exp(-diff / halfLife));
  const points = Math.max(0, Math.min(985, rawPoints));

  let tier = "tier-miss";
  let emoji = "🔴";
  if (points >= 800) {
    tier = "tier-great";
    emoji = "🟢";
  } else if (points >= 500) {
    tier = "tier-good";
    emoji = "🟡";
  } else if (points >= 200) {
    tier = "tier-ok";
    emoji = "🟠";
  }

  return { points, tier, emoji };
}

function computeJourneyYearFromGuesses(guesses) {
  if (!guesses || guesses.length === 0) return 0;
  const totalPoints = guesses.reduce((sum, g) => sum + g.points, 0);
  const allFivePerfect =
    guesses.length === 5 && guesses.every((g) => !g.timedOut && g.diff === 0);

  if (allFivePerfect) {
    return 2026;
  }

  const calculated = Math.floor((totalPoints / 5000) * 2026);
  return Math.min(2025, calculated);
}

function getRankTitleByYear(reachedYear) {
  if (reachedYear === 2026) return "👑 Časovni mojster (Timekeeper) — Priletel si v leto 2026!";
  if (reachedYear >= 1991) return "🇸🇮 Kapitan sodobne Slovenije (1991–2025)";
  if (reachedYear >= 1848) return "🏛️ Navigator Pomladi narodov in moderne dobe";
  if (reachedYear >= 1550) return "📜 Kronist Trubarjeve in Valvasorjeve dobe";
  if (reachedYear >= 623) return "⚔️ Raziskovalec Karantanije in srednjega veka";
  return "🏺 Popotnik starega veka in Emone";
}

function formatYearsWord(n) {
  const absN = Math.abs(n);
  const mod100 = absN % 100;
  if (mod100 === 1) return "leto";
  if (mod100 === 2) return "leti";
  if (mod100 === 3 || mod100 === 4) return "leta";
  return "let";
}

// ============================================================================
// SHRANJEVANJE IN TEMA
// ============================================================================
function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.theme) state.theme = parsed.theme;
    if (parsed.dailyHistory) state.dailyHistory = parsed.dailyHistory;
    if (typeof parsed.streak === "number") state.streak = parsed.streak;
    if (parsed.lastCompletedDate) state.lastCompletedDate = parsed.lastCompletedDate;
  } catch (err) {
    console.warn("Napaka pri branju shranjenega stanja:", err);
  }
}

function savePersistedState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: state.theme,
        dailyHistory: state.dailyHistory,
        streak: state.streak,
        lastCompletedDate: state.lastCompletedDate
      })
    );
  } catch (err) {
    console.warn("Napaka pri shranjevanju stanja:", err);
  }
}

function applyTheme() {
  if (state.theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    document.getElementById("theme-icon").textContent = "🌙";
  } else {
    document.documentElement.removeAttribute("data-theme");
    document.getElementById("theme-icon").textContent = "☀️";
  }
}

function updateTopbarStreak() {
  document.getElementById("streak-val").textContent = state.streak;
}

// ============================================================================
// UPRAVLJANJE POGLEDOV (VSTOPNI MENI, IGRA, ARHIV)
// ============================================================================
function showMenuView() {
  stopRoundTimer();
  state.view = "menu";

  document.getElementById("menu-view").classList.add("visible");
  document.getElementById("game-view").classList.remove("visible");
  document.getElementById("archive-view").classList.remove("visible");

  renderMenuDashboard();
}

function renderMenuDashboard() {
  const entries = Object.values(state.dailyHistory);
  const played = entries.length;
  const bestYear =
    played > 0 ? Math.max(...entries.map((e) => e.reachedYear || 0)) : 0;

  document.getElementById("menu-best-year").textContent = `Leto ${bestYear}`;
  document.getElementById("menu-streak-val").textContent = `${state.streak} 🔥`;
  document.getElementById("menu-played-val").textContent = `${played}`;

  const todayKey = formatDateKey(new Date());
  const todayDayNum = getDayNumberFromDateKey(todayKey);
  const savedToday = state.dailyHistory[todayKey];

  const statusTag = document.getElementById("menu-daily-status-tag");
  const titleEl = document.getElementById("menu-daily-title");

  if (savedToday) {
    statusTag.textContent = `ODIGRANO (Leto ${savedToday.reachedYear})`;
    titleEl.textContent = `Poglej Dnevni izziv #${todayDayNum}`;
  } else {
    statusTag.textContent = `DNEVNI IZZIV #${todayDayNum}`;
    titleEl.textContent = `Začni Dnevni izziv (${formatSlovenianDate(todayKey)})`;
  }
}

function showArchiveView() {
  stopRoundTimer();
  state.view = "archive";

  document.getElementById("menu-view").classList.remove("visible");
  document.getElementById("game-view").classList.remove("visible");
  document.getElementById("archive-view").classList.add("visible");

  renderArchiveGrid();
}

function showGameView() {
  state.view = "game";
  document.getElementById("menu-view").classList.remove("visible");
  document.getElementById("archive-view").classList.remove("visible");
  document.getElementById("game-view").classList.add("visible");
}

// ============================================================================
// ZAGON DNEVNEGA IZZIVA IN PROSTE IGRE
// ============================================================================
function startDailyGame(dateKey = formatDateKey(new Date())) {
  stopRoundTimer();
  state.mode = "daily";
  state.activeDateKey = dateKey;
  state.activeDayNumber = getDayNumberFromDateKey(dateKey);
  state.events = getDailyEventsForDateKey(dateKey);

  const saved = state.dailyHistory[dateKey];
  if (saved && Array.isArray(saved.guesses) && saved.guesses.length === 5) {
    state.guesses = saved.guesses;
    state.currentRound = 4;
    state.roundSubmitted = true;
    state.journeyYear = saved.reachedYear ?? computeJourneyYearFromGuesses(saved.guesses);

    showGameView();
    if (gameScene) {
      gameScene.setInstantYear(state.journeyYear, state.journeyYear === 2026);
    }
    updateHud();
    renderSummary();
    return;
  }

  state.currentRound = 0;
  state.guesses = [];
  state.roundSubmitted = false;
  state.journeyYear = 0;

  showGameView();
  if (gameScene) gameScene.setInstantYear(0, false);
  updateHud();
  renderCurrentRound();
}

function startFreeplayGame() {
  stopRoundTimer();
  state.mode = "freeplay";
  state.activeDateKey = null;
  state.events = getFreeplayEvents(state.freeplayEra);
  state.currentRound = 0;
  state.guesses = [];
  state.roundSubmitted = false;
  state.journeyYear = 0;

  showGameView();
  if (gameScene) gameScene.setInstantYear(0, false);
  updateHud();
  renderCurrentRound();
}

// ============================================================================
// 20-SEKUNDNI ODŠTEVALNIK ZA VSAKO VPRAŠANJE
// ============================================================================
function stopRoundTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function startRoundTimer() {
  stopRoundTimer();

  const timerCard = document.getElementById("timer-bar-card");
  const displayEl = document.getElementById("timer-display");
  const fillEl = document.getElementById("timer-progress-fill");

  timerCard.style.display = "block";
  displayEl.className = "timer-Display";
  fillEl.className = "timer-progress-fill";
  displayEl.textContent = "20.0 s";
  fillEl.style.width = "100%";

  state.roundDeadline = performance.now() + ROUND_TIME_LIMIT_MS;

  state.timerInterval = setInterval(() => {
    const remainingMs = Math.max(0, state.roundDeadline - performance.now());
    const remainingSec = (remainingMs / 1000).toFixed(1);
    const pct = (remainingMs / ROUND_TIME_LIMIT_MS) * 100;

    displayEl.textContent = `${remainingSec} s`;
    fillEl.style.width = `${pct}%`;

    if (remainingMs <= 4000) {
      displayEl.className = "timer-Display danger";
      fillEl.className = "timer-progress-fill danger";
    } else if (remainingMs <= 8000) {
      displayEl.className = "timer-Display warn";
      fillEl.className = "timer-progress-fill warn";
    }

    if (remainingMs <= 0) {
      stopRoundTimer();
      handleRoundTimeout();
    }
  }, 50);
}

// ============================================================================
// IZRIS HUD IN TRENUTNEGA VPRAŠANJA
// ============================================================================
function updateHud() {
  const modeLabel = document.getElementById("hud-mode-label");
  if (state.mode === "daily") {
    modeLabel.textContent = `Dnevni #${state.activeDayNumber}`;
  } else {
    modeLabel.textContent = "Prosta igra";
  }

  const dotsContainer = document.getElementById("round-dots");
  dotsContainer.innerHTML = "";

  for (let i = 0; i < 5; i++) {
    const dot = document.createElement("div");
    dot.className = "round-dot";
    dot.textContent = i + 1;

    if (state.guesses[i]) {
      dot.classList.add(state.guesses[i].tier);
    } else if (i === state.currentRound) {
      dot.classList.add("current");
    }
    dotsContainer.appendChild(dot);
  }
}

function renderCurrentRound() {
  const ev = state.events[state.currentRound];
  const eraObj = SLOVENIAN_ERAS.find((er) => er.id === ev.era) || SLOVENIAN_ERAS[0];

  document.getElementById("eraly-stage-card").classList.remove("golden-flight");
  document.getElementById("active-round-area").style.display = "block";
  document.getElementById("summary-panel").classList.remove("visible");

  document.getElementById("event-era-badge").textContent = `Sklop ${eraObj.code} (${eraObj.rangeText})`;
  document.getElementById("event-category-badge").textContent = ev.category;
  document.getElementById("event-region-badge").textContent = `📍 ${ev.region}`;
  document.getElementById("round-counter-badge").textContent = `Vprašanje ${state.currentRound + 1} / 5`;

  document.getElementById("event-title").textContent = ev.title;
  document.getElementById("event-prompt").textContent = ev.prompt;

  const yearInput = document.getElementById("year-input");
  const slider = document.getElementById("timeline-slider");
  yearInput.value = "";
  slider.value = 1;

  document.getElementById("guess-panel").style.display = "block";
  document.getElementById("round-result").classList.remove("visible");

  startRoundTimer();

  setTimeout(() => {
    yearInput.focus();
  }, 40);
}

// ============================================================================
// ODDAJA ODGOVORA ALI POTEK 20 SEKUND + POLET ČASOPLOVA
// ============================================================================
function handleRoundTimeout() {
  if (state.roundSubmitted) return;
  state.roundSubmitted = true;

  const ev = state.events[state.currentRound];
  const prevYear = state.journeyYear;

  const guessRecord = {
    eventId: ev.id,
    title: ev.title,
    guessYear: null,
    actualYear: ev.year,
    diff: null,
    points: 0,
    yearGain: 0,
    targetYearAfter: prevYear,
    timedOut: true,
    tier: "tier-miss",
    emoji: "⏰"
  };

  state.guesses.push(guessRecord);
  updateHud();
  presentRoundOutcome(guessRecord, ev, prevYear, prevYear);
}

function submitCurrentGuess() {
  if (state.roundSubmitted) return;

  const yearInput = document.getElementById("year-input");
  const rawVal = parseInt(yearInput.value, 10);

  if (isNaN(rawVal) || rawVal < 1 || rawVal > 2026) {
    yearInput.focus();
    yearInput.style.borderColor = "#ef4444";
    setTimeout(() => {
      yearInput.style.borderColor = "";
    }, 600);
    return;
  }

  stopRoundTimer();
  state.roundSubmitted = true;

  const ev = state.events[state.currentRound];
  const diff = Math.abs(rawVal - ev.year);
  const { points, tier, emoji } = calculateScore(rawVal, ev.year, ev.era);

  const prevYear = state.journeyYear;
  const tempGuesses = [...state.guesses, { points, diff, timedOut: false }];
  const newJourneyYear = computeJourneyYearFromGuesses(tempGuesses);
  const yearGain = Math.max(0, newJourneyYear - prevYear);

  state.journeyYear = newJourneyYear;

  const guessRecord = {
    eventId: ev.id,
    title: ev.title,
    guessYear: rawVal,
    actualYear: ev.year,
    diff,
    points,
    yearGain,
    targetYearAfter: newJourneyYear,
    timedOut: false,
    tier,
    emoji
  };

  state.guesses.push(guessRecord);
  updateHud();
  presentRoundOutcome(guessRecord, ev, prevYear, newJourneyYear);
}

function presentRoundOutcome(guessRecord, ev, prevYear, newJourneyYear) {
  document.getElementById("timer-bar-card").style.display = "none";
  document.getElementById("guess-panel").style.display = "none";

  // Sproži pravo Eraly.io animacijo poleta časoplova na glavnem platnu!
  if (gameScene) {
    gameScene.triggerFlight(prevYear, newJourneyYear, {
      isExact: !guessRecord.timedOut && guessRecord.diff === 0,
      isTimeout: guessRecord.timedOut
    });
  }

  const resPanel = document.getElementById("round-result");
  resPanel.classList.add("visible");

  const jsbIcon = document.getElementById("jsb-icon");
  const jsbTitle = document.getElementById("jsb-title");
  const jsbSub = document.getElementById("jsb-sub");

  if (guessRecord.timedOut) {
    jsbIcon.textContent = "⏰";
    jsbTitle.textContent = "Čas (20 s) je potekel — motor časoplova je ugasnil!";
    jsbSub.textContent = `Časoplov ostaja v letu ${newJourneyYear} (+0 let premika · 0 točk)`;
  } else if (guessRecord.diff === 0) {
    jsbIcon.textContent = "⚡";
    jsbTitle.textContent = "ZLATI POLET! Zadel si točno letnico brez odstopanja!";
    jsbSub.textContent = `Nebo se je obarvalo zlato: Leto ${prevYear} ➔ Leto ${newJourneyYear} (+${guessRecord.yearGain} ${formatYearsWord(guessRecord.yearGain)})`;
  } else if (guessRecord.yearGain > 0) {
    jsbIcon.textContent = "🛸";
    jsbTitle.textContent = `Časoplov je poletel za +${guessRecord.yearGain} ${formatYearsWord(guessRecord.yearGain)} v prihodnost!`;
    jsbSub.textContent = `Leto ${prevYear} ➔ Leto ${newJourneyYear} (do leta 2026 manjka še ${2026 - newJourneyYear} let)`;
  } else {
    jsbIcon.textContent = "💨";
    jsbTitle.textContent = "Preveliko odstopanje — časoplov je obmiroval";
    jsbSub.textContent = `Ostajaš v letu ${newJourneyYear} (+0 let premika)`;
  }

  document.getElementById("res-user-year").textContent = guessRecord.timedOut
    ? "Brez odgovora"
    : `${guessRecord.guessYear}`;
  document.getElementById("res-actual-year").textContent = `${ev.year}`;
  document.getElementById("res-points").textContent = `+${guessRecord.yearGain} let (${guessRecord.points} tč)`;

  const diffBanner = document.getElementById("res-diff-banner");
  const vtCompareBox = document.getElementById("vt-compare-box");
  const vtLegendBox = document.getElementById("vt-legend-box");

  if (guessRecord.timedOut) {
    diffBanner.textContent = "⏰ Poteklo je 20 sekund brez oddanega odgovora (0 točk).";
    diffBanner.style.color = "var(--accent-red)";
    vtCompareBox.style.display = "none";
    vtLegendBox.style.display = "none";
  } else {
    vtCompareBox.style.display = "block";
    vtLegendBox.style.display = "flex";

    if (guessRecord.diff === 0) {
      diffBanner.textContent = "🎯 Točno v nulo! Zlati polet (0 let odstopanja)!";
      diffBanner.style.color = "var(--accent-gold)";
    } else {
      const direction =
        guessRecord.guessYear < ev.year
          ? `dogodek se je zgodil ${guessRecord.diff} ${formatYearsWord(guessRecord.diff)} kasneje`
          : `dogodek se je zgodil ${guessRecord.diff} ${formatYearsWord(guessRecord.diff)} prej`;
      diffBanner.textContent = `${guessRecord.emoji} Odstopanje: ${guessRecord.diff} ${formatYearsWord(guessRecord.diff)} (${direction})`;
      diffBanner.style.color = "var(--text-main)";
    }

    const pctGuess = Math.max(2, Math.min(98, ((guessRecord.guessYear - 1) / 2025) * 100));
    const pctActual = Math.max(2, Math.min(98, ((ev.year - 1) / 2025) * 100));

    const pinGuess = document.getElementById("vt-pin-guess");
    const pinActual = document.getElementById("vt-pin-actual");
    const connector = document.getElementById("vt-connector");

    pinGuess.style.left = `${pctGuess}%`;
    pinActual.style.left = `${pctActual}%`;

    const leftPct = Math.min(pctGuess, pctActual);
    const widthPct = Math.max(0.5, Math.abs(pctGuess - pctActual));
    connector.style.left = `${leftPct}%`;
    connector.style.width = `${widthPct}%`;

    document.getElementById("vt-lbl-guess").textContent = guessRecord.guessYear;
    document.getElementById("vt-lbl-actual").textContent = ev.year;
  }

  document.getElementById("res-explanation").textContent = ev.explanation;

  const nextBtn = document.getElementById("btn-next-round");
  if (state.currentRound < 4) {
    nextBtn.textContent = `Naslednji polet (${state.currentRound + 2}/5) ➔`;
  } else {
    nextBtn.textContent = "Prikaži končni pristanek časoplova (5/5) ➔";
  }
}

function advanceToNextRound() {
  if (!state.roundSubmitted) return;

  if (state.currentRound < 4) {
    state.currentRound++;
    state.roundSubmitted = false;
    updateHud();
    renderCurrentRound();
  } else {
    finishGameSession();
  }
}

// ============================================================================
// ZAKLJUČEK IGRE IN POVZETEK 5 VPRAŠANJ
// ============================================================================
function finishGameSession() {
  stopRoundTimer();
  const totalScore = state.guesses.reduce((sum, g) => sum + g.points, 0);
  const reachedYear = computeJourneyYearFromGuesses(state.guesses);
  state.journeyYear = reachedYear;

  if (state.mode === "daily" && state.activeDateKey) {
    const alreadySaved = state.dailyHistory[state.activeDateKey];
    if (!alreadySaved) {
      state.dailyHistory[state.activeDateKey] = {
        score: totalScore,
        reachedYear,
        guesses: state.guesses,
        completedAt: Date.now()
      };

      const todayKey = formatDateKey(new Date());
      if (state.activeDateKey === todayKey) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = formatDateKey(yesterday);

        if (state.lastCompletedDate === yesterdayKey) {
          state.streak += 1;
        } else if (state.lastCompletedDate !== todayKey) {
          state.streak = 1;
        }
        state.lastCompletedDate = todayKey;
      }

      savePersistedState();
      updateTopbarStreak();
    }
  }

  if (reachedYear >= 1800 && typeof confetti === "function") {
    confetti({ particleCount: reachedYear === 2026 ? 150 : 75, spread: 70, origin: { y: 0.6 } });
  }

  renderSummary();
}

function renderSummary() {
  document.getElementById("active-round-area").style.display = "none";
  const summaryPanel = document.getElementById("summary-panel");
  summaryPanel.classList.add("visible");

  const totalScore = state.guesses.reduce((sum, g) => sum + g.points, 0);
  const reachedYear = state.journeyYear;

  document.getElementById("summary-rank").textContent = getRankTitleByYear(reachedYear);
  document.getElementById("summary-year-reached").textContent = `Leto ${reachedYear}`;

  const exactCount = state.guesses.filter((g) => !g.timedOut && g.diff === 0).length;
  document.getElementById("summary-subtitle").textContent =
    reachedYear === 2026
      ? `Popolnih 5/5 zadetkov v nulo! Tvoj časoplov je pristal v letu 2026 (${totalScore} / 5000 točk)!`
      : `Zbral si ${totalScore} / 5000 točk (${exactCount}/5 zlatih poletov v nulo). Do leta 2026 prideš le z vsemi 5 zadetki v nulo!`;

  const listEl = document.getElementById("summary-rounds-list");
  listEl.innerHTML = "";

  state.guesses.forEach((g, idx) => {
    const row = document.createElement("div");
    row.className = "summary-round-item";
    const userText = g.timedOut
      ? "⏰ Potekel čas (20 s)"
      : `Tvoj vnos: <strong>${g.guessYear}</strong> (${g.diff === 0 ? "Zlati polet!" : "±" + g.diff + " " + formatYearsWord(g.diff)})`;

    row.innerHTML = `
      <div class="sri-left">
        <span class="sri-emoji">${g.emoji}</span>
        <div>
          <div class="sri-title">${idx + 1}. ${g.title}</div>
          <div class="sri-years">${userText} · Pravilno: <strong>${g.actualYear}</strong></div>
        </div>
      </div>
      <div class="sri-score">+${g.yearGain ?? 0} let (${g.points} tč)</div>
    `;
    listEl.appendChild(row);
  });

  const timerEl = document.getElementById("next-daily-timer");
  if (state.mode === "daily") {
    timerEl.textContent = "Nov dnevni izziv bo na voljo ob polnoči.";
  } else {
    timerEl.textContent = "V Prosti igri lahko takoj poletiš znova!";
  }
}

// ============================================================================
// DELJENJE REZULTATA V ODLOŽIŠČE
// ============================================================================
function shareResultToClipboard() {
  const totalScore = state.guesses.reduce((sum, g) => sum + g.points, 0);
  const reachedYear = state.journeyYear;
  const headerTitle =
    state.mode === "daily"
      ? `🇸🇮 Letnica.si #${state.activeDayNumber} (${formatSlovenianDate(state.activeDateKey)})`
      : `🇸🇮 Letnica.si (Prosta igra)`;

  const emojiRow = state.guesses.map((g) => g.emoji).join("");
  const detailRows = state.guesses
    .map((g, i) => {
      if (g.timedOut) return `${i + 1}. ⏰ potekel čas (+0 let)`;
      return `${i + 1}. ${g.emoji} +${g.yearGain ?? 0} let (${g.diff === 0 ? "zlati polet!" : "±" + g.diff + " let"})`;
    })
    .join("\n");

  const shareText = `${headerTitle}\n🛸 Časoplov je priletel do: Leto ${reachedYear} / 2026 (${totalScore} tč)\n${emojiRow}\n\n${detailRows}`;

  navigator.clipboard.writeText(shareText).then(() => {
    const btn = document.getElementById("btn-share-result");
    const orig = btn.textContent;
    btn.textContent = "✅ Rezultat skopiran v odložišče!";
    setTimeout(() => {
      btn.textContent = orig;
    }, 2200);
  });
}

// ============================================================================
// ARHIV DNEVNIH IZZIVOV IN STATISTIKA
// ============================================================================
function renderArchiveGrid() {
  const grid = document.getElementById("archive-grid");
  grid.innerHTML = "";

  const today = new Date();
  for (let offset = 0; offset < 24; offset++) {
    const d = new Date(today);
    d.setDate(today.getDate() - offset);
    const dKey = formatDateKey(d);
    const dayNum = getDayNumberFromDateKey(dKey);
    const saved = state.dailyHistory[dKey];

    const card = document.createElement("div");
    card.className = "archive-day-card" + (saved ? " completed" : "");
    const yearReached = saved
      ? saved.reachedYear ?? computeJourneyYearFromGuesses(saved.guesses)
      : null;

    card.innerHTML = `
      <div class="adc-top">
        <span class="adc-num">Izziv #${dayNum}</span>
        <span class="adc-date">${formatSlovenianDate(dKey)}</span>
      </div>
      <div class="adc-status">
        ${saved ? `✅ Leto ${yearReached} / 2026` : "▶ Poleti (20 s)"}
      </div>
    `;
    card.addEventListener("click", () => {
      startDailyGame(dKey);
    });
    grid.appendChild(card);
  }
}

function renderStatsModal() {
  const entries = Object.values(state.dailyHistory);
  const played = entries.length;
  const years = entries.map((e) => e.reachedYear ?? computeJourneyYearFromGuesses(e.guesses));
  const bestYear = played > 0 ? Math.max(...years) : 0;
  const avgYear =
    played > 0 ? Math.round(years.reduce((s, y) => s + y, 0) / played) : 0;

  document.getElementById("st-played").textContent = played;
  document.getElementById("st-avg").textContent = avgYear;
  document.getElementById("st-best").textContent = bestYear;
  document.getElementById("st-streak").textContent = state.streak;

  const buckets = [
    { label: "🎯 Leto 2026", min: 2026, max: 2026, count: 0 },
    { label: "1800 – 2025", min: 1800, max: 2025, count: 0 },
    { label: "1400 – 1799", min: 1400, max: 1799, count: 0 },
    { label: "800 – 1399", min: 800, max: 1399, count: 0 },
    { label: "0 – 799", min: 0, max: 799, count: 0 }
  ];

  years.forEach((y) => {
    const b = buckets.find((bk) => y >= bk.min && y <= bk.max);
    if (b) b.count++;
  });

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const distContainer = document.getElementById("stats-distribution");
  distContainer.innerHTML = "";

  buckets.forEach((b) => {
    const pct = Math.max(8, Math.round((b.count / maxCount) * 100));
    const row = document.createElement("div");
    row.className = "dist-row";
    row.innerHTML = `
      <div class="dist-label">${b.label}</div>
      <div class="dist-bar-wrap">
        <div class="dist-bar" style="width: ${pct}%">${b.count}</div>
      </div>
    `;
    distContainer.appendChild(row);
  });
}

// ============================================================================
// POVEZAVA DOGODKOV (EVENT LISTENERS)
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  loadPersistedState();
  applyTheme();
  updateTopbarStreak();

  // Inicializiraj oba 60fps Eraly.io Canvas pogona
  menuScene = new EralySceneRenderer("menu-preview-canvas", true);
  gameScene = new EralySceneRenderer("eraly-game-canvas", false);
  startAnimationLoop();

  // Ob odprtju prikaži Vstopni meni
  showMenuView();

  // Preklop teme
  document.getElementById("btn-theme-toggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    savePersistedState();
  });

  // Gumbi za vrnitev v Vstopni meni
  document.getElementById("btn-home").addEventListener("click", showMenuView);
  document.getElementById("btn-back-menu").addEventListener("click", showMenuView);
  document.getElementById("btn-summary-back-menu").addEventListener("click", showMenuView);
  document.getElementById("btn-archive-back-menu").addEventListener("click", showMenuView);

  // Gumbi v Vstopnem meniju
  document.getElementById("btn-menu-start-daily").addEventListener("click", () => {
    startDailyGame(formatDateKey(new Date()));
  });

  document.getElementById("btn-menu-start-freeplay").addEventListener("click", () => {
    state.freeplayEra = document.getElementById("menu-era-select").value;
    startFreeplayGame();
  });

  document.getElementById("btn-menu-open-archive").addEventListener("click", () => {
    showArchiveView();
  });

  // Sinhronizacija vnosnega polja in drsnika
  const yearInput = document.getElementById("year-input");
  const slider = document.getElementById("timeline-slider");

  yearInput.addEventListener("input", () => {
    const v = parseInt(yearInput.value, 10);
    if (!isNaN(v) && v >= 1 && v <= 2026) {
      slider.value = v;
    }
  });

  slider.addEventListener("input", () => {
    yearInput.value = slider.value;
  });

  document.querySelectorAll("#timeline-ticks span").forEach((tick) => {
    tick.addEventListener("click", () => {
      const y = tick.getAttribute("data-year");
      yearInput.value = y;
      slider.value = y;
      yearInput.focus();
    });
  });

  document.querySelectorAll(".step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = parseInt(btn.getAttribute("data-step"), 10);
      const curr = parseInt(yearInput.value, 10) || 1900;
      const next = Math.max(1, Math.min(2026, curr + step));
      yearInput.value = next;
      slider.value = next;
      yearInput.focus();
    });
  });

  // Oddaja odgovora in naslednje vprašanje
  document.getElementById("btn-submit-year").addEventListener("click", submitCurrentGuess);
  document.getElementById("btn-next-round").addEventListener("click", advanceToNextRound);

  // Tipka Enter
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (state.view !== "game") return;
      const statsOpen = document.getElementById("modal-stats").classList.contains("visible");
      const rulesOpen = document.getElementById("modal-rules").classList.contains("visible");
      if (statsOpen || rulesOpen) return;

      const summaryVisible = document.getElementById("summary-panel").classList.contains("visible");
      if (summaryVisible) return;

      e.preventDefault();
      if (!state.roundSubmitted) {
        submitCurrentGuess();
      } else {
        advanceToNextRound();
      }
    }
  });

  // Akcije na končnem povzetku
  document.getElementById("btn-share-result").addEventListener("click", shareResultToClipboard);
  document.getElementById("btn-summary-play-more").addEventListener("click", () => {
    startFreeplayGame();
  });

  // Modala za statistiko in pravila
  document.getElementById("btn-open-stats").addEventListener("click", () => {
    renderStatsModal();
    document.getElementById("modal-stats").classList.add("visible");
  });

  document.getElementById("btn-streak").addEventListener("click", () => {
    renderStatsModal();
    document.getElementById("modal-stats").classList.add("visible");
  });

  document.getElementById("btn-open-rules").addEventListener("click", () => {
    document.getElementById("modal-rules").classList.add("visible");
  });

  document.querySelectorAll(".btn-close-modal").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-close");
      document.getElementById(targetId).classList.remove("visible");
    });
  });

  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove("visible");
      }
    });
  });
});
