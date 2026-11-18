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

// Deterministično premešan vrstni red dogodkov enega sklopa za en »cikel«.
// Vsak cikel traja toliko dni, kolikor ima sklop dogodkov.
function shuffledEraOrder(eraId, poolSize, cycle) {
  const rng = seededRandom(hashString(`LETNICA_SI_ERA_${eraId}_CYCLE_${cycle}`));
  const order = Array.from({ length: poolSize }, (_, i) => i);
  for (let i = poolSize - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const eraCycleCache = new Map();

// Vsak nov cikel nastane iz prejšnjega: dogodki iz prve polovice prejšnjega
// cikla se premešajo samo med seboj, prav tako tisti iz druge polovice.
// Tako je med dvema pojavitvama istega dogodka vedno vsaj pol cikla (≥ 51 dni).
function getEraCycleOrder(eraId, poolSize, cycle) {
  const key = `${eraId}:${poolSize}:${cycle}`;
  if (eraCycleCache.has(key)) return eraCycleCache.get(key);

  let order;
  if (cycle <= 0) {
    order = shuffledEraOrder(eraId, poolSize, cycle);
  } else {
    const prev = getEraCycleOrder(eraId, poolSize, cycle - 1);
    const half = Math.floor(poolSize / 2);
    const rng = seededRandom(hashString(`LETNICA_SI_ERA_${eraId}_MIX_${cycle}`));
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    order = shuffle(prev.slice(0, half)).concat(shuffle(prev.slice(half)));
  }

  eraCycleCache.set(key, order);
  return order;
}

function getDayIndexFromDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const epochUtc = Date.UTC(EPOCH_START.getFullYear(), EPOCH_START.getMonth(), EPOCH_START.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - epochUtc) / 86400000);
}

// Dnevni izziv: iz vsakega sklopa en dogodek; znotraj sklopa se noben dogodek
// ne ponovi, dokler niso na vrsti vsi (pri 100 dogodkih = 100 dni).
function getDailyEventsForDateKey(dateKey) {
  const dayIndex = getDayIndexFromDateKey(dateKey);
  const chosen = [];

  for (let eraId = 1; eraId <= 5; eraId++) {
    const pool = SLOVENIAN_EVENTS.filter((e) => e.era === eraId).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
    const n = pool.length;
    const cycle = Math.floor(dayIndex / n);
    const pos = ((dayIndex % n) + n) % n;
    const order = getEraCycleOrder(eraId, n, cycle);
    chosen.push(pool[order[pos]]);
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
function showMenuView() {
  stopRoundTimer();
  state.view = "menu";
  document.body.dataset.era = "0";

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
  state.view = "archive";
  document.body.dataset.era = "0";

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

  timerCard.style.display = "";
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
  const slider = document.getElementById("timeline-slider");
  yearInput.value = "";
  slider.value = 1;

  document.getElementById("guess-panel").style.display = "block";
  document.getElementById("round-result").classList.remove("visible", "in-flight", "revealed");

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
}

function advanceToNextRound() {
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
    const label = document.querySelector("#btn-share-result .btn-label");
    const orig = label.textContent;
    label.textContent = "Skopirano v odložišče ✓";
    setTimeout(() => {
      label.textContent = orig;
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
    card.className = "archive-day-card" + (saved ? " completed" : "") + (offset === 0 && !saved ? " is-today" : "");
    card.style.animation = `cardEnter 0.45s var(--ease-out) ${offset * 0.025}s both`;
    const yearReached = saved
      ? saved.reachedYear ?? computeJourneyYearFromGuesses(saved.guesses)
      : null;
    const pct = saved ? Math.max(3, Math.round((yearReached / 2026) * 100)) : 0;

    card.innerHTML = `
      ${offset === 0 ? '<span class="adc-today">DANES</span>' : ""}
      <div class="adc-top">
        <span class="adc-num">#${dayNum}</span>
        <span class="adc-date">${formatSlovenianDate(dKey)}</span>
      </div>
      <div class="adc-status">
        ${saved
          ? `<svg class="ic"><use href="#i-check" /></svg>Leto ${yearReached} / 2026`
          : `<svg class="ic play-ic"><use href="#i-play" /></svg>Poleti`}
      </div>
      <div class="adc-bar"><i style="width: ${pct}%"></i></div>
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

  // Klik na nebo med poletom preskoči animacijo
  document.getElementById("eraly-canvas-viewport").addEventListener("click", () => {
    if (gameScene) gameScene.skipFlight();
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
