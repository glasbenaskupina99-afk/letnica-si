// ============================================================================
// ČASOLOV — SKUPNO JEDRO IGRE (brskalnik + strežnik)
// Izbor dnevnih dogodkov in točkovanje. Brskalnik ga naloži kot navaden
// <script>, Cloudflare Worker ga uvozi; oba zato računata popolnoma enako.
// ============================================================================

// Prvi dnevni izziv (#1). Vsak naslednji dan ob polnoči po lokalnem času se
// začne nov izziv z naslednjo številko, prejšnji pa ostane v koledarju.
const EPOCH_START = new Date(2026, 10, 18);

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

// Številka izziva po koledarskih dneh (neodvisno od premika ure poleti/pozimi)
function getDayNumberFromDateKey(dateKey) {
  return Math.max(1, getDayIndexFromDateKey(dateKey) + 1);
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

  return orderDailyEvents(dateKey, chosen);
}

// Od tega dne naprej so obdobja v dnevnem izzivu premešana (prej kronološko).
// Starejši dnevi ostanejo nespremenjeni, da shranjeni rezultati veljajo naprej.
const MIXED_ORDER_FROM = "2026-11-20";

function orderDailyEvents(dateKey, events) {
  const sorted = events.slice().sort((a, b) => a.year - b.year);
  if (dateKey < MIXED_ORDER_FROM) return sorted;
  const rng = seededRandom(hashString(`CASOLOV_ORDER_${dateKey}`));
  const mixed = sorted.slice();
  for (let i = mixed.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
  }
  // Nikoli povsem kronološko: v tem primeru zamaknemo vrstni red
  if (mixed.every((e, i) => e === sorted[i])) mixed.push(mixed.shift());
  return mixed;
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

// ============================================================================
// PREVERJANJE ODDANEGA DNEVNEGA REZULTATA (uporablja strežnik)
// Odgovori so letnice ali null (potekel čas); točke izračunamo sami.
// ============================================================================
function scoreDailyAnswers(dateKey, answers) {
  const events = getDailyEventsForDateKey(dateKey);
  if (!Array.isArray(answers) || answers.length !== events.length) {
    throw new Error("Pričakovanih je natanko 5 odgovorov.");
  }
  const guesses = events.map((ev, i) => {
    const raw = answers[i];
    if (raw === null || raw === undefined) {
      return { eventId: ev.id, guessYear: null, actualYear: ev.year, diff: null, points: 0, tier: "tier-miss", emoji: "⏰", timedOut: true };
    }
    const guessYear = Number(raw);
    if (!Number.isInteger(guessYear) || guessYear < 1 || guessYear > 2026) {
      throw new Error("Letnica mora biti celo število med 1 in 2026.");
    }
    const { points, tier, emoji } = calculateScore(guessYear, ev.year, ev.era);
    return { eventId: ev.id, guessYear, actualYear: ev.year, diff: Math.abs(guessYear - ev.year), points, tier, emoji, timedOut: false };
  });
  const points = guesses.reduce((sum, g) => sum + g.points, 0);
  return {
    guesses,
    points,
    reachedYear: computeJourneyYearFromGuesses(guesses),
    exactCount: guesses.filter((g) => !g.timedOut && g.diff === 0).length,
    emojis: guesses.map((g) => g.emoji).join("")
  };
}

// Za strežnik (ES modul) tudi kot lastnost globalnega objekta
globalThis.CasolovCore = {
  EPOCH_START,
  formatDateKey,
  getDayNumberFromDateKey,
  getDayIndexFromDateKey,
  getDailyEventsForDateKey,
  calculateScore,
  computeJourneyYearFromGuesses,
  scoreDailyAnswers
};
