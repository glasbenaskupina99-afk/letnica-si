# 🇸🇮 Letnica.si — Slovenski zgodovinski Eraly (0 – 2026)

Interaktivna dnevna igra slovenske zgodovine po vzoru **Eraly.io**.

## 🛸 Kako deluje igra?
- **Popotovanje od leta `0` do leta `2026`:** Tvoj časoplov s popotnikom štarta v **letu 0**. V vsaki igri dobiš **5 zgodovinskih dogodkov** iz slovenske zgodovine (od rimske Emone in Karantanije do osamosvojitve in sodobne Slovenije).
- **⏱️ 20 sekund na vprašanje:** Za vsak dogodek imaš natanko **20 sekund**, da vpišeš letnico. Če čas poteče brez odgovora, motor časoplova obstane (`0 točk`, `+0 let premika`).
- **60fps animacija poleta skozi 5 zgodovinskih dob:** Po vsakem odgovoru časoplov poleti čez drsečo pokrajino slovenskih zgodovinskih mejnikov (*Rimska Emona*, *Knežji kamen*, *Brižinski spomeniki*, *Blejski otok*, *Grad Celjskih grofov*, *Trubarjev Katekizem*, *Južna železnica*, *Aljažev stolp*, *Plečnikova Ljubljana*, *Samostojna Slovenija 1991* ➔ *Portal 2026*).
- **⚡ Zlato nebo (Golden Sky):** Ob zadetku točne letnice (`0 let` odstopanja) se nebo obarva v zlato barvo.
- **🎯 Ekskluzivni cilj leta 2026:** V **leto 2026** priletiš **zgolj in samo, če zadeneš vseh 5 letnic točno v nulo!**

## 📂 Zgradba projekta
- `index.html` — Vstopni meni, igralni oder s 60fps Canvas časoplovom, arhiv dni in statistika
- `style.css` — Temna in svetla tema, animacije in odzivna postavitev
- `events.js` — Baza 141 mejnikov slovenske zgodovine v 5 kronoloških sklopih (`14 n. št. – 2025/2026`)
- `app.js` — Igralni pogon, 20-sekundni odštevalnik in `EralySceneRenderer` (60fps Canvas animacija)
