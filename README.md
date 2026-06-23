# Landing page

Statická landing page (HTML, CSS, vanilla JavaScript) hostovaná na GitHub Pages.
Bez frameworku a bez build procesu.

## Struktura

- `index.html` — stránka
- `styles.css` — styly
- `script.js` — odeslání formuláře a měření návštěvnosti
- `product.png` / `product.webp` — hlavní obrázek

## Konfigurace

- Endpoint pro odeslání formuláře: konstanta `GOOGLE_SCRIPT_URL` v `script.js`
- Měřicí ID analytiky: `GA4_MEASUREMENT_ID` v `index.html`

## Lokální spuštění

Otevři `index.html` v prohlížeči, nebo spusť jednoduchý statický server:

```bash
npx serve .
```

## Nasazení

Publikováno přes GitHub Pages (Settings → Pages → Deploy from a branch → `main` → `/root`).
