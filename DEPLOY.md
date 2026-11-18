# Namestitev Časolova na Cloudflare

Igra in zasebne sobe tečejo kot en Cloudflare Worker (`worker/index.js`), ki
streže statične datoteke igre in API `/api/*`. Podatki sob so v bazi D1.

Baza D1 `casolov` je že ustvarjena (regija Zahodna Evropa) in ima naloženo
shemo iz `migrations/0001_sobe.sql`; njen ID je vpisan v `wrangler.toml`.

## Možnost 1: samodejna namestitev iz GitHuba (priporočeno)

1. V nadzorni plošči Cloudflare odpri **Workers & Pages → Create → Import a repository**.
2. Poveži GitHub in izberi repozitorij `letnica-si`.
3. Nastavitve gradnje:
   - **Project name:** `letnica-si` (mora se ujemati z `name` v `wrangler.toml`)
   - **Production branch:** veja, na kateri je ta koda (npr. `main` po združitvi)
   - **Build command:** pusti prazno
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** `/`
4. Klikni **Save and Deploy**. Igra bo dosegljiva na `https://letnica-si.<tvoj-podracun>.workers.dev`.

Vsak nov commit na izbrani veji se nato namesti sam.

## Možnost 2: ročna namestitev z računalnika

```bash
npm install
npx wrangler login
npx wrangler deploy
```

## Lokalni razvoj

```bash
npm install
npm run db:migrate:local
npm run dev
```

Igra je nato na `http://localhost:8787`, sobe delujejo s krajevno bazo.

## Spremembe sheme

Novo migracijo dodaj v `migrations/` (npr. `0002_….sql`) in jo uveljavi z
`npm run db:migrate`.

## Lastna domena (neobvezno)

V nadzorni plošči Workerja: **Settings → Domains & Routes → Add → Custom domain**.
Če spremeniš naslov, ostanejo sobe in rezultati enaki; igralci morajo le odpreti
nov naslov (ključ igralca je shranjen v brskalniku za vsak naslov posebej).

## Oglasi in sponzorji

Mesta za oglase so pripravljena, a **izklopljena**: dokler jih ne vklopiš, na
strani ne zasedejo prostora. Nastavitve so na vrhu `public/ads.js`
(`CASOLOV_ADS_CONFIG`).

Mesta (oglasi se nikoli ne prikažejo med vprašanjem, odštevanjem ali poletom):

| Mesto | Kje | Velikost |
| --- | --- | --- |
| `summary` | povzetek po igri, pod gumboma za deljenje | odzivna |
| `menu` | vstopni meni, pod paneli | odzivna |
| `page` | dno koledarja, statistike in zbirke | odzivna |
| `railLeft`, `railRight` | lepljiva pasova ob strani, le na oknih širših od 1320 px | 160 × 600 |

### Sponzor (brez piškotkov in pasice za soglasje)

1. Logotip shrani v `public/` (npr. `public/sponzor.png`).
2. V `public/ads.js` nastavi `mode: "sponsor"` in izpolni `sponsor`
   (`name`, `url`, `logo`, po želji `showInRails: true`).
3. Namesti znova (`npx wrangler deploy` ali commit, če je povezan GitHub).

### Google AdSense

1. Ustvari račun AdSense in dodaj svojo domeno (AdSense ne sprejme naslova
   `*.workers.dev`; potrebuješ lastno domeno).
2. V `public/` dodaj datoteko `ads.txt` z vrstico, ki ti jo pokaže AdSense, npr.
   `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`.
3. Ustvari oglasne enote (Oglasi → Po oglasnih enotah → Prikazni oglasi):
   tri **odzivne** (summary, menu, page) in dve s **fiksno velikostjo 160 × 600**
   (railLeft, railRight).
4. V `public/ads.js` nastavi `mode: "adsense"`, `client` (`ca-pub-…`) in ID-je enot.
5. **Soglasje (obvezno v EU):** v AdSense → Zasebnost in sporočila vklopi
   sporočilo za soglasje po GDPR (Googlova certificirana platforma). Skripta
   AdSense ga nato prikaže sama.
6. Dopolni izjavo o zasebnosti (oglasi uporabljajo piškotke tretjih oseb).

Za način brez oglasov (npr. prihodnji šolski način) pokliči `CasolovAds.suppress(true)`.
