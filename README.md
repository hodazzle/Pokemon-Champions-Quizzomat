# 🎮 Champions Quiz

**Learn the Pokémon Champions VGC metagame by heart.**

A flashcard-style quiz that shows you a Pokémon and asks you to recall its most-used
**moves, abilities, items**, its **base Speed**, and its **type matchups** — all from
live competitive usage data. It drills the Pokémon you'll actually face most, and brings
back whatever you keep forgetting, like a spaced-repetition app (Anki) built just for VGC.

### ▶️ Play it here
**https://hodazzle.github.io/Pokemon-Champions-Quizzomat/**

> 📲 **Put it on your phone:** open that link in **Safari** → tap **Share** →
> **Add to Home Screen**. It then opens fullscreen like a real app and works offline.

---

## How to play

1. You see a Pokémon — its sprite, name, types, and a question
   (e.g. *"Name the most-used moves"*).
2. Try to recall the answer in your head.
3. **Tap the card** (or press `Space`) to flip it and reveal the answer, with the exact
   **usage %** for each move/ability/item.
4. Rate how you did: **Again / Good / Easy** (or keys `1` / `2` / `3`).
   The app schedules when you'll see that card again — soon if you struggled, later if you nailed it.

You're quizzed **more often on popular Pokémon** (Basculegion shows up far more than some
2%-usage pick) and less on rare ones, so your study time goes where it matters.

### What it quizzes you on
- **Moves** — the top moves and how often they're run
- **Abilities** — the common ability choices
- **Items** — the common held items
- **Base Speed** — the Pokémon's base Speed stat (with its full stat spread on the back)
- **Weaknesses / Resistances / Immunities** — its type matchups

Tap **⚙** to turn any of these on/off, choose how many of the top Pokémon to study, and
set how many new cards to learn per day. Tap **📊** to see your progress.

---

## Staying up to date

The usage data refreshes automatically **every Monday**, so the quiz always reflects the
current metagame. When that happens:

- **Your progress is kept.** A Pokémon you've been learning stays the same card — it just
  shows the latest numbers.
- **If its facts change, it comes back sooner.** If, say, 2 of a Pokémon's 6 moves have
  shifted in the meta, the card is bumped up for review proportionally — small changes mean
  a gentle refresher, big changes mean it's treated almost like something brand new.
- **New Pokémon show up automatically.** If a Pokémon climbs into the top of the metagame,
  it (and its sprite) appear as new cards on their own.

Your learning progress is saved on each device you use — it isn't synced between them.

---

## A few notes

- It's **free** and runs entirely in your browser — no account, no ads, nothing to pay.
- Usage data is from [Pikalytics](https://www.pikalytics.com), which updates roughly monthly,
  so some Mondays the numbers will simply stay the same.
- Type matchups use the standard Pokémon type chart.

---

<details>
<summary>🔧 For the curious / developers</summary>

This is a static web app (plain HTML/CSS/JS, no build step) hosted on GitHub Pages.
A scheduled GitHub Action runs the scraper weekly and redeploys the site — there's no
server and nothing to maintain.

| Path | What it is |
|------|------------|
| `index.html`, `styles.css`, `app.js` | the app and quiz engine |
| `data/champions.json` | per-Pokémon usage, top moves/abilities/items, types, stats |
| `data/typechart.json` | ability-based immunity maps (the type chart is built into `app.js`) |
| `sprites/*.png` | cached Pokémon sprites |
| `scripts/scrape.mjs` | the scraper (runs in CI; uses Pikalytics' documented data endpoints) |
| `.github/workflows/refresh.yml` | weekly refresh + deploy to GitHub Pages |
| `manifest.webmanifest`, `sw.js`, `icons/` | makes it installable + offline (PWA) |

**Run the scraper locally** (optional, needs Node): `node scripts/scrape.mjs`
regenerates `data/*.json` and `sprites/`. Tweaks: `MAX_POKEMON=272 node scripts/scrape.mjs`
for more Pokémon; `FORMAT=...` for a different format. In `app.js`, `STRETCH_K` controls
how strongly usage biases how often a Pokémon is quizzed.

</details>

## License

Source code is [MIT licensed](LICENSE). Usage data belongs to Pikalytics, and Pokémon
names/sprites are © Nintendo, Game Freak, and The Pokémon Company — included here for
personal, non-commercial study only.
