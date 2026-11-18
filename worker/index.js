// ============================================================================
// ČASOLOV — Cloudflare Worker
// Streže igro (statične datoteke) in API za zasebne sobe:
//   igralci brez prijave (vzdevek + skrivni ključ v brskalniku),
//   sobe s kodo za povabilo, dnevni rezultati, ki jih strežnik izračuna sam.
// ============================================================================

import "../public/events.js";
import "../public/core.js";
import { archiveIndex, archiveDay, sitemap } from "./pages.js";

const Core = globalThis.CasolovCore;

const LIMITS = {
  nameMax: 24,
  roomNameMax: 40,
  membersPerRoom: 50,
  roomsPerPlayer: 30
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // brez 0/O, 1/I

// ----------------------------------------------------------------------------
// Pomožne funkcije
// ----------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Zahteva nima veljavnega JSON telesa.");
  }
}

function cleanName(raw, max, what) {
  const name = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) throw new HttpError(400, `${what} ne sme biti prazen.`);
  if ([...name].length > max) throw new HttpError(400, `${what} je lahko dolg največ ${max} znakov.`);
  return name;
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomCode(length = 8) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isValidDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Dovoljeni so dnevi od začetka igre do jutri po UTC (za igralce vzhodno od UTC)
function assertPlayableDate(key) {
  if (!isValidDateKey(key)) throw new HttpError(400, "Datum mora biti v obliki LLLL-MM-DD.");
  const epochKey = Core.formatDateKey(Core.EPOCH_START);
  const tomorrow = new Date(Date.now() + 14 * 3600 * 1000).toISOString().slice(0, 10);
  if (key < epochKey || key > tomorrow) throw new HttpError(400, "Za ta dan dnevni izziv ne obstaja.");
}

function shiftDateKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------
// Igralec (brez prijave): glava X-Casolov-Player: <id>.<skrivnost>
// ----------------------------------------------------------------------------
async function getPlayer(request, env, required = true) {
  const header = request.headers.get("x-casolov-player") || "";
  const [id, secret] = header.split(".");
  if (!id || !secret) {
    if (required) throw new HttpError(401, "Najprej izberi vzdevek.");
    return null;
  }
  const row = await env.DB.prepare("SELECT id, name, secret_hash FROM players WHERE id = ?").bind(id).first();
  if (!row || !timingSafeEqual(row.secret_hash, await sha256(secret))) {
    if (required) throw new HttpError(401, "Igralec ni prepoznan. Izberi vzdevek znova.");
    return null;
  }
  return { id: row.id, name: row.name };
}

async function createPlayer(request, env) {
  const body = await readJson(request);
  const name = cleanName(body.name, LIMITS.nameMax, "Vzdevek");
  const id = crypto.randomUUID();
  const secret = randomHex(24);
  await env.DB.prepare("INSERT INTO players (id, secret_hash, name, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, await sha256(secret), name, Date.now())
    .run();
  return json({ player: { id, name }, token: `${id}.${secret}` }, 201);
}

async function getMe(request, env) {
  const player = await getPlayer(request, env);
  const rooms = await env.DB.prepare(
    `SELECT r.code, r.name, r.owner_id = ?1 AS is_owner,
            (SELECT COUNT(*) FROM room_members m2 WHERE m2.room_code = r.code) AS member_count
       FROM room_members m JOIN rooms r ON r.code = m.room_code
      WHERE m.player_id = ?1
      ORDER BY m.joined_at DESC`
  )
    .bind(player.id)
    .all();
  return json({
    player,
    rooms: rooms.results.map((r) => ({ code: r.code, name: r.name, isOwner: !!r.is_owner, memberCount: r.member_count }))
  });
}

async function renameMe(request, env) {
  const player = await getPlayer(request, env);
  const body = await readJson(request);
  const name = cleanName(body.name, LIMITS.nameMax, "Vzdevek");
  await env.DB.prepare("UPDATE players SET name = ? WHERE id = ?").bind(name, player.id).run();
  return json({ player: { id: player.id, name } });
}

// ----------------------------------------------------------------------------
// Sobe
// ----------------------------------------------------------------------------
async function countRoomsOf(env, playerId) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM room_members WHERE player_id = ?").bind(playerId).first();
  return row.n;
}

async function createRoom(request, env) {
  const player = await getPlayer(request, env);
  const body = await readJson(request);
  const name = cleanName(body.name, LIMITS.roomNameMax, "Ime sobe");
  if ((await countRoomsOf(env, player.id)) >= LIMITS.roomsPerPlayer) {
    throw new HttpError(400, `Si že v ${LIMITS.roomsPerPlayer} sobah. Zapusti katero, preden ustvariš novo.`);
  }
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO rooms (code, name, owner_id, created_at) VALUES (?, ?, ?, ?)").bind(code, name, player.id, now),
        env.DB.prepare("INSERT INTO room_members (room_code, player_id, joined_at) VALUES (?, ?, ?)").bind(code, player.id, now)
      ]);
      return json({ room: { code, name, isOwner: true, memberCount: 1 } }, 201);
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  throw new HttpError(500, "Sobe ni bilo mogoče ustvariti. Poskusi znova.");
}

async function findRoom(env, code) {
  const room = await env.DB.prepare("SELECT code, name, owner_id FROM rooms WHERE code = ?").bind(code).first();
  if (!room) throw new HttpError(404, "Soba s to kodo ne obstaja.");
  return room;
}

// Javni predogled za povabilo (brez rezultatov)
async function previewRoom(env, code) {
  const room = await findRoom(env, code);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM room_members WHERE room_code = ?").bind(code).first();
  return json({ room: { code: room.code, name: room.name, memberCount: row.n } });
}

async function joinRoom(request, env, code) {
  const player = await getPlayer(request, env);
  const room = await findRoom(env, code);
  const already = await env.DB.prepare("SELECT 1 FROM room_members WHERE room_code = ? AND player_id = ?").bind(code, player.id).first();
  if (!already) {
    const members = await env.DB.prepare("SELECT COUNT(*) AS n FROM room_members WHERE room_code = ?").bind(code).first();
    if (members.n >= LIMITS.membersPerRoom) throw new HttpError(400, "Soba je polna.");
    if ((await countRoomsOf(env, player.id)) >= LIMITS.roomsPerPlayer) {
      throw new HttpError(400, `Si že v ${LIMITS.roomsPerPlayer} sobah. Zapusti katero, preden vstopiš v novo.`);
    }
    await env.DB.prepare("INSERT INTO room_members (room_code, player_id, joined_at) VALUES (?, ?, ?)").bind(code, player.id, Date.now()).run();
  }
  return json({ room: { code: room.code, name: room.name } });
}

async function leaveRoom(request, env, code) {
  const player = await getPlayer(request, env);
  await findRoom(env, code);
  await env.DB.prepare("DELETE FROM room_members WHERE room_code = ? AND player_id = ?").bind(code, player.id).run();
  const left = await env.DB.prepare("SELECT player_id FROM room_members WHERE room_code = ? ORDER BY joined_at LIMIT 1").bind(code).first();
  if (!left) {
    await env.DB.prepare("DELETE FROM rooms WHERE code = ?").bind(code).run();
  } else {
    // Če lastnik odide, lastništvo preide na najstarejšega člana
    await env.DB.prepare("UPDATE rooms SET owner_id = ? WHERE code = ? AND owner_id = ?").bind(left.player_id, code, player.id).run();
  }
  return json({ ok: true });
}

// Začetek koledarskega tedna (ponedeljek) in meseca za dani dan
function weekStartKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = ponedeljek
  return shiftDateKey(key, -dow);
}

function monthStartKey(key) {
  return key.slice(0, 8) + "01";
}

// Seštevek rezultatov članov sobe v obdobju [from, to]
async function periodTotals(env, code, from, to) {
  const rows = await env.DB.prepare(
    `SELECT r.player_id, COUNT(*) AS days, SUM(r.points) AS points, SUM(r.reached_year) AS years,
            SUM(CASE WHEN r.reached_year = 2026 THEN 1 ELSE 0 END) AS landings
       FROM results r JOIN room_members m ON m.player_id = r.player_id AND m.room_code = ?
      WHERE r.date_key BETWEEN ? AND ?
      GROUP BY r.player_id`
  )
    .bind(code, from, to)
    .all();
  return new Map(rows.results.map((r) => [r.player_id, r]));
}

function standings(members, totals, viewerId) {
  return members
    .map((m) => {
      const w = totals.get(m.id);
      return {
        id: m.id,
        name: m.name,
        isYou: m.id === viewerId,
        days: w ? w.days : 0,
        points: w ? w.points : 0,
        avgYear: w ? Math.round(w.years / w.days) : null,
        landings: w ? w.landings : 0
      };
    })
    .sort((a, b) => b.points - a.points || b.days - a.days || a.name.localeCompare(b.name, "sl"));
}

// Zmagovalec zaključenega obdobja: največ točk; ob izenačenju si zmago delijo
function periodWinner(rows, from, to) {
  const played = rows.filter((r) => r.days > 0);
  if (played.length === 0) return null;
  const best = played[0].points;
  return {
    from,
    to,
    points: best,
    names: played.filter((r) => r.points === best).map((r) => r.name),
    youWon: played.some((r) => r.points === best && r.isYou)
  };
}

// Lestvica sobe za izbrani dan, tekoči teden in mesec ter zmagovalca
// preteklega tedna in meseca. Podrobnosti dneva so skrite, dokler gledalec
// tega dne ne odigra sam.
async function roomBoard(request, env, code, url) {
  const player = await getPlayer(request, env);
  const room = await findRoom(env, code);
  const member = await env.DB.prepare("SELECT 1 FROM room_members WHERE room_code = ? AND player_id = ?").bind(code, player.id).first();
  if (!member) throw new HttpError(403, "Nisi član te sobe. Vstopi s povezavo za povabilo.");

  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  if (!isValidDateKey(date)) throw new HttpError(400, "Datum mora biti v obliki LLLL-MM-DD.");

  const weekFrom = weekStartKey(date);
  const monthFrom = monthStartKey(date);
  const prevWeekTo = shiftDateKey(weekFrom, -1);
  const prevWeekFrom = weekStartKey(prevWeekTo);
  const prevMonthTo = shiftDateKey(monthFrom, -1);
  const prevMonthFrom = monthStartKey(prevMonthTo);

  const members = (
    await env.DB.prepare(
      `SELECT p.id, p.name FROM room_members m JOIN players p ON p.id = m.player_id
        WHERE m.room_code = ? ORDER BY m.joined_at`
    )
      .bind(code)
      .all()
  ).results;

  const dayRows = await env.DB.prepare(
    `SELECT r.player_id, r.reached_year, r.points, r.exact_count, r.emojis
       FROM results r JOIN room_members m ON m.player_id = r.player_id AND m.room_code = ?
      WHERE r.date_key = ?`
  )
    .bind(code, date)
    .all();

  const [weekT, monthT, prevWeekT, prevMonthT] = await Promise.all([
    periodTotals(env, code, weekFrom, date),
    periodTotals(env, code, monthFrom, date),
    periodTotals(env, code, prevWeekFrom, prevWeekTo),
    periodTotals(env, code, prevMonthFrom, prevMonthTo)
  ]);

  const byDay = new Map(dayRows.results.map((r) => [r.player_id, r]));
  const viewerPlayed = byDay.has(player.id);

  const day = members
    .map((m) => {
      const r = byDay.get(m.id);
      const base = { id: m.id, name: m.name, isYou: m.id === player.id, played: !!r };
      if (!r || !viewerPlayed) return base;
      return { ...base, reachedYear: r.reached_year, points: r.points, exactCount: r.exact_count, emojis: r.emojis };
    })
    .sort((a, b) => {
      if (a.played !== b.played) return a.played ? -1 : 1;
      return (b.points ?? 0) - (a.points ?? 0) || a.name.localeCompare(b.name, "sl");
    });

  const week = standings(members, weekT, player.id);
  const month = standings(members, monthT, player.id);

  return json({
    room: { code: room.code, name: room.name, isOwner: room.owner_id === player.id },
    date,
    weekFrom,
    monthFrom,
    viewerPlayed,
    day,
    week,
    month,
    winners: {
      week: periodWinner(standings(members, prevWeekT, player.id), prevWeekFrom, prevWeekTo),
      month: periodWinner(standings(members, prevMonthT, player.id), prevMonthFrom, prevMonthTo)
    }
  });
}

// ----------------------------------------------------------------------------
// Dnevni rezultat: strežnik ga izračuna sam iz odgovorov
// ----------------------------------------------------------------------------
async function submitResult(request, env) {
  const player = await getPlayer(request, env);
  const body = await readJson(request);
  const date = String(body.date || "");
  assertPlayableDate(date);

  let scored;
  try {
    scored = Core.scoreDailyAnswers(date, body.answers);
  } catch (err) {
    throw new HttpError(400, err.message);
  }

  const answers = JSON.stringify(scored.guesses.map((g) => g.guessYear));
  await env.DB.prepare(
    `INSERT OR IGNORE INTO results (player_id, date_key, reached_year, points, exact_count, emojis, answers, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(player.id, date, scored.reachedYear, scored.points, scored.exactCount, scored.emojis, answers, Date.now())
    .run();

  // Prvi oddani rezultat dneva velja; ponovna oddaja vrne shranjenega
  const saved = await env.DB.prepare(
    "SELECT reached_year, points, exact_count, emojis FROM results WHERE player_id = ? AND date_key = ?"
  )
    .bind(player.id, date)
    .first();

  return json({
    result: { date, reachedYear: saved.reached_year, points: saved.points, exactCount: saved.exact_count, emojis: saved.emojis }
  });
}

// ----------------------------------------------------------------------------
// Usmerjanje
// ----------------------------------------------------------------------------
async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  const roomMatch = path.match(/^\/api\/rooms\/([A-Z0-9]{8})(\/[a-z]+)?$/i);

  if (path === "/api/health" && method === "GET") return json({ ok: true });
  if (path === "/api/players" && method === "POST") return createPlayer(request, env);
  if (path === "/api/me" && method === "GET") return getMe(request, env);
  if (path === "/api/me" && method === "PATCH") return renameMe(request, env);
  if (path === "/api/rooms" && method === "POST") return createRoom(request, env);
  if (path === "/api/results" && method === "POST") return submitResult(request, env);
  if (roomMatch) {
    const code = roomMatch[1].toUpperCase();
    const action = roomMatch[2] || "";
    if (action === "/preview" && method === "GET") return previewRoom(env, code);
    if (action === "/join" && method === "POST") return joinRoom(request, env, code);
    if (action === "/leave" && method === "POST") return leaveRoom(request, env, code);
    if (action === "" && method === "GET") return roomBoard(request, env, code, url);
  }
  throw new HttpError(404, "Ta pot ne obstaja.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (path === "/arhiv") return archiveIndex(Core);
      const day = path.match(/^\/arhiv\/(\d{1,5})$/);
      if (day) return archiveDay(Core, Number(day[1]));
      if (path === "/sitemap.xml") return sitemap(Core);
      return env.ASSETS.fetch(request);
    }
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Na strežniku je prišlo do napake. Poskusi znova čez trenutek." }, 500);
    }
  }
};
