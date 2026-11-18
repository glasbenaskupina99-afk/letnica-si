# Namestitev Časolova na Cloudflare

Igra in zasebne sobe tečejo kot en Cloudflare Worker (`worker/index.js`), ki
streže statične datoteke igre in API `/api/*`. Podatki sob so v bazi D1.

Baza D1 `casolov` je že ustvarjena (regija Zahodna Evropa) in ima naloženo
shemo iz `migrations/0001_sobe.sql`; njen ID je vpisan v `wrangler.toml`.

## Možnost 1: samodejna namestitev iz GitHuba (priporočeno)

1. V nadzorni plošči Cloudflare odpri **Workers & Pages → Create → Import a repository**.
2. Poveži GitHub in izberi repozitorij `letnica-si`.
3. Nastavitve gradnje:
   - **Project name:** `casolov` (mora se ujemati z `name` v `wrangler.toml`)
   - **Production branch:** veja, na kateri je ta koda (npr. `main` po združitvi)
   - **Build command:** pusti prazno
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** `/`
4. Klikni **Save and Deploy**. Igra bo dosegljiva na `https://casolov.<tvoj-podracun>.workers.dev`.

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
