// Champions Quiz — Anki-style spaced repetition for Pokemon Champions usage data.
// Plain ES module, no build step. State lives in localStorage (per device).

const DAY = 86_400_000;
const AGAIN_DELAY = 60_000; // a lapsed card comes back ~1 min later (same session)
const STRETCH_K = 2; // low-usage Pokemon get up to ~3x longer review intervals

// ---------------------------------------------------------------------------
// Static reference data
// ---------------------------------------------------------------------------

// Canonical attacking type chart: T[attacker][defender] = multiplier (omitted = 1x).
// Embedded because type effectiveness is universal and stable, and the live feed
// does not encode 0x immunities.
const T = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { grass: 2, ice: 2, bug: 2, steel: 2, fire: 0.5, water: 0.5, rock: 0.5, dragon: 0.5 },
  water: { fire: 2, ground: 2, rock: 2, water: 0.5, grass: 0.5, dragon: 0.5 },
  electric: { water: 2, flying: 2, electric: 0.5, grass: 0.5, dragon: 0.5, ground: 0 },
  grass: { water: 2, ground: 2, rock: 2, fire: 0.5, grass: 0.5, poison: 0.5, flying: 0.5, bug: 0.5, dragon: 0.5, steel: 0.5 },
  ice: { grass: 2, ground: 2, flying: 2, dragon: 2, fire: 0.5, water: 0.5, ice: 0.5, steel: 0.5 },
  fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, fairy: 0.5, ghost: 0 },
  poison: { grass: 2, fairy: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
  ground: { fire: 2, electric: 2, poison: 2, rock: 2, steel: 2, grass: 0.5, bug: 0.5, flying: 0 },
  flying: { grass: 2, fighting: 2, bug: 2, electric: 0.5, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, steel: 0.5, dark: 0 },
  bug: { grass: 2, psychic: 2, dark: 2, fire: 0.5, fighting: 0.5, poison: 0.5, flying: 0.5, ghost: 0.5, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, flying: 2, bug: 2, fighting: 0.5, ground: 0.5, steel: 0.5 },
  ghost: { psychic: 2, ghost: 2, dark: 0.5, normal: 0 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { psychic: 2, ghost: 2, fighting: 0.5, dark: 0.5, fairy: 0.5 },
  steel: { ice: 2, rock: 2, fairy: 2, fire: 0.5, water: 0.5, electric: 0.5, steel: 0.5 },
  fairy: { fighting: 2, dragon: 2, dark: 2, fire: 0.5, poison: 0.5, steel: 0.5 },
};
const ALL_TYPES = Object.keys(T);

const TYPE_COLORS = {
  normal: "#9099a1", fire: "#ff9d55", water: "#4d90d5", electric: "#f4d23c",
  grass: "#63bb5b", ice: "#73cec0", fighting: "#ce4069", poison: "#ab6ac8",
  ground: "#d97746", flying: "#8fa9de", psychic: "#fa7179", bug: "#90c12c",
  rock: "#c7b78b", ghost: "#5269ac", dragon: "#0a6dc4", dark: "#5a5366",
  steel: "#5a8ea1", fairy: "#ec8fe6",
};

const CATEGORIES = {
  moves: { label: "Moves", prompt: "Name the most-used moves", kind: "list" },
  abilities: { label: "Abilities", prompt: "Name the most-used abilities", kind: "list" },
  items: { label: "Items", prompt: "Name the most-used items", kind: "list" },
  weak: { label: "Weaknesses", prompt: "Which types are super effective against it?", kind: "type" },
  resist: { label: "Resistances", prompt: "Which types does it resist?", kind: "type" },
  immune: { label: "Immunities", prompt: "Which types is it immune to?", kind: "type" },
};

// ---------------------------------------------------------------------------
// Persistent state
// ---------------------------------------------------------------------------

const LS = {
  srs: "cq.srs.v1",
  daily: "cq.daily.v1",
  settings: "cq.settings.v1",
};
const load = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
  catch { return fallback; }
};
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const defaultSettings = () => ({
  cats: { moves: true, abilities: true, items: true, weak: true, resist: true, immune: true },
  topN: 100,
  newPerDay: 15,
});

let DATA = null; // { meta, pokemon: [...] }
let CHART = null; // typechart.json (ability maps)
let byId = new Map(); // pokemonId -> pokemon
let maxUsage = 1;

let srs = load(LS.srs, {});
let settings = { ...defaultSettings(), ...load(LS.settings, {}) };
let daily = load(LS.daily, { date: today(), reviewed: 0, introduced: 0 });

let current = null; // current card { pokemon, cat, id, answer }
let cramMode = false;

function today() {
  return new Date().toISOString().slice(0, 10);
}
function rollDaily() {
  if (daily.date !== today()) {
    daily = { date: today(), reviewed: 0, introduced: 0 };
    save(LS.daily, daily);
  }
}

// ---------------------------------------------------------------------------
// Type-effectiveness helpers
// ---------------------------------------------------------------------------

function defenseMultiplier(attacker, defTypes) {
  let m = 1;
  for (const d of defTypes) m *= T[attacker][d] ?? 1;
  return m;
}

// Returns { weak:[{type,mult}], resist:[...], immune:[...] } for a Pokemon's typing.
function typeProfile(pokemon) {
  const out = { weak: [], resist: [], immune: [] };
  for (const atk of ALL_TYPES) {
    const m = defenseMultiplier(atk, pokemon.types);
    if (m === 0) out.immune.push({ type: atk, mult: m });
    else if (m > 1) out.weak.push({ type: atk, mult: m });
    else if (m < 1) out.resist.push({ type: atk, mult: m });
  }
  const order = (a, b) => b.mult - a.mult || a.type.localeCompare(b.type);
  out.weak.sort(order);
  out.resist.sort((a, b) => a.mult - b.mult || a.type.localeCompare(b.type));
  return out;
}

// Ability-based immunity note (e.g. Levitate -> Ground). Informational only.
function abilityImmunityNote(pokemon) {
  const map = CHART?.abilityImmunityMap || {};
  for (const a of pokemon.abilities || []) {
    const key = a.name.toLowerCase().replace(/[^a-z]/g, "");
    if (map[key]) return `With ${a.name}, also immune to ${map[key]}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deck + card answers
// ---------------------------------------------------------------------------

function eligiblePokemon() {
  return DATA.pokemon.slice(0, settings.topN);
}

// Does a Pokemon have content for a given category?
function hasCategory(p, cat) {
  if (cat === "moves") return p.moves.length > 0;
  if (cat === "abilities") return p.abilities.length > 0;
  if (cat === "items") return p.items.length > 0;
  if (cat === "weak") return true;
  if (cat === "resist") return true;
  if (cat === "immune") return typeProfile(p).immune.length > 0; // skip trivial "None"
  return false;
}

function enabledCats() {
  return Object.keys(CATEGORIES).filter((c) => settings.cats[c]);
}

// All currently-eligible card ids.
function allCards() {
  const cards = [];
  for (const p of eligiblePokemon()) {
    for (const cat of enabledCats()) {
      if (hasCategory(p, cat)) cards.push({ id: `${p.id}#${cat}`, pid: p.id, cat });
    }
  }
  return cards;
}

function cardAnswer(p, cat) {
  if (cat === "moves") return { kind: "list", items: p.moves };
  if (cat === "abilities") return { kind: "list", items: p.abilities };
  if (cat === "items") return { kind: "list", items: p.items };
  const prof = typeProfile(p);
  if (cat === "weak") return { kind: "type", items: prof.weak, note: null };
  if (cat === "resist") return { kind: "type", items: prof.resist, note: null };
  if (cat === "immune") return { kind: "type", items: prof.immune, note: abilityImmunityNote(p) };
}

// ---------------------------------------------------------------------------
// Spaced-repetition scheduling
// ---------------------------------------------------------------------------

function usageStretch(usage) {
  const norm = Math.min(1, usage / maxUsage);
  return 1 + (1 - norm) * STRETCH_K; // 1x for top mon, up to (1+K)x for rarest
}

function grade(card, g) {
  const now = Date.now();
  const prior = srs[card.id];
  const isNew = !prior;
  const s = prior
    ? { ...prior }
    : { reps: 0, interval: 0, ease: 2.5, lapses: 0, last: 0 };

  if (g === "again") {
    s.reps = 0;
    s.lapses += 1;
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.interval = 0;
    s.due = now + AGAIN_DELAY;
  } else {
    let base;
    if (g === "easy") {
      base = s.reps === 0 ? 2 : s.reps === 1 ? 4 : s.interval * s.ease * 1.3;
      s.ease = Math.min(2.8, s.ease + 0.15);
    } else {
      base = s.reps === 0 ? 1 : s.reps === 1 ? 3 : s.interval * s.ease;
    }
    base *= usageStretch(byId.get(card.pid).usage);
    s.interval = base;
    s.reps += 1;
    s.due = now + base * DAY;
  }
  s.last = now;
  srs[card.id] = s;
  save(LS.srs, srs);

  rollDaily();
  daily.reviewed += 1;
  if (isNew) daily.introduced += 1;
  save(LS.daily, daily);
}

// Weighted random pick: probability scales with usage (strong bias to meta staples).
function weightedPick(cards) {
  let total = 0;
  const weights = cards.map((c) => {
    const w = Math.max(0.3, byId.get(c.pid).usage);
    total += w;
    return w;
  });
  let r = Math.random() * total;
  for (let i = 0; i < cards.length; i++) {
    r -= weights[i];
    if (r <= 0) return cards[i];
  }
  return cards[cards.length - 1];
}

// Decide the next card. Returns { card, mode } or null.
function pickNext() {
  rollDaily();
  const now = Date.now();
  const cards = allCards();
  const due = [];
  const fresh = [];
  for (const c of cards) {
    const s = srs[c.id];
    if (!s) fresh.push(c);
    else if (s.due <= now) due.push(c);
  }

  if (cramMode) {
    // Keep studying everything, weighted by usage, ignoring schedule.
    return cards.length ? { card: weightedPick(cards), mode: "cram" } : null;
  }
  if (due.length) return { card: weightedPick(due), mode: "due" };
  if (fresh.length && daily.introduced < settings.newPerDay)
    return { card: weightedPick(fresh), mode: "new" };
  return null; // all caught up
}

function dueCount() {
  rollDaily();
  const now = Date.now();
  let n = 0;
  for (const c of allCards()) {
    const s = srs[c.id];
    if (s && s.due <= now) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const fmtPct = (n) => `${n.toFixed(1)}%`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function spriteUrl(p) {
  return p.spriteKey ? `sprites/${p.spriteKey}.png` : "";
}
function typeChip(type) {
  const c = el("span", "type-chip", cap(type));
  c.style.background = TYPE_COLORS[type] || "#888";
  return c;
}

function renderQuestion() {
  const next = pickNext();
  if (!next) {
    showCaughtUp();
    return;
  }
  cramMode = next.mode === "cram";
  const p = byId.get(next.card.pid);
  const cat = next.card.cat;
  current = { pokemon: p, pid: p.id, cat, id: next.card.id, answer: cardAnswer(p, cat) };

  $("#message").hidden = true;
  $("#quiz").hidden = false;

  $("#q-category").textContent = CATEGORIES[cat].label;
  $("#q-usage").textContent = `${fmtPct(p.usage)} usage`;
  const sprite = $("#q-sprite");
  sprite.src = spriteUrl(p);
  sprite.alt = p.name;
  $("#q-name").textContent = p.name;

  const types = $("#q-types");
  types.replaceChildren(...p.types.map(typeChip));

  $("#q-prompt").textContent = CATEGORIES[cat].prompt;

  // reset answer / controls
  const ans = $("#answer");
  ans.hidden = true;
  ans.replaceChildren();
  $("#btn-flip").hidden = false;
  $("#grade-row").hidden = true;

  updateTopStats();
}

function renderAnswer() {
  const ans = $("#answer");
  ans.replaceChildren();
  const a = current.answer;

  if (a.kind === "list") {
    if (!a.items.length) {
      ans.append(el("p", "answer-empty", "No data."));
    } else {
      for (const it of a.items) ans.append(answerRow(it.name, it.percent));
    }
  } else {
    if (!a.items.length) {
      ans.append(el("p", "answer-empty", "None — neutral or no immunities."));
    } else {
      const wrap = el("div", "type-row");
      for (const it of a.items) wrap.append(multChip(it.type, it.mult));
      ans.append(wrap);
    }
    if (a.note) ans.append(el("p", "answer-note", a.note));
  }

  ans.hidden = false;
  $("#btn-flip").hidden = true;
  $("#grade-row").hidden = false;
}

function answerRow(label, pct) {
  const row = el("div", "ans-row");
  row.append(el("span", "ans-label", label));
  const bar = el("div", "bar");
  bar.append(Object.assign(document.createElement("span"), {
    style: `width:${Math.min(100, pct)}%`,
  }));
  row.append(bar);
  row.append(el("span", "ans-pct", fmtPct(pct)));
  return row;
}

function multChip(type, mult) {
  const c = el("span", "mult-chip");
  const dot = typeChip(type);
  c.append(dot);
  const label = mult === 0 ? "0×" : `${mult}×`;
  c.append(el("span", "mult", label));
  return c;
}

function showCaughtUp() {
  $("#quiz").hidden = true;
  const m = $("#message");
  m.hidden = false;
  $("#message-text").textContent =
    dueCount() === 0
      ? "All caught up! No cards are due right now. 🎉"
      : "Daily new-card limit reached.";
  const btn = $("#message-action");
  btn.hidden = false;
  btn.textContent = "Keep studying anyway";
  btn.onclick = () => {
    cramMode = true;
    renderQuestion();
  };
  updateTopStats();
}

function updateTopStats() {
  const d = dueCount();
  const dueEl = $("#stat-due");
  dueEl.textContent = `${d} due`;
  dueEl.classList.toggle("zero", d === 0);
  $("#stat-done").textContent = `${daily.reviewed} today`;
}

// ---------------------------------------------------------------------------
// Settings + stats drawers
// ---------------------------------------------------------------------------

function buildCatToggles() {
  const wrap = $("#cat-toggles");
  wrap.replaceChildren();
  for (const [key, def] of Object.entries(CATEGORIES)) {
    const count = eligiblePokemon().filter((p) => hasCategory(p, key)).length;
    const lab = el("label", "toggle");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!settings.cats[key];
    cb.onchange = () => {
      settings.cats[key] = cb.checked;
      if (!enabledCats().length) { settings.cats[key] = true; cb.checked = true; return; }
      save(LS.settings, settings);
      renderQuestion();
    };
    lab.append(
      el("span", null, `${def.label} <span class="toggle-count">${count} cards</span>`),
    );
    lab.append(cb);
    wrap.append(lab);
  }
}

function openSettings() {
  buildCatToggles();
  $("#top-n").value = settings.topN;
  $("#new-per-day").value = settings.newPerDay;
  const m = DATA.meta;
  $("#data-info").innerHTML =
    `${m.label}<br>Usage data: <b>${m.date}</b> · ${DATA.pokemon.length} Pokémon` +
    `<br>Fetched ${new Date(m.generatedAt).toLocaleDateString()} · ` +
    `<a href="${m.source}" target="_blank" rel="noopener">Pikalytics</a>`;
  $("#settings").hidden = false;
}

function commitNumberSetting(input, key, min, max) {
  let v = parseInt(input.value, 10);
  if (!Number.isFinite(v)) v = settings[key];
  v = Math.max(min, Math.min(max, v));
  input.value = v;
  settings[key] = v;
  save(LS.settings, settings);
  renderQuestion();
  buildCatToggles();
}

function openStats() {
  const cards = allCards();
  const now = Date.now();
  let seen = 0, due = 0, mature = 0, learning = 0;
  for (const c of cards) {
    const s = srs[c.id];
    if (!s) continue;
    seen++;
    if (s.due <= now) due++;
    if (s.interval >= 21) mature++;
    else learning++;
  }
  const total = cards.length;
  const newCount = total - seen;
  const pct = (n) => (total ? (n / total) * 100 : 0);

  const body = $("#stats-body");
  body.replaceChildren();
  const grid = el("div", "stat-grid");
  const box = (num, lbl) => {
    const b = el("div", "stat-box");
    b.append(el("div", "num", String(num)));
    b.append(el("div", "lbl", lbl));
    return b;
  };
  grid.append(box(total, "Total cards"));
  grid.append(box(daily.reviewed, "Reviewed today"));
  grid.append(box(due, "Due now"));
  grid.append(box(mature, "Mastered (21d+)"));
  body.append(grid);

  const bar = el("div", "mastery-bar");
  const seg = (w, color) => {
    if (w <= 0) return;
    const s = document.createElement("span");
    s.style.width = `${w}%`;
    s.style.background = color;
    bar.append(s);
  };
  seg(pct(mature), "#4ad07f");
  seg(pct(learning), "#f4d23c");
  seg(pct(newCount), "#3a4263");
  body.append(el("p", "answer-section-title", "Mastery"));
  body.append(bar);
  body.append(
    el(
      "div",
      "legend",
      `<span><i style="background:#4ad07f"></i>Mastered ${mature}</span>` +
        `<span><i style="background:#f4d23c"></i>Learning ${learning}</span>` +
        `<span><i style="background:#3a4263"></i>New ${newCount}</span>`,
    ),
  );
  $("#stats").hidden = false;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function flip() {
  // Only reveal when a card is showing its question side.
  if (current && $("#answer").hidden) renderAnswer();
}

function wireEvents() {
  $("#btn-flip").onclick = flip;
  document.querySelector(".card").addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    if ($("#answer").hidden) flip();
  });

  document.querySelectorAll(".grade").forEach((b) => {
    b.onclick = () => {
      if (!current || $("#answer").hidden) return;
      grade(current, b.dataset.grade);
      renderQuestion();
    };
  });

  $("#btn-settings").onclick = openSettings;
  $("#settings-close").onclick = () => ($("#settings").hidden = true);
  $("#btn-stats").onclick = openStats;
  $("#stats-close").onclick = () => ($("#stats").hidden = true);
  [$("#settings"), $("#stats")].forEach((d) =>
    d.addEventListener("click", (e) => { if (e.target === d) d.hidden = true; }),
  );

  $("#top-n").onchange = (e) => commitNumberSetting(e.target, "topN", 10, DATA.pokemon.length);
  $("#new-per-day").onchange = (e) => commitNumberSetting(e.target, "newPerDay", 0, 100);

  $("#btn-reset").onclick = () => {
    if (!confirm("Erase all your quiz progress on this device?")) return;
    srs = {};
    daily = { date: today(), reviewed: 0, introduced: 0 };
    save(LS.srs, srs);
    save(LS.daily, daily);
    $("#settings").hidden = true;
    cramMode = false;
    renderQuestion();
  };

  document.addEventListener("keydown", (e) => {
    if (!$("#settings").hidden || !$("#stats").hidden) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (current && $("#answer").hidden) flip();
    } else if (!$("#answer").hidden && ["1", "2", "3"].includes(e.key)) {
      const map = { 1: "again", 2: "good", 3: "easy" };
      grade(current, map[e.key]);
      renderQuestion();
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  try {
    const [champRes, chartRes] = await Promise.all([
      fetch("data/champions.json"),
      fetch("data/typechart.json"),
    ]);
    DATA = await champRes.json();
    CHART = await chartRes.json();
  } catch (err) {
    $("#message-text").textContent =
      "Could not load quiz data. If you just set this up, run the data refresh first.";
    return;
  }

  byId = new Map(DATA.pokemon.map((p) => [p.id, p]));
  maxUsage = Math.max(...DATA.pokemon.map((p) => p.usage), 1);
  settings.topN = Math.min(settings.topN, DATA.pokemon.length);

  wireEvents();
  renderQuestion();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot();
