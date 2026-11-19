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

  const ip = request.headers.get("cf-connecting-ip") || "neznan";
  const visitor = (await sha256(`${ip}|${await dailySalt(env, day)}`)).slice(0, 16);

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
export async function statsPage(env, url) {
  const key = url.searchParams.get("k") || "";
  const ok = env.STATS_KEY_SHA256 && key && (await sha256(key)) === env.STATS_KEY_SHA256;
  if (!ok) {
    return new Response("Ni dostopa.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
  }

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
</style></head>
<body><main>
  <h1>Časolov · <span>statistika iger</span></h1>
  <p class="muted">Danes je ${fmt(today)}. »Igralci« so različni obiskovalci na dan (iz IP-naslova in dnevno spremenljive vrednosti; IP-naslovi se ne shranjujejo). Isti igralec je na različne dni štet ločeno.</p>

  <div class="cards">
    <div class="card"><b>${n(totals.games)}</b><span>vseh odigranih iger</span></div>
    <div class="card"><b>${n(totals.daily)}</b><span>dnevnih izzivov</span></div>
    <div class="card"><b>${n(totals.free)}</b><span>prostih iger</span></div>
    <div class="card"><b>${n(totals.avg_year)}</b><span>povprečno doseženo leto</span></div>
    <div class="card"><b>${n(totals.landings)}</b><span>pristankov v letu 2026</span></div>
  </div>
  <p class="muted">Štetje teče od ${totals.first_day ? fmt(totals.first_day) : "prve odigrane igre"}.</p>

  <h2>Zadnjih 30 dni</h2>
  <div class="scroll"><table>
    <thead><tr><th>Dan</th><th class="r">Igralci</th><th class="r">Dnevni izziv</th><th class="r">Proste igre</th><th class="r">Povp. leto</th><th class="r">Pristanki 2026</th></tr></thead>
    <tbody>${
      daily.length
        ? daily
            .map(
              (d) =>
                `<tr><td>${fmt(d.day)}</td><td class="r"><b>${n(d.players)}</b></td><td class="r">${n(d.daily)}</td><td class="r">${n(d.free)}</td><td class="r">${n(d.avg_year)}</td><td class="r">${n(d.landings)}</td></tr>`
            )
            .join("")
        : `<tr><td colspan="6" class="muted">Še ni odigranih iger.</td></tr>`
    }</tbody>
  </table></div>

  <h2>Najtežji dogodki (zadnjih 30 dni)</h2>
  <div class="scroll">${evTable(hardest)}</div>

  <h2>Najlažji dogodki (zadnjih 30 dni)</h2>
  <div class="scroll">${evTable(easiest)}</div>
</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
