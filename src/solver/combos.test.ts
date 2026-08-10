import { describe, expect, test } from 'vitest';
import { getMonsters } from '@/lib/Monsters';
import { Solver } from './solve';
import { SolveRequest } from './types';
import { COMBO_TEMPLATES, pieceOptions, resolveByName } from './combos';
import { isModeRestricted } from './data';
import { findEquipment } from '@/tests/utils/TestUtils';

const monsters = getMonsters();

const baseRequest = (name: string, version = ''): SolveRequest => {
  const m = monsters.find((mm) => mm.name === name && (!version || mm.version === version));
  if (!m) throw new Error(`monster not found: ${name}`);
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

/** the ids a bank import would carry for these items (set pieces need a usable version) */
const bankIds = (names: string[]): number[] => names.map((n) => findEquipment(n, n.startsWith('Blood moon') ? 'New' : '').id);

const MELEE_BANK = [
  'Abyssal whip', 'Dragon scimitar', 'Fighter torso', 'Neitiznot faceguard', 'Barrows gloves',
  'Dragon boots', 'Amulet of fury', 'Fire cape', 'Berserker ring', 'Rune platelegs', 'Dragon defender',
];

describe('combo templates', () => {
  test('every template piece and weapon resolves to a usable item in the data', () => {
    const usable = (i: { version: string }) => !isModeRestricted(i as never);
    for (const tpl of COMBO_TEMPLATES) {
      for (const piece of Object.values(tpl.pieces)) {
        for (const name of pieceOptions(piece)) {
          expect(resolveByName(name, usable), `${tpl.name}: ${name}`).not.toBeNull();
        }
      }
      for (const name of tpl.weapons ?? []) {
        expect(resolveByName(name, usable), `${tpl.name}: ${name}`).not.toBeNull();
      }
    }
  });
});

describe('solver combos, all items', () => {
  test('melee combos are evaluated with their sets locked and ranked honestly', () => {
    const solver = new Solver(baseRequest('General Graardor'));
    const res = solver.solveStyle('melee');
    expect(res.best).not.toBeNull();

    const names = res.combos.map((c) => c.combo!.name);
    expect(names).toContain('Blood moon set');
    expect(names).toContain('Obsidian set');
    expect(names).toContain('Void (melee)');
    expect(names).toContain("Inquisitor's set");

    for (let i = 1; i < res.combos.length; i += 1) {
      expect(res.combos[i].metric).toBeLessThanOrEqual(res.combos[i - 1].metric);
    }
    // combos compete in the same ranking, so none can sit above the declared best
    expect(res.combos[0].metric).toBeLessThanOrEqual(res.best!.metric + 1e-9);

    const bloodmoon = res.combos.find((c) => c.combo!.name === 'Blood moon set')!;
    expect(bloodmoon.items.weapon!.name).toBe('Dual macuahuitl');
    expect(bloodmoon.items.head!.name).toBe('Blood moon helm');
    expect(bloodmoon.items.body!.name).toBe('Blood moon chestplate');
    expect(bloodmoon.items.legs!.name).toBe('Blood moon tassets');

    const obsidian = res.combos.find((c) => c.combo!.name === 'Obsidian set')!;
    expect(['Toktz-xil-ak', 'Tzhaar-ket-om', 'Toktz-xil-ek']).toContain(obsidian.items.weapon!.name);
    expect(obsidian.items.head!.name).toBe('Obsidian helmet');
  }, 240000);
});

describe('solver combos, owned bank', () => {
  test('full Blood moon outranks the per-slot best for strength training', () => {
    const ownedIds = bankIds([
      'Dual macuahuitl', 'Blood moon helm', 'Blood moon chestplate', 'Blood moon tassets', ...MELEE_BANK,
    ]);
    const req: SolveRequest = {
      ...baseRequest('Ammonite Crab'), ownedIds, restrictToOwned: true, mode: 'training', trainedSkill: 'str',
    };
    const res = new Solver(req).solveStyle('melee');
    expect(res.best).not.toBeNull();

    const bloodmoon = res.combos.find((c) => c.combo!.name === 'Blood moon set');
    expect(bloodmoon).toBeDefined();
    // the point of the feature: the set bundle beats any per-slot pick (whip has no
    // aggressive stance, and the scimitar loses to the set's attack-speed proc)
    expect(res.best!.combo?.name).toBe('Blood moon set');
    expect(res.best!.items.weapon!.name).toBe('Dual macuahuitl');
  }, 240000);

  test('a partly owned set is skipped in results but bundled by the upgrade advisor', () => {
    const tassets = findEquipment('Blood moon tassets', 'New');
    const ownedIds = bankIds(['Dual macuahuitl', 'Blood moon helm', 'Blood moon chestplate', ...MELEE_BANK]);
    const req: SolveRequest = {
      ...baseRequest('Ammonite Crab'),
      ownedIds,
      restrictToOwned: true,
      mode: 'training',
      trainedSkill: 'str',
      prices: { [tassets.id]: 4_000_000 },
      includeUpgrades: true,
      weaponsPerStyle: 3,
    };
    const res = new Solver(req).solve();

    const melee = res.styles.find((s) => s.styleGroup === 'melee')!;
    expect(melee.combos.some((c) => c.combo!.name === 'Blood moon set')).toBe(false);

    const bundle = res.upgrades!.find((u) => u.name === 'Blood moon set');
    expect(bundle).toBeDefined();
    expect(bundle!.price).toBe(4_000_000);
    expect(bundle!.detail).toContain('Blood moon tassets');
    expect(bundle!.gainPct).toBeGreaterThan(0);
  }, 240000);
});
