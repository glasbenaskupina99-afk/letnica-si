// ============================================================================
// ČASOLOV — ZVOK (sintetiziran z Web Audio) IN VIBRACIJA
// Brez zvočnih datotek: motor, »whoosh« prehoda obdobja, zvončki zlatega
// poleta, pristanek, pokašljevanje motorja in tiktakanje zadnjih sekund.
// ============================================================================

const LetnicaAudio = (() => {
  const PREF_KEY = "letnica_si_sound";
  let enabled = true;
  try {
    enabled = localStorage.getItem(PREF_KEY) !== "off";
  } catch (e) {
    /* zasebni način */
  }

  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let engine = null;

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);

      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function vibrate(pattern) {
    if (!enabled) return;
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {
      /* ni podprto */
    }
  }

  function envGain(t0, attack, peak, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    return g;
  }

  function tone(freq, { type = "sine", t = 0, attack = 0.01, decay = 0.4, peak = 0.3, detune = 0 } = {}) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + t;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.detune.value = detune;
    const g = envGain(t0, attack, peak, decay);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + attack + decay + 0.05);
  }

  function noise({ t = 0, dur = 0.6, from = 400, to = 4000, q = 1.2, peak = 0.25, type = "bandpass" } = {}) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + t;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t0);
    f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  // --------------------------------------------------------------------------
  // Motor časoplova: dva rahlo razglašena žagasta oscilatorja skozi nizkoprepustni
  // filter + šum vetra; višina in glasnost sledita hitrosti poleta.
  // --------------------------------------------------------------------------
  function engineStart(kind) {
    const c = ensure();
    if (!c) return;
    engineStop(true);
    const t0 = c.currentTime;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(kind === "stall" ? 0.12 : 0.09, t0 + 0.25);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400;
    lp.Q.value = 6;
    const o1 = c.createOscillator();
    const o2 = c.createOscillator();
    o1.type = "sawtooth";
    o2.type = "sawtooth";
    o1.frequency.value = 55;
    o2.frequency.value = 55;
    o2.detune.value = 14;
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(out);

    const wind = c.createBufferSource();
    wind.buffer = noiseBuffer;
    wind.loop = true;
    const wf = c.createBiquadFilter();
    wf.type = "bandpass";
    wf.frequency.value = 900;
    wf.Q.value = 0.7;
    const wg = c.createGain();
    wg.gain.value = 0.0001;
    wind.connect(wf).connect(wg).connect(master);

    out.connect(master);
    o1.start();
    o2.start();
    wind.start();
    engine = { o1, o2, lp, out, wind, wf, wg, kind };
  }

  function engineSpeed(speed) {
    if (!engine || !ctx) return;
    const t = ctx.currentTime;
    const s = Math.max(0, Math.min(1, speed));
    const sputter = engine.kind === "stall" ? (Math.random() < 0.25 ? 0.3 : 1) : 1;
    engine.o1.frequency.setTargetAtTime(55 + s * 150, t, 0.08);
    engine.o2.frequency.setTargetAtTime(55 + s * 150, t, 0.08);
    engine.lp.frequency.setTargetAtTime((300 + s * 2600) * sputter, t, 0.06);
    engine.wg.gain.setTargetAtTime(0.0001 + s * 0.16, t, 0.1);
    engine.wf.frequency.setTargetAtTime(700 + s * 2200, t, 0.1);
  }

  function engineStop(immediate = false) {
    if (!engine || !ctx) return;
    const e = engine;
    engine = null;
    const t = ctx.currentTime;
    const rel = immediate ? 0.05 : 0.6;
    e.out.gain.cancelScheduledValues(t);
    e.out.gain.setTargetAtTime(0.0001, t, rel / 4);
    e.wg.gain.setTargetAtTime(0.0001, t, rel / 4);
    [e.o1, e.o2, e.wind].forEach((n) => n.stop(t + rel + 0.1));
  }

  // --------------------------------------------------------------------------
  // Javni zvočni učinki
  // --------------------------------------------------------------------------
  const api = {
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = !!on;
      try {
        localStorage.setItem(PREF_KEY, enabled ? "on" : "off");
      } catch (e) {
        /* zasebni način */
      }
      if (!enabled) engineStop(true);
      else this.click();
    },
    unlock() {
      ensure();
    },
    click() {
      tone(880, { type: "triangle", decay: 0.06, peak: 0.08 });
    },
    launch(kind) {
      engineStart(kind);
      if (kind === "golden") {
        // zlati zvončki: arpeggio C-dur
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) =>
          tone(f, { type: "sine", t: i * 0.07, decay: 1.2, peak: 0.16 })
        );
        [1046.5, 1568].forEach((f, i) => tone(f * 2, { type: "sine", t: 0.3 + i * 0.1, decay: 1.5, peak: 0.05 }));
        vibrate([30, 40, 30, 40, 90]);
      } else if (kind === "stall") {
        for (let i = 0; i < 4; i++) noise({ t: 0.15 + i * 0.28, dur: 0.12, from: 200, to: 120, q: 3, peak: 0.35, type: "lowpass" });
        vibrate([60, 50, 60]);
      } else {
        noise({ dur: 0.7, from: 300, to: 2500, peak: 0.12 });
        vibrate(25);
      }
    },
    speed: engineSpeed,
    eraGate() {
      noise({ dur: 0.9, from: 6000, to: 400, q: 0.9, peak: 0.22 });
      tone(196, { type: "sine", decay: 0.9, peak: 0.12 });
      tone(293.7, { type: "sine", t: 0.05, decay: 0.9, peak: 0.08 });
    },
    landmark() {
      tone(1760, { type: "sine", decay: 0.25, peak: 0.05 });
    },
    land(kind) {
      engineStop(false);
      tone(90, { type: "sine", decay: 0.35, peak: 0.35 });
      noise({ dur: 0.35, from: 900, to: 150, peak: 0.12, type: "lowpass" });
      if (kind === "golden") {
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
          tone(f, { type: "triangle", t: 0.05 + i * 0.06, decay: 1.4, peak: 0.12 })
        );
        vibrate([20, 30, 20, 30, 20, 30, 140]);
      } else {
        vibrate(kind === "stall" ? 40 : 18);
      }
    },
    tick(urgent) {
      tone(urgent ? 1500 : 1100, { type: "square", decay: 0.04, peak: urgent ? 0.07 : 0.045 });
      if (urgent) vibrate(10);
    },
    timeout() {
      tone(110, { type: "sawtooth", decay: 0.6, peak: 0.18 });
      tone(103, { type: "sawtooth", decay: 0.6, peak: 0.14 });
      vibrate(220);
    },
    pin() {
      tone(660, { type: "sine", decay: 0.12, peak: 0.08 });
    },
    unlockLandmark() {
      [784, 988, 1175].forEach((f, i) => tone(f, { type: "triangle", t: i * 0.09, decay: 0.5, peak: 0.1 }));
      vibrate([15, 40, 15]);
    },
    finale(golden) {
      const notes = golden ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093] : [392, 493.9, 587.3, 784];
      notes.forEach((f, i) => tone(f, { type: "triangle", t: i * 0.11, decay: 1.6, peak: 0.12 }));
      vibrate(golden ? [40, 40, 40, 40, 40, 40, 200] : [30, 50, 60]);
    },
    error() {
      tone(220, { type: "square", decay: 0.12, peak: 0.06 });
      tone(185, { type: "square", t: 0.08, decay: 0.15, peak: 0.06 });
    }
  };

  return api;
})();

window.LetnicaAudio = LetnicaAudio;
