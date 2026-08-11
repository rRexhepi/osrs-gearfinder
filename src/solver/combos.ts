import { EquipmentPiece } from '@/types/Player';
import { CombatStyleType } from '@/types/PlayerCombatStyle';
import { canonicalEquipment, Slot } from './data';
import { StyleGroup } from './types';

/**
 * A full-set combo the engine credits as a bundle. Per-slot coordinate ascent
 * can never discover these (no single-piece swap improves DPS until the whole
 * set is worn), so the solver evaluates each template with its pieces locked
 * and only the remaining slots optimised.
 */
export interface ComboTemplate {
  name: string;
  group: StyleGroup;
  /** what the set effect does; shown as a tooltip */
  note: string;
  /** locked pieces: slot -> exact item name, or equivalent options (first available wins) */
  pieces: Partial<Record<Slot, string | string[]>>;
  /** locked weapon options; templates without them pair with the style's best weapons */
  weapons?: string[];
  /** also pair with the style's shortlisted weapons (in addition to `weapons`) */
  alsoShortlist?: boolean;
  /** only these attack types benefit (e.g. Inquisitor's is crush-only) */
  styleTypes?: CombatStyleType[];
  /** only evaluated when the solve assumes reduced current hp (NMZ absorptions) */
  requiresLowHp?: boolean;
}

/**
 * Engine-modelled offensive set effects only. Deliberately absent: Blue moon
 * and Eclipse moon (the vendored calc flags their set effects as unsupported),
 * Justiciar (purely defensive), and per-piece bonuses like Virtus or crystal
 * armour pieces that the per-slot search already finds on its own. Dharok's is
 * gated behind low-HP solves (NMZ absorptions), where its effect is real.
 */
export const COMBO_TEMPLATES: ComboTemplate[] = [
  {
    name: 'Blood moon set',
    group: 'melee',
    note: 'Full set with the Dual macuahuitl: hits can make the next attack 1 tick faster, and the double hit gains a minimum-damage special.',
    pieces: { head: 'Blood moon helm', body: 'Blood moon chestplate', legs: 'Blood moon tassets' },
    weapons: ['Dual macuahuitl'],
  },
  {
    name: "Dharok's set",
    group: 'melee',
    note: "Damage scales with missing hitpoints - at 1 HP with absorptions (NMZ) it nearly doubles. Only evaluated when the solve assumes low HP.",
    pieces: { head: "Dharok's helm", body: "Dharok's platebody", legs: "Dharok's platelegs" },
    weapons: ["Dharok's greataxe"],
    requiresLowHp: true,
  },
  {
    name: 'Obsidian set',
    group: 'melee',
    note: 'Full obsidian armour boosts accuracy and strength by 10% with Tzhaar weapons (stacks with the Berserker necklace).',
    pieces: { head: 'Obsidian helmet', body: 'Obsidian platebody', legs: 'Obsidian platelegs' },
    weapons: ['Toktz-xil-ak', 'Tzhaar-ket-om', 'Toktz-xil-ek'],
  },
  {
    name: 'Void (melee)',
    group: 'melee',
    note: 'Full void with the melee helm: +10% melee accuracy and strength (elite robes count too).',
    pieces: {
      head: 'Void melee helm',
      body: ['Void knight top', 'Elite void top'],
      legs: ['Void knight robe', 'Elite void robe'],
      hands: 'Void knight gloves',
    },
  },
  {
    name: "Inquisitor's set",
    group: 'melee',
    note: 'Each piece boosts crush accuracy and damage, with a full-set bonus. Crush weapons only.',
    pieces: { head: "Inquisitor's great helm", body: "Inquisitor's hauberk", legs: "Inquisitor's plateskirt" },
    weapons: ["Inquisitor's mace"],
    alsoShortlist: true,
    styleTypes: ['crush'],
  },
  {
    name: 'Elite void (ranged)',
    group: 'ranged',
    note: 'Full elite void with the ranger helm: +10% ranged accuracy and +12.5% ranged damage.',
    pieces: {
      head: 'Void ranger helm', body: 'Elite void top', legs: 'Elite void robe', hands: 'Void knight gloves',
    },
  },
  {
    name: 'Void (ranged)',
    group: 'ranged',
    note: 'Full void with the ranger helm: +10% ranged accuracy and damage.',
    pieces: {
      head: 'Void ranger helm', body: 'Void knight top', legs: 'Void knight robe', hands: 'Void knight gloves',
    },
  },
  {
    name: 'Crystal armour + crystal bow',
    group: 'ranged',
    note: 'Crystal helm, body and legs boost the Bow of faerdhinen and Crystal bow (up to +30% damage, +15% accuracy).',
    pieces: { head: 'Crystal helm', body: 'Crystal body', legs: 'Crystal legs' },
    weapons: ['Bow of faerdhinen (c)', 'Bow of faerdhinen', 'Crystal bow'],
  },
  {
    name: "Karil's + Amulet of the damned",
    group: 'ranged',
    note: "Full Karil's with the amulet: 25% chance of a second hit for half damage.",
    pieces: {
      head: "Karil's coif", body: "Karil's leathertop", legs: "Karil's leatherskirt", neck: 'Amulet of the damned',
    },
    weapons: ["Karil's crossbow"],
  },
  {
    name: 'Elite void (magic)',
    group: 'magic',
    note: 'Full elite void with the mage helm: +45% magic accuracy and +2.5% magic damage.',
    pieces: {
      head: 'Void mage helm', body: 'Elite void top', legs: 'Elite void robe', hands: 'Void knight gloves',
    },
  },
  {
    name: 'Void (magic)',
    group: 'magic',
    note: 'Full void with the mage helm: +45% magic accuracy.',
    pieces: {
      head: 'Void mage helm', body: 'Void knight top', legs: 'Void knight robe', hands: 'Void knight gloves',
    },
  },
  {
    name: "Ahrim's + Amulet of the damned",
    group: 'magic',
    note: "Full Ahrim's with the amulet: 25% chance of +30% magic damage.",
    pieces: {
      head: "Ahrim's hood", body: "Ahrim's robetop", legs: "Ahrim's robeskirt", neck: 'Amulet of the damned',
    },
    weapons: ["Ahrim's staff"],
  },
];

const byName = new Map<string, EquipmentPiece[]>();
for (const item of canonicalEquipment) {
  const list = byName.get(item.name);
  if (list) list.push(item);
  else byName.set(item.name, [item]);
}

export const equipmentByName = (name: string): EquipmentPiece[] => byName.get(name) ?? [];

/** usable version first: barrows undamaged before degraded, crystal active before inactive */
const VERSION_PREFERENCE = ['Undamaged', 'Active', 'Charged', 'New', 'Full', 'Normal', ''];

/** the preferred allowed version of a named item, or null if none is allowed */
export function resolveByName(name: string, allowed: (item: EquipmentPiece) => boolean): EquipmentPiece | null {
  const matches = equipmentByName(name).filter(allowed);
  if (matches.length === 0) return null;
  for (const version of VERSION_PREFERENCE) {
    const hit = matches.find((m) => m.version === version);
    if (hit) return hit;
  }
  return matches[0];
}

export const pieceOptions = (piece: string | string[]): string[] => (Array.isArray(piece) ? piece : [piece]);

/**
 * The template a worn loadout completes, if any. Labelling is a property of
 * the loadout, not the search path: the per-slot ascent can stumble into a
 * full set on its own (small banks), and it deserves the same badge.
 */
export function comboOf(
  group: StyleGroup,
  weaponName: string | undefined,
  styleType: string | null,
  wornBySlot: (slot: Slot) => string | undefined,
): { name: string; note: string } | null {
  for (const tpl of COMBO_TEMPLATES) {
    if (tpl.group !== group) continue;
    if (tpl.styleTypes && (!styleType || !tpl.styleTypes.includes(styleType as never))) continue;
    if (tpl.weapons && (!weaponName || !tpl.weapons.includes(weaponName))) continue;
    const allWorn = (Object.entries(tpl.pieces) as [Slot, string | string[]][])
      .every(([slot, piece]) => pieceOptions(piece).includes(wornBySlot(slot) ?? ''));
    if (allWorn) return { name: tpl.name, note: tpl.note };
  }
  return null;
}
