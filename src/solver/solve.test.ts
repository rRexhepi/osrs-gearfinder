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
