// ============================================================================
// ČASOLOV — strani, ki jih izriše strežnik (berljive tudi za iskalnike)
//   /arhiv        seznam preteklih dnevnih izzivov
//   /arhiv/N      izziv št. N (brez letnic, da ga lahko odigraš znova)
//   /sitemap.xml  zemljevid strani z vsemi arhivskimi dnevi
// Arhiv pokaže le dneve PRED današnjim (po slovenskem času), zato nikoli ne
// razkrije današnjega ali prihodnjih izzivov.
// ============================================================================

const SITE = "https://casolov.si";
const ERAS = globalThis.SLOVENIAN_ERAS;

const STATIC_PAGES = ["", "o-igri", "obdobja", "arhiv", "zasebnost", "stik"];

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Današnji dan po slovenskem času (izziv se zamenja ob polnoči v Sloveniji)
export function todayKeyLjubljana(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Ljubljana", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function shiftKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function prettyDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  const months = ["januarja", "februarja", "marca", "aprila", "maja", "junija", "julija", "avgusta", "septembra", "oktobra", "novembra", "decembra"];
  return `${d}. ${months[m - 1]} ${y}`;
}

function footer(current) {
  const links = [
    ["/", "Igra"],
    ["/o-igri", "O igri"],
    ["/obdobja", "Obdobja"],
    ["/arhiv", "Arhiv"],
    ["/zasebnost", "Zasebnost"],
    ["/stik", "Stik"]
  ];
  return `<footer class="site-footer">
    <span>© 2026 Časolov</span>
    <nav aria-label="Informacije">
      ${links.map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`).join("\n      ")}
    </nav>
  </footer>`;
}

function layout({ title, description, path, body, current, noindex = false }) {
  return `<!DOCTYPE html>
<html lang="sl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#070b16" />
  <title>${esc(title)} — Časolov</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <link rel="canonical" href="${SITE}${path}" />
  ${noindex ? '<meta name="robots" content="noindex" />' : ""}
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Časolov" />
  <meta property="og:locale" content="sl_SI" />
  <meta property="og:url" content="${SITE}${path}" />
  <meta property="og:title" content="${esc(title)} — Časolov" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${SITE}/og-image.jpg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <script>
    try {
      var s = JSON.parse(localStorage.getItem("letnica_si_state_v2") || "{}");
      if (s.theme === "light") document.documentElement.setAttribute("data-theme", "light");
    } catch (e) {}
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@400;500;600;700;800&display=swap" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body data-era="0">
  <div class="bg-aurora" aria-hidden="true"></div>
  <div class="bg-grain" aria-hidden="true"></div>

  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="/" aria-label="Časolov — na igro" style="color: inherit; text-decoration: none;">
        <div class="brand-logo" aria-hidden="true">
          <svg viewBox="0 0 32 32"><path d="M9 6h14M9 26h14M11 6c0 6 10 6 10 10s-10 4-10 10M21 6c0 6-10 6-10 10s10 4 10 10" /></svg>
        </div>
        <div class="brand-title">
          <p class="brand-name">Časo<span>lov</span></p>
          <span class="brand-subtitle">Polet skozi slovensko zgodovino</span>
        </div>
      </a>
      <nav class="nav-actions">
        <a class="icon-btn" href="/" style="text-decoration: none;">Na igro →</a>
      </nav>
    </div>
  </header>

  <main class="doc-main">
    <article class="doc-card">
${body}
    </article>
  </main>

  ${footer(current)}
</body>
</html>
`;
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" }
  });
}

// Zadnji arhivirani dan (včeraj po slovenskem času); null, če ga še ni
function lastArchivedDay(Core) {
  const epochKey = Core.formatDateKey(Core.EPOCH_START);
  const yesterday = shiftKey(todayKeyLjubljana(), -1);
  if (yesterday < epochKey) return null;
  return { key: yesterday, number: Core.getDayNumberFromDateKey(yesterday), epochKey };
}

function keyForNumber(Core, n) {
  return shiftKey(Core.formatDateKey(Core.EPOCH_START), n - 1);
}

export function archiveIndex(Core) {
  const last = lastArchivedDay(Core);
  let list;
  if (!last) {
    list = `<p>Arhiv je še prazen. Današnji izziv se vanj preseli jutri ob polnoči — <a href="/">odigraj ga, dokler je še skrivnost</a>.</p>`;
  } else {
    const items = [];
    for (let n = last.number; n >= 1; n--) {
      const key = keyForNumber(Core, n);
      const events = Core.getDailyEventsForDateKey(key);
      items.push(`<li class="archive-item">
          <a href="/arhiv/${n}">
            <span class="archive-num">#${n}</span>
            <span class="archive-text"><strong>${esc(prettyDate(key))}</strong><span>${events.map((e) => esc(e.title)).join(" · ")}</span></span>
            <span class="archive-arrow" aria-hidden="true">→</span>
          </a>
        </li>`);
    }
    list = `<ol class="archive-list">${items.join("\n")}</ol>`;
  }

  const body = `      <p class="doc-eyebrow">Arhiv</p>
      <h1>Pretekli dnevni izzivi</h1>
      <p class="doc-lead">Vsak dan opolnoči se dnevni izziv preseli sem — s petimi dogodki iz petih obdobij slovenske zgodovine.</p>
      <p>Letnic arhiv ne razkriva, zato ga lahko brez skrbi pregleduješ tudi pred igranjem. Vsak pretekli izziv lahko odigraš s klikom na <strong>Odigraj ta izziv</strong> ali v igri pod <strong>Koledar izzivov</strong>.</p>
      ${list}`;
  return html(
    layout({
      title: "Arhiv dnevnih izzivov",
      description: "Pretekli dnevni izzivi Časolova: dogodki iz slovenske zgodovine, ki jih lahko odigraš znova.",
      path: "/arhiv",
      body,
      current: "/arhiv"
    })
  );
}

export function archiveDay(Core, n) {
  const last = lastArchivedDay(Core);
  if (!last || !Number.isInteger(n) || n < 1 || n > last.number) {
    const body = `      <p class="doc-eyebrow">Arhiv</p>
      <h1>Tega izziva še ni v arhivu</h1>
      <p class="doc-lead">Izziv se v arhiv preseli šele dan po tem, ko je bil dnevni izziv.</p>
      <a class="doc-cta" href="/arhiv">Na arhiv →</a>`;
    return html(layout({ title: "Izziva ni v arhivu", description: "Ta izziv še ni v arhivu.", path: `/arhiv/${n}`, body, current: "/arhiv", noindex: true }), 404);
  }

  const key = keyForNumber(Core, n);
  const events = Core.getDailyEventsForDateKey(key);
  const cards = events
    .map((e) => {
      const era = ERAS.find((x) => x.id === e.era);
      return `      <section class="archive-event" style="--ev-era: ${esc(era?.color || "#f5b942")}">
        <div class="archive-event-head">
          <span class="archive-era">${esc(era ? `${era.code}. ${era.name}` : "")}</span>
          <span class="archive-range">${esc(era ? era.rangeText : "")}</span>
        </div>
        <h2>${esc(e.title)}</h2>
        <p>${esc(e.prompt)}</p>
        <p class="archive-meta">${esc(e.category)} · ${esc(e.region)}</p>
      </section>`;
    })
    .join("\n");

  const prev = n > 1 ? `<a href="/arhiv/${n - 1}">← Izziv #${n - 1}</a>` : "<span></span>";
  const next = n < last.number ? `<a href="/arhiv/${n + 1}">Izziv #${n + 1} →</a>` : `<a href="/">Današnji izziv →</a>`;

  const body = `      <p class="doc-eyebrow"><a href="/arhiv" style="text-decoration:none">Arhiv</a> · izziv #${n}</p>
      <h1>Dnevni izziv #${n}</h1>
      <p class="doc-lead">${esc(prettyDate(key))} — pet dogodkov iz petih obdobij slovenske zgodovine. Znaš umestiti vse v pravo leto?</p>
      <p><a href="/?izziv=${n}">Odigraj ta izziv v igri →</a></p>
${cards}
      <a class="doc-cta" href="/?izziv=${n}">Odigraj izziv #${n} →</a>
      <nav class="archive-pager" aria-label="Arhiv">${prev}${next}</nav>`;
  return html(
    layout({
      title: `Izziv #${n} (${prettyDate(key)})`,
      description: `Dnevni izziv #${n}: ${events.map((e) => e.title).join("; ")}. Znaš ugotoviti letnice?`.slice(0, 300),
      path: `/arhiv/${n}`,
      body,
      current: "/arhiv"
    })
  );
}

export function sitemap(Core) {
  const urls = STATIC_PAGES.map((p) => `${SITE}/${p}`);
  const last = lastArchivedDay(Core);
  if (last) for (let n = 1; n <= last.number; n++) urls.push(`${SITE}/arhiv/${n}`);
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    "\n</urlset>\n";
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
