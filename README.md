# 🇸🇮 Letnica.si — Slovenski zgodovinski Eraly (0 – 2026)

Interaktivna dnevna igra slovenske zgodovine po vzoru **Eraly.io**.

## 🛸 Kako deluje igra?
- **Dnevni izziv brez ponavljanja:** vsak dan je iz vsakega sklopa izbran en dogodek; v 100-dnevnem ciklu pride na vrsto vsak dogodek sklopa natanko enkrat, med dvema ponovitvama pa je vedno vsaj 51 dni.
- **Popotovanje od leta `0` do leta `2026`:** Tvoj časoplov s popotnikom štarta v **letu 0**. V vsaki igri dobiš **5 zgodovinskih dogodkov** iz slovenske zgodovine (od rimske Emone in Karantanije do osamosvojitve in sodobne Slovenije).
- **⏱️ 20 sekund na vprašanje:** Za vsak dogodek imaš natanko **20 sekund**, da vpišeš letnico. Če čas poteče brez odgovora, motor časoplova obstane (`0 točk`, `+0 let premika`).
- **60fps animacija poleta skozi 5 zgodovinskih dob:** Po vsakem odgovoru časoplov poleti čez drsečo pokrajino slovenskih zgodovinskih mejnikov (*Rimska Emona*, *Knežji kamen*, *Brižinski spomeniki*, *Blejski otok*, *Grad Celjskih grofov*, *Trubarjev Katekizem*, *Južna železnica*, *Aljažev stolp*, *Plečnikova Ljubljana*, *Samostojna Slovenija 1991* ➔ *Portal 2026*).
- **⚡ Zlato nebo (Golden Sky):** Ob zadetku točne letnice (`0 let` odstopanja) se nebo obarva v zlato barvo.
- **🎯 Ekskluzivni cilj leta 2026:** V **leto 2026** priletiš **zgolj in samo, če zadeneš vseh 5 letnic točno v nulo!**

## ✨ Doživetje
- **Zvok in vibracija** (sintetizirano v brskalniku, brez datotek): motor, ki sledi hitrosti, prehodi obdobij, zlati zvončki, tiktakanje zadnjih sekund — izklop z gumbom v zgornji vrstici.
- **Veliki finale:** po 5. vprašanju časoplov ponovi celotno pot krog za krogom.
- **Deljenje slike** (PNG 1080 × 1350) in besedila, **odštevanje** do novega dnevnega izziva.
- **Drsnik v razponu obdobja** vprašanja z lebdečo letnico.
- **Zbirka 13 mejnikov**, ki se odklenejo ob preletu, **koledar izzivov** in **statistika** z napredkom ter natančnostjo po obdobjih.
- Temna in pergamentna svetla tema (tudi z dnevnim nebom), podpora za zmanjšano gibanje in bralnike zaslona.

## 📂 Zgradba projekta
- `index.html` — Vstopni meni, igralni oder s 60fps Canvas časoplovom, arhiv dni in statistika
- `style.css` — Oblikovni sistem »kinematografski atlas«: temna in pergamentna svetla tema, Fraunces + Inter, steklene površine, sij v barvi obdobja, animacije in odzivna postavitev
- `events.js` — Baza **500 dogodkov** slovenske zgodovine, **100 v vsakem od 5 kronoloških sklopov** (`6 n. št. – 2025`)
- `scene.js` — `EralySceneRenderer`: kinematografski 60fps HiDPI Canvas polet (večplastna paralaksa, warp zvezde, letnice stoletij, prehodi obdobij, zlati polet, odometer letnice)
- `audio.js` — Sintetizirani zvočni učinki (Web Audio) in vibracija
- `app.js` — Igralni pogon, 20-sekundni odštevalnik in zaporedje razkritja rezultata po pristanku
