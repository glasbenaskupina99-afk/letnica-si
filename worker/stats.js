// ============================================================================
// ČASOLOV — anonimna statistika odigranih iger
//   POST /api/play      ob koncu igre (dnevni izziv ali prosta igra)
//   GET  /statistika    zasebna stran s statistiko (?k=<ključ>)
//
// Zasebnost: IP-naslova ne shranimo. Iz njega in naključne vrednosti, ki se
// zamenja vsak dan in se po dveh dneh izbriše, izračunamo kratko oznako
// obiskovalca. Tako lahko štejemo različne igralce na dan, oznak pa ni mogoče
// povezati med dnevi ali nazaj z IP-naslovom.
// ============================================================================

import { todayKeyLjubljana } from "./pages.js";

// Dan, ko se je začelo štetje vseh iger
const COUNTING_FROM = "2026-11-19";

const EVENTS_BY_ID = new Map(globalThis.SLOVENIAN_EVENTS.map((e) => [e.id, e]));

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function shiftKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function timingSafeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function dailySalt(env, day) {
  const row = await env.DB.prepare("SELECT salt FROM stats_salts WHERE day = ?").bind(day).first();
  if (row) return row.salt;
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  const salt = [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT OR IGNORE INTO stats_salts (day, salt) VALUES (?, ?)").bind(day, salt).run();
  // Stare vrednosti izbrišemo: oznak iz preteklih dni ni več mogoče obnoviti
  await env.DB.prepare("DELETE FROM stats_salts WHERE day < ?").bind(shiftKey(day, -1)).run();
  const again = await env.DB.prepare("SELECT salt FROM stats_salts WHERE day = ?").bind(day).first();
  return again.salt;
}

async function visitorHash(env, request, day = todayKeyLjubljana()) {
  const ip = request.headers.get("cf-connecting-ip") || "neznan";
  return (await sha256(`${ip}|${await dailySalt(env, day)}`)).slice(0, 16);
}

// Omejitev števila dejanj na obiskovalca na dan (zaščita brezplačne kvote pred boti)
// Velikodušno, ker si šola ali podjetje lahko deli en IP-naslov
export const LIMITS_PER_DAY = { player: 60, room: 30, join: 150, freeplay: 200, login: 10 };

export async function rateLimit(env, request, action, HttpError) {
  const max = LIMITS_PER_DAY[action];
  if (!max) return;
  const day = todayKeyLjubljana();
  const visitor = await visitorHash(env, request, day);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (day, visitor, action, n) VALUES (?, ?, ?, 1)
     ON CONFLICT(day, visitor, action) DO UPDATE SET n = n + 1
     RETURNING n`
  )
    .bind(day, visitor, action)
    .first();
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM rate_limits WHERE day < ?").bind(shiftKey(day, -2)).run();
  }
  if (row && row.n > max) throw new HttpError(429, "Danes je bilo s te povezave preveč zahtevkov. Poskusi znova jutri.");
}

// ---------------------------------------------------------------- prijava v statistiko
const COOKIE = "casolov_stats";

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function isStatsOwner(request, env) {
  const c = readCookie(request, COOKIE);
  return !!(c && env.STATS_COOKIE_SHA256 && timingSafeEqual(await sha256(c), env.STATS_COOKIE_SHA256));
}

async function keyIsValid(env, key) {
  return !!(key && env.STATS_KEY_SHA256 && timingSafeEqual(await sha256(key), env.STATS_KEY_SHA256));
}

function loginCookieHeader(value, maxAge) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function loginPage(error = "") {
  return new Response(
    `<!DOCTYPE html><html lang="sl"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" /><title>Prijava — Časolov</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #060a14; color: #eef2f8; font: 15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; }
  form { width: min(360px, 90vw); background: #0f1729; border: 1px solid rgba(160,174,200,.2); border-radius: 18px; padding: 26px; }
  h1 { font-size: 20px; margin: 0 0 14px; } h1 span { color: #f5b942; }
  input { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 11px; border: 1px solid rgba(160,174,200,.3); background: #060a14; color: #eef2f8; font-size: 16px; }
  button { width: 100%; margin-top: 12px; padding: 12px; border: 0; border-radius: 11px; background: #f5b942; color: #1a1203; font-weight: 800; font-size: 15px; cursor: pointer; }
  .err { color: #f87171; margin: 0 0 10px; font-size: 14px; }
</style></head><body>
<form method="post" action="/statistika">
  <h1>Časolov · <span>statistika</span></h1>
  ${error ? `<p class="err">${esc(error)}</p>` : ""}
  <input type="password" name="k" placeholder="Ključ" autocomplete="current-password" autofocus required />
  <button type="submit">Prijava</button>
</form></body></html>`,
    { status: error ? 403 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } }
  );
}

// GET/POST /statistika: prijava s ključem → piškotek (30 dni); ključ ne ostane v naslovu
export async function statsRoute(request, env, url, Core, HttpError) {
  const redirectHome = (cookie) =>
    new Response(null, {
      status: 303,
      headers: { location: "/statistika", "set-cookie": loginCookieHeader(cookie, 60 * 60 * 24 * 30), "cache-control": "no-store" }
    });

  if (url.searchParams.get("odjava") !== null) {
    return new Response(null, { status: 303, headers: { location: "/statistika", "set-cookie": loginCookieHeader("", 0) } });
  }

  let key = null;
  if (request.method === "POST") {
    try {
      await rateLimit(env, request, "login", HttpError);
    } catch {
      return loginPage("Preveč poskusov prijave. Poskusi znova jutri.");
    }
    const form = await request.formData().catch(() => null);
    key = form ? String(form.get("k") || "") : "";
    if (!(await keyIsValid(env, key))) return loginPage("Napačen ključ.");
  } else if (url.searchParams.get("k")) {
    key = url.searchParams.get("k");
    if (!(await keyIsValid(env, key))) return loginPage("Napačen ključ.");
  }
  if (key) return redirectHome(await sha256(`casolov-stats-cookie|${key}`));

  if (!(await isStatsOwner(request, env))) return loginPage();
  return statsPage(env, url, Core);
}

export async function recordPlay(request, env, Core, json, HttpError) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Neveljaven zahtevek.");
  }
  const mode = body.mode === "daily" ? "daily" : body.mode === "freeplay" ? "freeplay" : null;
  if (!mode) throw new HttpError(400, "Neznan način igre.");
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 5) : [];
  if (answers.length !== 5) throw new HttpError(400, "Pričakovanih je 5 odgovorov.");

  const day = todayKeyLjubljana();
  let challengeDate = null;
  let scored;

  if (mode === "daily") {
    challengeDate = String(body.dateKey || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(challengeDate) || challengeDate > shiftKey(day, 1)) {
      throw new HttpError(400, "Neveljaven datum izziva.");
    }
    if (challengeDate < Core.formatDateKey(Core.EPOCH_START)) throw new HttpError(400, "Za ta dan izziv ne obstaja.");
    let r;
    try {
      r = Core.scoreDailyAnswers(challengeDate, answers.map((a) => (a && a.y != null ? a.y : null)));
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    scored = r.guesses.map((g) => ({ e: g.eventId, d: g.timedOut ? null : g.diff, p: g.points }));
  } else {
    scored = answers.map((a) => {
      const ev = EVENTS_BY_ID.get(String(a && a.e));
      if (!ev) throw new HttpError(400, "Neznan dogodek.");
      if (a.y == null) return { e: ev.id, d: null, p: 0 };
      const y = Number(a.y);
      if (!Number.isInteger(y) || y < 1 || y > 2026) throw new HttpError(400, "Neveljavna letnica.");
      return { e: ev.id, d: Math.abs(y - ev.year), p: Core.calculateScore(y, ev.year, ev.era).points };
    });
  }

  const guessesForYear = scored.map((s) => ({ points: s.p, diff: s.d, timedOut: s.d === null }));
  const reachedYear = Core.computeJourneyYearFromGuesses(guessesForYear);
  const points = scored.reduce((sum, s) => sum + s.p, 0);
  const exact = scored.filter((s) => s.d === 0).length;
  const timeouts = scored.filter((s) => s.d === null).length;

  if (mode === "freeplay") await rateLimit(env, request, "freeplay", HttpError);
  const visitor = await visitorHash(env, request, day);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO plays (day, mode, challenge_date, visitor, reached_year, points, exact_count, timeouts, answers, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(day, mode, challengeDate, visitor, reachedYear, points, exact, timeouts, JSON.stringify(scored.map(({ e, d }) => ({ e, d }))), Date.now())
    .run();

  // Občasno počistimo zapise, starejše od 400 dni
  if (Math.random() < 0.01) {
    await env.DB.prepare("DELETE FROM plays WHERE day < ?").bind(shiftKey(day, -400)).run();
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------- zasebna stran
async function statsPage(env, url, Core) {
  const today = todayKeyLjubljana();
  const from = shiftKey(today, -29);

  const daily = (
    await env.DB.prepare(
      `SELECT day,
              SUM(mode = 'daily') AS daily,
              SUM(mode = 'freeplay') AS free,
              COUNT(DISTINCT visitor) AS players,
              ROUND(AVG(reached_year)) AS avg_year,
              SUM(reached_year = 2026) AS landings
         FROM plays WHERE day >= ? GROUP BY day ORDER BY day DESC`
    )
      .bind(from)
      .all()
  ).results;

  // Igre v sobah (shranjene že od začetka igre, 18. 11. 2026) — za dneve pred štetjem
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Ljubljana", year: "numeric", month: "2-digit", day: "2-digit" });
  const roomRows = (await env.DB.prepare("SELECT player_id, created_at, reached_year FROM results WHERE created_at >= ?").bind(Date.parse(from + "T00:00:00Z") - 86400000).all()).results;
  const roomByDay = new Map();
  for (const r of roomRows) {
    const d = dayFmt.format(new Date(r.created_at));
    if (d < from) continue;
    const x = roomByDay.get(d) || { games: 0, players: new Set() };
    x.games++;
    x.players.add(r.player_id);
    roomByDay.set(d, x);
  }
  const playsByDay = new Map(daily.map((d) => [d.day, d]));
  const epochKey = Core.formatDateKey(Core.EPOCH_START);
  const allDays = [];
  for (let k = today; k >= from && k >= epochKey; k = shiftKey(k, -1)) allDays.push(k);

  // Danes: vse igre današnjega dne (po slovenskem času)
  const todayRows = (
    await env.DB.prepare("SELECT mode, challenge_date, visitor, reached_year, points, exact_count, answers, created_at FROM plays WHERE day = ?")
      .bind(today)
      .all()
  ).results;
  const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Ljubljana", hour: "2-digit", hour12: false });
  const byHour = Array(24).fill(0);
  for (const r of todayRows) byHour[Number(hourFmt.format(new Date(r.created_at))) % 24]++;
  const todayDaily = todayRows.filter((r) => r.mode === "daily" && r.challenge_date === today);
  const tStats = {
    games: todayRows.length,
    players: new Set(todayRows.map((r) => r.visitor)).size,
    daily: todayRows.filter((r) => r.mode === "daily").length,
    free: todayRows.filter((r) => r.mode === "freeplay").length,
    avgYear: todayRows.length ? Math.round(todayRows.reduce((a, r) => a + r.reached_year, 0) / todayRows.length) : 0,
    best: todayRows.length ? Math.max(...todayRows.map((r) => r.reached_year)) : 0,
    landings: todayRows.filter((r) => r.reached_year === 2026).length
  };
  // Današnji izziv po vprašanjih
  const todayEvents = Core.getDailyEventsForDateKey(today);
  const perQ = todayEvents.map((ev) => {
    let n = 0, sum = 0, exact = 0, timeouts = 0;
    for (const r of todayDaily) {
      let list;
      try {
        list = JSON.parse(r.answers);
      } catch {
        continue;
      }
      const a = list.find((x) => x.e === ev.id);
      if (!a) continue;
      n++;
      if (a.d === null) timeouts++;
      else {
        sum += a.d;
        if (a.d === 0) exact++;
      }
    }
    return { ev, n, avg: n > timeouts ? sum / (n - timeouts) : null, exactPct: n ? Math.round((exact / n) * 100) : 0, timeouts };
  });
  const dayNum = Core.getDayNumberFromDateKey(today);
  const maxHour = Math.max(1, ...byHour);

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS games, SUM(mode = 'daily') AS daily, SUM(mode = 'freeplay') AS free,
            ROUND(AVG(reached_year)) AS avg_year, SUM(reached_year = 2026) AS landings, MIN(day) AS first_day
       FROM plays`
  ).first();

  // Najtežji in najlažji dogodki (zadnjih 30 dni, vsaj 3 odgovori)
  const rows = (await env.DB.prepare("SELECT answers FROM plays WHERE day >= ?").bind(from).all()).results;
  const agg = new Map();
  for (const r of rows) {
    let list;
    try {
      list = JSON.parse(r.answers);
    } catch {
      continue;
    }
    for (const a of list) {
      const s = agg.get(a.e) || { n: 0, sum: 0, exact: 0, timeouts: 0 };
      s.n++;
      if (a.d === null) s.timeouts++;
      else {
        s.sum += a.d;
        if (a.d === 0) s.exact++;
      }
      agg.set(a.e, s);
    }
  }
  const evRows = [...agg.entries()]
    .filter(([, s]) => s.n >= 3 && s.n > s.timeouts)
    .map(([id, s]) => ({ id, ev: EVENTS_BY_ID.get(id), n: s.n, avg: s.sum / (s.n - s.timeouts), exactPct: Math.round((s.exact / s.n) * 100) }))
    .filter((r) => r.ev);
  const hardest = [...evRows].sort((a, b) => b.avg - a.avg).slice(0, 10);
  const easiest = [...evRows].sort((a, b) => a.avg - b.avg).slice(0, 10);

  const fmt = (k) => {
    const [y, m, d] = k.split("-").map(Number);
    return `${d}. ${m}. ${y}`;
  };
  const n = (v) => (v == null ? 0 : v);
  const evTable = (list) =>
    list.length
      ? `<table><thead><tr><th>Dogodek</th><th>Leto</th><th class="r">Odgovorov</th><th class="r">Povp. odstopanje</th><th class="r">Točno</th></tr></thead><tbody>${list
          .map(
            (r) =>
              `<tr><td>${esc(r.ev.title)}</td><td>${r.ev.year}</td><td class="r">${r.n}</td><td class="r">${r.avg.toFixed(1)} let</td><td class="r">${r.exactPct} %</td></tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="muted">Še premalo podatkov (vsaj 3 odgovori na dogodek).</p>`;

  const html = `<!DOCTYPE html>
<html lang="sl"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" /><title>Statistika — Časolov</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #060a14; color: #eef2f8; font: 15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 28px 16px 60px; }
  h1 { font-size: 26px; margin: 0 0 4px; } h1 span { color: #f5b942; }
  h2 { font-size: 17px; margin: 32px 0 10px; color: #f5b942; }
  .muted { color: #8592a8; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 18px; }
  .card { background: #0f1729; border: 1px solid rgba(160,174,200,.18); border-radius: 14px; padding: 14px 16px; }
  .card b { display: block; font-size: 28px; font-variant-numeric: tabular-nums; }
  .card span { color: #8592a8; font-size: 13px; }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(160,174,200,.14); white-space: nowrap; }
  td:first-child { white-space: normal; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #8592a8; }
  .r { text-align: right; }
  .today { border: 1px solid rgba(245,185,66,.4); background: rgba(245,185,66,.07); border-radius: 18px; padding: 18px 18px 8px; margin-top: 20px; }
  .today h2 { margin-top: 0; }
  .today .card { background: rgba(6,10,20,.55); }
  .hours { display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px; align-items: end; height: 90px; margin: 14px 0 4px; }
  .hours div { background: #f5b942; border-radius: 3px 3px 0 0; min-height: 2px; position: relative; }
  .hours div.zero { background: rgba(160,174,200,.18); }
  .hlabels { display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px; font-size: 10px; color: #8592a8; text-align: center; }
</style></head>
<body><main>
  <h1>Časolov · <span>statistika iger</span> <a href="/statistika?odjava" style="float:right;font-size:13px;color:#8592a8;font-weight:500">Odjava</a></h1>
  <p class="muted">Danes je ${fmt(today)}. »Igralci« so različni obiskovalci na dan (iz IP-naslova in dnevno spremenljive vrednosti; IP-naslovi se ne shranjujejo). Isti igralec je na različne dni štet ločeno.</p>

  <section class="today">
    <h2>Danes · ${fmt(today)} · izziv #${dayNum}</h2>
    <div class="cards" style="margin-top:6px;grid-template-columns:repeat(auto-fit,minmax(125px,1fr))">
      <div class="card"><b>${tStats.players}</b><span>različnih igralcev</span></div>
      <div class="card"><b>${tStats.games}</b><span>odigranih iger</span></div>
      <div class="card"><b>${tStats.daily}</b><span>dnevnih izzivov</span></div>
      <div class="card"><b>${tStats.free}</b><span>prostih iger</span></div>
      <div class="card"><b>${tStats.avgYear}</b><span>povprečno leto</span></div>
      <div class="card"><b>${tStats.best}</b><span>najdlje (${tStats.landings}× v 2026)</span></div>
    </div>

    <h2 style="font-size:14px;margin-top:22px">Igre po urah</h2>
    <div class="hours">${byHour
      .map((c, h) => `<div class="${c ? "" : "zero"}" style="height:${c ? Math.max(6, (c / maxHour) * 100) : 2}%" title="${h}:00 — ${c} iger"></div>`)
      .join("")}</div>
    <div class="hlabels">${byHour.map((_, h) => `<span>${h % 3 === 0 ? h : ""}</span>`).join("")}</div>

    <h2 style="font-size:14px;margin-top:22px">Današnji izziv po vprašanjih · odigran ${todayDaily.length}-krat</h2>
    <div class="scroll"><table>
      <thead><tr><th>#</th><th>Dogodek</th><th>Leto</th><th class="r">Povp. odstopanje</th><th class="r">Točno</th><th class="r">Potekel čas</th></tr></thead>
      <tbody>${perQ
        .map(
          (q, i) =>
            `<tr><td>${i + 1}</td><td>${esc(q.ev.title)}</td><td>${q.ev.year}</td><td class="r">${q.avg === null ? "–" : q.avg.toFixed(1) + " let"}</td><td class="r">${q.n ? q.exactPct + " %" : "–"}</td><td class="r">${q.timeouts}</td></tr>`
        )
        .join("")}</tbody>
    </table></div>
  </section>

  <h2>Skupaj</h2>
  <div class="cards">
    <div class="card"><b>${n(totals.games)}</b><span>vseh odigranih iger</span></div>
    <div class="card"><b>${n(totals.daily)}</b><span>dnevnih izzivov</span></div>
    <div class="card"><b>${n(totals.free)}</b><span>prostih iger</span></div>
    <div class="card"><b>${n(totals.avg_year)}</b><span>povprečno doseženo leto</span></div>
    <div class="card"><b>${n(totals.landings)}</b><span>pristankov v letu 2026</span></div>
  </div>
  <p class="muted">Štetje vseh iger teče od ${fmt(COUNTING_FROM)}. Za dneve prej so znane le igre igralcev v sobah (zadnji stolpec spodaj); obisk strani za vse dni vidiš v Cloudflaru (casolov.si → Analytics).</p>

  <h2>Zadnjih 30 dni</h2>
  <div class="scroll"><table>
    <thead><tr><th>Dan</th><th class="r">Igralci</th><th class="r">Dnevni izziv</th><th class="r">Proste igre</th><th class="r">Povp. leto</th><th class="r">Pristanki 2026</th><th class="r">Igre v sobah</th></tr></thead>
    <tbody>${allDays
      .map((day) => {
        const d = playsByDay.get(day) || {};
        const r = roomByDay.get(day);
        const before = day < COUNTING_FROM;
        return `<tr><td>${fmt(day)}${before ? ' <span class="muted">· pred štetjem</span>' : ""}</td><td class="r"><b>${before ? "–" : n(d.players)}</b></td><td class="r">${before ? "–" : n(d.daily)}</td><td class="r">${before ? "–" : n(d.free)}</td><td class="r">${before ? "–" : n(d.avg_year)}</td><td class="r">${before ? "–" : n(d.landings)}</td><td class="r">${r ? `${r.games} (${r.players.size} ${r.players.size === 1 ? "igralec" : r.players.size === 2 ? "igralca" : r.players.size <= 4 ? "igralci" : "igralcev"})` : 0}</td></tr>`;
      })
      .join("")}</tbody>
  </table></div>

  <h2>Najtežji dogodki (zadnjih 30 dni)</h2>
  <div class="scroll">${evTable(hardest)}</div>

  <h2>Najlažji dogodki (zadnjih 30 dni)</h2>
  <div class="scroll">${evTable(easiest)}</div>
</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
