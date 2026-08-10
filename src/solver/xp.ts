import { PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import { Spell } from '@/types/Spell';
import { EquipmentPiece } from '@/types/Player';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import { BLOWPIPE_IDS } from '@/lib/constants';
import { AmmoApplicability, ammoApplicability } from '@/lib/Equipment';

export type TrainedSkill = 'atk' | 'str' | 'def' | 'ranged' | 'magic';

export const TRAINED_SKILL_LABELS: Record<TrainedSkill, string> = {
  atk: 'Attack', str: 'Strength', def: 'Defence', ranged: 'Ranged', magic: 'Magic',
};

/**
 * XP awarded in the trained skill per point of damage dealt, by combat style.
 * Melee/ranged award 4xp per damage to the stance's skill; controlled and
 * longrange split. Magic awards 2xp per damage while casting (defensive
 * casting splits roughly 1.33 magic / 1 def).
 */
export function xpPerDamage(style: PlayerCombatStyle, skill: TrainedSkill): number {
  const { type, stance } = style;
  if (!type || !stance) return 0;

  if (type === 'magic') {
    if (skill === 'magic') return stance === 'Defensive Autocast' ? 1.33 : 2;
    if (skill === 'def') return stance === 'Defensive Autocast' || stance === 'Longrange' ? 1 : 0;
    return 0;
  }

  if (type === 'ranged') {
    if (skill === 'ranged') {
      if (stance === 'Accurate' || stance === 'Rapid') return 4;
      if (stance === 'Longrange') return 2;
      return 0;
    }
    if (skill === 'def' && stance === 'Longrange') return 2;
    return 0;
  }

  // melee
  switch (stance) {
    case 'Accurate': return skill === 'atk' ? 4 : 0;
    case 'Aggressive': return skill === 'str' ? 4 : 0;
    case 'Defensive': return skill === 'def' ? 4 : 0;
    case 'Controlled': return (skill === 'atk' || skill === 'str' || skill === 'def') ? 1.33 : 0;
    default: return 0;
  }
}

/** base magic XP per cast for the spells the solver considers */
const SPELL_BASE_XP: Record<string, number> = {
  'Fire Strike': 11.5,
  'Fire Bolt': 22.5,
  'Fire Blast': 34.5,
  'Fire Wave': 42.5,
  'Fire Surge': 44.5,
  'Iban Blast': 30,
  'Magic Dart': 30,
  'Ice Barrage': 52,
  'Blood Barrage': 51,
  'Dark Demonbane': 43.5,
};

export const spellBaseXp = (spell: Spell | null): number => (spell ? SPELL_BASE_XP[spell.name] ?? 0 : 0);

/**
 * XP/hr in the trained skill. XP per kill is capped by the monster's HP
 * (overkill grants nothing), kill rate comes from TTK plus fixed downtime
 * between kills (respawn/walking/looting).
 */
export function xpPerHour(args: {
  skill: TrainedSkill;
  style: PlayerCombatStyle;
  spell: Spell | null;
  dps: number;
  attackSpeedTicks: number;
  monsterHp: number;
  downtimeSeconds: number;
}): number {
  const {
    skill, style, spell, dps, attackSpeedTicks, monsterHp, downtimeSeconds,
  } = args;
  if (dps <= 0) return 0;
  const rate = xpPerDamage(style, skill);
  const base = skill === 'magic' ? spellBaseXp(spell) : 0;
  if (rate <= 0 && base <= 0) return 0;

  const ttk = monsterHp / dps;
  const castsPerKill = base > 0 ? ttk / (attackSpeedTicks * 0.6) : 0;
  const xpPerKill = monsterHp * rate + castsPerKill * base;
  const killsPerHour = 3600 / (ttk + Math.max(0, downtimeSeconds));
  return xpPerKill * killsPerHour;
}

// ---------------------------------------------------------------------------
// Consumable cost model (estimates, needs a GE price map)
// ---------------------------------------------------------------------------

export const ZULRAH_SCALE_ID = 12934;
const RUNE_IDS = {
  mind: 558, chaos: 562, death: 560, blood: 565, soul: 566, wrath: 21880,
};
export const EXTRA_PRICE_IDS = [ZULRAH_SCALE_ID, ...Object.values(RUNE_IDS)];

/** non-elemental runes per cast (elemental runes assumed covered by the staff) */
const SPELL_RUNES: Record<string, Partial<Record<keyof typeof RUNE_IDS, number>>> = {
  'Fire Strike': { mind: 1 },
  'Fire Bolt': { chaos: 1 },
  'Fire Blast': { death: 1 },
  'Fire Wave': { blood: 1 },
  'Fire Surge': { wrath: 1 },
  'Iban Blast': { death: 1 },
  'Magic Dart': { death: 1, mind: 4 },
  'Ice Barrage': { death: 4, blood: 2 },
  'Blood Barrage': { death: 4, blood: 4, soul: 1 },
  'Dark Demonbane': { blood: 2, soul: 2 },
};

/** rough gp per cast for charge-based powered staves */
const CHARGE_COST_PER_CAST: Record<string, number> = {
  'Trident of the seas': 15,
  'Trident of the seas (e)': 15,
  'Trident of the swamp': 30,
  'Trident of the swamp (e)': 30,
  'Sanguinesti staff': 90,
  'Holy sanguinesti staff': 90,
  "Tumeken's shadow": 160,
  'Accursed sceptre': 30,
  'Warped sceptre': 12,
  "Thammaron's sceptre": 20,
};

export type PriceMap = Record<number, number>;

const priceOf = (prices: PriceMap, id: number): number | null => {
  const p = prices[id];
  return typeof p === 'number' && p > 0 ? p : null;
};

/** ammo save chance from the equipped cape/quiver */
function ammoSaveRate(cape: EquipmentPiece | null | undefined): number {
  const name = cape?.name.toLowerCase() ?? '';
  if (name.includes('assembler') || name.includes('quiver')) return 0.8;
  if (name.includes('accumulator') || name.includes('ranging cape') || name.includes("ava's persona")) return 0.72;
  if (name.includes('attractor')) return 0.6;
  return 0;
}

export interface CostBreakdown {
  gpPerHour: number;
  parts: string[];
}

/**
 * Estimated consumable gp/hr for a loadout: arrows/bolts (with ava saving),
 * thrown weapons, chins, blowpipe darts+scales, runes, staff charges.
 */
export function consumableCostPerHour(args: {
  prices: PriceMap;
  weapon: EquipmentPiece;
  ammo: EquipmentPiece | null | undefined;
  cape: EquipmentPiece | null | undefined;
  spell: Spell | null;
  attackSpeedTicks: number;
  uptime: number;
}): CostBreakdown | null {
  const {
    prices, weapon, ammo, cape, spell, attackSpeedTicks, uptime,
  } = args;
  const attacksPerHour = (3600 / (attackSpeedTicks * 0.6)) * Math.min(1, Math.max(0, uptime));
  let gp = 0;
  const parts: string[] = [];

  if (BLOWPIPE_IDS.includes(weapon.id)) {
    const dartId = weapon.itemVars?.blowpipeDartId;
    const dartPrice = dartId ? priceOf(prices, dartId) : null;
    const scalePrice = priceOf(prices, ZULRAH_SCALE_ID);
    if (dartPrice !== null) { gp += attacksPerHour * dartPrice; parts.push('darts'); }
    if (scalePrice !== null) { gp += attacksPerHour * (2 / 3) * scalePrice; parts.push('scales'); }
  } else if (weapon.category === EquipmentCategory.CHINCHOMPA) {
    const p = priceOf(prices, weapon.id);
    if (p !== null) { gp += attacksPerHour * p; parts.push('chins'); }
  } else if (weapon.category === EquipmentCategory.THROWN) {
    const p = priceOf(prices, weapon.id);
    if (p !== null) { gp += attacksPerHour * p * (1 - ammoSaveRate(cape)); parts.push('thrown'); }
  }

  if (ammo && ammoApplicability(weapon.id, ammo.id) === AmmoApplicability.INCLUDED) {
    const p = priceOf(prices, ammo.id);
    if (p !== null) { gp += attacksPerHour * p * (1 - ammoSaveRate(cape)); parts.push('ammo'); }
  }

  if (spell) {
    const recipe = SPELL_RUNES[spell.name];
    if (recipe) {
      let perCast = 0;
      for (const [rune, count] of Object.entries(recipe)) {
        const p = priceOf(prices, RUNE_IDS[rune as keyof typeof RUNE_IDS]);
        if (p !== null && count) perCast += p * count;
      }
      if (perCast > 0) { gp += attacksPerHour * perCast; parts.push('runes'); }
    }
  } else if (CHARGE_COST_PER_CAST[weapon.name] !== undefined) {
    gp += attacksPerHour * CHARGE_COST_PER_CAST[weapon.name];
    parts.push('charges');
  }

  if (parts.length === 0) return null;
  return { gpPerHour: gp, parts };
}
