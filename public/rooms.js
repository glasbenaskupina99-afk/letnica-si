// ============================================================================
// ČASOLOV — ZASEBNE SOBE S PRIJATELJI (vmesnik)
// Igralec brez prijave: vzdevek + skrivni ključ, shranjen v tem brskalniku.
// Sobe se delijo s povezavo #soba-KODA. Rezultat dnevnega izziva se po igri
// samodejno pošlje; strežnik ga izračuna sam iz odgovorov.
// ============================================================================

const CasolovRooms = (() => {
  const PLAYER_KEY = "casolov_player";
  const LAST_ROOM_KEY = "casolov_last_room";
  const SYNC_KEY = "casolov_synced_days";
  const HASH_RE = /^#soba-([A-Z0-9]{8})$/i;

  let player = readStore(PLAYER_KEY, null); // { id, name, token }
  let me = null; // { player, rooms }
  let available = null; // je API dosegljiv?
  let pendingInvite = null; // koda sobe iz povezave za povabilo
  let invitePreview = null;
  let current = { code: null, date: null };
  let busy = false;

  // ------------------------------------------------------------------ shramba
  function readStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* zasebni način: igra deluje naprej, sobe le v tej seji */
    }
  }

  // ---------------------------------------------------------------------- API
  async function api(path, { method = "GET", body } = {}) {
    const headers = { "content-type": "application/json" };
    if (player && player.token) headers["x-casolov-player"] = player.token;
    let res;
    try {
      res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      const err = new Error("Ni povezave s strežnikom. Preveri internet in poskusi znova.");
      err.status = 0;
      throw err;
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* ni JSON */
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || "Strežnik ni odgovoril pravilno.");
      err.status = res.status;
      if (res.status === 401 && player) {
        // Ključ ni več veljaven (npr. pobrisana baza): začni znova z vzdevkom
        player = null;
        me = null;
        writeStore(PLAYER_KEY, null);
      }
      throw err;
    }
    return data;
  }

  async function checkAvailable() {
    if (available !== null) return available;
    if (location.protocol === "file:") return (available = false);
    try {
      const res = await fetch("/api/health");
      const type = res.headers.get("content-type") || "";
      available = res.ok && type.includes("application/json");
    } catch {
      available = false;
    }
    return available;
  }

  // ---------------------------------------------------------- pomožni izris
  const $ = (id) => document.getElementById(id);

  function esc(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function todayKey() {
    return formatDateKey(new Date());
  }

  function shiftKey(key, days) {
    const [y, m, d] = key.split("-").map(Number);
    return formatDateKey(new Date(y, m - 1, d + days));
  }

  const SL_DAYS = ["nedelja", "ponedeljek", "torek", "sreda", "četrtek", "petek", "sobota"];

  function prettyDate(key) {
    const [y, m, d] = key.split("-").map(Number);
    const wd = SL_DAYS[new Date(y, m - 1, d).getDay()];
    return `${wd}, ${d}. ${m}. ${y}`;
  }

  function inviteLink(code) {
    return `${location.origin}${location.pathname}#soba-${code}`;
  }

  function setError(el, message) {
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
  }

  // ------------------------------------------------------------------ pogled
  function show() {
    if (typeof stopRoundTimer === "function") stopRoundTimer();
    if (typeof cancelFinaleSilently === "function") cancelFinaleSilently();
    state.view = "rooms";
    document.body.dataset.era = "0";
    ["menu-view", "game-view", "archive-view"].forEach((id) => $(id).classList.remove("visible"));
    $("rooms-view").classList.add("visible");
    window.scrollTo({ top: 0, behavior: "auto" });
    render();
  }

  async function render() {
    const root = $("rooms-root");
    if (!(await checkAvailable())) {
      root.innerHTML = `
        <div class="panel rooms-note">
          <h3>Sobe tu niso na voljo</h3>
          <p>Zasebne sobe potrebujejo strežnik igre. Odpri Časolov na njegovem spletnem naslovu, pa boš lahko ustvaril sobo in povabil prijatelje.</p>
        </div>`;
      return;
    }

    if (!player) {
      renderOnboarding(root);
      return;
    }

    if (pendingInvite) {
      const code = pendingInvite;
      pendingInvite = null;
      clearHash();
      try {
        await api(`/rooms/${code}/join`, { method: "POST" });
        me = null;
        current = { code, date: todayKey() };
      } catch (err) {
        root.innerHTML = `<div class="panel rooms-note"><h3>Vstop v sobo ni uspel</h3><p>${esc(err.message)}</p>
          <button type="button" class="btn btn-emerald" id="rooms-back-list">Na seznam sob</button></div>`;
        $("rooms-back-list").addEventListener("click", () => render());
        return;
      }
    }

    if (current.code) renderRoom(root);
    else renderList(root);
  }

  async function renderOnboarding(root) {
    let inviteHtml = "";
    if (pendingInvite) {
      try {
        invitePreview = invitePreview || (await api(`/rooms/${pendingInvite}/preview`)).room;
        inviteHtml = `<p class="rooms-invite">Povabljen si v sobo <strong>${esc(invitePreview.name)}</strong> (${invitePreview.memberCount} ${invitePreview.memberCount === 1 ? "član" : invitePreview.memberCount === 2 ? "člana" : invitePreview.memberCount <= 4 ? "člani" : "članov"}).</p>`;
      } catch (err) {
        inviteHtml = `<p class="rooms-error">${esc(err.message)}</p>`;
        pendingInvite = null;
        clearHash();
      }
    }
    root.innerHTML = `
      <form class="panel rooms-onboard" id="rooms-name-form" novalidate>
        ${inviteHtml}
        <h3>Kako naj te vidijo prijatelji?</h3>
        <p>Brez registracije in e-pošte. Vzdevek in skrivni ključ si zapomni ta brskalnik.</p>
        <div class="rooms-field">
          <label for="rooms-name-input">Vzdevek</label>
          <input id="rooms-name-input" class="rooms-input" maxlength="24" autocomplete="nickname" placeholder="npr. Ana" required />
        </div>
        <p class="rooms-error" id="rooms-name-error" hidden></p>
        <button type="submit" class="btn btn-emerald">${pendingInvite ? "Vstopi v sobo" : "Nadaljuj"}</button>
        <p class="rooms-fine">Na drugi napravi boš nov igralec, ker se ključ ne prenese.</p>
      </form>`;
    $("rooms-name-input").focus();
    $("rooms-name-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      const name = $("rooms-name-input").value.trim();
      if (!name) {
        setError($("rooms-name-error"), "Vpiši vzdevek.");
        return;
      }
      busy = true;
      try {
        const data = await api("/players", { method: "POST", body: { name } });
        player = { id: data.player.id, name: data.player.name, token: data.token };
        writeStore(PLAYER_KEY, player);
        syncLocalResults();
        render();
      } catch (err) {
        setError($("rooms-name-error"), err.message);
      } finally {
        busy = false;
      }
    });
  }

  async function renderList(root) {
    root.innerHTML = `<div class="panel rooms-loading">Nalagam tvoje sobe …</div>`;
    try {
      me = await api("/me");
      player.name = me.player.name;
      writeStore(PLAYER_KEY, player);
    } catch (err) {
      if (!player) return render();
      root.innerHTML = `<div class="panel rooms-note"><h3>Sob ni bilo mogoče naložiti</h3><p>${esc(err.message)}</p></div>`;
      return;
    }

    const rooms = me.rooms
      .map(
        (r) => `
        <button type="button" class="room-card" data-code="${esc(r.code)}">
          <span class="room-card-name">${esc(r.name)}</span>
          <span class="room-card-meta">${r.memberCount} ${r.memberCount === 1 ? "član" : r.memberCount === 2 ? "člana" : r.memberCount <= 4 ? "člani" : "članov"}${r.isOwner ? " · tvoja soba" : ""}</span>
          <span class="archive-arrow"><svg class="ic"><use href="#i-arrow" /></svg></span>
        </button>`
      )
      .join("");

    root.innerHTML = `
      <div class="rooms-me">
        Igraš kot <strong id="rooms-me-name">${esc(player.name)}</strong>
        <button type="button" class="rooms-link" id="rooms-rename">Spremeni vzdevek</button>
      </div>
      <form class="rooms-rename" id="rooms-rename-form" hidden novalidate>
        <label for="rooms-rename-input" class="sr-only">Nov vzdevek</label>
        <input id="rooms-rename-input" class="rooms-input" maxlength="24" value="${esc(player.name)}" />
        <button type="submit" class="btn btn-emerald">Shrani</button>
        <p class="rooms-error" id="rooms-rename-error" hidden></p>
      </form>

      <section class="rooms-list">
        <h3 class="rooms-h">Tvoje sobe</h3>
        ${rooms || `<p class="rooms-empty">Še nisi v nobeni sobi. Ustvari svojo in pošlji povezavo prijateljem.</p>`}
      </section>

      <div class="rooms-forms">
        <form class="panel" id="rooms-create-form" novalidate>
          <h3 class="rooms-h">Nova soba</h3>
          <label for="rooms-create-input" class="sr-only">Ime sobe</label>
          <input id="rooms-create-input" class="rooms-input" maxlength="40" placeholder="npr. Zgodovinarji iz 4.b" />
          <p class="rooms-error" id="rooms-create-error" hidden></p>
          <button type="submit" class="btn btn-emerald">Ustvari sobo</button>
        </form>
        <form class="panel" id="rooms-join-form" novalidate>
          <h3 class="rooms-h">Vstopi s kodo</h3>
          <label for="rooms-join-input" class="sr-only">Koda sobe</label>
          <input id="rooms-join-input" class="rooms-input code" maxlength="8" placeholder="8 znakov" autocapitalize="characters" spellcheck="false" />
          <p class="rooms-error" id="rooms-join-error" hidden></p>
          <button type="submit" class="btn-secondary-action">Vstopi</button>
        </form>
      </div>`;

    root.querySelectorAll(".room-card").forEach((card) =>
      card.addEventListener("click", () => {
        current = { code: card.dataset.code, date: todayKey() };
        render();
      })
    );

    $("rooms-rename").addEventListener("click", () => {
      const f = $("rooms-rename-form");
      f.hidden = !f.hidden;
      if (!f.hidden) $("rooms-rename-input").select();
    });
    $("rooms-rename-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const data = await api("/me", { method: "PATCH", body: { name: $("rooms-rename-input").value } });
        player.name = data.player.name;
        writeStore(PLAYER_KEY, player);
        render();
      } catch (err) {
        setError($("rooms-rename-error"), err.message);
      }
    });

    $("rooms-create-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      try {
        const data = await api("/rooms", { method: "POST", body: { name: $("rooms-create-input").value } });
        current = { code: data.room.code, date: todayKey(), justCreated: true };
        render();
      } catch (err) {
        setError($("rooms-create-error"), err.message);
      } finally {
        busy = false;
      }
    });

    $("rooms-join-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = $("rooms-join-input").value.trim().toUpperCase();
      const code = (raw.match(/[A-Z0-9]{8}$/) || [""])[0];
      if (!code) {
        setError($("rooms-join-error"), "Koda ima 8 črk in številk (najdeš jo na koncu povezave).");
        return;
      }
      try {
        await api(`/rooms/${code}/join`, { method: "POST" });
        current = { code, date: todayKey() };
        render();
      } catch (err) {
        setError($("rooms-join-error"), err.message);
      }
    });
  }

  async function renderRoom(root) {
    const date = current.date || todayKey();
    root.innerHTML = `<div class="panel rooms-loading">Nalagam sobo …</div>`;
    let board;
    try {
      board = await api(`/rooms/${current.code}?date=${date}`);
    } catch (err) {
      if (!player) return render();
      root.innerHTML = `<div class="panel rooms-note"><h3>Sobe ni bilo mogoče odpreti</h3><p>${esc(err.message)}</p>
        <button type="button" class="btn btn-emerald" id="rooms-back-list">Na seznam sob</button></div>`;
      $("rooms-back-list").addEventListener("click", () => {
        current = { code: null, date: null };
        render();
      });
      return;
    }

    writeStore(LAST_ROOM_KEY, board.room.code);
    const epochKey = formatDateKey(EPOCH_START);
    const canPrev = date > epochKey;
    const canNext = date < todayKey();
    const dayNum = getDayNumberFromDateKey(date);
    const link = inviteLink(board.room.code);
    const localSaved = state.dailyHistory[date];

    const dayRows = board.day
      .map((r, i) => {
        const rank = r.played && board.viewerPlayed ? `${i + 1}.` : "";
        let detail;
        if (!r.played) detail = `<span class="rb-pending">${r.isYou ? "še nisi igral" : "še ni igral(a)"}</span>`;
        else if (!board.viewerPlayed) detail = `<span class="rb-hidden"><svg class="ic"><use href="#i-check" /></svg>odigrano</span>`;
        else
          detail = `<span class="rb-emojis" aria-label="${r.exactCount} zadetkov v nulo">${esc(r.emojis)}</span>
            <span class="rb-year">${r.reachedYear}</span>
            <span class="rb-points">${r.points} tč</span>`;
        return `<li class="rb-row${r.isYou ? " you" : ""}${r.reachedYear === 2026 ? " perfect" : ""}">
            <span class="rb-rank">${rank}</span>
            <span class="rb-name">${esc(r.name)}${r.isYou ? " <em>(ti)</em>" : ""}</span>
            ${detail}
          </li>`;
      })
      .join("");

    const weekRows = board.week
      .map(
        (r, i) => `<tr class="${r.isYou ? "you" : ""}">
          <td class="num">${r.days ? i + 1 + "." : ""}</td>
          <td>${esc(r.name)}${r.isYou ? " <em>(ti)</em>" : ""}</td>
          <td class="num">${r.days}</td>
          <td class="num">${r.points}</td>
          <td class="num">${r.avgYear ?? "–"}</td>
          <td class="num">${r.landings}</td>
        </tr>`
      )
      .join("");

    const [, fm, fd] = board.weekFrom.split("-").map(Number);
    const [, tm, td] = date.split("-").map(Number);

    root.innerHTML = `
      <button type="button" class="rooms-link back" id="rooms-back"><svg class="ic"><use href="#i-arrow" /></svg>Vse sobe</button>

      <section class="panel room-head">
        <div class="room-title">
          <div class="eyebrow"><span class="eyebrow-dot"></span>Soba</div>
          <h2>${esc(board.room.name)}</h2>
          <p>${board.day.length} ${board.day.length === 1 ? "član" : board.day.length === 2 ? "člana" : board.day.length <= 4 ? "člani" : "članov"} · rezultate prijateljev vidiš, ko dan odigraš sam</p>
        </div>
        <div class="room-invite${current.justCreated ? " fresh" : ""}">
          <label for="room-invite-link">${current.justCreated ? "Soba je ustvarjena. Pošlji to povezavo prijateljem:" : "Povezava za povabilo"}</label>
          <div class="room-invite-row">
            <input id="room-invite-link" class="rooms-input" readonly value="${esc(link)}" />
            <button type="button" class="btn btn-emerald" id="room-copy"><svg class="ic"><use href="#i-copy" /></svg><span>Kopiraj</span></button>
            ${navigator.share ? `<button type="button" class="btn-secondary-action" id="room-share"><svg class="ic"><use href="#i-share" /></svg>Deli</button>` : ""}
          </div>
          <p class="rooms-fine">Koda sobe: <strong class="code">${esc(board.room.code)}</strong></p>
        </div>
      </section>

      <section class="panel room-day">
        <div class="room-daynav">
          <button type="button" class="icon-btn icon-only" id="room-prev" ${canPrev ? "" : "disabled"} aria-label="Prejšnji dan"><svg class="ic flip"><use href="#i-arrow" /></svg></button>
          <div class="room-date">
            <strong>${date === todayKey() ? "Danes" : esc(prettyDate(date))}</strong>
            <span>Izziv #${dayNum}${date === todayKey() ? " · " + esc(prettyDate(date)) : ""}</span>
          </div>
          <button type="button" class="icon-btn icon-only" id="room-next" ${canNext ? "" : "disabled"} aria-label="Naslednji dan"><svg class="ic"><use href="#i-arrow" /></svg></button>
        </div>
        ${
          board.viewerPlayed
            ? ""
            : `<div class="room-cta">
                <p>${localSaved ? "Ta dan si odigral pred vstopom v sobe. Rezultat se pošilja …" : "Odigraj izziv tega dne, da vidiš, kako daleč so prileteli ostali."}</p>
                ${localSaved ? "" : `<button type="button" class="btn-hero small" id="room-play"><span class="btn-hero-text"><span class="btn-hero-title">Igraj izziv #${dayNum}</span></span><span class="btn-hero-arrow"><svg class="ic"><use href="#i-arrow" /></svg></span></button>`}
              </div>`
        }
        <ol class="room-board" aria-label="Lestvica dneva">${dayRows}</ol>
      </section>

      <section class="panel room-week">
        <h3 class="rooms-h">Zadnjih 7 dni <span>${fd}. ${fm}. – ${td}. ${tm}.</span></h3>
        <div class="room-week-scroll">
          <table class="room-week-table">
            <thead><tr><th class="num">#</th><th>Igralec</th><th class="num">Dni</th><th class="num">Točke</th><th class="num">Povp. leto</th><th class="num">2026</th></tr></thead>
            <tbody>${weekRows}</tbody>
          </table>
        </div>
      </section>

      <div class="room-foot">
        <button type="button" class="rooms-link danger" id="room-leave">Zapusti sobo</button>
        <div class="room-leave-confirm" id="room-leave-confirm" hidden>
          <span>Res zapustiš sobo »${esc(board.room.name)}«?</span>
          <button type="button" class="btn-secondary-action" id="room-leave-yes">Da, zapusti</button>
          <button type="button" class="rooms-link" id="room-leave-no">Prekliči</button>
        </div>
      </div>`;

    current.justCreated = false;

    $("rooms-back").addEventListener("click", () => {
      current = { code: null, date: null };
      render();
    });
    $("room-prev").addEventListener("click", () => {
      current.date = shiftKey(date, -1);
      render();
    });
    $("room-next").addEventListener("click", () => {
      current.date = shiftKey(date, 1);
      render();
    });
    if ($("room-play")) $("room-play").addEventListener("click", () => startDailyGame(date));
    $("room-copy").addEventListener("click", async () => {
      const label = $("room-copy").querySelector("span");
      try {
        await navigator.clipboard.writeText(link);
        label.textContent = "Skopirano ✓";
      } catch {
        $("room-invite-link").select();
        label.textContent = "Označeno — kopiraj";
      }
      setTimeout(() => (label.textContent = "Kopiraj"), 2200);
    });
    if ($("room-share")) {
      $("room-share").addEventListener("click", () =>
        navigator.share({ title: "Časolov", text: `Pridruži se moji sobi »${board.room.name}« v Časolovu`, url: link }).catch(() => {})
      );
    }
    $("room-leave").addEventListener("click", () => ($("room-leave-confirm").hidden = false));
    $("room-leave-no").addEventListener("click", () => ($("room-leave-confirm").hidden = true));
    $("room-leave-yes").addEventListener("click", async () => {
      try {
        await api(`/rooms/${board.room.code}/leave`, { method: "POST" });
        if (readStore(LAST_ROOM_KEY, null) === board.room.code) writeStore(LAST_ROOM_KEY, null);
        current = { code: null, date: null };
        render();
      } catch (err) {
        alertInline(err.message);
      }
    });

    // Če je dan odigran lokalno, a še ni na strežniku, ga pošlji in osveži
    if (!board.viewerPlayed && localSaved) {
      const ok = await submitDay(date, localSaved.guesses);
      if (ok) render();
    }
  }

  function alertInline(message) {
    if (typeof showToast === "function") showToast(`<span class="toast-k">Sobe</span><strong>${esc(message)}</strong>`);
  }

  // ------------------------------------------------------------- rezultati
  function answersFor(dateKey, guesses) {
    if (!Array.isArray(guesses) || guesses.length !== 5) return null;
    // Pošlji le, če se shranjeni dogodki ujemajo z dogodki tega dne (baza se je lahko spremenila)
    const ids = getDailyEventsForDateKey(dateKey).map((e) => e.id);
    if (guesses.some((g, i) => g.eventId !== ids[i])) return null;
    return guesses.map((g) => (g.timedOut ? null : g.guessYear));
  }

  async function submitDay(dateKey, guesses) {
    if (!player || !(await checkAvailable())) return false;
    const answers = answersFor(dateKey, guesses);
    if (!answers) return false;
    try {
      await api("/results", { method: "POST", body: { date: dateKey, answers } });
      const synced = new Set(readStore(SYNC_KEY, []));
      synced.add(dateKey);
      writeStore(SYNC_KEY, [...synced].slice(-400));
      return true;
    } catch {
      return false;
    }
  }

  async function syncLocalResults() {
    if (!player || !(await checkAvailable())) return;
    const synced = new Set(readStore(SYNC_KEY, []));
    const keys = Object.keys(state.dailyHistory)
      .filter((k) => !synced.has(k))
      .sort()
      .slice(-60);
    for (const k of keys) await submitDay(k, state.dailyHistory[k].guesses);
  }

  // Klic iz app.js po končanem dnevnem izzivu
  async function onDailyFinished(dateKey, guesses) {
    const box = $("summary-rooms");
    if (!box) return;
    if (!(await checkAvailable())) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const label = $("summary-rooms-label");
    if (!player) {
      label.textContent = "Tekmuj s prijatelji v zasebni sobi";
      return;
    }
    label.textContent = "Pošiljam rezultat v tvoje sobe …";
    const ok = await submitDay(dateKey, guesses);
    label.textContent = ok ? "Rezultat je v tvojih sobah — primerjaj se s prijatelji" : "Odpri sobe s prijatelji";
    box.dataset.date = dateKey;
  }

  // --------------------------------------------------------- povabila (#)
  function clearHash() {
    if (HASH_RE.test(location.hash)) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  function handleHash() {
    const m = location.hash.match(HASH_RE);
    if (!m) return false;
    pendingInvite = m[1].toUpperCase();
    invitePreview = null;
    current = { code: null, date: null };
    show();
    return true;
  }

  function init() {
    window.addEventListener("hashchange", handleHash);
    const btn = $("btn-menu-open-rooms");
    if (btn) btn.addEventListener("click", () => {
      current = { code: null, date: null };
      show();
    });
    const sumBtn = $("summary-rooms");
    if (sumBtn) sumBtn.addEventListener("click", () => {
      // Odpri zadnjo sobo na dnevu, ki je bil ravnokar odigran (če je igralec v kakšni sobi)
      const last = player ? readStore(LAST_ROOM_KEY, null) : null;
      current = last ? { code: last, date: sumBtn.dataset.date || todayKey() } : { code: null, date: null };
      show();
    });
    $("btn-rooms-back-menu").addEventListener("click", () => showMenuView());
    if (!handleHash() && player) {
      // tiho: preveri ključ in pošlji morebitne neposlane dneve
      checkAvailable().then((ok) => {
        if (!ok) return;
        api("/me").then((d) => (me = d)).catch(() => {});
        syncLocalResults();
      });
    }
  }

  return { init, show, onDailyFinished };
})();

window.CasolovRooms = CasolovRooms;
