# Champions Quiz

An Anki-style quiz for **Pokémon Champions VGC** usage stats. It shows you a
Pokémon and asks you to recall its most-used **moves, abilities, items**, and its
**type matchups** (weaknesses / resistances / immunities). High-usage Pokémon
(like Basculegion at ~51%) come up far more often than rare ones, and a
spaced-repetition scheduler brings back what you keep getting wrong.

- 📊 Live usage data from [Pikalytics](https://www.pikalytics.com) (top 200 Pokémon)
- 🧠 Spaced repetition (SM-2-style) **weighted by usage %**
- ⚡ Type-effectiveness quizzes from the canonical type chart
- 📱 Installable on your iPhone home screen, works offline (PWA)
- 🔄 Auto-refreshes every Monday via GitHub Actions — no servers, completely free

> Note: Pikalytics refreshes its numbers roughly **monthly**, so the Monday job
> usually re-pulls the same data and picks up changes as soon as they post a new set.

---

## How it plays

1. You see a Pokémon's sprite, name, types, and a prompt ("Name the most-used moves").
2. Recall the answer in your head, then tap the card (or press <kbd>Space</kbd>) to flip.
3. The answer appears with **usage % bars**.
4. Grade yourself: **Again / Good / Easy** (keys <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>).
   The scheduler decides when you'll see that card next.

Tap ⚙ to choose which quiz types are active, how many top Pokémon to study, and
how many new cards to introduce per day. Tap 📊 for your progress. Your progress
is stored on each device (not synced).

---

## One-time setup (copy & paste)

You need a free [GitHub](https://github.com) account. Everything else is free.

**1. Create an empty repository** on GitHub — e.g. name it `champions-quiz`.
Don't add a README/license (this folder already has files).

**2. Push this folder.** In Terminal, from inside this project folder, run
(replace `YOUR_USERNAME` and `champions-quiz` if you named it differently):

```bash
git init
git add .
git commit -m "Champions Quiz"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/champions-quiz.git
git push -u origin main
```

**3. Turn on GitHub Pages.** On GitHub: your repo → **Settings → Pages** →
under "Build and deployment", set **Source** to **GitHub Actions**.

**4. Wait for the build.** Go to the **Actions** tab. The "Refresh & Deploy"
workflow runs automatically on your push (it scrapes fresh data and publishes the
site). When it finishes (~1–2 min), your app is live at:

```
https://YOUR_USERNAME.github.io/champions-quiz/
```

**5. Install on your phone.** Open that URL in **Safari** on your iPhone →
tap the **Share** button → **Add to Home Screen**. It now opens like an app and
works offline.

---

## Updating the data

- **Automatic:** every Monday the GitHub Action re-scrapes and redeploys.
- **On demand:** repo → **Actions → Refresh & Deploy → Run workflow**.
- **Locally** (optional, needs Node): `node scripts/scrape.mjs` regenerates
  `data/*.json` and `sprites/`.

---

## Project layout

| Path | What it is |
|------|------------|
| `index.html`, `styles.css`, `app.js` | the app (no build step) |
| `data/champions.json` | per-Pokémon usage, top moves/abilities/items, types, stats |
| `data/typechart.json` | ability-based immunity maps (type chart is built into `app.js`) |
| `sprites/*.png` | cached Pokémon sprites |
| `scripts/scrape.mjs` | the scraper (runs in CI; uses Pikalytics' documented AI endpoints) |
| `.github/workflows/refresh.yml` | Monday cron + deploy to GitHub Pages |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA install + offline support |

## Tweaks

- **Study more/fewer Pokémon:** the ⚙ "top N" setting, or set `MAX_POKEMON`
  when scraping (e.g. `MAX_POKEMON=272 node scripts/scrape.mjs`).
- **Change how strongly usage biases the quiz:** `STRETCH_K` in `app.js`.
- **A different format:** set `FORMAT=...` for the scraper (see format codes in
  Pikalytics' `llms-full.txt`).

Data courtesy of [Pikalytics](https://www.pikalytics.com).

## License

Source code is [MIT licensed](LICENSE). Bundled usage data belongs to Pikalytics,
and Pokémon names/sprites are © Nintendo, Game Freak, and The Pokémon Company —
included here for personal, non-commercial study only.
