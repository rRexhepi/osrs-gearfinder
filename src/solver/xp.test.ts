import { describe, expect, test } from 'vitest';
import { getMonsters } from '@/lib/Monsters';
import { findEquipment } from '@/tests/utils/TestUtils';
import { Solver } from './solve';
import { SolveRequest } from './types';
import { xpPerDamage, xpPerHour } from './xp';
import { rankTrainingTargets } from './targets';

describe('xp rates', () => {
  test('stances award xp in the right skills', () => {
    expect(xpPerDamage({ name: 'Slash', type: 'slash', stance: 'Aggressive' }, 'str')).toBe(4);
    expect(xpPerDamage({ name: 'Slash', type: 'slash', stance: 'Aggressive' }, 'atk')).toBe(0);
    expect(xpPerDamage({ name: 'Chop', type: 'slash', stance: 'Accurate' }, 'atk')).toBe(4);
    expect(xpPerDamage({ name: 'Lunge', type: 'stab', stance: 'Controlled' }, 'str')).toBeCloseTo(1.33);
    expect(xpPerDamage({ name: 'Block', type: 'slash', stance: 'Defensive' }, 'def')).toBe(4);
    expect(xpPerDamage({ name: 'Rapid', type: 'ranged', stance: 'Rapid' }, 'ranged')).toBe(4);
    expect(xpPerDamage({ name: 'Longrange', type: 'ranged', stance: 'Longrange' }, 'def')).toBe(2);
    expect(xpPerDamage({ name: 'Accurate', type: 'magic', stance: 'Accurate' }, 'magic')).toBe(2);
  });

  test('xp/hr is capped by hp and includes downtime', () => {
    const style = { name: 'Slash', type: 'slash', stance: 'Aggressive' } as const;
    const args = {
      skill: 'str' as const, style, spell: null, dps: 10, attackSpeedTicks: 4, monsterHp: 60, downtimeSeconds: 0,
    };
    // ttk 6s -> 600 kills/hr -> 60*4*600
    expect(xpPerHour(args)).toBeCloseTo(144000);
    // downtime halves the kill rate at ttk 6s + 6s downtime
    expect(xpPerHour({ ...args, downtimeSeconds: 6 })).toBeCloseTo(72000);
  });
});

const monsterByName = (name: string) => {
  const m = getMonsters().find((mm) => mm.name === name);
  if (!m) throw new Error(`monster not found: ${name}`);
  return m;
};

const trainingRequest = (name: string, overrides: Partial<SolveRequest> = {}): SolveRequest => {
  const m = monsterByName(name);
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
    weaponsPerStyle: 4,
    mode: 'training',
    trainedSkill: 'str',
    downtimeSeconds: 5,
    ...overrides,
  };
};

describe('training mode', () => {
  test('strength training picks an aggressive stance and reports xp/hr', () => {
    const solver = new Solver(trainingRequest('Ammonite Crab'));
    const res = solver.solveStyle('melee');
    expect(res.best).not.toBeNull();
    expect(['Aggressive', 'Controlled']).toContain(res.best!.styleStance);
    expect(res.best!.styleStance).toBe('Aggressive');
    expect(res.best!.xpHr).toBeGreaterThan(50000);
    expect(res.best!.metric).toBe(res.best!.xpHr);
    // alternatives are ranked on xp/hr
    const weapons = res.alternatives.weapon!;
    for (let i = 1; i < weapons.length; i += 1) {
      expect(weapons[i].metric).toBeLessThanOrEqual(weapons[i - 1].metric);
    }
  }, 240000);

  test('defence training allows defensive stances', () => {
    const solver = new Solver(trainingRequest('Ammonite Crab', { trainedSkill: 'def' }));
    const res = solver.solveStyle('melee');
    expect(res.best).not.toBeNull();
    expect(['Defensive', 'Controlled']).toContain(res.best!.styleStance);
  }, 240000);
});

describe('upgrade advisor', () => {
  test('suggests unowned upgrades with prices and gain', () => {
    const whip = findEquipment('Abyssal whip');
    const ownedNames = ['Abyssal whip', 'Rune platebody', 'Rune platelegs', 'Rune full helm', 'Amulet of glory', 'Climbing boots', 'Combat bracelet'];
    const ownedIds = ownedNames.map((n) => findEquipment(n).id);
    const rancour = findEquipment('Amulet of rancour');
    const prices = { [rancour.id]: 25_000_000, [findEquipment('Amulet of torture').id]: 12_000_000, [findEquipment('Osmumten\'s fang').id]: 30_000_000 };
    const solver = new Solver(trainingRequest('Ammonite Crab', {
      ownedIds, restrictToOwned: true, prices, includeUpgrades: true,
    }));
    const melee = solver.solveStyle('melee');
    expect(melee.best!.items.weapon!.name).toBe('Abyssal whip');
    const upgrades = (solver as unknown as { buildUpgrades: () => { name: string; gainPct: number; price: number }[] | null }).buildUpgrades();
    expect(upgrades).not.toBeNull();
    const names = upgrades!.map((u) => u.name);
    // fang is a huge upgrade for str training (whip has no aggressive stance)
    expect(names).toContain("Osmumten's fang");
    expect(names).toContain('Amulet of rancour');
    const fang = upgrades!.find((u) => u.name === "Osmumten's fang")!;
    expect(fang.gainPct).toBeGreaterThan(50);
    for (const u of upgrades!) {
      expect(u.gainPct).toBeGreaterThan(0);
      expect(u.price).toBeGreaterThan(0);
    }
  }, 240000);
});

describe('training spot ranking', () => {
  test('ranks spots by xp/hr descending', () => {
    const res = rankTrainingTargets(trainingRequest('Ammonite Crab', { weaponsPerStyle: 1 }));
    expect(res.rows.length).toBeGreaterThan(10);
    for (let i = 1; i < res.rows.length; i += 1) {
      expect(res.rows[i].xpHr).toBeLessThanOrEqual(res.rows[i - 1].xpHr);
    }
    const names = res.rows.map((r) => r.monsterName.toLowerCase());
    expect(names.some((n) => n.includes('crab'))).toBe(true);
  }, 240000);
});
