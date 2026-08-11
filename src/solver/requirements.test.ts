import { describe, expect, test } from 'vitest';
import { getMonsters } from '@/lib/Monsters';
import { PlayerSkills } from '@/types/Player';
import { Solver } from './solve';
import { SolveRequest, SolveResult, StyleResult } from './types';
import { meetsRequirements, requirementsOf } from './requirements';
import { isUnobtainable } from './data';
import { findEquipment } from '@/tests/utils/TestUtils';

const monsters = getMonsters();

const skillsOf = (overrides: Partial<PlayerSkills>): PlayerSkills => ({
  atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99, mining: 99, herblore: 99, ...overrides,
});

const baseRequest = (name: string, skills: PlayerSkills): SolveRequest => {
  const m = monsters.find((mm) => mm.name === name);
  if (!m) throw new Error(`monster not found: ${name}`);
  return {
    monsterId: m.id,
    monsterVersion: m.version ?? '',
    monsterInputs: {},
    skills,
    potionPreset: 'standard',
    usePrayers: true,
    onSlayerTask: false,
    ownedIds: null,
    restrictToOwned: false,
    excludedIds: [],
    weaponsPerStyle: 5,
  };
};

/** every item name surfaced anywhere in a style result */
const namesIn = (res: StyleResult): string[] => [
  ...res.setups.flatMap((s) => Object.values(s.items).map((i) => i!.name)),
  ...res.combos.flatMap((s) => Object.values(s.items).map((i) => i!.name)),
  ...Object.values(res.alternatives).flatMap((alts) => (alts ?? []).map((a) => a.name)),
];

describe('requirements data', () => {
  test('known items parsed from the wiki with correct levels', () => {
    expect(requirementsOf("Tumeken's shadow")).toEqual({ magic: 85 });
    expect(requirementsOf('Abyssal whip')).toEqual({ atk: 70 });
    expect(requirementsOf('Dragon boots')).toEqual({ def: 60 });
    expect(requirementsOf('Void knight top')).toMatchObject({ def: 42, prayer: 22 });
    expect(requirementsOf('Barrows gloves')).toBeUndefined();
  });

  test('meetsRequirements gates on base levels', () => {
    const shadow = findEquipment("Tumeken's shadow");
    expect(meetsRequirements(shadow, skillsOf({ magic: 84 }))).toBe(false);
    expect(meetsRequirements(shadow, skillsOf({ magic: 85 }))).toBe(true);
    const leafBladed = findEquipment('Leaf-bladed battleaxe');
    expect(meetsRequirements(leafBladed, skillsOf({}), 54)).toBe(false);
    expect(meetsRequirements(leafBladed, skillsOf({}), 55)).toBe(true);
  });
});

describe('unobtainable gear', () => {
  test('seasonal and discontinued items are flagged, main-game gear is not', () => {
    for (const name of ['Starter cape', "V's helm", "Devil's element", 'Crystal blessing', 'Echo venator bow']) {
      expect(isUnobtainable(findEquipment(name)), name).toBe(true);
    }
    for (const name of ['Abyssal whip', 'Zombie helmet', 'Antler guard', 'Soul cape', "Vesta's blighted longsword"]) {
      expect(isUnobtainable(findEquipment(name)), name).toBe(false);
    }
  });

  test('never suggested unless the player owns it', () => {
    const skills = skillsOf({});
    const res = new Solver(baseRequest('General Graardor', skills)).solveStyle('magic');
    const names = namesIn(res);
    expect(names.length).toBeGreaterThan(20);
    for (const gone of ["Devil's element", 'Crystal blessing', 'Starter cape', "V's helm"]) {
      expect(names).not.toContain(gone);
    }

    // whoever has one can still wear it
    const ownedIds = ['Starter cape', 'Kodai wand', 'Occult necklace', 'Mystic robe top', 'Mystic robe bottom']
      .map((n) => findEquipment(n).id);
    const owned = new Solver({ ...baseRequest('General Graardor', skills), ownedIds, restrictToOwned: true }).solveStyle('magic');
    expect(owned.best).not.toBeNull();
    expect(owned.best!.items.cape?.name).toBe('Starter cape');
  }, 240000);
});

describe('solver respects requirements', () => {
  test('80 magic account never sees Tumeken\'s shadow, and nothing above its levels', () => {
    const skills = skillsOf({ magic: 80, def: 60, atk: 75, str: 80, ranged: 70 });
    const solver = new Solver(baseRequest('General Graardor', skills));
    const res = solver.solveStyle('magic');
    expect(res.best).not.toBeNull();

    const names = namesIn(res);
    expect(names.length).toBeGreaterThan(20);
    expect(names).not.toContain("Tumeken's shadow");
    expect(names).not.toContain('Sanguinesti staff'); // 82 magic
    for (const name of names) {
      if (name === 'Nothing (leave empty)') continue;
      expect(meetsRequirements(findEquipment(name), skills), `${name} exceeds the account's levels`).toBe(true);
    }
    // kodai wand is exactly 80 magic, so the cap is respected without over-filtering
    expect(names).toContain('Kodai wand');
  }, 240000);

  test('owning an item does not make it wearable', () => {
    const skills = skillsOf({ magic: 80 });
    const ownedIds = ['Tumeken\'s shadow', 'Kodai wand', 'Occult necklace', 'Mystic robe top', 'Mystic robe bottom']
      .map((n) => findEquipment(n).id);
    const req = { ...baseRequest('General Graardor', skills), ownedIds, restrictToOwned: true };
    const res = new Solver(req).solveStyle('magic');
    expect(res.best).not.toBeNull();
    expect(res.best!.items.weapon!.name).toBe('Kodai wand');
    expect(namesIn(res)).not.toContain("Tumeken's shadow");
  }, 240000);

  test('upgrade advisor never suggests gear above the account\'s levels', () => {
    const skills = skillsOf({ magic: 80 });
    const shadow = findEquipment("Tumeken's shadow");
    const kodai = findEquipment('Kodai wand');
    const ownedIds = ['Occult necklace', 'Mystic robe top', 'Mystic robe bottom', 'Staff of fire']
      .map((n) => findEquipment(n).id);
    const req: SolveRequest = {
      ...baseRequest('General Graardor', skills),
      ownedIds,
      restrictToOwned: true,
      prices: { [shadow.id]: 800_000_000, [kodai.id]: 90_000_000 },
      includeUpgrades: true,
      weaponsPerStyle: 3,
    };
    const res: SolveResult = new Solver(req).solve();
    const upgradeNames = (res.upgrades ?? []).map((u) => u.name);
    expect(upgradeNames).not.toContain("Tumeken's shadow");
    expect(upgradeNames).toContain('Kodai wand');
  }, 240000);
});
