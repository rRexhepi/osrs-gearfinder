/**
 * Builds cdn/json/requirements.json: equipment level requirements per item name.
 *
 * The wiki has no structured requirements data (not in the infobox, SMW, or
 * bucket tables), but the lead sentence of every equipment page states them in
 * a small set of phrasings ("requires 85 Magic to wield", "requires an Attack
 * level of 70", "42 Attack, Strength, ... and 22 Prayer to wear"). This script
 * pulls the rendered intro extract for every equipment name, parses those
 * clauses, applies hand overrides, and validates known anchors so a bad wiki
 * edit or parser regression fails loudly instead of silently dropping reqs.
 *
 * Run: node scripts/sync-reqs.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const equipment = JSON.parse(readFileSync(join(root, 'cdn/json/equipment.json'), 'utf8'));
const overrides = JSON.parse(readFileSync(join(root, 'scripts/reqs-overrides.json'), 'utf8'));

const API = 'https://oldschool.runescape.wiki/api.php';
const UA = 'osrs-gearfinder requirements sync (github.com/rRexhepi/osrs-gearfinder)';
const BATCH = 20; // TextExtracts exlimit cap for intro extracts

const SKILLS = {
  attack: 'atk',
  strength: 'str',
  defence: 'def',
  ranged: 'ranged',
  magic: 'magic',
  prayer: 'prayer',
  hitpoints: 'hp',
  slayer: 'slayer',
};
const SKILL_RE = 'Attack|Strength|Defence|Ranged|Magic|Prayer|Hitpoints|Slayer';

/**
 * "70 Attack", "70 Attack and 70 Strength", "level 75 in Magic and 65 Defence",
 * "42 Attack, Strength, Defence, Hitpoints, Ranged, and Magic, along with 22 Prayer",
 * "an Attack level of 70" -> skill/level pairs
 */
function parseClause(clause, reqs) {
  const add = (skillWord, level) => {
    const key = SKILLS[skillWord.toLowerCase()];
    reqs[key] = Math.max(reqs[key] ?? 0, level);
  };
  // a number followed by one or more skill names in list form
  const segmentRe = new RegExp(
    `(\\d+)((?:\\s+(?:in\\s+)?(?:${SKILL_RE})|\\s*,\\s*(?:and\\s+)?(?:${SKILL_RE})|\\s+and\\s+(?:${SKILL_RE})|\\s+levels?)+)`,
    'gi',
  );
  for (const m of clause.matchAll(segmentRe)) {
    const level = parseInt(m[1], 10);
    for (const s of m[2].matchAll(new RegExp(SKILL_RE, 'gi'))) add(s[0], level);
  }
  // "an Attack level of 70" / "a Hitpoints of 75" / "Attack level 80"
  const ofRe = new RegExp(`(${SKILL_RE})\\s+(?:levels?\\s+)?(?:of\\s+)?(?:at\\s+least\\s+)?(\\d+)`, 'gi');
  for (const m of clause.matchAll(ofRe)) add(m[1], parseInt(m[2], 10));
}

/** wear/wield requirement skills stated in an intro extract */
function parseIntro(text) {
  const reqs = {};
  // sentences about equipping, not obtaining (quest/diary skill reqs)
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (!/(wield|wear|worn|equip|to use)/i.test(sentence)) continue;
    if (!/(requir|must have|needs?|players? with|who have|at least|(?:equipped|worn|wielded)\s+with)/i.test(sentence)) continue;
    parseClause(sentence, reqs);
  }
  return reqs;
}

async function fetchExtracts(titles) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    exlimit: 'max',
    redirects: '1',
    format: 'json',
    titles: titles.join('|'),
  });
  const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`wiki ${res.status} for batch ${titles[0]}...`);
  const data = await res.json();
  // map redirected/normalised titles back to what we asked for
  const back = new Map();
  for (const r of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) {
    back.set(r.to, back.get(r.from) ?? r.from);
  }
  const out = new Map();
  for (const page of Object.values(data.query?.pages ?? {})) {
    if (page.missing !== undefined || !page.extract) continue;
    out.set(back.get(page.title) ?? page.title, page.extract);
  }
  return out;
}

/** parser/source regressions must fail the sync, not ship bad data */
const ANCHORS = {
  'Abyssal whip': { atk: 70 },
  "Tumeken's shadow": { magic: 85 },
  'Dragon boots': { def: 60 },
  "Dharok's greataxe": { atk: 70, str: 70 },
  'Ancestral robe top': { magic: 75, def: 65 },
};

// probe mode: node scripts/sync-reqs.mjs "Abyssal whip" "Void knight top"
const probe = process.argv.slice(2);
if (probe.length > 0) {
  const extracts = await fetchExtracts(probe);
  for (const name of probe) {
    const text = extracts.get(name);
    console.log(`\n== ${name}`);
    console.log(text ? text.split('\n')[0].slice(0, 300) : '(no page)');
    console.log('->', JSON.stringify(text ? parseIntro(text) : null));
  }
  process.exit(0);
}

const names = [...new Set(equipment.map((e) => e.name))].sort();
console.log(`${names.length} unique equipment names`);

const result = {};
let fetched = 0;
for (let i = 0; i < names.length; i += BATCH) {
  const batch = names.slice(i, i + BATCH);
  const extracts = await fetchExtracts(batch);
  for (const [name, text] of extracts) {
    const reqs = parseIntro(text);
    if (Object.keys(reqs).length > 0) result[name] = reqs;
  }
  fetched += batch.length;
  if (fetched % 400 < BATCH) console.log(`  ${fetched}/${names.length}`);
  await new Promise((r) => setTimeout(r, 150));
}

// cosmetic/clan variants ("Abyssal whip (or)", "Bow of faerdhinen (c) (Ithell)")
// have their own pages without requirement sentences; inherit from the base name
for (const name of names) {
  if (result[name]) continue;
  let base = name;
  while (!result[base]) {
    const stripped = base.replace(/\s*\([^)]*\)$/, '');
    if (stripped === base) break;
    base = stripped;
  }
  if (result[base]) result[name] = result[base];
}

for (const [name, reqs] of Object.entries(overrides)) {
  if (reqs === null) delete result[name];
  else result[name] = reqs;
}

const failures = [];
for (const [name, expected] of Object.entries(ANCHORS)) {
  for (const [skill, level] of Object.entries(expected)) {
    if (result[name]?.[skill] !== level) {
      failures.push(`${name}: expected ${skill} ${level}, got ${JSON.stringify(result[name])}`);
    }
  }
}
if (failures.length > 0) {
  console.error('ANCHOR FAILURES - not writing output:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

// review aid: strong items the parser found no requirements for
const strength = (e) => Math.max(
  ...Object.values(e.offensive ?? {}),
  e.bonuses?.str ?? 0,
  e.bonuses?.ranged_str ?? 0,
  (e.bonuses?.magic_str ?? 0) / 2,
);
const suspicious = [...new Set(equipment.filter((e) => strength(e) >= 60 && !result[e.name]).map((e) => e.name))];
console.log(`\nno reqs parsed for ${suspicious.length} high-stat items (review these):`);
for (const n of suspicious.slice(0, 40)) console.log(`  ${n}`);

const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(join(root, 'cdn/json/requirements.json'), `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`\nwrote requirements for ${Object.keys(sorted).length} items`);
