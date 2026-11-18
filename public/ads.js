// ============================================================================
// ČASOLOV — OGLASI IN SPONZORJI
//
// Vsa mesta so privzeto IZKLOPLJENA in na strani ne zasedejo prostora.
// Za vklop izpolni CASOLOV_ADS_CONFIG spodaj (glej tudi DEPLOY.md → Oglasi).
//
// Mesta:
//   summary  — povzetek po igri, pod rezultatom in gumbi za deljenje
//   menu     — vstopni meni, pod paneli Prosta igra / Sobe / Koledar
//   page     — dno koledarja, statistike in zbirke mejnikov
//   railLeft / railRight — pokončna pasova ob strani (le na širokih zaslonih)
//
// Oglasi se NIKOLI ne prikažejo med vprašanjem, odštevanjem ali poletom.
// ============================================================================

const CASOLOV_ADS_CONFIG = {
  // "off" | "adsense" | "sponsor"
  mode: "off",

  adsense: {
    // npr. "ca-pub-1234567890123456" (AdSense → Račun → Podatki o računu)
    client: "",
    // ID-ji oglasnih enot (AdSense → Oglasi → Po oglasnih enotah); prazen ID = mesto izklopljeno
    slots: {
      summary: "",
      menu: "",
      page: "",
      railLeft: "",
      railRight: ""
    }
  },

  sponsor: {
    name: "", // npr. "Založba Primer"
    url: "", // npr. "https://primer.si"
    logo: "", // pot ali URL do logotipa (npr. "sponzor.png" v mapi public/)
    text: "Današnji izziv podpira", // napis nad imenom
    // Ali naj se sponzor pokaže tudi v stranskih pasovih na širokih zaslonih
    showInRails: false
  }
  // Stranska pasova se pokažeta le na oknih, širših od 1320 px (style.css → .ad-rails).
};

const CasolovAds = (() => {
  const cfg = CASOLOV_ADS_CONFIG;
  let suppressed = false; // npr. šolski način: brez oglasov
  let scriptRequested = false;
  const filled = new WeakSet();

  function slotEnabled(name) {
    if (suppressed) return false;
    if (cfg.mode === "adsense") return !!(cfg.adsense.client && cfg.adsense.slots[name]);
    if (cfg.mode === "sponsor") {
      if (!cfg.sponsor.name) return false;
      if (name === "railLeft" || name === "railRight") return !!cfg.sponsor.showInRails;
      return true;
    }
    return false;
  }

  function loadAdsenseScript() {
    if (scriptRequested) return;
    scriptRequested = true;
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg.adsense.client)}`;
    document.head.appendChild(s);
  }

  function esc(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderSponsor(el, isRail) {
    const sp = cfg.sponsor;
    const inner = `
      ${sp.logo ? `<img class="sponsor-logo" src="${esc(sp.logo)}" alt="" loading="lazy" />` : ""}
      <span class="sponsor-text">${esc(sp.text)}</span>
      <strong class="sponsor-name">${esc(sp.name)}</strong>`;
    el.innerHTML = sp.url
      ? `<a class="sponsor-card${isRail ? " rail" : ""}" href="${esc(sp.url)}" target="_blank" rel="sponsored noopener">${inner}</a>`
      : `<div class="sponsor-card${isRail ? " rail" : ""}">${inner}</div>`;
  }

  function renderAdsense(el, name) {
    loadAdsenseScript();
    const isRail = name === "railLeft" || name === "railRight";
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.setAttribute("data-ad-client", cfg.adsense.client);
    ins.setAttribute("data-ad-slot", cfg.adsense.slots[name]);
    if (isRail) {
      ins.style.cssText = "display:inline-block;width:160px;height:600px";
    } else {
      ins.style.display = "block";
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
    }
    el.querySelector(".ad-body").appendChild(ins);
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.warn("Oglas se ni naložil:", err);
    }
  }

  // Mesto napolnimo šele, ko je vidno in ima širino (AdSense v skritem
  // elementu ne zna izbrati velikosti oglasa).
  function fill(el) {
    if (filled.has(el)) return;
    const name = el.dataset.ad;
    if (el.getBoundingClientRect().width < 50) return;
    filled.add(el);
    if (cfg.mode === "sponsor") renderSponsor(el.querySelector(".ad-body"), name.startsWith("rail"));
    else renderAdsense(el, name);
  }

  function setup() {
    const slots = [...document.querySelectorAll("[data-ad]")];
    slots.forEach((el) => {
      const on = slotEnabled(el.dataset.ad);
      el.hidden = !on;
      if (!on) return;
      el.classList.add(`ad-mode-${cfg.mode}`);
      if (!el.querySelector(".ad-body")) {
        el.innerHTML = `<span class="ad-label">${cfg.mode === "sponsor" ? "Sponzor" : "Oglas"}</span><div class="ad-body"></div>`;
      }
    });

    const rails = document.getElementById("ad-rails");
    if (rails) rails.hidden = !(slotEnabled("railLeft") || slotEnabled("railRight"));

    const visible = slots.filter((el) => !el.hidden);
    if (visible.length === 0) return;
    if ("IntersectionObserver" in window) {
      // Napolni malo preden pride mesto na zaslon, da se stran ob tem ne premakne
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) fill(en.target);
          });
        },
        { rootMargin: "400px 0px" }
      );
      visible.forEach((el) => io.observe(el));
    } else {
      visible.forEach(fill);
    }
  }

  return {
    init: setup,
    // Za prihodnji šolski način: skrije vsa oglasna mesta
    suppress(on) {
      suppressed = !!on;
      document.body.classList.toggle("no-ads", suppressed);
      setup();
    },
    get enabled() {
      return cfg.mode !== "off";
    }
  };
})();

window.CasolovAds = CasolovAds;

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => CasolovAds.init());
else CasolovAds.init();
