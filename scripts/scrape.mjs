#!/usr/bin/env node
/**
 * Champions Quiz - data scraper
 * ------------------------------------------------------------------
 * Pulls the current Pokemon Champions usage data from Pikalytics'
 * publicly-documented machine endpoints (see /llms-full.txt) and writes:
 *
 *   data/champions.json   - per-Pokemon: usage%, top moves/abilities/items, types, stats
 *   data/typechart.json   - type-effectiveness chart + ability immunity maps
 *   sprites/<key>.png     - cached sprite for every Pokemon
 *
 * It is polite: descriptive User-Agent, small delays, only documented
 * endpoints (ClaudeBot / AI agents are explicitly allowed in robots.txt).
 *
 * Runs in GitHub Actions every Monday; can also be run locally:  node scripts/scrape.mjs
 */

import { mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const SPRITE_DIR = join(ROOT, "sprites");

const BASE = "https://www.pikalytics.com";
const CDN = "https://cdn.pikalytics.com/images/championssprites";
const UA =
  "ChampionsQuiz/1.0 (personal Pokemon study app; uses Pikalytics AI endpoints)";

// The format we study. Override with FORMAT env var if Pikalytics renames it.
const DEFAULT_FORMAT = process.env.FORMAT || "gen9championsvgc2026regma";

// How many candidate moves / abilities / items to keep per Pokemon. We keep extra
// here; the app decides how many to actually show based on the usage distribution.
const KEEP = { moves: 8, abilities: 4, items: 8 };

// How many Pokemon (by usage rank) to include. The user studies "the top 200".
const MAX_POKEMON = Number(process.env.MAX_POKEMON || 200);

// Concurrent per-Pokemon detail requests (kept modest to be polite to Pikalytics).
const CONCURRENCY = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}
async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

/**
 * Discover the current data date + versioned format key.
 * The pokedex HTML carries options like value="gen9championsvgc2026regma-1760";
 * the "-1760" suffix is Pikalytics' internal data version. The month ("2026-05")
 * comes from the typequiz feed's generatedAt field.
 */
async function discover() {
  const html = await fetchText(`${BASE}/pokedex/${DEFAULT_FORMAT}`);
  const m = html.match(new RegExp(`value="(${DEFAULT_FORMAT}-\\d+)"`));
  if (!m) throw new Error("Could not find versioned format key in pokedex HTML");
  const formatKey = m[1];

  const tq = await fetchJSON(`${BASE}/api/typequiz`);
  const date = tq.generatedAt; // e.g. "2026-05"
  if (!date) throw new Error("typequiz feed missing generatedAt date");

  return { formatKey, date, typequiz: tq };
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Keep the top N real entries (drop "Other"/"Nothing" placeholders), sorted by %.
const PLACEHOLDERS = new Set(["Other", "Nothing"]);
function topReal(arr, labelKey, n) {
  return (arr || [])
    .filter((e) => e && e[labelKey] && !PLACEHOLDERS.has(e[labelKey]))
    .map((e) => ({ name: e[labelKey], percent: num(e.percent), type: e.type }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, n);
}

/** Run an async mapper over items with a fixed concurrency, preserving order. */
async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

/**
 * The /api/l list only carries full move/ability/item detail for the first entry,
 * so we pull each Pokemon's detail from /api/p/<date>/<formatKey>/<name>.
 */
async function fetchDetail(name, date, formatKey) {
  const url = `${BASE}/api/p/${date}/${formatKey}/${encodeURIComponent(name)}`;
  try {
    const d = await fetchJSON(url);
    if (!d || typeof d !== "object") return null;
    return d;
  } catch {
    return null;
  }
}

async function buildChampions(list, typequiz, meta, date, formatKey) {
  // spriteKey comes from the typequiz feed where available.
  const tqByName = new Map();
  for (const p of typequiz.pokemon || []) tqByName.set(p.name, p);

  // Rank by usage and take the top N.
  const ranked = [...list]
    .map((e) => ({ ...e, usage: num(e.percent) }))
    .sort((a, b) => b.usage - a.usage)
    .slice(0, MAX_POKEMON);

  let done = 0;
  const mons = await mapPool(ranked, CONCURRENCY, async (e) => {
    const detail = await fetchDetail(e.name, date, formatKey);
    if (++done % 25 === 0) console.log(`  detail ${done}/${ranked.length}`);
    const tq = tqByName.get(e.name);
    const moves = topReal(detail?.moves, "move", KEEP.moves).map((m) => ({
      name: m.name,
      percent: m.percent,
      type: m.type || null,
    }));
    const abilities = topReal(detail?.abilities, "ability", KEEP.abilities).map((a) => ({
      name: a.name,
      percent: a.percent,
    }));
    const items = topReal(detail?.items, "item", KEEP.items).map((i) => ({
      name: i.name,
      percent: i.percent,
    }));
    return {
      id: (tq?.id || e.name.toLowerCase().replace(/[^a-z0-9]+/g, "")).trim(),
      name: e.name,
      spriteKey: tq?.spriteKey || null, // resolved during sprite download if null
      types: (e.types || detail?.types || []).map((t) => t.toLowerCase()),
      usage: e.usage,
      winRate: num(e.winPercent),
      stats: e.stats || detail?.stats || null,
      moves,
      abilities,
      items,
    };
  });

  // Keep only Pokemon we actually got quizzable data for; de-dupe by id.
  const seen = new Set();
  const unique = [];
  for (const m of mons) {
    if (!(m.moves.length || m.abilities.length || m.items.length)) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    unique.push(m);
  }

  mergeMegaStones(unique);
  return { meta, pokemon: unique };
}

const isMegaName = (n) => /-Mega(-[XY])?$/i.test(n);
const baseSpeciesName = (n) => n.replace(/-Mega(-[XY])?$/i, "");

// A Mega always holds its stone, so its Items card is trivial. Instead we attach the
// stone to the BASE form as an extra, always shown item, sized to its real share of
// the species' usage: stoneShare = megaUsage / (baseUsage + sum(megaUsage)). The base
// items are rescaled by baseUsage/total so the species-wide distribution stays coherent.
function mergeMegaStones(list) {
  const byName = new Map(list.map((p) => [p.name, p]));
  const megasByBase = new Map();
  for (const p of list) {
    if (!isMegaName(p.name)) continue;
    p.isMega = true; // app drops the Items card for these
    const base = baseSpeciesName(p.name);
    (megasByBase.get(base) || megasByBase.set(base, []).get(base)).push(p);
  }

  for (const [base, megas] of megasByBase) {
    const baseMon = byName.get(base);
    if (!baseMon) continue; // base form not tracked, nothing to attach to
    const total = baseMon.usage + megas.reduce((s, m) => s + m.usage, 0);
    if (total <= 0) continue;

    // The stone(s): kept separate so the app can always show them in addition to items.
    baseMon.megaStones = megas
      .map((m) => ({
        name: m.items[0]?.name || `${base} Stone`,
        percent: (m.usage / total) * 100,
        mega: true,
      }))
      .sort((a, b) => b.percent - a.percent);

    // Rescale the base items to species-wide share (they no longer sum to 100 alone).
    baseMon.items = baseMon.items.map((i) => ({
      name: i.name,
      percent: i.percent * (baseMon.usage / total),
    }));
    baseMon.canMega = true;
  }
}

/** Candidate sprite filenames, tried in order until one returns 200. */
function spriteCandidates(mon) {
  const cands = [];
  if (mon.spriteKey) cands.push(mon.spriteKey);
  const lower = mon.name.toLowerCase();
  const clean = (s) => s.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  // Mega X/Y collapse the separator before the letter: "charizard-mega-y" -> "charizard_megay"
  cands.push(clean(lower.replace(/[-_ ]mega[-_ ]?([xy])\b/, "_mega$1")));
  cands.push(clean(lower)); // generic: aerodactyl_mega, kommo_o, floette_eternal
  cands.push(lower.replace(/[^a-z0-9]+/g, "")); // no separators: kingambit
  const parts = lower.split(/[^a-z0-9]+/).filter(Boolean);
  if (parts.length > 1) {
    cands.push(`${parts[0]}_${parts.slice(1).join("")}`); // tauros_paldeaaqua
    cands.push(parts[0]); // base species (size forms share a sprite): gourgeist
  }
  return [...new Set(cands.filter(Boolean))];
}

async function downloadSprites(champions) {
  await mkdir(SPRITE_DIR, { recursive: true });
  const existing = new Set(
    (await readdir(SPRITE_DIR).catch(() => [])).map((f) => f.replace(/\.png$/, "")),
  );
  let downloaded = 0,
    failed = [];

  for (const mon of champions.pokemon) {
    const cands = spriteCandidates(mon);
    // already cached?
    const have = cands.find((c) => existing.has(c));
    if (have) {
      mon.spriteKey = have;
      continue;
    }
    let ok = false;
    for (const key of cands) {
      try {
        const res = await fetch(`${CDN}/${key}.png`, {
          headers: { "User-Agent": UA },
        });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 100) continue; // guard against error placeholders
        await writeFile(join(SPRITE_DIR, `${key}.png`), buf);
        mon.spriteKey = key;
        existing.add(key);
        ok = true;
        downloaded++;
        await sleep(120); // be gentle on the CDN
        break;
      } catch {
        /* try next candidate */
      }
    }
    if (!ok) {
      failed.push(mon.name);
      mon.spriteKey = mon.spriteKey || null;
    }
  }
  console.log(`Sprites: ${downloaded} downloaded, ${failed.length} missing`);
  if (failed.length) console.log("  missing:", failed.join(", "));
}

// ---------------------------------------------------------------------------
// Move / ability / item mechanics (from PokeAPI - free, no key, stable data)
// ---------------------------------------------------------------------------

const POKEAPI = "https://pokeapi.co/api/v2";
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const titleize = (s) =>
  (s || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[.'’:%]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function enText(entries, key) {
  if (!Array.isArray(entries)) return "";
  const en = entries.find((e) => e.language?.name === "en");
  return (en?.[key] || "").replace(/\s+/g, " ").trim();
}

// How a move targets in doubles - what VGC players care about (spread vs single).
const TARGET_LABEL = {
  "selected-pokemon": "Single target",
  "all-opponents": "Spread (both foes)",
  "all-other-pokemon": "Spread (all others)",
  user: "Self",
  "users-field": "Team",
  "user-and-allies": "Team",
  ally: "Ally",
  "entire-field": "Field",
  "all-pokemon": "Field",
  "random-opponent": "Random foe",
  "user-or-ally": "Self / Ally",
};

async function fetchMove(name) {
  try {
    const d = await fetchJSON(`${POKEAPI}/move/${toSlug(name)}`);
    let desc = enText(d.effect_entries, "short_effect");
    if (d.meta?.effect_chance != null)
      desc = desc.replace(/\$effect_chance/g, d.meta.effect_chance);
    return {
      type: d.type?.name || null,
      category: d.damage_class?.name ? cap(d.damage_class.name) : null,
      power: d.power ?? null,
      accuracy: d.accuracy ?? null,
      pp: d.pp ?? null,
      target: TARGET_LABEL[d.target?.name] || titleize(d.target?.name),
      desc,
    };
  } catch {
    return null;
  }
}

async function fetchAbility(name) {
  try {
    const d = await fetchJSON(`${POKEAPI}/ability/${toSlug(name)}`);
    return {
      desc: enText(d.effect_entries, "short_effect") || enText(d.flavor_text_entries, "flavor_text"),
    };
  } catch {
    return null;
  }
}

async function fetchItem(name) {
  try {
    const d = await fetchJSON(`${POKEAPI}/item/${toSlug(name)}`);
    return {
      desc: enText(d.effect_entries, "short_effect") || enText(d.flavor_text_entries, "text"),
    };
  } catch {
    return null;
  }
}

async function buildDict(names, fetchOne) {
  const arr = [...names];
  const dict = {};
  const miss = [];
  await mapPool(arr, 8, async (name) => {
    const rec = await fetchOne(name);
    if (rec) dict[name] = rec;
    else miss.push(name);
  });
  return { dict, miss };
}

// Pull mechanics for every move/ability/item that appears in the dataset.
async function buildReference(champions) {
  const moves = new Set(), abilities = new Set(), items = new Set();
  for (const p of champions.pokemon) {
    p.moves.forEach((m) => moves.add(m.name));
    p.abilities.forEach((a) => abilities.add(a.name));
    p.items.forEach((i) => items.add(i.name));
  }
  const m = await buildDict(moves, fetchMove);
  const a = await buildDict(abilities, fetchAbility);
  const i = await buildDict(items, fetchItem);
  const report = (label, set, res) =>
    console.log(`  ${label}: ${set.size - res.miss.length}/${set.size}` + (res.miss.length ? ` (no data: ${res.miss.join(", ")})` : ""));
  report("moves", moves, m);
  report("abilities", abilities, a);
  report("items", items, i);
  return { moves: m.dict, abilities: a.dict, items: i.dict };
}

function buildTypeChart(tq) {
  return {
    generatedAt: tq.generatedAt,
    typeChart: tq.typeChart, // { Attacking: { Defending: multiplier } }
    abilityImmunityMap: tq.abilityImmunityMap, // ability -> immune type
    abilityTypeModifierMap: tq.abilityTypeModifierMap, // ability -> { type: factor }
  };
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  console.log(`Discovering current format (${DEFAULT_FORMAT})...`);
  const { formatKey, date, typequiz } = await discover();
  console.log(`  format=${formatKey} date=${date}`);

  console.log("Fetching usage list...");
  const list = await fetchJSON(`${BASE}/api/l/${date}/${formatKey}`);
  if (!Array.isArray(list) || !list.length)
    throw new Error("Usage list endpoint returned no data");
  console.log(`  ${list.length} Pokemon`);

  const meta = {
    format: DEFAULT_FORMAT,
    formatKey,
    date,
    label: "Pokemon Champions VGC 2026 Reg M-A",
    generatedAt: new Date().toISOString(),
    source: "https://www.pikalytics.com",
  };

  console.log(`Fetching per-Pokemon detail (top ${MAX_POKEMON})...`);
  const champions = await buildChampions(list, typequiz, meta, date, formatKey);
  console.log(`  kept ${champions.pokemon.length} Pokemon after trim/dedupe`);

  console.log("Downloading sprites...");
  await downloadSprites(champions);

  console.log("Fetching move/ability/item mechanics from PokeAPI...");
  const reference = await buildReference(champions);

  await writeFile(
    join(DATA_DIR, "champions.json"),
    JSON.stringify(champions, null, 0),
  );
  await writeFile(
    join(DATA_DIR, "typechart.json"),
    JSON.stringify(buildTypeChart(typequiz), null, 0),
  );
  await writeFile(join(DATA_DIR, "moves.json"), JSON.stringify(reference.moves, null, 0));
  await writeFile(join(DATA_DIR, "abilities.json"), JSON.stringify(reference.abilities, null, 0));
  await writeFile(join(DATA_DIR, "items.json"), JSON.stringify(reference.items, null, 0));

  console.log("Done.");
  console.log(`  data/champions.json  (${champions.pokemon.length} Pokemon)`);
  console.log(`  data/typechart.json, moves.json, abilities.json, items.json`);
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
