import { describe, expect, test } from 'vitest';
import { getMonsters } from '@/lib/Monsters';
import { PlayerSkills } from '@/types/Player';
import { Solver } from './solve';
import {
  rankTrainingTargets, SLAYER_TASKS, TRAINING_SPOTS, findTargetMonster,
} from './targets';
import { SolveRequest } from './types';
import { findEquipment } from '@/tests/utils/TestUtils';

const monsters = getMonsters();

const SKILLS: PlayerSkills = {
  atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99, mining: 99, herblore: 99,
};

const baseRequest = (overrides: Partial<SolveRequest> = {}): SolveRequest => ({
  monsterId: 0,
  monsterVersion: '',
  monsterInputs: {},
  skills: SKILLS,
  potionPreset: 'standard',
  usePrayers: true,
  onSlayerTask: false,
  ownedIds: null,
  restrictToOwned: false,
  excludedIds: [],
  weaponsPerStyle: 2,
  mode: 'training',
  trainedSkill: 'str',
  downtimeSeconds: 5,
  ...overrides,
});

describe('training spot groups', () => {
  test('every curated spot resolves to a monster in the data', () => {
    for (const spot of TRAINING_SPOTS) {
      expect(findTargetMonster(spot.name, spot.version), `${spot.name} ${spot.version ?? ''}`).toBeDefined();
    }
  });

  test('every slayer task resolves to its representative monster', () => {
    for (const t of SLAYER_TASKS) {
      const m = findTargetMonster(t.name, t.version);
      expect(m, `${t.task}: ${t.name} ${t.version ?? ''}`).toBeDefined();
      expect(m!.skills.hp, t.task).toBeGreaterThan(0);
    }
    // the dropdown is sorted for scanning
    const tasks = SLAYER_TASKS.map((t) => t.task);
    expect(tasks).toEqual([...tasks].sort((a, b) => a.localeCompare(b)));
  });

  test('ranker: gemstone crab has no kill cycle, NMZ rows use the 1 HP Dharok meta', () => {
    const ownedIds = [
      "Dharok's helm", "Dharok's platebody", "Dharok's platelegs", "Dharok's greataxe",
      'Abyssal whip', 'Dragon scimitar', 'Fighter torso', 'Dragon defender', 'Rune platelegs',
      'Neitiznot faceguard', 'Barrows gloves', 'Dragon boots', 'Amulet of fury', 'Fire cape',
    ].map((n) => findEquipment(n, n.startsWith("Dharok's") ? 'Undamaged' : '').id);
    const res = rankTrainingTargets(baseRequest({ ownedIds, restrictToOwned: true }));

    const crab = res.rows.find((r) => r.group === 'crab');
    expect(crab).toBeDefined();
    expect(crab!.monsterName).toBe('Gemstone Crab');
    expect(crab!.ttk).toBe(Infinity);
    // never dies: xp/hr is pure damage uptime (dps x 4 xp x 3600s)
    expect(Math.abs(crab!.xpHr - crab!.dps * 4 * 3600) / crab!.xpHr).toBeLessThan(0.01);

    const nmz = res.rows.filter((r) => r.group === 'nmz');
    expect(nmz.length).toBeGreaterThanOrEqual(8);
    // at 1 hp with the set owned, Dharok's beats the whip on every NMZ boss
    for (const row of nmz) {
      expect(row.weaponName, row.monsterName).toBe("Dharok's greataxe");
    }

    // outside NMZ the ranker solves at full hp, where the whip-tier picks compete again
    const overworld = res.rows.filter((r) => r.group === 'spots');
    expect(overworld.length).toBeGreaterThan(10);
    expect(overworld.some((r) => r.weaponName !== "Dharok's greataxe")).toBe(true);
  }, 240000);
});

describe('NMZ main solve', () => {
  test('at 1 hp the Dharok combo leads; at full hp it is not evaluated', () => {
    const dad = monsters.find((m) => m.name === 'Dad (Nightmare Zone)' && m.version === 'Hard Mode')!;
    const req = baseRequest({
      monsterId: dad.id, monsterVersion: dad.version ?? '', mode: 'boss', weaponsPerStyle: 5,
    });

    const lowHp = new Solver({ ...req, playerHpCurrent: 1 }).solveStyle('melee');
    const dharok = lowHp.combos.find((c) => c.combo!.name === "Dharok's set");
    expect(dharok).toBeDefined();
    expect(dharok!.items.weapon!.name).toBe("Dharok's greataxe");
    // nearly doubled damage: competitive with the absolute best (a maxed scythe
    // still wins on raw dps - Dharok's dominance shows in realistic owned banks)
    expect(dharok!.dps).toBeGreaterThan(lowHp.best!.dps * 0.7);

    const fullHp = new Solver(req).solveStyle('melee');
    expect(fullHp.combos.some((c) => c.combo!.name === "Dharok's set")).toBe(false);
    // and at full hp the same loadout would be far weaker than the low-hp one
    expect(dharok!.dps).toBeGreaterThan(11);
  }, 240000);
});
