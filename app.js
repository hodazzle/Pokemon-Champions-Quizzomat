// Champions Quiz. Anki style spaced repetition for Pokemon Champions usage data.
// Plain ES module, no build step. State lives in localStorage (per device).

const DAY = 86_400_000;
const AGAIN_DELAY = 60_000; // a lapsed card comes back about a minute later (same session)
const STRETCH_K = 2; // low usage Pokemon get up to about 3x longer review intervals

// How many of each answer to show, chosen from the usage distribution (see selectShown).
const SHOW = {
  moves: { floor: 10, hard: 3, min: 4, cap: 6 },
  abilities: { floor: 5, hard: 1, min: 2, cap: 4 },
  items: { floor: 5, hard: 2, min: 3, cap: 6 },
};

// ---------------------------------------------------------------------------
// Static reference data
// ---------------------------------------------------------------------------

// Canonical attacking type chart: T[attacker][defender] = multiplier (omitted = 1x).
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

// Move category badges with a small glyph (physical / special / status).
const CAT_META = {
  Physical: { color: "#e8533f", glyph: '<path d="M2 8.5 L9.5 2 L8 7 H14 L6.5 14 L8 8.5 Z"/>' },
  Special: { color: "#4c7be0", glyph: '<circle cx="8" cy="8" r="2.6"/><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.5"/>' },
  Status: { color: "#8a8f9c", glyph: '<circle cx="4.4" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="11.6" cy="8" r="1.5"/>' },
};

const CATEGORIES = {
  moves: { label: "Moves", kind: "list" },
  abilities: { label: "Abilities", kind: "list" },
  items: { label: "Items", kind: "list" },
  speed: { label: "Base Speed", kind: "stat" },
  weak: { label: "Weaknesses", kind: "type" },
  resist: { label: "Resistances", kind: "type" },
  immune: { label: "Immunities", kind: "type" },
};

function promptFor(cat, n) {
  switch (cat) {
    case "moves": return `Name the ${n} most-used moves`;
    case "abilities": return n === 1 ? "Name the main ability" : `Name the ${n} most-used abilities`;
    case "items": return `Name the ${n} most-used items`;
    case "speed": return "What is its base Speed stat?";
    case "weak": return "Which types are super effective against it?";
    case "resist": return "Which types does it resist?";
    case "immune": return "Which types is it immune to?";
    default: return "";
  }
}

// ---------------------------------------------------------------------------
// What's new + how it works content
// ---------------------------------------------------------------------------

const CHANGELOG = [
  { v: "1.6", date: "2026-06-09", items: [
    "New home screen and menu before the quiz.",
    "Cross device sync and backup, by code or file.",
    "Clearer, more prominent question on every card.",
    "Move, ability and item details redesigned with category icons and a clean stat layout.",
    "Answer length now adapts to the usage distribution instead of always showing three.",
    "The Mega stone is now shown as an extra item and is always included.",
    "Added this Updates and How it works section.",
  ]},
  { v: "1.4", date: "2026-06-08", items: ["Mega forms no longer ask for their item; the stone is folded into the base form at its real usage share."] },
  { v: "1.3", date: "2026-06-08", items: ["Tap any move, ability or item to see its mechanics, from PokéAPI."] },
  { v: "1.2", date: "2026-06-08", items: ["Smart weekly updates: cards whose facts changed come back for review sooner."] },
  { v: "1.1", date: "2026-06-08", items: ["Added a base Speed quiz."] },
  { v: "1.0", date: "2026-06-08", items: ["First version: usage weighted spaced repetition for moves, abilities, items and type matchups."] },
];

const HOWTO = [
  { q: "How does the quiz pick what to show me?", a: "You see Pokémon weighted by how common they are in the metagame, so most of your time goes to what you will actually face. A spaced repetition scheduler then brings each card back based on how well you knew it." },
  { q: "Why do item percentages differ from Pikalytics for Mega Pokémon?", a: "On Pikalytics a Mega is listed as a separate Pokémon whose item is almost always its Mega stone. Here the stone is attached to the base form instead, sized to how often that species actually Mega Evolves: megaUsage divided by (baseUsage plus megaUsage). The base items are rescaled to a species wide share. So the numbers are recomputed on purpose, to teach the real chance of facing the Mega, not a mismatch." },
  { q: "How do spread and single target moves work in VGC?", a: "Champions is doubles, so many moves can hit both opponents (spread) for slightly less damage, while others hit a single target. Tap a move to see its target, power, accuracy, PP and effect." },
  { q: "Why do some Pokémon show more answers than others?", a: "The app shows the meaningful options, those above a usage threshold, with at least a few and a sensible cap. When there is a long flat tail of rare choices it is skipped to save your time. The Mega stone is always shown." },
  { q: "What happens to my progress when the data updates?", a: "It is kept. Each Monday the data refreshes; if a card's facts changed, it comes back for review sooner, in proportion to how much changed. Brand new Pokémon appear as new cards." },
  { q: "Where does the data come from?", a: "Usage statistics from Pikalytics, refreshed about monthly. Move, ability and item mechanics from PokéAPI." },
];

// ---------------------------------------------------------------------------
// Persistent state
// ---------------------------------------------------------------------------

const LS = { srs: "cq.srs.v1", daily: "cq.daily.v1", settings: "cq.settings.v1" };
const load = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
  catch { return fallback; }
};
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const defaultSettings = () => ({
  cats: { moves: true, abilities: true, items: true, speed: true, weak: true, resist: true, immune: true },
  topN: 100,
  newPerDay: 15,
});

let DATA = null;
let CHART = null;
let MOVES = {};
let ABILITIES = {};
let ITEMS = {};
let byId = new Map();
let maxUsage = 1;

const savedSettings = load(LS.settings, {});
let settings = {
  ...defaultSettings(),
  ...savedSettings,
  cats: { ...defaultSettings().cats, ...(savedSettings.cats || {}) },
};
let srs = load(LS.srs, {});
let daily = load(LS.daily, { date: today(), reviewed: 0, introduced: 0 });

let current = null;
let cramMode = false;

function today() { return new Date().toISOString().slice(0, 10); }
function rollDaily() {
  if (daily.date !== today()) {
    daily = { date: today(), reviewed: 0, introduced: 0 };
    save(LS.daily, daily);
  }
}

// ---------------------------------------------------------------------------
// Type effectiveness
// ---------------------------------------------------------------------------

function defenseMultiplier(attacker, defTypes) {
  let m = 1;
  for (const d of defTypes) m *= T[attacker][d] ?? 1;
  return m;
}
function typeProfile(pokemon) {
  const out = { weak: [], resist: [], immune: [] };
  for (const atk of ALL_TYPES) {
    const m = defenseMultiplier(atk, pokemon.types);
    if (m === 0) out.immune.push({ type: atk, mult: m });
    else if (m > 1) out.weak.push({ type: atk, mult: m });
    else if (m < 1) out.resist.push({ type: atk, mult: m });
  }
  out.weak.sort((a, b) => b.mult - a.mult || a.type.localeCompare(b.type));
  out.resist.sort((a, b) => a.mult - b.mult || a.type.localeCompare(b.type));
  return out;
}
function abilityImmunityNote(pokemon) {
  const map = CHART?.abilityImmunityMap || {};
  for (const a of pokemon.abilities || []) {
    const key = a.name.toLowerCase().replace(/[^a-z]/g, "");
    if (map[key]) return `With ${a.name}, also immune to ${map[key]}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deck + answers
// ---------------------------------------------------------------------------

// Choose how many answers to show from the usage distribution: include those above a
// floor, keep at least a minimum and at most a cap, skip a long flat tail, and never
// pad with near zero noise.
function selectShown(list, cfg) {
  const sorted = [...(list || [])].sort((a, b) => b.percent - a.percent);
  if (!sorted.length) return [];
  const strong = sorted.filter((x) => x.percent >= cfg.floor).length;
  let n = strong > cfg.cap ? cfg.min : Math.max(cfg.min, strong);
  n = Math.min(n, cfg.cap, sorted.length);
  let chosen = sorted.slice(0, n);
  while (chosen.length > 1 && chosen[chosen.length - 1].percent < cfg.hard) chosen.pop();
  return chosen;
}

// The exact list shown for a list category. Mega stones are always appended for items.
function shownList(p, cat) {
  if (cat === "moves") return selectShown(p.moves, SHOW.moves);
  if (cat === "abilities") return selectShown(p.abilities, SHOW.abilities);
  if (cat === "items") {
    // Show the chosen items plus the Mega stone(s), always included, sorted by share.
    return [...selectShown(p.items, SHOW.items), ...(p.megaStones || [])].sort(
      (a, b) => b.percent - a.percent,
    );
  }
  return [];
}

function eligiblePokemon() { return DATA.pokemon.slice(0, settings.topN); }

function hasCategory(p, cat) {
  if (cat === "moves") return p.moves.length > 0;
  if (cat === "abilities") return p.abilities.length > 0;
  if (cat === "items") return !p.isMega && shownList(p, "items").length > 0;
  if (cat === "speed") return !!(p.stats && Number.isFinite(p.stats.spe));
  if (cat === "weak") return true;
  if (cat === "resist") return true;
  if (cat === "immune") return typeProfile(p).immune.length > 0;
  return false;
}

function enabledCats() { return Object.keys(CATEGORIES).filter((c) => settings.cats[c]); }

function allCards() {
  const cards = [];
  for (const p of eligiblePokemon())
    for (const cat of enabledCats())
      if (hasCategory(p, cat)) cards.push({ id: `${p.id}#${cat}`, pid: p.id, cat });
  return cards;
}

function cardAnswer(p, cat) {
  if (cat === "moves" || cat === "abilities" || cat === "items")
    return { kind: "list", items: shownList(p, cat) };
  if (cat === "speed") return { kind: "stat", value: p.stats.spe, stats: p.stats };
  const prof = typeProfile(p);
  if (cat === "weak") return { kind: "type", items: prof.weak };
  if (cat === "resist") return { kind: "type", items: prof.resist };
  return { kind: "type", items: prof.immune, note: abilityImmunityNote(p) };
}

// ---------------------------------------------------------------------------
// Spaced repetition
// ---------------------------------------------------------------------------

function contentFingerprint(p, cat) {
  if (cat === "moves" || cat === "abilities" || cat === "items")
    return shownList(p, cat).map((x) => x.name).sort().join("|");
  if (cat === "speed") return `spe:${p.stats?.spe}`;
  return `types:${[...p.types].sort().join(",")}`;
}
function changeRatio(oldFp, newFp, cat) {
  if (oldFp === newFp) return 0;
  if (cat === "moves" || cat === "abilities" || cat === "items") {
    const oldSet = new Set(oldFp ? oldFp.split("|") : []);
    const newArr = newFp ? newFp.split("|") : [];
    if (!newArr.length) return 0;
    return Math.min(1, newArr.filter((x) => !oldSet.has(x)).length / newArr.length);
  }
  return 1;
}
function reconcileContent() {
  const now = Date.now();
  let dirty = false;
  for (const [id, s] of Object.entries(srs)) {
    const hash = id.indexOf("#");
    const p = byId.get(id.slice(0, hash));
    const cat = id.slice(hash + 1);
    if (!p || !CATEGORIES[cat]) continue;
    const cur = contentFingerprint(p, cat);
    if (s.content === undefined) { s.content = cur; dirty = true; continue; }
    if (s.content === cur) continue;
    const r = changeRatio(s.content, cur, cat);
    if (r > 0) {
      s.reps = Math.round((s.reps || 0) * (1 - r));
      s.interval = (s.interval || 0) * (1 - r);
      if (s.due > now) s.due = now + (s.due - now) * (1 - r);
    }
    s.content = cur;
    dirty = true;
  }
  if (dirty) save(LS.srs, srs);
}

function usageStretch(usage) {
  const norm = Math.min(1, usage / maxUsage);
  return 1 + (1 - norm) * STRETCH_K;
}

function grade(card, g) {
  const now = Date.now();
  const prior = srs[card.id];
  const isNew = !prior;
  const s = prior ? { ...prior } : { reps: 0, interval: 0, ease: 2.5, lapses: 0, last: 0 };

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
  s.content = contentFingerprint(byId.get(card.pid), card.cat);
  srs[card.id] = s;
  save(LS.srs, srs);

  rollDaily();
  daily.reviewed += 1;
  if (isNew) daily.introduced += 1;
  save(LS.daily, daily);
}

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

function pickNext() {
  rollDaily();
  const now = Date.now();
  const cards = allCards();
  const due = [], fresh = [];
  for (const c of cards) {
    const s = srs[c.id];
    if (!s) fresh.push(c);
    else if (s.due <= now) due.push(c);
  }
  if (cramMode) return cards.length ? { card: weightedPick(cards), mode: "cram" } : null;
  if (due.length) return { card: weightedPick(due), mode: "due" };
  if (fresh.length && daily.introduced < settings.newPerDay) return { card: weightedPick(fresh), mode: "new" };
  return null;
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
// DOM helpers
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
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const spriteUrl = (p) => (p.spriteKey ? `sprites/${p.spriteKey}.png` : "");

function typeChip(type) {
  const c = el("span", "type-chip", cap(type));
  c.style.background = TYPE_COLORS[type] || "#888";
  return c;
}

// ---------------------------------------------------------------------------
// Quiz rendering
// ---------------------------------------------------------------------------

function renderQuestion() {
  const next = pickNext();
  if (!next) { showCaughtUp(); return; }
  cramMode = next.mode === "cram";
  const p = byId.get(next.card.pid);
  const cat = next.card.cat;
  const answer = cardAnswer(p, cat);
  current = { pokemon: p, pid: p.id, cat, id: next.card.id, answer };

  $("#message").hidden = true;
  $("#quiz").hidden = false;

  $("#q-category").textContent = CATEGORIES[cat].label;
  $("#q-prompt").textContent = promptFor(cat, answer.items ? answer.items.length : 0);
  $("#q-usage").textContent = `${fmtPct(p.usage)} usage`;
  const sprite = $("#q-sprite");
  sprite.src = spriteUrl(p);
  sprite.alt = p.name;
  $("#q-name").textContent = p.name;
  $("#q-types").replaceChildren(...p.types.map(typeChip));

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

  if (a.kind === "stat") {
    const big = el("div", "stat-answer");
    big.append(el("div", "stat-number", String(a.value)));
    big.append(el("div", "stat-sub", "Base Speed"));
    ans.append(big);
    if (a.stats) ans.append(statSpread(a.stats));
  } else if (a.kind === "list") {
    if (!a.items.length) ans.append(el("p", "answer-empty", "No data."));
    else for (const it of a.items)
      ans.append(answerRow(it.name, it.percent, buildDetail(current.cat, it), it.mega ? "Mega" : null));
  } else {
    if (!a.items.length) ans.append(el("p", "answer-empty", "None. Neutral, no immunities."));
    else {
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

function answerRow(label, pct, detailHtml, badge) {
  const wrap = el("div", "ans-row-wrap");
  const row = el("div", "ans-row");
  const lab = el(detailHtml ? "button" : "span", "ans-label" + (detailHtml ? " has-info" : ""));
  lab.append(document.createTextNode(label));
  if (badge) lab.append(el("span", "mega-badge", badge));
  if (detailHtml) lab.append(el("span", "info-dot", "ⓘ"));
  row.append(lab);

  const bar = el("div", "bar");
  bar.append(Object.assign(document.createElement("span"), { style: `width:${Math.min(100, pct)}%` }));
  row.append(bar);
  row.append(el("span", "ans-pct", fmtPct(pct)));
  wrap.append(row);

  if (detailHtml) {
    const detail = el("div", "ans-detail", detailHtml);
    detail.hidden = true;
    lab.onclick = (e) => {
      e.stopPropagation();
      detail.hidden = !detail.hidden;
      lab.classList.toggle("open", !detail.hidden);
    };
    wrap.append(detail);
  }
  return wrap;
}

function statSpread(stats) {
  const order = [["HP", "hp"], ["Atk", "atk"], ["Def", "def"], ["SpA", "spa"], ["SpD", "spd"], ["Spe", "spe"]];
  const w = el("div", "stat-spread");
  for (const [lbl, key] of order) {
    const s = el("div", "s" + (key === "spe" ? " hl" : ""));
    s.append(el("b", null, String(stats[key] ?? "-")));
    s.append(el("span", null, lbl));
    w.append(s);
  }
  return w;
}

function multChip(type, mult) {
  const c = el("span", "mult-chip");
  c.append(typeChip(type));
  c.append(el("span", "mult", mult === 0 ? "0×" : `${mult}×`));
  return c;
}

// ---- expandable detail (move mechanics / ability / item) ----

function buildDetail(cat, it) {
  const name = it.name;
  if (cat === "moves") {
    const m = MOVES[name];
    return m ? moveDetailHtml(m) : null;
  }
  if (cat === "items" && it.mega) {
    const known = ITEMS[name]?.desc;
    return `<div class="effect-text">${known ? esc(known) + " " : ""}Mega Evolution stone. The holder Mega Evolves in battle. Shown as its share of this Pokémon's total usage.</div>`;
  }
  const rec = (cat === "abilities" ? ABILITIES : cat === "items" ? ITEMS : null)?.[name];
  return rec && rec.desc ? `<div class="effect-text">${esc(rec.desc)}</div>` : null;
}

function catBadge(category) {
  const meta = CAT_META[category];
  if (!meta) return `<span class="cat-badge">${esc(category)}</span>`;
  return `<span class="cat-badge" style="--c:${meta.color}"><svg class="cat-ico" viewBox="0 0 16 16" fill="currentColor">${meta.glyph}</svg>${category}</span>`;
}
function targetIcon(target) {
  const spread = /spread|all/i.test(target);
  const dots = spread
    ? '<circle cx="4" cy="8" r="2.4"/><circle cx="12" cy="8" r="2.4"/>'
    : '<circle cx="8" cy="8" r="2.6"/>';
  return `<svg class="tgt-ico" viewBox="0 0 16 16" fill="currentColor">${dots}</svg>`;
}
function moveDetailHtml(m) {
  const type = m.type
    ? `<span class="type-chip" style="background:${TYPE_COLORS[m.type] || "#888"}">${cap(m.type)}</span>` : "";
  const cat = m.category ? catBadge(m.category) : "";
  const block = (val, lbl) => `<div class="mb"><b>${val}</b><span>${lbl}</span></div>`;
  const stats = [
    block(m.power ? m.power : "-", "Power"),
    block(m.accuracy == null ? "-" : m.accuracy + "%", "Acc"),
    block(m.pp ?? "-", "PP"),
  ].join("");
  const target = m.target ? `<div class="md-target">${targetIcon(m.target)}<span>${esc(m.target)}</span></div>` : "";
  const desc = m.desc ? `<div class="effect-text">${esc(m.desc)}</div>` : "";
  return `<div class="move-detail"><div class="md-head">${type}${cat}</div><div class="md-stats">${stats}</div>${target}${desc}</div>`;
}

// ---- caught up / top stats ----

function showCaughtUp() {
  $("#quiz").hidden = true;
  const m = $("#message");
  m.hidden = false;
  $("#message-text").textContent =
    dueCount() === 0 ? "All caught up. No cards are due right now." : "Daily new card limit reached.";
  const btn = $("#message-action");
  btn.hidden = false;
  btn.textContent = "Keep studying anyway";
  btn.onclick = () => { cramMode = true; renderQuestion(); };
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
// Home screen
// ---------------------------------------------------------------------------

function renderHome() {
  const cards = allCards();
  const now = Date.now();
  let due = 0, mature = 0;
  for (const c of cards) {
    const s = srs[c.id];
    if (!s) continue;
    if (s.due <= now) due++;
    if (s.interval >= 21) mature++;
  }
  const chip = (n, l) => `<div class="hstat"><b>${n}</b><span>${l}</span></div>`;
  $("#home-stats").innerHTML = chip(due, "due now") + chip(daily.reviewed, "today") + chip(mature, "mastered");
  $("#home-data").textContent = `${DATA.meta.label} · usage data ${DATA.meta.date} · top ${DATA.pokemon.length} Pokémon`;
  $("#home-start").textContent = due > 0 ? `Study ${due} due card${due === 1 ? "" : "s"}` : "Start studying";
}

// ---------------------------------------------------------------------------
// Screens + drawers
// ---------------------------------------------------------------------------

function showScreen(name) {
  $("#home").hidden = name !== "home";
  $("#quiz-screen").hidden = name !== "quiz";
  if (name === "home") renderHome();
}

function openDrawer(id) {
  if (id === "settings") buildSettings();
  if (id === "stats") renderStats();
  if (id === "sync") fillSync();
  if (id === "updates") renderUpdates();
  $("#" + id).hidden = false;
}
function closeDrawers() {
  for (const d of document.querySelectorAll(".drawer")) d.hidden = true;
  if ($("#home").hidden === false) renderHome();
}

// ---- settings ----

function buildSettings() {
  buildCatToggles();
  $("#top-n").value = settings.topN;
  $("#new-per-day").value = settings.newPerDay;
}
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
    };
    lab.append(el("span", null, `${def.label} <span class="toggle-count">${count} cards</span>`));
    lab.append(cb);
    wrap.append(lab);
  }
}
function commitNumberSetting(input, key, min, max) {
  let v = parseInt(input.value, 10);
  if (!Number.isFinite(v)) v = settings[key];
  v = Math.max(min, Math.min(max, v));
  input.value = v;
  settings[key] = v;
  save(LS.settings, settings);
  buildCatToggles();
}

// ---- stats ----

function renderStats() {
  const cards = allCards();
  const now = Date.now();
  let seen = 0, due = 0, mature = 0, learning = 0;
  for (const c of cards) {
    const s = srs[c.id];
    if (!s) continue;
    seen++;
    if (s.due <= now) due++;
    if (s.interval >= 21) mature++; else learning++;
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
  grid.append(box(total, "Total cards"), box(daily.reviewed, "Reviewed today"), box(due, "Due now"), box(mature, "Mastered (21d+)"));
  body.append(grid);

  const bar = el("div", "mastery-bar");
  const seg = (w, color) => { if (w > 0) { const s = document.createElement("span"); s.style.width = `${w}%`; s.style.background = color; bar.append(s); } };
  seg(pct(mature), "#4ad07f");
  seg(pct(learning), "#f4d23c");
  seg(pct(newCount), "#3a4263");
  body.append(el("p", "answer-section-title", "Mastery"));
  body.append(bar);
  body.append(el("div", "legend",
    `<span><i style="background:#4ad07f"></i>Mastered ${mature}</span>` +
    `<span><i style="background:#f4d23c"></i>Learning ${learning}</span>` +
    `<span><i style="background:#3a4263"></i>New ${newCount}</span>`));
}

// ---- updates / how it works ----

function renderUpdates() {
  const cl = $("#tab-changelog");
  cl.replaceChildren();
  for (const e of CHANGELOG) {
    const block = el("div", "cl-entry");
    block.append(el("div", "cl-ver", `v${e.v} <span class="cl-date">${e.date}</span>`));
    const ul = el("ul", "cl-list");
    for (const it of e.items) ul.append(el("li", null, esc(it)));
    block.append(ul);
    cl.append(block);
  }
  const how = $("#tab-how");
  how.replaceChildren();
  for (const f of HOWTO) {
    const block = el("div", "faq");
    block.append(el("div", "faq-q", esc(f.q)));
    block.append(el("div", "faq-a", esc(f.a)));
    how.append(block);
  }
}

// ---------------------------------------------------------------------------
// Sync + backup (code / file, no server)
// ---------------------------------------------------------------------------

function gatherState() { return { v: 1, app: "champions-quiz", srs, daily, settings }; }
function encodeState(s) { return btoa(unescape(encodeURIComponent(JSON.stringify(s)))); }
function decodeState(str) { return JSON.parse(decodeURIComponent(escape(atob(str.trim())))); }

function fillSync() {
  $("#sync-out").value = encodeState(gatherState());
  $("#sync-in").value = "";
  $("#sync-msg").textContent = "";
}
function applyImported(s) {
  if (!s || typeof s !== "object" || !s.srs) throw new Error("Not a valid backup code");
  let added = 0;
  for (const [id, e] of Object.entries(s.srs)) {
    const cur = srs[id];
    if (!cur || (e.last || 0) > (cur.last || 0)) { srs[id] = e; added++; }
  }
  if (s.settings) settings = { ...settings, ...s.settings, cats: { ...settings.cats, ...(s.settings.cats || {}) } };
  if (s.daily && (!daily.date || s.daily.date >= daily.date)) daily = s.daily;
  save(LS.srs, srs); save(LS.settings, settings); save(LS.daily, daily);
  return added;
}
function syncMsg(text, ok = true) {
  const m = $("#sync-msg");
  m.textContent = text;
  m.classList.toggle("err", !ok);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function flip() { if (current && $("#answer").hidden) renderAnswer(); }

function wireEvents() {
  // home
  $("#home-start").onclick = () => { showScreen("quiz"); renderQuestion(); };
  document.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openDrawer(b.dataset.open)));

  // quiz topbar
  $("#btn-home").onclick = () => showScreen("home");
  $("#btn-quiz-settings").onclick = () => openDrawer("settings");

  // flip + grade
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

  // drawers: close buttons + backdrop
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeDrawers()));
  document.querySelectorAll(".drawer").forEach((d) =>
    d.addEventListener("click", (e) => { if (e.target === d) closeDrawers(); }));

  // settings inputs
  $("#top-n").onchange = (e) => commitNumberSetting(e.target, "topN", 10, DATA.pokemon.length);
  $("#new-per-day").onchange = (e) => commitNumberSetting(e.target, "newPerDay", 0, 100);
  $("#btn-reset").onclick = () => {
    if (!confirm("Erase all your quiz progress on this device?")) return;
    srs = {};
    daily = { date: today(), reviewed: 0, introduced: 0 };
    save(LS.srs, srs); save(LS.daily, daily);
    closeDrawers();
    cramMode = false;
    showScreen("home");
  };

  // updates tabs
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    $("#tab-changelog").hidden = t.dataset.tab !== "changelog";
    $("#tab-how").hidden = t.dataset.tab !== "how";
  }));

  // sync
  $("#sync-copy").onclick = async () => {
    try { await navigator.clipboard.writeText($("#sync-out").value); syncMsg("Code copied. Paste it on your other device."); }
    catch { $("#sync-out").select(); syncMsg("Select all and copy the code above."); }
  };
  $("#sync-download").onclick = () => {
    const blob = new Blob([JSON.stringify(gatherState(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "champions-quiz-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
    syncMsg("Backup file saved.");
  };
  $("#sync-load").onclick = () => {
    try {
      const added = applyImported(decodeState($("#sync-in").value));
      syncMsg(`Loaded. ${added} card${added === 1 ? "" : "s"} updated.`);
    } catch (err) { syncMsg("That code could not be read. Check you copied all of it.", false); }
  };
  $("#sync-file").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const added = applyImported(JSON.parse(reader.result));
        syncMsg(`Loaded from file. ${added} card${added === 1 ? "" : "s"} updated.`);
      } catch { syncMsg("That file could not be read.", false); }
    };
    reader.readAsText(file);
  };

  // keyboard (quiz screen only, no drawer open)
  document.addEventListener("keydown", (e) => {
    if ([...document.querySelectorAll(".drawer")].some((d) => !d.hidden)) return;
    if ($("#quiz-screen").hidden) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (current && $("#answer").hidden) flip();
    } else if (!$("#answer").hidden && ["1", "2", "3"].includes(e.key)) {
      grade(current, { 1: "again", 2: "good", 3: "easy" }[e.key]);
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
    const ref = async (f) => { try { return await (await fetch(f)).json(); } catch { return {}; } };
    [MOVES, ABILITIES, ITEMS] = await Promise.all([
      ref("data/moves.json"), ref("data/abilities.json"), ref("data/items.json"),
    ]);
  } catch {
    $("#message-text").textContent = "Could not load quiz data. If you just set this up, run the data refresh first.";
    showScreen("quiz");
    return;
  }

  byId = new Map(DATA.pokemon.map((p) => [p.id, p]));
  maxUsage = Math.max(...DATA.pokemon.map((p) => p.usage), 1);
  settings.topN = Math.min(settings.topN, DATA.pokemon.length);

  reconcileContent();
  wireEvents();
  showScreen("home");

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

boot();
