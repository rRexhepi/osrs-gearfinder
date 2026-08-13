import { describe, expect, test } from 'vitest';
import { getMonsters } from '@/lib/Monsters';
import { PlayerSkills } from '@/types/Player';
import { Solver } from './solve';
import { GearLoadout, SolveRequest } from './types';
import { findEquipment } from '@/tests/utils/TestUtils';

const monsters = getMonsters();

const SKILLS: PlayerSkills = {
  atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99, mining: 99, herblore: 99,
};

const request = (name: string, overrides: Partial<SolveRequest> = {}): SolveRequest => {
  const m = monsters.find((mm) => mm.name === name)!;
  return {
    monsterId: m.id,
    monsterVersion: m.version ?? '',
    monsterInputs: {},
    skills: SKILLS,
    potionPreset: 'standard',
    usePrayers: true,
    onSlayerTask: false,
    ownedIds: null,
    restrictToOwned: false,
    excludedIds: [],
    ...overrides,
  };
};

const ids = (names: Partial<Record<string, string>>): Partial<Record<string, number>> => Object.fromEntries(
  Object.entries(names).map(([slot, n]) => [slot, findEquipment(n!).id]),
);

describe('evaluateLoadout', () => {
  const meleeItems = ids({
    weapon: 'Abyssal whip',
    shield: 'Dragon defender',
    head: 'Neitiznot faceguard',
    body: 'Fighter torso',
    legs: 'Rune platelegs',
    hands: 'Barrows gloves',
    feet: 'Dragon boots',
    neck: 'Amulet of fury',
    cape: 'Fire cape',
  });

  test('auto style picks the best eligible stance; explicit style is honoured', () => {
    const solver = new Solver(request('General Graardor'));
    const auto = solver.evaluateLoadout({ items: meleeItems })!;
    expect(auto.dps).toBeGreaterThan(3);
    expect(auto.styleStance).not.toBe('Defensive'); // boss mode skips defensive stances

    const explicit = solver.evaluateLoadout({ items: meleeItems, styleName: 'Flick', styleStance: 'Accurate' })!;
    expect(explicit.styleName).toBe('Flick');
    expect(explicit.styleStance).toBe('Accurate');

    // an explicitly chosen defensive stance still evaluates
    const defensive = solver.evaluateLoadout({ items: meleeItems, styleName: 'Deflect', styleStance: 'Defensive' })!;
    expect(defensive.styleStance).toBe('Defensive');
    expect(defensive.dps).toBeGreaterThan(0);
  });

  test('training mode ranks by xp/hr and respects the trained skill', () => {
    const solver = new Solver(request('Ammonite Crab', { mode: 'training', trainedSkill: 'str', downtimeSeconds: 5 }));
    const setup = solver.evaluateLoadout({ items: meleeItems })!;
    // the whip can only train strength on controlled
    expect(setup.styleStance).toBe('Controlled');
    expect(setup.xpHr).not.toBeNull();
    expect(setup.metric).toBe(setup.xpHr);
  });

  test('a hand-picked full set gets its combo badge', () => {
    const solver = new Solver(request('General Graardor'));
    const setup = solver.evaluateLoadout({
      items: ids({
        weapon: 'Dual macuahuitl',
        head: 'Blood moon helm',
        body: 'Blood moon chestplate',
        legs: 'Blood moon tassets',
      }),
    })!;
    expect(setup.combo?.name).toBe('Blood moon set');
  });

  test('blowpipe uses the requested dart, a two-handed weapon drops the shield', () => {
    const solver = new Solver(request('General Graardor'));
    const setup = solver.evaluateLoadout({
      items: { ...ids({ weapon: 'Toxic blowpipe', shield: 'Dragon defender' }) },
      dartName: 'Rune dart',
    })!;
    expect(setup.items.weapon!.detail).toBe('Rune dart');
    expect(setup.items.shield).toBeUndefined();
  });

  test('no weapon means nothing to evaluate', () => {
    const solver = new Solver(request('General Graardor'));
    expect(solver.evaluateLoadout({ items: ids({ head: 'Neitiznot faceguard' }) })).toBeNull();
  });
});
