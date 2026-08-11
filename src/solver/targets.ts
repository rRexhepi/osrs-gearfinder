import { getMonsters } from '@/lib/Monsters';
import { INFINITE_HEALTH_MONSTERS } from '@/lib/constants';
import { Solver } from './solve';
import {
  RankTargetsResult, SolveRequest, SpotGroup, TargetRow,
} from './types';

/** well-known combat training spots, matched by monster name in monsters.json */
export const TRAINING_SPOTS: { name: string; version?: string; note: string; group?: SpotGroup }[] = [
  { name: 'Ammonite Crab', note: 'AFK, aggro, near-zero def' },
  { name: 'Sand Crab', note: 'AFK, aggro, near-zero def' },
  { name: 'Rock Crab', note: 'AFK, aggro, low def' },
  { name: 'Swamp Crab', note: 'AFK, aggro' },
  { name: 'Experiment', note: 'quest area, huge HP, no reqs' },
  { name: 'Flesh Crawler', note: 'Stronghold, semi-AFK' },
  { name: 'Bandit', note: 'aggro with god item, AFK' },
  { name: 'Ogress Warrior', note: 'good loot, low effort' },
  { name: 'Hill Giant', note: 'low level' },
  { name: 'Moss giant', note: 'low level' },
  { name: 'Giant frog', note: 'low level, AFK-ish' },
  { name: 'Ankou', note: 'catacombs/stronghold' },
  { name: 'Cave horror', note: 'slayer only, black mask hunt' },
  { name: 'Bloodveld', note: 'slayer, low def' },
  { name: 'Mutated Bloodveld', note: 'slayer, catacombs' },
  { name: 'Dust devil', note: 'slayer, bursting spot' },
  { name: 'Nechryael', note: 'slayer' },
  { name: 'Greater Nechryael', note: 'slayer, bursting spot' },
  { name: 'Abyssal demon', note: 'slayer' },
  { name: 'Gargoyle', note: 'slayer, steady gp' },
  { name: 'Hellhound', note: 'low def, no loot' },
  { name: 'Kurask', note: 'slayer, leaf-bladed only' },
  { name: 'Smoke devil', note: 'slayer, bursting spot' },
  { name: 'Suqah', note: 'lunar isle, AFK' },
  { name: 'Sulphur Nagua', note: 'Neypotzli, AFK with Blood moon sustain' },
  { name: 'Maniacal monkey', note: 'chinning spot (MM2)' },
  { name: 'Brutal black dragon', note: 'ranged gp/xp' },

  {
    name: 'Gemstone Crab', group: 'crab', note: 'never dies, pure AFK, drops gems',
  },

  // hard-mode rumble bosses commonly kept enabled for AFK melee
  {
    name: 'Dad (Nightmare Zone)', version: 'Hard Mode', group: 'nmz', note: 'big HP, low def',
  },
  {
    name: 'Arrg (Nightmare Zone)', version: 'Hard Mode', group: 'nmz', note: 'big HP, low def',
  },
  {
    name: 'Count Draynor (Nightmare Zone)', version: 'Hard Mode', group: 'nmz', note: 'low def',
  },
  {
    name: 'Culinaromancer (Nightmare Zone)', version: 'Hard Mode', group: 'nmz', note: 'lowest def in NMZ',
  },
  {
    name: 'King Roald (Nightmare Zone)', version: 'Hard Mode', group: 'nmz', note: 'low def',
  },
  {
    name: 'Sand Snake (Nightmare Zone)', version: 'Hard', group: 'nmz', note: 'low def',
  },
  {
    name: 'Corrupt Lizardman (Nightmare Zone)', version: 'Hard Mode', group: 'nmz', note: 'low def',
  },
  {
    name: 'The Kendal (Nightmare Zone)', version: 'Hard Mode', group: 'nmz', note: 'moderate def',
  },
  {
    name: 'Ice Troll King (Nightmare Zone)', version: 'Hard Mode', group: 'nmz', note: 'big HP',
  },
  {
    name: 'Tree spirit (Nightmare Zone)', version: 'Hard Mode', group: 'nmz', note: 'moderate def',
  },
];

/** common slayer tasks -> representative monster */
export const SLAYER_TASKS: { task: string; name: string; version?: string }[] = [
  { task: 'Aberrant spectres', name: 'Aberrant spectre' },
  { task: 'Abyssal demons', name: 'Abyssal demon' },
  { task: 'Ankou', name: 'Ankou' },
  { task: 'Banshees', name: 'Banshee' },
  { task: 'Black demons', name: 'Black demon' },
  { task: 'Black dragons', name: 'Black dragon' },
  { task: 'Bloodveld', name: 'Bloodveld' },
  { task: 'Blue dragons', name: 'Blue dragon' },
  { task: 'Cave horrors', name: 'Cave horror' },
  { task: 'Dagannoth', name: 'Dagannoth' },
  { task: 'Drakes', name: 'Drake' },
  { task: 'Dust devils', name: 'Dust devil' },
  { task: 'Gargoyles', name: 'Gargoyle' },
  { task: 'Greater demons', name: 'Greater demon' },
  { task: 'Hellhounds', name: 'Hellhound' },
  { task: 'Hydras', name: 'Hydra' },
  { task: 'Jellies', name: 'Jelly' },
  { task: 'Kalphites', name: 'Kalphite Soldier' },
  { task: 'Kurask', name: 'Kurask' },
  { task: 'Nechryael', name: 'Nechryael' },
  { task: 'Skeletal Wyverns', name: 'Skeletal Wyvern' },
  { task: 'Smoke devils', name: 'Smoke devil' },
  { task: 'Suqahs', name: 'Suqah' },
  { task: 'Trolls', name: 'Mountain troll' },
  { task: 'Turoth', name: 'Turoth' },
  { task: 'Wyrms', name: 'Wyrm' },
];

const monsterList = getMonsters();

export function findTargetMonster(name: string, version?: string) {
  return monsterList.find((m) => m.name.toLowerCase() === name.toLowerCase()
    && (!version || m.version === version));
}

/**
 * Ranks the curated training spots by XP/hr for the request's trained skill.
 * Each spot gets its own quick solve (top weapon only + armour ascent).
 */
export function rankTrainingTargets(
  baseRequest: SolveRequest,
  onProgress?: (pct: number, label: string) => void,
): RankTargetsResult {
  const started = Date.now();
  const skill = baseRequest.trainedSkill ?? 'str';
  const rows: TargetRow[] = [];
  const spots = TRAINING_SPOTS
    .map((s) => ({ spot: s, monster: findTargetMonster(s.name, s.version) }))
    .filter((s) => s.monster && s.monster.skills.hp > 0);

  spots.forEach(({ spot, monster }, ix) => {
    onProgress?.(ix / spots.length, `${monster!.name}`);
    try {
      const group = spot.group ?? 'spots';
      const req: SolveRequest = {
        ...baseRequest,
        mode: 'training',
        monsterId: monster!.id,
        monsterVersion: monster!.version ?? '',
        monsterInputs: {},
        weaponsPerStyle: 2,
        includeUpgrades: false,
        // NMZ: constant spawns, absorption method at 1 hp (Dharok's counts).
        // Gemstone crab: never dies, so there is no between-kill downtime.
        ...(group === 'nmz' ? { downtimeSeconds: 0, playerHpCurrent: 1 } : {}),
        ...(group === 'crab' ? { downtimeSeconds: 0 } : {}),
      };
      const solver = new Solver(req);
      const groups = skill === 'ranged' ? ['ranged' as const]
        : skill === 'magic' ? ['magic' as const]
          : skill === 'def' ? ['melee' as const, 'ranged' as const]
            : ['melee' as const];
      let best = null as ReturnType<typeof solver.solveStyle>['best'];
      for (const g of groups) {
        const res = solver.solveStyle(g, undefined, 0, 1, true);
        if (res.best && (!best || res.best.metric > best.metric)) best = res.best;
      }
      if (!best || best.metric <= 0) return;
      rows.push({
        monsterId: monster!.id,
        monsterName: monster!.name,
        monsterVersion: monster!.version ?? '',
        monsterImage: monster!.image ?? '',
        group,
        note: spot.note,
        xpHr: best.metric,
        dps: best.dps,
        ttk: INFINITE_HEALTH_MONSTERS.includes(monster!.id) ? Infinity : best.ttk,
        dmgTakenHr: best.dmgTakenHr,
        foodHr: best.foodHr,
        weaponName: best.items.weapon?.name ?? '?',
        styleStance: best.styleStance,
      });
    } catch {
      // skip spots the engine cannot evaluate
    }
  });

  rows.sort((a, b) => b.xpHr - a.xpHr);
  return { trainedSkill: skill, rows, elapsedMs: Date.now() - started };
}
