# Lean – calorie tracker PWA

Snap a photo of a meal (or scan a barcode, search a food, or describe what you ate) and Lean logs the
calories and macros against a personal daily plan.

## How it fits together

- `public/` – the installable web app (plain HTML/CSS/ES modules, no build step). Everything a phone
  needs is in here; data is stored on the phone in IndexedDB.
- `supabase/functions/lean-food-ai/` – Supabase Edge Function that holds the API keys and does the work:
  - photo / label / text analysis with Claude Sonnet 5.5 (`ANTHROPIC_API_KEY`)
  - food search with USDA FoodData Central (`USDA_API_KEY`)
  - barcode lookup with Open Food Facts, falling back to USDA branded foods
- The app proves it may use the function with an access code (`APP_ACCESS_CODE` secret), entered once
  during onboarding or in Settings.

Supabase project: `lean` (`iuwgetnugmpeyelztnvq`).

## Run locally

```sh
npm run serve          # http://localhost:5173
```

## Update the server

```sh
npm run deploy:function
supabase secrets set --project-ref iuwgetnugmpeyelztnvq APP_ACCESS_CODE=new-code   # rotate the code
```

## Publish the app

Upload the contents of `public/` to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages).
After changing files in `public/`, bump `CACHE` in `public/sw.js` so phones pick up the new version.

## Install on iPhone

Open the site in Safari → Share → **Add to Home Screen** → open Lean from the Home Screen and follow the
onboarding. (Home Screen apps keep their own storage, so do the onboarding inside the installed app.)

## Regenerating vendored code

`public/vendor/zxing.js` (barcode decoder for iPhone) is bundled with `npm install && npm run vendor`.
