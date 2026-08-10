import { Monster } from '@/types/Monster';
import {
  EquipmentPiece, Player, PlayerEquipment, PlayerSkills,
} from '@/types/Player';
import { PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import { Spell, spellByName } from '@/types/Spell';
import { Prayer } from '@/enums/Prayer';
import { generateEmptyPlayer } from '@/state';
import { calculateAttackSpeed, calculateEquipmentBonusesFromGear } from '@/lib/Equipment';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { PotionPreset, StyleGroup } from './types';

const monsterList = getMonsters();

export function buildMonster(id: number, version: string, inputs: Partial<Monster['inputs']> = {}): Monster {
  const base = monsterList.find((m) => m.id === id && (!version || m.version === version))
    ?? monsterList.find((m) => m.id === id);
  if (!base) throw new Error(`Monster ${id} not found`);
  const monster: Monster = {
    ...base,
    inputs: {
      ...INITIAL_MONSTER_INPUTS,
      ...inputs,
      defenceReductions: {
        ...INITIAL_MONSTER_INPUTS.defenceReductions,
        ...(inputs.defenceReductions ?? {}),
      },
    },
  };
  monster.inputs.monsterCurrentHp = monster.skills.hp;
  return monster;
}

export function styleGroupOf(style: PlayerCombatStyle): StyleGroup {
  if (style.type === 'magic') return 'magic';
  if (style.type === 'ranged') return 'ranged';
  return 'melee';
}

export function bestPrayers(group: StyleGroup): Prayer[] {
  switch (group) {
    case 'melee': return [Prayer.PIETY];
    case 'ranged': return [Prayer.RIGOUR];
    case 'magic': return [Prayer.AUGURY];
    default: return [];
  }
}

export function potionBoosts(preset: PotionPreset, group: StyleGroup, skills: PlayerSkills): Partial<PlayerSkills> {
  const s = skills;
  switch (preset) {
    case 'none':
      return {};
    case 'overload':
      return {
        atk: Math.floor(6 + s.atk * 0.16),
        str: Math.floor(6 + s.str * 0.16),
        def: Math.floor(6 + s.def * 0.16),
        magic: Math.floor(6 + s.magic * 0.16),
        ranged: Math.floor(6 + s.ranged * 0.16),
      };
    case 'salts':
      return {
        atk: Math.floor(11 + s.atk * 0.16),
        str: Math.floor(11 + s.str * 0.16),
        def: Math.floor(11 + s.def * 0.16),
        magic: Math.floor(11 + s.magic * 0.16),
        ranged: Math.floor(11 + s.ranged * 0.16),
      };
    case 'standard':
    default:
      // super combat / ranging potion / saturated heart depending on style
      switch (group) {
        case 'melee':
          return {
            atk: Math.floor(5 + s.atk * 0.15),
            str: Math.floor(5 + s.str * 0.15),
            def: Math.floor(5 + s.def * 0.15),
          };
        case 'ranged':
          return { ranged: Math.floor(4 + s.ranged * 0.1) };
        case 'magic':
          return { magic: Math.floor(4 + s.magic * 0.1) };
        default:
          return {};
      }
  }
}

export interface LoadoutConfig {
  skills: PlayerSkills;
  potionPreset: PotionPreset;
  usePrayers: boolean;
  onSlayerTask: boolean;
}

export function buildPlayer(
  cfg: LoadoutConfig,
  monster: Monster,
  equipment: Partial<PlayerEquipment>,
  style: PlayerCombatStyle,
  spell: Spell | null = null,
): Player {
  const player = generateEmptyPlayer();
  player.skills = { ...player.skills, ...cfg.skills };
  player.equipment = { ...player.equipment, ...equipment };
  player.style = style;
  player.spell = spell;
  player.buffs.onSlayerTask = cfg.onSlayerTask;
  player.buffs.kandarinDiary = true;

  const group = styleGroupOf(style);
  player.prayers = cfg.usePrayers ? bestPrayers(group) : [];
  const boosts = potionBoosts(cfg.potionPreset, group, player.skills);
  player.boosts = { ...player.boosts, ...boosts };

  const computed = calculateEquipmentBonusesFromGear(player, monster);
  player.bonuses = computed.bonuses;
  player.offensive = computed.offensive;
  player.defensive = computed.defensive;
  player.attackSpeed = calculateAttackSpeed(player, monster);
  return player;
}

export interface EvalResult {
  dps: number;
  maxHit: number;
  accuracy: number;
  ttk: number;
  attackSpeed: number;
}

export function evaluate(
  cfg: LoadoutConfig,
  monster: Monster,
  equipment: Partial<PlayerEquipment>,
  style: PlayerCombatStyle,
  spell: Spell | null = null,
): EvalResult {
  const player = buildPlayer(cfg, monster, equipment, style, spell);
  const calc = new PlayerVsNPCCalc(player, monster, { loadoutName: 'solver' });
  return {
    dps: calc.getDps(),
    maxHit: calc.getMax(),
    accuracy: calc.getHitChance(),
    ttk: calc.getTtk(),
    attackSpeed: player.attackSpeed,
  };
}

export function bestStandardSpell(magicLevel: number): Spell | null {
  if (magicLevel >= 95) return spellByName('Fire Surge');
  if (magicLevel >= 75) return spellByName('Fire Wave');
  if (magicLevel >= 59) return spellByName('Fire Blast');
  if (magicLevel >= 35) return spellByName('Fire Bolt');
  return spellByName('Fire Strike');
}

export function blowpipeWithDart(blowpipe: EquipmentPiece, dart: EquipmentPiece): EquipmentPiece {
  return {
    ...blowpipe,
    itemVars: {
      blowpipeDartName: dart.name,
      blowpipeDartId: dart.id,
    },
  };
}
