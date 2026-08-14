import { describe, expect, test } from 'vitest';
import { getMonsters } from '@/lib/Monsters';
import { Solver } from './solve';
import { SolveRequest } from './types';
import { parseBankText } from './ownership';
import { findEquipment } from '@/tests/utils/TestUtils';

const monsters = getMonsters();

const monsterByName = (name: string, version = '') => {
  const m = monsters.find((mm) => mm.name === name && (!version || mm.version === version));
  if (!m) throw new Error(`monster not found: ${name}`);
  return m;
};

const baseRequest = (name: string, version = ''): SolveRequest => {
  const m = monsterByName(name, version);
  return {
    monsterId: m.id,
    monsterVersion: m.version ?? '',
    monsterInputs: {},
    skills: {
      atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99, mining: 99, herblore: 99,
    },
    potionPreset: 'standard',
    usePrayers: true,
    onSlayerTask: false,
    ownedIds: null,
    restrictToOwned: false,
    excludedIds: [],
    weaponsPerStyle: 5,
  };
};

describe('solver, all items', () => {
  test('General Graardor melee: finds a strong setup with sorted alternatives', () => {
    const solver = new Solver(baseRequest('General Graardor'));
    const res = solver.solveStyle('melee');

    expect(res.immune).toBe(false);
    expect(res.best).not.toBeNull();
    expect(res.best!.dps).toBeGreaterThan(4);

    // weapon alternatives are sorted best-first and include several options
    const weapons = res.alternatives.weapon!;
    expect(weapons.length).toBeGreaterThan(10);
    for (let i = 1; i < weapons.length; i += 1) {
      expect(weapons[i].dps).toBeLessThanOrEqual(weapons[i - 1].dps);
    }
    // the top weapon alternative matches the chosen setup's dps
    expect(weapons[0].dps).toBeCloseTo(res.best!.dps, 3);

    // per-slot alternative lists are sorted too
    for (const slot of ['head', 'body', 'legs', 'neck'] as const) {
      const alts = res.alternatives[slot]!;
      expect(alts.length).toBeGreaterThan(3);
      for (let i = 1; i < alts.length; i += 1) {
        expect(alts[i].dps).toBeLessThanOrEqual(alts[i - 1].dps);
      }
    }
  }, 240000);

  test('Zulrah: melee only works with polearms, ranged finds twisted bow or blowpipe near the top', () => {
    const solver = new Solver(baseRequest('Zulrah', 'Serpentine'));
    const melee = solver.solveStyle('melee');
    // Zulrah is melee-immune except to polearms, so if a setup exists it must be a halberd
    if (!melee.immune) {
      expect(melee.best!.items.weapon!.name).toMatch(/halberd/i);
    }

    const ranged = solver.solveStyle('ranged');
    expect(ranged.immune).toBe(false);
    expect(ranged.best!.dps).toBeGreaterThan(3);
    const topWeapons = ranged.alternatives.weapon!.slice(0, 6).map((w) => w.name);
    expect(topWeapons.join()).toMatch(/Twisted bow|blowpipe/i);
  }, 240000);
});

describe('solver, owned-only', () => {
  test('restricts every recommended item to the owned set', () => {
    const ownedNames = [
      'Abyssal whip', 'Dragon scimitar', 'Fighter torso', 'Dragon defender',
      "Neitiznot faceguard", 'Barrows gloves', 'Dragon boots', 'Amulet of fury',
      'Fire cape', 'Berserker ring', "Rune platelegs",
    ];
    const ownedIds = ownedNames.map((n) => findEquipment(n).id);
    const req = { ...baseRequest('General Graardor'), ownedIds, restrictToOwned: true };
    const solver = new Solver(req);
    const res = solver.solveStyle('melee');

    expect(res.best).not.toBeNull();
    expect(res.best!.items.weapon!.name).toBe('Abyssal whip');
    for (const item of Object.values(res.best!.items)) {
      expect(ownedNames).toContain(item!.name);
    }
    // whip beats scimitar in the weapon ranking
    const weaponNames = res.alternatives.weapon!.map((w) => w.name);
    expect(weaponNames.indexOf('Abyssal whip')).toBeLessThan(weaponNames.indexOf('Dragon scimitar'));
  }, 240000);
});

describe('slot tie-breaks', () => {
  test('items adding nothing over an empty slot stay out', () => {
    const ownedIds = [
      'Trident of the swamp', 'Adamant arrow', "Dagon'hai hat", "Dagon'hai robe top",
      "Dagon'hai robe bottom", 'Occult necklace',
    ].map((n) => findEquipment(n).id);
    const req = { ...baseRequest('Hellhound'), ownedIds, restrictToOwned: true };
    const res = new Solver(req).solveStyle('magic');
    expect(res.best).not.toBeNull();
    // arrows tie the dps of an empty ammo slot on a mage - leave it empty
    expect(res.best!.items.ammo).toBeUndefined();
  }, 240000);
});

describe('upgrade advisor pricing', () => {
  test('charged gear prices via its tradeable variant; untradeables are listed without one', () => {
    const ownedIds = [
      'Abyssal whip', 'Fighter torso', 'Dragon defender', 'Neitiznot faceguard', 'Barrows gloves',
      'Dragon boots', 'Amulet of fury', 'Fire cape', 'Berserker ring', 'Rune platelegs',
    ].map((n) => findEquipment(n).id);
    const scytheUncharged = findEquipment('Scythe of vitur', 'Uncharged');
    const req = {
      ...baseRequest('Hellhound'),
      ownedIds,
      restrictToOwned: true,
      prices: { [scytheUncharged.id]: 1_400_000_000 },
      includeUpgrades: true,
      weaponsPerStyle: 3,
    };
    const res = new Solver(req).solve();

    // the charged scythe has no GE price of its own; the uncharged one covers it
    const scythe = res.upgrades!.find((u) => u.name === 'Scythe of vitur');
    expect(scythe).toBeDefined();
    expect(scythe!.price).toBe(1_400_000_000);

    // emberlight is the biggest melee upgrade against a demon but untradeable -
    // it must show up anyway instead of being silently skipped
    const ember = res.upgrades!.find((u) => u.name === 'Emberlight');
    expect(ember).toBeDefined();
    expect(ember!.price).toBeNull();
    expect(ember!.gainPct).toBeGreaterThan(5);
  }, 240000);
});

describe('mandatory shield protection', () => {
  const WYVERN_SHIELDS = ['Elemental shield', 'Mind shield', 'Dragonfire shield', 'Dragonfire ward', 'Ancient wyvern shield'];

  test('fossil wyverns: every setup carries icy-breath protection, no two-handers', () => {
    const solver = new Solver(baseRequest('Spitting Wyvern'));
    for (const group of ['melee', 'ranged', 'magic'] as const) {
      const res = solver.solveStyle(group);
      if (res.immune || !res.best) continue;
      expect(WYVERN_SHIELDS, `${group} shield`).toContain(res.best.items.shield?.name);
      expect(res.best.warning).toBeNull();
      for (const s of res.setups) {
        expect(WYVERN_SHIELDS, `${group}: ${s.items.weapon?.name}`).toContain(s.items.shield?.name);
      }
      // the shield alternatives table offers nothing that fails to block the breath
      for (const alt of res.alternatives.shield ?? []) {
        expect(WYVERN_SHIELDS).toContain(alt.name);
      }
    }
  }, 240000);

  test('basilisks require a mirror-class shield', () => {
    const res = new Solver(baseRequest('Basilisk Knight')).solveStyle('melee');
    expect(res.best).not.toBeNull();
    expect(['Mirror shield', "V's shield"]).toContain(res.best!.items.shield?.name);
  }, 240000);

  test('owning no protective shield yields a loud warning, not a silent death trap', () => {
    const ownedIds = ['Abyssal whip', 'Dragon defender', 'Fighter torso', 'Rune platelegs', 'Neitiznot faceguard']
      .map((n) => findEquipment(n).id);
    const res = new Solver({ ...baseRequest('Spitting Wyvern'), ownedIds, restrictToOwned: true }).solveStyle('melee');
    expect(res.best).not.toBeNull();
    expect(res.best!.items.shield).toBeUndefined(); // the defender must not sneak in
    expect(res.best!.warning).toMatch(/icy breath/);
  }, 240000);

  test('aberrant spectres: never the black mask, always fume protection', () => {
    // black mask has the same dps as the slayer helmet but zero fume protection
    const req = { ...baseRequest('Aberrant spectre'), onSlayerTask: true };
    const res = new Solver(req).solveStyle('melee');
    expect(res.best).not.toBeNull();
    expect(['Nose peg', 'Slayer helmet', 'Slayer helmet (i)']).toContain(res.best!.items.head?.name);
    expect(res.best!.warning).toBeNull();
    for (const alt of res.alternatives.head ?? []) {
      expect(['Nose peg', 'Slayer helmet', 'Slayer helmet (i)']).toContain(alt.name);
    }
  }, 240000);

  test('cave horrors require the witchwood icon on the neck', () => {
    const res = new Solver({ ...baseRequest('Cave horror'), onSlayerTask: true }).solveStyle('melee');
    expect(res.best).not.toBeNull();
    expect(res.best!.items.neck?.name).toBe('Witchwood icon');
  }, 240000);

  test('Karuulm floor is advisory: best gear stands, but the warning names stone boots', () => {
    const res = new Solver(baseRequest('Hydra')).solveStyle('melee');
    expect(res.best).not.toBeNull();
    // primordials still win the slot - the diary can make the boots unnecessary
    expect(res.best!.items.feet?.name).not.toBe('Boots of stone');
    expect(res.best!.warning).toMatch(/Karuulm/);
  }, 240000);

  test('flying monsters cannot be meleed, slayer krakens are magic-only', () => {
    const avi = new Solver(baseRequest('Aviansie', 'Level 131'));
    expect(avi.solveStyle('melee').immune).toBe(true);
    expect(avi.solveStyle('ranged').immune).toBe(false);

    const kraken = new Solver(baseRequest('Cave kraken', 'Cave kraken'));
    expect(kraken.solveStyle('melee').immune).toBe(true);
    expect(kraken.solveStyle('ranged').immune).toBe(true);
    expect(kraken.solveStyle('magic').immune).toBe(false);
  }, 240000);
});

describe('bank text parsing', () => {
  test('bank memory TSV, names, and tag id lists all parse', () => {
    const whip = findEquipment('Abyssal whip');
    const text = [
      'Abyssal whip\t1',
      'Dragon boots,1',
      'Twisted bow',
      `mytag,${whip.id},4151,11832`,
      'Coins\t1000000',
    ].join('\n');
    const res = parseBankText(text);
    expect(res.ids).toContain(whip.id);
    expect(res.matchedNames).toContain('Abyssal whip');
    expect(res.matchedNames).toContain('Twisted bow');
    expect(res.unmatched).toContain('Coins');
  });
});
