// ============================================================================
// ČASOLOV — IGRALNI POGON + ERALY.IO 60FPS ANIMIRANI ČASOPLOV (0 ➔ 2026)
// ============================================================================

const STORAGE_KEY = "letnica_si_state_v2";
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
  lastCompletedDate: null,
  unlocked: [] // tipi odklenjenih mejnikov (zbirka)
};

let gameScene = null;
let menuScene = null;

const audio = window.LetnicaAudio || null;
const canvasVisible = { menu: true, game: true };

function observeCanvasVisibility() {
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const key = en.target.id === "menu-preview-canvas" ? "menu" : "game";
      canvasVisible[key] = en.isIntersecting;
    });
  });
  ["menu-preview-canvas", "eraly-game-canvas"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });
}

// Platno riše le, ko je vidno (varčevanje z baterijo); med poletom vedno,
// sicer se pristanek in razkritje rezultata ne bi sprožila.
function startAnimationLoop() {
  function loop(now) {
    if (!document.hidden) {
      if (state.view === "menu" && menuScene && canvasVisible.menu) {
        menuScene.step(now);
      } else if (state.view === "game" && gameScene && (canvasVisible.game || gameScene.isFlying)) {
        gameScene.step(now);
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
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

function getRankTitleByYear(reachedYear) {
  if (reachedYear === 2026) return "👑 Časovni mojster (Timekeeper) — Priletel si v leto 2026!";
  if (reachedYear >= 1991) return "🇸🇮 Kapitan sodobne Slovenije (1991–2025)";
  if (reachedYear >= 1848) return "🏛️ Navigator Pomladi narodov in moderne dobe";
  if (reachedYear >= 1550) return "📜 Kronist Trubarjeve in Valvasorjeve dobe";
  if (reachedYear >= 623) return "⚔️ Raziskovalec Karantanije in srednjega veka";
  return "🏺 Popotnik starega veka in Emone";
}

function slDays(n) {
  const m = Math.abs(n) % 100;
  if (m === 1) return "dan";
  if (m === 2) return "dneva";
  if (m === 3 || m === 4) return "dnevi";
  return "dni";
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
    if (Array.isArray(parsed.unlocked)) state.unlocked = parsed.unlocked;
    pruneDailyHistory();
  } catch (err) {
    console.warn("Napaka pri branju shranjenega stanja:", err);
  }
}

// Odstrani dneve pred prvim izzivom in rezultate, ki ne ustrezajo več dogodkom
// svojega dne (npr. po spremembi baze ali začetnega datuma).
function pruneDailyHistory() {
  const epochKey = formatDateKey(EPOCH_START);
  let changed = false;
  Object.keys(state.dailyHistory).forEach((key) => {
    const entry = state.dailyHistory[key];
    let valid = key >= epochKey && entry && Array.isArray(entry.guesses) && entry.guesses.length === 5;
    if (valid) {
      const ids = getDailyEventsForDateKey(key).map((e) => e.id);
      valid = entry.guesses.every((g, i) => g.eventId === ids[i]);
    }
    if (!valid) {
      delete state.dailyHistory[key];
      changed = true;
    }
  });
  if (state.lastCompletedDate && !state.dailyHistory[state.lastCompletedDate]) {
    state.lastCompletedDate = null;
    state.streak = 0;
    changed = true;
  }
  if (changed) savePersistedState();
}

function savePersistedState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: state.theme,
        dailyHistory: state.dailyHistory,
        streak: state.streak,
        lastCompletedDate: state.lastCompletedDate,
        unlocked: state.unlocked
      })
    );
  } catch (err) {
    console.warn("Napaka pri shranjevanju stanja:", err);
  }
}

function applyTheme() {
  const icon = document.getElementById("theme-icon");
  if (state.theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    icon.setAttribute("href", "#i-moon");
  } else {
    document.documentElement.removeAttribute("data-theme");
    icon.setAttribute("href", "#i-sun");
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", state.theme === "light" ? "#efe7d8" : "#070b16");
}

function updateTopbarStreak() {
  document.getElementById("streak-val").textContent = state.streak;
}

// ============================================================================
// UPRAVLJANJE POGLEDOV (VSTOPNI MENI, IGRA, ARHIV)
// ============================================================================
function cancelFinaleSilently() {
  if (!finale.active) return;
  finale.active = false;
  finale.done = null;
  finale.timers.forEach(clearTimeout);
  finale.timers = [];
  document.getElementById("finale-strip").classList.remove("visible");
}

function showMenuView() {
  stopRoundTimer();
  cancelFinaleSilently();
  state.view = "menu";
  document.body.dataset.era = "0";

  document.getElementById("menu-view").classList.add("visible");
  document.getElementById("game-view").classList.remove("visible");
  document.getElementById("archive-view").classList.remove("visible");
  document.getElementById("rooms-view").classList.remove("visible");

  renderMenuDashboard();
}

function renderMenuDashboard() {
  const entries = Object.values(state.dailyHistory);
  const played = entries.length;
  const bestYear =
    played > 0 ? Math.max(...entries.map((e) => e.reachedYear || 0)) : 0;

  document.getElementById("menu-best-year").textContent = `Leto ${bestYear}`;
  document.getElementById("menu-streak-val").textContent = `${state.streak} ${slDays(state.streak)}`;
  document.getElementById("menu-played-val").textContent = `${played}`;

  const todayKey = formatDateKey(new Date());
  const todayDayNum = getDayNumberFromDateKey(todayKey);
  const savedToday = state.dailyHistory[todayKey];

  const statusTag = document.getElementById("menu-daily-status-tag");
  const titleEl = document.getElementById("menu-daily-title");

  if (savedToday) {
    statusTag.textContent = `IZZIV #${todayDayNum} · ODIGRANO · LETO ${savedToday.reachedYear}`;
    titleEl.textContent = "Poglej današnji polet";
  } else {
    statusTag.textContent = `IZZIV #${todayDayNum} · ${formatSlovenianDate(todayKey)}`;
    titleEl.textContent = "Igraj dnevni izziv";
  }
}

function showArchiveView() {
  stopRoundTimer();
  cancelFinaleSilently();
  state.view = "archive";
  document.body.dataset.era = "0";

  document.getElementById("menu-view").classList.remove("visible");
  document.getElementById("game-view").classList.remove("visible");
  document.getElementById("rooms-view").classList.remove("visible");
  document.getElementById("archive-view").classList.add("visible");

  renderArchiveGrid();
}

function showGameView() {
  state.view = "game";
  document.getElementById("menu-view").classList.remove("visible");
  document.getElementById("archive-view").classList.remove("visible");
  document.getElementById("rooms-view").classList.remove("visible");
  document.getElementById("game-view").classList.add("visible");
}

// ============================================================================
// ZAGON DNEVNEGA IZZIVA IN PROSTE IGRE
// ============================================================================
function startDailyGame(dateKey = formatDateKey(new Date())) {
  stopRoundTimer();
  cancelFinaleSilently();
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
    if (window.CasolovRooms) window.CasolovRooms.onDailyFinished(dateKey, state.guesses);
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
  cancelFinaleSilently();
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
  if (gameScene) gameScene.tension = 0;
  const timerCard = document.getElementById("timer-bar-card");
  if (timerCard) timerCard.classList.remove("tense");
}

function startRoundTimer() {
  stopRoundTimer();

  const timerCard = document.getElementById("timer-bar-card");
  const displayEl = document.getElementById("timer-display");
  const fillEl = document.getElementById("timer-progress-fill");

  timerCard.style.display = "";
  displayEl.className = "timer-Display";
  fillEl.className = "timer-progress-fill";
  displayEl.textContent = "20.0 s";
  fillEl.style.width = "100%";

  state.roundDeadline = performance.now() + ROUND_TIME_LIMIT_MS;
  let lastTickSecond = null;

  state.timerInterval = setInterval(() => {
    const remainingMs = Math.max(0, state.roundDeadline - performance.now());
    const remainingSec = (remainingMs / 1000).toFixed(1);
    const pct = (remainingMs / ROUND_TIME_LIMIT_MS) * 100;

    displayEl.textContent = `${remainingSec} s`;
    fillEl.style.width = `${pct}%`;

    // Zadnjih 5 sekund: tiktakanje, zadnje 4 sekunde še rdeč utrip neba
    const wholeSec = Math.ceil(remainingMs / 1000);
    if (wholeSec <= 5 && wholeSec > 0 && wholeSec !== lastTickSecond) {
      lastTickSecond = wholeSec;
      if (audio) audio.tick(wholeSec <= 3);
    }
    if (gameScene) gameScene.tension = remainingMs <= 4000 ? Math.min(1, (4000 - remainingMs) / 4000 + 0.25) : 0;
    timerCard.classList.toggle("tense", remainingMs <= 4000);

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
function restartAnimation(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

function animateNumber(el, from, to, duration, format) {
  if (!el) return;
  const fmt = format || ((v) => `${v}`);
  if (PREFERS_REDUCED_MOTION || duration <= 0) {
    el.textContent = fmt(to);
    return;
  }
  const token = (el._animToken = (el._animToken || 0) + 1);
  const t0 = performance.now();
  const tick = (now) => {
    if (el._animToken !== token) return;
    const p = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function updateHud(popIndex = -1) {
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
    const g = state.guesses[i];
    dot.setAttribute(
      "aria-label",
      g ? `Krog ${i + 1}: ${g.timedOut ? "čas je potekel" : g.diff === 0 ? "zadetek v nulo" : "odstopanje " + g.diff}` : i === state.currentRound ? `Krog ${i + 1}: trenutni` : `Krog ${i + 1}`
    );

    if (state.guesses[i]) {
      dot.classList.add(state.guesses[i].tier);
      if (i === popIndex) dot.classList.add("pop");
    } else if (i === state.currentRound) {
      dot.classList.add("current");
    }
    dotsContainer.appendChild(dot);
  }
}

function renderCurrentRound() {
  const ev = state.events[state.currentRound];
  const eraObj = SLOVENIAN_ERAS.find((er) => er.id === ev.era) || SLOVENIAN_ERAS[0];

  document.getElementById("eraly-stage-card").classList.remove("golden-flight", "stall-flight");
  document.getElementById("active-round-area").style.display = "block";
  restartAnimation(document.getElementById("question-event-card"), "card-enter");
  restartAnimation(document.getElementById("guess-panel"), "card-enter");
  document.getElementById("summary-panel").classList.remove("visible");

  document.body.dataset.era = String(ev.era);
  document.getElementById("event-era-badge").textContent = `Sklop ${eraObj.code} · ${eraObj.rangeText}`;
  document.getElementById("event-category-badge").textContent = ev.category;
  document.getElementById("event-region-badge").textContent = ev.region;
  document.getElementById("round-counter-badge").textContent = `Vprašanje ${state.currentRound + 1} / 5`;

  document.getElementById("event-title").textContent = ev.title;
  document.getElementById("event-prompt").textContent = ev.prompt;

  const yearInput = document.getElementById("year-input");
  yearInput.value = "";
  configureSliderForEra(eraObj);

  document.getElementById("guess-panel").style.display = "block";
  document.getElementById("round-result").classList.remove("visible", "in-flight", "revealed");

  startRoundTimer();

  // Na telefonih tipkovnice ne odpremo sami — drsnik in gumbi so dovolj
  if (!IS_TOUCH) {
    setTimeout(() => {
      yearInput.focus({ preventScroll: true });
    }, 40);
  }
}

// ============================================================================
// DRSNIK ZA LETNICO: razpon obdobja vprašanja, lebdeča letnica nad ročico
// ============================================================================
const IS_TOUCH = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

function niceTickStep(span) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  return steps.find((st) => span / st <= 6) || 500;
}

function configureSliderForEra(eraObj) {
  const slider = document.getElementById("timeline-slider");
  const min = eraObj.minYear;
  const max = eraObj.maxYear;
  slider.min = min;
  slider.max = max;
  slider.value = Math.round((min + max) / 2);

  const ticksEl = document.getElementById("timeline-ticks");
  const step = niceTickStep(max - min);
  const ticks = [min];
  for (let y = Math.ceil((min + 1) / step) * step; y < max; y += step) {
    if (y - ticks[ticks.length - 1] >= step * 0.6 && max - y >= step * 0.6) ticks.push(y);
  }
  ticks.push(max);
  ticksEl.innerHTML = ticks
    .map((y) => {
      const pct = ((y - min) / (max - min)) * 100;
      return `<span data-year="${y}" style="left: ${pct}%">${y}</span>`;
    })
    .join("");

  document.getElementById("guess-range-note").textContent = `Drsnik: ${min} – ${max} · vpis: 1 – 2026`;
  updateSliderBubble();
}

function updateSliderBubble() {
  const slider = document.getElementById("timeline-slider");
  const bubble = document.getElementById("slider-bubble");
  const input = document.getElementById("year-input");
  if (!slider || !bubble) return;
  const min = Number(slider.min);
  const max = Number(slider.max);
  const typed = parseInt(input.value, 10);
  const hasValue = !isNaN(typed);
  const val = hasValue ? typed : Number(slider.value);
  const clamped = Math.max(min, Math.min(max, val));
  const pct = max > min ? (clamped - min) / (max - min) : 0;
  // ročica je široka 24 px — lebdeči napis poravnamo na njeno središče
  bubble.style.left = `calc(${pct * 100}% + ${12 - pct * 24}px)`;
  bubble.textContent = hasValue ? String(typed) : "?";
  bubble.classList.toggle("idle", !hasValue);
  bubble.classList.toggle("outside", hasValue && (typed < min || typed > max));
  slider.style.setProperty("--fill", `${pct * 100}%`);
  slider.setAttribute("aria-valuetext", hasValue ? `Leto ${typed}` : `Leto ${slider.value}`);
}

// ============================================================================
// ODDAJA ODGOVORA ALI POTEK 20 SEKUND + POLET ČASOPLOVA
// ============================================================================
function handleRoundTimeout() {
  if (state.roundSubmitted) return;
  state.roundSubmitted = true;

  const ev = state.events[state.currentRound];
  const prevYear = state.journeyYear;
  if (audio) audio.timeout();

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
  presentRoundOutcome(guessRecord, ev, prevYear, prevYear);
}

function submitCurrentGuess() {
  if (state.roundSubmitted) return;

  const yearInput = document.getElementById("year-input");
  const rawVal = parseInt(yearInput.value, 10);

  if (isNaN(rawVal) || rawVal < 1 || rawVal > 2026) {
    yearInput.focus();
    yearInput.style.borderColor = "var(--red)";
    restartAnimation(yearInput, "shake");
    if (audio) audio.error();
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
  presentRoundOutcome(guessRecord, ev, prevYear, newJourneyYear);
}

function presentRoundOutcome(guessRecord, ev, prevYear, newJourneyYear) {
  document.getElementById("timer-bar-card").style.display = "none";
  document.getElementById("guess-panel").style.display = "none";

  const roundIdx = state.guesses.length - 1;
  const isExact = !guessRecord.timedOut && guessRecord.diff === 0;

  // 1) Rezultat se pripravi, a ostane skrit, dokler časoplov ne pristane
  const resPanel = document.getElementById("round-result");
  resPanel.classList.remove("revealed");
  resPanel.classList.add("visible", "in-flight");
  resPanel.dataset.tier = guessRecord.timedOut ? "tier-timeout" : guessRecord.tier;

  const jsbIcon = document.getElementById("jsb-icon");
  const jsbTitle = document.getElementById("jsb-title");
  const jsbSub = document.getElementById("jsb-sub");
  jsbIcon.textContent = guessRecord.timedOut ? "⏰" : "🛸";
  jsbTitle.textContent = guessRecord.timedOut ? "Motor časoplova pokašljuje…" : "Časoplov je na poti skozi stoletja…";
  jsbSub.textContent = "Klikni na nebo ali pritisni Enter za preskok animacije";

  // 2) Če je oder izven zaslona (mobilni telefon), ga pripelji v pogled
  const stage = document.getElementById("eraly-stage-card");
  const stageTop = stage.getBoundingClientRect().top;
  if (stageTop < 50 || stageTop > window.innerHeight * 0.5) {
    const topbarH = document.querySelector(".topbar")?.offsetHeight || 0;
    window.scrollTo({
      top: window.scrollY + stageTop - topbarH - 10,
      behavior: PREFERS_REDUCED_MOTION ? "auto" : "smooth"
    });
  }

  // 3) Sproži kinematografski polet; ob pristanku razkrij rezultat
  const reveal = () => revealRoundResult(guessRecord, ev, prevYear, newJourneyYear, roundIdx);
  if (gameScene) {
    gameScene.triggerFlight(
      prevYear,
      newJourneyYear,
      { isExact, isTimeout: guessRecord.timedOut },
      reveal
    );
  } else {
    reveal();
  }
}

function revealRoundResult(guessRecord, ev, prevYear, newJourneyYear, roundIdx) {
  const resPanel = document.getElementById("round-result");
  if (!resPanel.classList.contains("in-flight")) return;

  updateHud(roundIdx);

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

  const userYearEl = document.getElementById("res-user-year");
  const actualYearEl = document.getElementById("res-actual-year");
  const pointsEl = document.getElementById("res-points");

  if (guessRecord.timedOut) {
    userYearEl.textContent = "Brez odgovora";
  } else {
    animateNumber(userYearEl, Math.max(1, guessRecord.guessYear - 120), guessRecord.guessYear, 650);
  }
  animateNumber(actualYearEl, Math.max(1, ev.year - 120), ev.year, 800);
  pointsEl.textContent = `+0 let (0 tč)`;
  setTimeout(() => {
    animateNumber(pointsEl, 0, guessRecord.yearGain, 900, (v) => {
      const pts = guessRecord.yearGain > 0
        ? Math.round((v / guessRecord.yearGain) * guessRecord.points)
        : guessRecord.points;
      return `+${v} let (${pts} tč)`;
    });
  }, 260);

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
    connector.style.transformOrigin = pctGuess <= pctActual ? "left center" : "right center";

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

  resPanel.classList.remove("in-flight");
  void resPanel.offsetWidth;
  resPanel.classList.add("revealed");

  // Bralniki zaslona: kratek povzetek kroga; tipkovnica: fokus na »naprej«
  const live = document.getElementById("sr-live");
  if (live) {
    live.textContent = guessRecord.timedOut
      ? `Čas je potekel. Pravilna letnica je ${ev.year}.`
      : `${guessRecord.diff === 0 ? "Zadetek v nulo!" : `Odstopanje ${guessRecord.diff} ${formatYearsWord(guessRecord.diff)}.`} Tvoj odgovor ${guessRecord.guessYear}, pravilno ${ev.year}. Časoplov je v letu ${newJourneyYear}.`;
  }
  if (!IS_TOUCH) setTimeout(() => nextBtn.focus({ preventScroll: true }), 500);
  unlockPassedLandmarks(newJourneyYear);
  if (audio && !guessRecord.timedOut && !PREFERS_REDUCED_MOTION) {
    setTimeout(() => audio.pin(), 420);
    setTimeout(() => audio.pin(), 1180);
  }
}

function advanceToNextRound() {
  if (finale.active) {
    finishFinale(true);
    return;
  }
  if (!state.roundSubmitted) return;

  // Med poletom Enter / klik najprej preskoči animacijo
  if (gameScene && gameScene.isFlying) {
    gameScene.skipFlight();
    return;
  }
  if (document.getElementById("round-result").classList.contains("in-flight")) return;

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

  const roomsBox = document.getElementById("summary-rooms");
  if (roomsBox) roomsBox.hidden = true;
  if (state.mode === "daily" && state.activeDateKey && window.CasolovRooms) {
    window.CasolovRooms.onDailyFinished(state.activeDateKey, state.guesses);
  }

  playFinale(() => {
    if (reachedYear >= 1800 && typeof confetti === "function") {
      const gold = ["#fde68a", "#f5b942", "#ffffff", "#fcd770"];
      confetti({ particleCount: reachedYear === 2026 ? 180 : 80, spread: 75, origin: { y: 0.55 }, colors: reachedYear === 2026 ? gold : undefined });
    }
    renderSummary();
  });
}

// ============================================================================
// VELIKI FINALE: ponovitev celotnega poleta krog za krogom
// ============================================================================
const finale = { active: false, timers: [], done: null, finalYear: 0 };

function playFinale(onDone) {
  const guesses = state.guesses.slice();
  const finalYear = state.journeyYear;
  if (!gameScene || PREFERS_REDUCED_MOTION || guesses.length !== 5) {
    onDone();
    return;
  }

  finale.active = true;
  finale.done = onDone;
  finale.finalYear = finalYear;
  finale.timers = [];

  document.getElementById("active-round-area").style.display = "none";
  const strip = document.getElementById("finale-strip");
  const chips = document.getElementById("finale-chips");
  chips.innerHTML = guesses
    .map((g, i) => `<span class="fin-chip" data-i="${i}"><b>${i + 1}</b><i>${g.timedOut ? "⏰" : g.diff === 0 ? "🎯" : "+" + (g.yearGain || 0)}</i></span>`)
    .join("");
  document.getElementById("finale-title").textContent = "Ponovitev tvojega poleta skozi čas";
  strip.classList.add("visible");

  const stage = document.getElementById("eraly-stage-card");
  const top = stage.getBoundingClientRect().top;
  if (top < 50 || top > window.innerHeight * 0.4) {
    const topbarH = document.querySelector(".topbar")?.offsetHeight || 0;
    window.scrollTo({ top: window.scrollY + top - topbarH - 10, behavior: "smooth" });
  }

  gameScene.setInstantYear(0, false);
  let from = 0;
  let i = 0;
  const later = (fn, ms) => finale.timers.push(setTimeout(fn, ms));

  const nextLeg = () => {
    if (!finale.active) return;
    if (i >= guesses.length) {
      finishFinale(false);
      return;
    }
    const g = guesses[i];
    const to = typeof g.targetYearAfter === "number" ? g.targetYearAfter : from;
    const gain = Math.max(0, to - from);
    const chip = chips.querySelector(`[data-i="${i}"]`);
    if (chip) chip.classList.add("on", g.timedOut ? "tier-timeout" : g.tier);

    gameScene.triggerFlight(
      from,
      to,
      {
        isExact: !g.timedOut && g.diff === 0,
        isTimeout: g.timedOut,
        duration: gain > 0 ? 1050 + Math.min(gain, 700) * 1.1 : 650
      },
      () => later(nextLeg, 260)
    );
    const badge = document.getElementById("fco-badge");
    if (badge) {
      badge.textContent = `Krog ${i + 1} · ${g.timedOut ? "čas je potekel" : g.diff === 0 ? "zlati polet" : "±" + g.diff + " " + formatYearsWord(g.diff)}`;
    }
    from = to;
    i++;
  };
  later(nextLeg, 450);
}

function finishFinale(skipped) {
  if (!finale.active) return;
  finale.active = false;
  finale.timers.forEach(clearTimeout);
  finale.timers = [];
  const golden = finale.finalYear === 2026;

  if (skipped && gameScene) gameScene.setInstantYear(finale.finalYear, golden);

  if (audio) audio.finale(golden);
  if (golden && gameScene && !skipped) {
    gameScene.goldenTarget = 1;
    gameScene.flash = 0.9;
    gameScene.flashColor = [255, 226, 140];
    gameScene.shake = 1;
    const badge = document.getElementById("fco-badge");
    const overlay = document.getElementById("flight-cinematic-overlay");
    if (badge && overlay) {
      badge.textContent = "👑 Pristanek v sedanjosti";
      overlay.classList.add("visible", "kind-golden");
      setTimeout(() => overlay.classList.remove("visible"), 1800);
    }
  }

  document.getElementById("finale-title").textContent = golden ? "Pristal si v letu 2026!" : "Pristanek";
  const done = finale.done;
  finale.done = null;
  setTimeout(
    () => {
      document.getElementById("finale-strip").classList.remove("visible");
      if (done) done();
    },
    skipped ? 0 : golden ? 1100 : 500
  );
}

function renderSummary() {
  document.getElementById("active-round-area").style.display = "none";
  const summaryPanel = document.getElementById("summary-panel");
  summaryPanel.classList.add("visible");

  const totalScore = state.guesses.reduce((sum, g) => sum + g.points, 0);
  const reachedYear = state.journeyYear;

  document.getElementById("summary-rank").textContent = getRankTitleByYear(reachedYear);
  animateNumber(document.getElementById("summary-year-reached"), 0, reachedYear, 1400, (v) => `Leto ${v}`);
  restartAnimation(summaryPanel, "summary-enter");

  const exactCount = state.guesses.filter((g) => !g.timedOut && g.diff === 0).length;
  document.getElementById("summary-subtitle").textContent =
    reachedYear === 2026
      ? `Popolnih 5/5 zadetkov v nulo! Tvoj časoplov je pristal v letu 2026 (${totalScore} / 5000 točk)!`
      : `Zbral si ${totalScore} / 5000 točk (${exactCount}/5 zlatih poletov v nulo). Do leta 2026 prideš le z vsemi 5 zadetki v nulo!`;

  const listEl = document.getElementById("summary-rounds-list");
  listEl.innerHTML = "";

  state.guesses.forEach((g, idx) => {
    const row = document.createElement("div");
    row.className = `summary-round-item ${g.timedOut ? "tier-timeout" : g.tier || ""}`;
    row.style.animationDelay = `${0.25 + idx * 0.09}s`;
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
  timerEl.dataset.mode = state.mode;
  if (state.mode !== "daily") {
    timerEl.textContent = "V prosti igri lahko takoj poletiš znova!";
  }
  updateCountdowns();
}

// ============================================================================
// ODŠTEVANJE DO NASLEDNJEGA DNEVNEGA IZZIVA (polnoč po lokalnem času)
// ============================================================================
function formatCountdown() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const total = Math.max(0, Math.floor((next - now) / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

function updateCountdowns() {
  const cd = formatCountdown();
  const timerEl = document.getElementById("next-daily-timer");
  if (timerEl && timerEl.dataset.mode === "daily") {
    timerEl.innerHTML = `Nov dnevni izziv čez <strong class="countdown">${cd}</strong>`;
  }
  const todayKey = formatDateKey(new Date());
  const tag = document.getElementById("menu-daily-status-tag");
  if (tag && state.dailyHistory[todayKey]) {
    tag.textContent = `ODIGRANO · NOV IZZIV ČEZ ${cd}`;
  }
  // ob polnoči osveži meni (nov izziv)
  if (cd === "00:00:00" && state.view === "menu") setTimeout(renderMenuDashboard, 1200);
}

// ============================================================================
// DELJENJE REZULTATA: besedilo in slika (PNG, 1080 × 1350)
// ============================================================================
function buildShareText() {
  const totalScore = state.guesses.reduce((sum, g) => sum + g.points, 0);
  const reachedYear = state.journeyYear;
  const headerTitle =
    state.mode === "daily"
      ? `🇸🇮 Časolov #${state.activeDayNumber} (${formatSlovenianDate(state.activeDateKey)})`
      : `🇸🇮 Časolov (Prosta igra)`;

  const emojiRow = state.guesses.map((g) => g.emoji).join("");
  const detailRows = state.guesses
    .map((g, i) => {
      if (g.timedOut) return `${i + 1}. ⏰ potekel čas (+0 let)`;
      return `${i + 1}. ${g.emoji} +${g.yearGain ?? 0} let (${g.diff === 0 ? "zlati polet!" : "±" + g.diff + " let"})`;
    })
    .join("\n");

  return `${headerTitle}\n🛸 Časoplov je priletel do: Leto ${reachedYear} / 2026 (${totalScore} tč)\n${emojiRow}\n\n${detailRows}`;
}

function flashButtonLabel(btnId, text) {
  const label = document.querySelector(`#${btnId} .btn-label`);
  if (!label) return;
  const orig = label.dataset.orig || label.textContent;
  label.dataset.orig = orig;
  label.textContent = text;
  clearTimeout(label._t);
  label._t = setTimeout(() => {
    label.textContent = orig;
  }, 2200);
}

function shareResultToClipboard() {
  const text = buildShareText();
  const done = () => flashButtonLabel("btn-copy-result", "Skopirano ✓");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => flashButtonLabel("btn-copy-result", "Kopiranje ni uspelo"));
  }
}

const TIER_COLORS = {
  "tier-perfect": ["#fde047", "#f59e0b"],
  "tier-great": ["#6ee7b7", "#10b981"],
  "tier-good": ["#fde68a", "#eab308"],
  "tier-ok": ["#fdba74", "#f97316"],
  "tier-miss": ["#fca5a5", "#ef4444"],
  "tier-timeout": ["#94a3b8", "#475569"]
};

async function renderShareImage() {
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const reached = state.journeyYear;
  const golden = reached === 2026;
  const totalScore = state.guesses.reduce((sum, g) => sum + g.points, 0);

  try {
    await Promise.all([
      document.fonts.load('900 200px "Fraunces"'),
      document.fonts.load('italic 700 60px "Fraunces"'),
      document.fonts.load('800 40px "Inter"')
    ]);
  } catch (e) {
    /* nadomestne pisave */
  }

  // Nebo v barvah doseženega obdobja (isti izračun kot na odru)
  const skyFx = new EralySceneRenderer("__share__", true);
  skyFx.goldenGlow = golden ? 1 : 0;
  const sky = skyFx.getSky(reached);
  const rgb = (a, al = 1) => `rgba(${a[0] | 0},${a[1] | 0},${a[2] | 0},${al})`;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, rgb(sky.top));
  grad.addColorStop(0.55, rgb(sky.mid));
  grad.addColorStop(0.85, rgb(sky.bot));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Zvezde (deterministično, da je slika vedno enaka)
  const rnd = seededRandom(hashString("share" + reached));
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`;
    ctx.beginPath();
    ctx.arc(rnd() * W, rnd() * H * 0.5, 0.8 + rnd() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sonce
  const sx = W * 0.8;
  const sy = H * 0.2;
  const halo = ctx.createRadialGradient(sx, sy, 10, sx, sy, 260);
  halo.addColorStop(0, rgb([255, 240, 200], 0.7));
  halo.addColorStop(1, rgb(sky.bot, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,248,225,0.95)";
  ctx.beginPath();
  ctx.arc(sx, sy, 58, 0, Math.PI * 2);
  ctx.fill();

  // Gorske plasti
  const ridge = (t) => Math.pow(1 - Math.abs(Math.sin(t)), 2);
  const layer = (base, amp, f, col, seed) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      ctx.lineTo(x, base - amp * ridge(x * f + seed) - amp * 0.35 * Math.sin(x * f * 3.1 + seed));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  };
  layer(H * 0.78, 150, 0.006, rgb([20, 26, 46], 0.55), 1.3);
  layer(H * 0.85, 90, 0.009, rgb([12, 16, 30], 0.8), 2.7);
  layer(H * 0.93, 40, 0.014, "rgba(5,8,16,0.96)", 0.4);
  const fade = ctx.createLinearGradient(0, H * 0.25, 0, H);
  fade.addColorStop(0, "rgba(4,7,16,0)");
  fade.addColorStop(1, "rgba(4,7,16,0.55)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Glava
  ctx.fillStyle = "#fcd770";
  ctx.font = '800 34px "Inter", sans-serif';
  ctx.fillText("Č A S O L O V", W / 2, 130);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = '600 32px "Inter", sans-serif';
  const sub =
    state.mode === "daily"
      ? `Dnevni izziv #${state.activeDayNumber} · ${formatSlovenianDate(state.activeDateKey)}`
      : "Prosta igra";
  ctx.fillText(sub, W / 2, 180);

  // Glavna letnica
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = 'italic 700 46px "Fraunces", Georgia, serif';
  ctx.fillText("Moj časoplov je priletel do", W / 2, 360);
  const yearGrad = ctx.createLinearGradient(0, 400, 0, 600);
  yearGrad.addColorStop(0, "#fff3c4");
  yearGrad.addColorStop(0.45, "#fcd770");
  yearGrad.addColorStop(1, "#e0901a");
  ctx.fillStyle = yearGrad;
  ctx.shadowColor = "rgba(245,158,11,0.55)";
  ctx.shadowBlur = 40;
  ctx.font = '900 230px "Fraunces", Georgia, serif';
  ctx.fillText(`${reached}`, W / 2, 590);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = '700 44px "Fraunces", Georgia, serif';
  ctx.fillText("od 2026 let", W / 2, 660);

  // Pot 0 → 2026
  const bx = 140;
  const bw = W - 280;
  const by = 735;
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, 14, 7);
  ctx.fill();
  const fillGrad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  fillGrad.addColorStop(0, "#3b82f6");
  fillGrad.addColorStop(0.4, "#8b5cf6");
  fillGrad.addColorStop(0.75, "#f59e0b");
  fillGrad.addColorStop(1, "#fcd770");
  ctx.fillStyle = fillGrad;
  ctx.beginPath();
  ctx.roundRect(bx, by, Math.max(14, (bw * reached) / 2026), 14, 7);
  ctx.fill();
  ctx.fillStyle = "#fff7d6";
  ctx.shadowColor = "rgba(251,191,36,0.9)";
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(bx + (bw * reached) / 2026, by + 7, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = '700 26px "Inter", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("0", bx, by + 56);
  ctx.textAlign = "right";
  ctx.fillText("2026", bx + bw, by + 56);
  ctx.textAlign = "center";

  // Pet krogov
  const size = 128;
  const gap = 24;
  const rowW = size * 5 + gap * 4;
  let x0 = (W - rowW) / 2;
  state.guesses.forEach((g, i) => {
    const tier = g.timedOut ? "tier-timeout" : g.tier;
    const [c1, c2] = TIER_COLORS[tier] || TIER_COLORS["tier-miss"];
    const x = x0 + i * (size + gap);
    const y = 860;
    const tg = ctx.createLinearGradient(x, y, x + size, y + size);
    tg.addColorStop(0, c1);
    tg.addColorStop(1, c2);
    ctx.fillStyle = tg;
    if (tier === "tier-perfect") {
      ctx.shadowColor = "rgba(251,191,36,0.8)";
      ctx.shadowBlur = 30;
    }
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 26);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(10,12,20,0.85)";
    ctx.font = '900 56px "Fraunces", Georgia, serif';
    ctx.fillText(String(i + 1), x + size / 2, y + 82);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = '800 28px "Inter", sans-serif';
    ctx.fillText(g.timedOut ? "čas" : g.diff === 0 ? "v nulo" : `±${g.diff}`, x + size / 2, y + size + 44);
  });

  // Naziv in točke
  ctx.fillStyle = golden ? "#fde68a" : "#ffffff";
  ctx.font = '800 38px "Inter", sans-serif';
  const rank = getRankTitleByYear(reached).replace(/^[^A-Za-zČŠŽčšž]+/u, "").split(" — ")[0];
  ctx.fillText(rank, W / 2, 1130);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = '600 32px "Inter", sans-serif';
  ctx.fillText(`${totalScore} / 5000 točk`, W / 2, 1180);

  ctx.fillStyle = "#fcd770";
  ctx.font = 'italic 700 40px "Fraunces", Georgia, serif';
  ctx.fillText("Poleti tudi ti — igraj Časolov", W / 2, 1275);

  return new Promise((resolve) => c.toBlob((blob) => resolve(blob), "image/png"));
}

async function shareResultImage() {
  const btn = document.getElementById("btn-share-result");
  btn.disabled = true;
  try {
    const blob = await renderShareImage();
    const name = state.mode === "daily" ? `casolov-${state.activeDayNumber}.png` : "casolov.png";
    const file = new File([blob], name, { type: "image/png" });
    const text = buildShareText();
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        flashButtonLabel("btn-share-result", "Deljeno ✓");
      } catch (err) {
        if (err && err.name !== "AbortError") throw err;
      }
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      flashButtonLabel("btn-share-result", "Slika shranjena ✓");
    }
  } catch (err) {
    console.warn("Deljenje slike ni uspelo:", err);
    flashButtonLabel("btn-share-result", "Ni uspelo");
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// ARHIV DNEVNIH IZZIVOV IN STATISTIKA
// ============================================================================
// Koledar dnevnih izzivov: barvna lestvica enega odtenka (zlato) po doseženem letu
const SL_MONTHS = ["januar", "februar", "marec", "april", "maj", "junij", "julij", "avgust", "september", "oktober", "november", "december"];
const SL_WEEKDAYS = ["Pon", "Tor", "Sre", "Čet", "Pet", "Sob", "Ned"];

function reachedYearOf(entry) {
  return entry.reachedYear ?? computeJourneyYearFromGuesses(entry.guesses);
}

function renderArchiveGrid() {
  const grid = document.getElementById("archive-grid");
  grid.innerHTML = "";

  const today = new Date();
  const todayKey = formatDateKey(today);
  const epochKey = formatDateKey(EPOCH_START);
  let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstMonth = new Date(EPOCH_START.getFullYear(), EPOCH_START.getMonth(), 1);
  let monthIdx = 0;

  while (cursor >= firstMonth) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7; // ponedeljek = 0
    let played = 0;

    let cells = "";
    for (let i = 0; i < lead; i++) cells += '<span class="cal-cell empty" aria-hidden="true"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const key = formatDateKey(new Date(y, m, d));
      const saved = state.dailyHistory[key];
      const isFuture = key > todayKey;
      const beforeEpoch = key < epochKey;
      const isToday = key === todayKey;
      if (isFuture || beforeEpoch) {
        cells += `<span class="cal-cell off" aria-hidden="true"><b>${d}</b></span>`;
        continue;
      }
      const dayNum = getDayNumberFromDateKey(key);
      if (saved) {
        played++;
        const yr = reachedYearOf(saved);
        const t = Math.max(0, Math.min(1, yr / 2026));
        const pct = Math.round(18 + t * 72);
        cells += `<button type="button" class="cal-cell played${yr === 2026 ? " perfect" : ""}${isToday ? " today" : ""}" data-key="${key}"
          style="--heat: ${pct}%" data-tip="Izziv #${dayNum} · ${formatSlovenianDate(key)} · Leto ${yr}"
          aria-label="Izziv ${dayNum}, ${formatSlovenianDate(key)}, odigrano, doseženo leto ${yr}">
          <b>${d}</b><i>${yr}</i></button>`;
      } else {
        cells += `<button type="button" class="cal-cell open${isToday ? " today" : ""}" data-key="${key}"
          data-tip="Izziv #${dayNum} · ${formatSlovenianDate(key)} · še ni odigran"
          aria-label="Izziv ${dayNum}, ${formatSlovenianDate(key)}, še ni odigran">
          <b>${d}</b><i>${isToday ? "danes" : "▶"}</i></button>`;
      }
    }

    const section = document.createElement("section");
    section.className = "cal-month";
    section.style.animation = `cardEnter 0.45s var(--ease-out) ${monthIdx * 0.08}s both`;
    section.innerHTML = `
      <header class="cal-head">
        <h3>${SL_MONTHS[m]} ${y}</h3>
        <span>${played} odigranih</span>
      </header>
      <div class="cal-grid">
        ${SL_WEEKDAYS.map((w) => `<span class="cal-wd">${w}</span>`).join("")}
        ${cells}
      </div>`;
    grid.appendChild(section);
    cursor = new Date(y, m - 1, 1);
    monthIdx++;
  }

  const legend = document.createElement("div");
  legend.className = "cal-legend";
  legend.innerHTML = `
    <span><i class="lg-cell open"></i>Še ni odigrano</span>
    <span class="lg-scale">Doseženo leto <em>0</em><i class="lg-ramp"></i><em>2026</em></span>`;
  grid.appendChild(legend);

  grid.querySelectorAll("button.cal-cell").forEach((btn) => {
    btn.addEventListener("click", () => startDailyGame(btn.dataset.key));
  });
}

function renderStatsModal() {
  const entries = Object.entries(state.dailyHistory).sort((a, b) => a[0].localeCompare(b[0]));
  const played = entries.length;
  const years = entries.map(([, e]) => reachedYearOf(e));
  const bestYear = played > 0 ? Math.max(...years) : 0;
  const avgYear = played > 0 ? Math.round(years.reduce((s, y) => s + y, 0) / played) : 0;

  document.getElementById("st-played").textContent = played;
  document.getElementById("st-avg").textContent = avgYear;
  document.getElementById("st-best").textContent = bestYear;
  document.getElementById("st-streak").textContent = state.streak;

  // 1) Doseženo leto v zadnjih 14 odigranih dnevih (stolpci, en odtenek)
  const recent = entries.slice(-14);
  const trend = document.getElementById("stats-trend");
  if (recent.length === 0) {
    trend.innerHTML = '<p class="chart-empty">Odigraj prvi dnevni izziv, pa se bo tu izrisal tvoj napredek.</p>';
  } else {
    const best = Math.max(...recent.map(([, e]) => reachedYearOf(e)));
    trend.innerHTML = `
      <div class="trend-plot" role="list">
        ${recent
          .map(([key, e]) => {
            const yr = reachedYearOf(e);
            const h = Math.max(3, (yr / 2026) * 100);
            const [, mm, dd] = key.split("-");
            return `<div class="trend-col" role="listitem" data-tip="${formatSlovenianDate(key)} · Leto ${yr}" aria-label="${formatSlovenianDate(key)}: leto ${yr}">
              <span class="trend-val">${yr === best ? yr : ""}</span>
              <span class="trend-bar${yr === 2026 ? " perfect" : ""}" style="height: ${h}%"></span>
              <span class="trend-x">${Number(dd)}.<span class="trend-mm"> ${Number(mm)}.</span></span>
            </div>`;
          })
          .join("")}
      </div>
      <div class="trend-axis"><span>2026</span><span>1013</span><span>0</span></div>`;
  }

  // 2) Natančnost po obdobjih: povprečne točke na vprašanje (0–1000)
  const byId = new Map(SLOVENIAN_EVENTS.map((ev) => [ev.id, ev]));
  const agg = SLOVENIAN_ERAS.map((er) => ({ era: er, n: 0, pts: 0, diffSum: 0, diffN: 0 }));
  entries.forEach(([, e]) =>
    (e.guesses || []).forEach((g) => {
      const ev = byId.get(g.eventId);
      if (!ev) return;
      const a = agg[ev.era - 1];
      a.n++;
      a.pts += g.points || 0;
      if (!g.timedOut && typeof g.diff === "number") {
        a.diffSum += g.diff;
        a.diffN++;
      }
    })
  );
  const eraBox = document.getElementById("stats-eras");
  const withData = agg.filter((a) => a.n > 0);
  if (withData.length === 0) {
    eraBox.innerHTML = '<p class="chart-empty">Tu boš videl, v katerem obdobju si najmočnejši.</p>';
  } else {
    const weakest = withData.reduce((w, a) => (a.pts / a.n < w.pts / w.n ? a : w));
    eraBox.innerHTML =
      agg
        .map((a) => {
          const avg = a.n ? Math.round(a.pts / a.n) : 0;
          const diff = a.diffN ? Math.round(a.diffSum / a.diffN) : null;
          const label = a.n ? `${avg} tč${diff !== null ? ` · ±${diff} ${formatYearsWord(diff)}` : ""}` : "brez podatkov";
          return `<div class="era-row${a === weakest && withData.length > 1 ? " weakest" : ""}" data-tip="${a.era.code}. ${a.era.name}: ${a.n} vprašanj">
            <span class="era-name"><b>${a.era.code}</b>${a.era.rangeText}</span>
            <span class="era-track"><span class="era-fill" style="width: ${Math.max(a.n ? 2 : 0, avg / 10)}%"></span></span>
            <span class="era-val">${label}</span>
          </div>`;
        })
        .join("") +
      (withData.length > 1
        ? `<p class="era-note">Najšibkejši sklop: <strong>${weakest.era.code}. ${weakest.era.name}</strong></p>`
        : "");
  }

  // 3) Porazdelitev doseženih let
  const buckets = [
    { label: "Leto 2026", min: 2026, max: 2026, count: 0 },
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
  distContainer.innerHTML = buckets
    .map((b) => {
      const pct = b.count ? Math.max(6, Math.round((b.count / maxCount) * 100)) : 0;
      return `<div class="dist-row">
        <div class="dist-label">${b.label}</div>
        <div class="dist-bar-wrap"><div class="dist-bar" style="width: ${pct}%"></div></div>
        <div class="dist-count">${b.count}</div>
      </div>`;
    })
    .join("");
}

// ============================================================================
// ZBIRKA MEJNIKOV: odkleneš jih, ko jih časoplov preleti
// ============================================================================
let thumbRenderer = null;

function unlockPassedLandmarks(reachedYear) {
  const fresh = LANDMARKS.filter((lm) => lm.year <= reachedYear && !state.unlocked.includes(lm.type));
  if (fresh.length === 0) return;
  fresh.forEach((lm) => state.unlocked.push(lm.type));
  savePersistedState();
  renderCollectionCount();
  fresh.forEach((lm, i) =>
    setTimeout(() => {
      showToast(
        `<span class="toast-k">Nov mejnik v zbirki</span><strong>${lm.name}</strong><span class="toast-y">${lm.year}</span>`,
        () => openCollection(lm.type)
      );
      if (audio && i === 0) audio.unlockLandmark();
    }, 900 + i * 700)
  );
}

function renderCollectionCount() {
  const el = document.getElementById("collection-count");
  if (el) el.textContent = `${state.unlocked.length} / ${LANDMARKS.length} odklenjenih`;
  const bar = document.getElementById("collection-bar");
  if (bar) bar.style.width = `${(state.unlocked.length / LANDMARKS.length) * 100}%`;
}

function openCollection(focusType) {
  const grid = document.getElementById("collection-grid");
  if (!thumbRenderer) thumbRenderer = new EralySceneRenderer(document.createElement("canvas"), true);
  grid.innerHTML = "";
  LANDMARKS.forEach((lm) => {
    const unlocked = state.unlocked.includes(lm.type);
    const card = document.createElement("article");
    card.className = `coll-card${unlocked ? "" : " locked"}${focusType === lm.type ? " focus" : ""}`;
    card.innerHTML = `
      <canvas class="coll-thumb" aria-hidden="true"></canvas>
      <div class="coll-body">
        <div class="coll-year">${unlocked ? lm.year : "????"}</div>
        <div class="coll-name">${unlocked ? lm.name : "Še neodkrit mejnik"}</div>
        <p class="coll-desc">${unlocked ? lm.desc : "Preleti ga s časoplovom, da ga odkleneš."}</p>
      </div>`;
    grid.appendChild(card);
    const cv = card.querySelector("canvas");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = 220;
    const h = 120;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    thumbRenderer.drawLandmarkThumb(ctx, w, h, lm, unlocked);
  });
  document.getElementById("collection-summary").textContent = `${state.unlocked.length} od ${LANDMARKS.length} mejnikov odklenjenih`;
  openModal("modal-collection");
  const focus = grid.querySelector(".focus");
  if (focus) setTimeout(() => focus.scrollIntoView({ block: "nearest", behavior: "smooth" }), 250);
}

// ============================================================================
// OBVESTILA (TOAST) IN MODALNA OKNA
// ============================================================================
function showToast(html, onClick) {
  const wrap = document.getElementById("toast-wrap");
  const t = document.createElement("button");
  t.type = "button";
  t.className = "toast";
  t.innerHTML = html;
  t.addEventListener("click", () => {
    t.remove();
    if (onClick) onClick();
  });
  wrap.appendChild(t);
  setTimeout(() => t.classList.add("out"), 4200);
  setTimeout(() => t.remove(), 4700);
}

let lastFocusBeforeModal = null;

function openModal(id) {
  const m = document.getElementById(id);
  lastFocusBeforeModal = document.activeElement;
  m.classList.add("visible");
  const closeBtn = m.querySelector(".btn-close-modal");
  if (closeBtn) setTimeout(() => closeBtn.focus(), 30);
}

function closeModal(id) {
  const m = document.getElementById(id);
  m.classList.remove("visible");
  if (lastFocusBeforeModal && document.contains(lastFocusBeforeModal)) lastFocusBeforeModal.focus();
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
  observeCanvasVisibility();

  // Brskalniki dovolijo zvok šele po prvi interakciji uporabnika
  const unlockAudio = () => {
    if (audio) audio.unlock();
    window.removeEventListener("pointerdown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
  };
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);

  const soundBtn = document.getElementById("btn-sound-toggle");
  const syncSoundBtn = () => {
    const on = audio ? audio.enabled : false;
    document.getElementById("sound-icon").setAttribute("href", on ? "#i-sound" : "#i-mute");
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    soundBtn.title = on ? "Izklopi zvok in vibracijo" : "Vklopi zvok in vibracijo";
    soundBtn.setAttribute("aria-label", soundBtn.title);
  };
  if (soundBtn) {
    if (!audio) soundBtn.hidden = true;
    syncSoundBtn();
    soundBtn.addEventListener("click", () => {
      if (!audio) return;
      audio.setEnabled(!audio.enabled);
      syncSoundBtn();
    });
  }

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
  document.getElementById("btn-home").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      showMenuView();
    }
  });
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
    updateSliderBubble();
  });

  slider.addEventListener("input", () => {
    yearInput.value = slider.value;
    updateSliderBubble();
  });

  document.getElementById("timeline-ticks").addEventListener("click", (e) => {
    const tick = e.target.closest("span[data-year]");
    if (!tick) return;
    const y = tick.getAttribute("data-year");
    yearInput.value = y;
    slider.value = y;
    updateSliderBubble();
    if (!IS_TOUCH) yearInput.focus();
  });

  document.querySelectorAll(".step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = parseInt(btn.getAttribute("data-step"), 10);
      const curr = parseInt(yearInput.value, 10) || Number(slider.value);
      const next = Math.max(1, Math.min(2026, curr + step));
      yearInput.value = next;
      slider.value = next;
      updateSliderBubble();
      if (!IS_TOUCH) yearInput.focus();
    });
  });

  // Klik na nebo med poletom preskoči animacijo
  document.getElementById("eraly-canvas-viewport").addEventListener("click", () => {
    if (finale.active) {
      finishFinale(true);
      return;
    }
    if (gameScene) gameScene.skipFlight();
  });
  document.getElementById("finale-skip").addEventListener("click", () => finishFinale(true));

  // Oddaja odgovora in naslednje vprašanje
  document.getElementById("btn-submit-year").addEventListener("click", submitCurrentGuess);
  document.getElementById("btn-next-round").addEventListener("click", advanceToNextRound);

  // Tipka Enter
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (state.view !== "game") return;
      const statsOpen = document.getElementById("modal-stats").classList.contains("visible");
      const rulesOpen = document.getElementById("modal-rules").classList.contains("visible");
      const collOpen = document.getElementById("modal-collection").classList.contains("visible");
      if (statsOpen || rulesOpen || collOpen) return;

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
  document.getElementById("btn-share-result").addEventListener("click", shareResultImage);
  document.getElementById("btn-copy-result").addEventListener("click", shareResultToClipboard);
  updateCountdowns();
  setInterval(updateCountdowns, 1000);
  document.getElementById("btn-summary-play-more").addEventListener("click", () => {
    startFreeplayGame();
  });

  // Modala za statistiko in pravila
  const openStats = () => {
    renderStatsModal();
    openModal("modal-stats");
  };
  document.getElementById("btn-open-stats").addEventListener("click", openStats);
  document.getElementById("btn-streak").addEventListener("click", openStats);
  document.getElementById("btn-open-rules").addEventListener("click", () => openModal("modal-rules"));
  document.getElementById("btn-menu-open-collection").addEventListener("click", () => openCollection());
  document.getElementById("btn-summary-collection").addEventListener("click", () => openCollection());
  // Tiho naknadno odklepanje za igralce z obstoječo zgodovino
  const bestEver = Math.max(0, ...Object.values(state.dailyHistory).map(reachedYearOf));
  LANDMARKS.forEach((lm) => {
    if (lm.year <= bestEver && !state.unlocked.includes(lm.type)) state.unlocked.push(lm.type);
  });
  renderCollectionCount();

  document.querySelectorAll(".btn-close-modal").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close")));
  });

  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".modal-backdrop.visible");
    if (open) closeModal(open.id);
  });

  // Zasebne sobe (rooms.js)
  if (window.CasolovRooms) window.CasolovRooms.init();
});
