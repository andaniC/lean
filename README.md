# Lean – calorie tracker PWA

Snap a photo of a meal (or scan a barcode, search a food, or describe what you ate) and Lean logs the
calories and macros against a personal daily plan.

## How it fits together

- `public/` – the installable web app (plain HTML/CSS/ES modules, no build step). Everything a phone
  needs is in here; data is stored on the phone in IndexedDB.
- Workouts: she builds her own workouts from a glute exercise library (demo GIFs from the free
  ExerciseDB API) or 1,500 searchable exercises; squats can be counted on-device with MediaPipe pose tracking.
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

GitHub Pages serves the `gh-pages` branch:

```sh
npm run deploy:beta   # https://andanic.github.io/lean/beta/  (separate data, shows "beta")
npm run deploy:prod   # https://andanic.github.io/lean/
```

Bump `CACHE` in `public/sw.js` with each release.

## Install on iPhone

Open the site in Safari → Share → **Add to Home Screen** → open Lean from the Home Screen and follow the
onboarding. (Home Screen apps keep their own storage, so do the onboarding inside the installed app.)

## Regenerating vendored code

`public/vendor/zxing.js` (barcode decoder for iPhone) is bundled with `npm install && npm run vendor`.
