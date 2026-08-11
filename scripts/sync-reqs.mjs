/**
 * Builds two wiki-derived datasets over every equipment name:
 *
 * - cdn/json/requirements.json: equip level requirements. The wiki has no
 *   structured requirements data (not in the infobox, SMW, or bucket tables),
 *   but the lead sentence states them in a small set of phrasings ("requires
 *   85 Magic to wield", "requires an Attack level of 70", "42 Attack, ... and
 *   22 Prayer to wear"), parsed from the rendered intro extract.
 * - cdn/json/unobtainable.json: items main-game players cannot get, detected
 *   from wiki categories (league rewards, Deadman seasonal gear, discontinued
 *   content). These carry no name suffix in the data, so categories are the
 *   only reliable signal.
 *
 * Hand overrides apply on top, and known anchors fail the sync loudly if a
 * wiki edit or parser regression would ship bad data.
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

/**
 * Categories marking gear that main-game players cannot obtain: seasonal-mode
 * rewards (every league, Deadman servers, LMS-locked gear, Fresh Start Worlds)
 * and discontinued content. Deliberately NOT matched: Bounty Hunter, Soul Wars,
 * Emir's Arena and similar minigames whose rewards are main-game obtainable.
 */
const UNOBTAINABLE_CATEGORY_RE = /(League$|^Deadman|^Last Man Standing$|^Fresh Start World|^Discontinued)/;

async function fetchExtracts(titles) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts|categories',
    exintro: '1',
    explaintext: '1',
    exlimit: 'max',
    cllimit: 'max',
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
    if (page.missing !== undefined) continue;
    out.set(back.get(page.title) ?? page.title, {
      extract: page.extract ?? '',
      categories: (page.categories ?? []).map((c) => c.title.replace('Category:', '')),
    });
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
    const page = extracts.get(name);
    console.log(`\n== ${name}`);
    console.log(page ? page.extract.split('\n')[0].slice(0, 300) : '(no page)');
    console.log('->', JSON.stringify(page ? parseIntro(page.extract) : null),
      page && page.categories.some((c) => UNOBTAINABLE_CATEGORY_RE.test(c)) ? 'UNOBTAINABLE' : '');
  }
  process.exit(0);
}

const names = [...new Set(equipment.map((e) => e.name))].sort();
console.log(`${names.length} unique equipment names`);

const result = {};
const unobtainable = new Set();
let fetched = 0;
for (let i = 0; i < names.length; i += BATCH) {
  const batch = names.slice(i, i + BATCH);
  const extracts = await fetchExtracts(batch);
  for (const [name, page] of extracts) {
    const reqs = parseIntro(page.extract);
    if (Object.keys(reqs).length > 0) result[name] = reqs;
    if (page.categories.some((c) => UNOBTAINABLE_CATEGORY_RE.test(c))) unobtainable.add(name);
  }
  fetched += batch.length;
  if (fetched % 400 < BATCH) console.log(`  ${fetched}/${names.length}`);
  await new Promise((r) => setTimeout(r, 150));
}

// cosmetic/clan variants ("Abyssal whip (or)", "Bow of faerdhinen (c) (Ithell)")
// have their own pages without requirement sentences; inherit from the base name
const baseOf = (name, has) => {
  let base = name;
  while (!has(base)) {
    const stripped = base.replace(/\s*\([^)]*\)$/, '');
    if (stripped === base) return null;
    base = stripped;
  }
  return base;
};
for (const name of names) {
  if (!result[name]) {
    const base = baseOf(name, (n) => result[n] !== undefined);
    if (base) result[name] = result[base];
  }
  if (!unobtainable.has(name) && baseOf(name, (n) => unobtainable.has(n))) {
    unobtainable.add(name);
  }
}

for (const [name, reqs] of Object.entries(overrides)) {
  if (reqs === null) delete result[name];
  else result[name] = reqs;
}

/** seasonal/discontinued detection regressions must fail the sync too */
const UNOBTAINABLE_ANCHORS = {
  'Starter cape': true,
  "V's helm": true,
  "Devil's element": true,
  'Crystal blessing': true, // league item despite the main-game-sounding name
  'Echo venator bow': true,
  'Infernal tecpatl': true,
  "Nature's recurve": true,
  'Abyssal whip': false,
  'Zombie helmet': false,
  'Antler guard': false,
  'Soul cape': false,
  "Vesta's blighted longsword": false,
  'Crystal bow (perfected)': false, // gauntlet-only, but usable there
};

const failures = [];
for (const [name, expected] of Object.entries(ANCHORS)) {
  for (const [skill, level] of Object.entries(expected)) {
    if (result[name]?.[skill] !== level) {
      failures.push(`${name}: expected ${skill} ${level}, got ${JSON.stringify(result[name])}`);
    }
  }
}
for (const [name, expected] of Object.entries(UNOBTAINABLE_ANCHORS)) {
  if (unobtainable.has(name) !== expected) {
    failures.push(`${name}: expected unobtainable=${expected}`);
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

const unobtainableSorted = [...unobtainable].sort((a, b) => a.localeCompare(b));
writeFileSync(join(root, 'cdn/json/unobtainable.json'), `${JSON.stringify(unobtainableSorted, null, 1)}\n`);
console.log(`flagged ${unobtainableSorted.length} unobtainable items:`);
for (const n of unobtainableSorted) console.log(`  ${n}`);
