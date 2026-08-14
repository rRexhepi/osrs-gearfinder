import { availableEquipment, equipmentAliases } from '@/lib/Equipment';
import { EquipmentPiece, PlayerEquipment } from '@/types/Player';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import unobtainableJson from '../../cdn/json/unobtainable.json';

export type Slot = keyof PlayerEquipment;

export const SLOTS: Slot[] = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'];

/** ids that are cosmetic/broken/locked variants of a base item */
const variantIds = new Set<number>();
const variantToBase = new Map<number, number>();
for (const [base, ids] of Object.entries(equipmentAliases)) {
  for (const id of ids) {
    variantIds.add(id);
    variantToBase.set(id, parseInt(base, 10));
  }
}

/** fast alias-collapse (Equipment.ts getCanonicalItemId is O(aliases) per call) */
export const canonicalIdOf = (id: number): number => variantToBase.get(id) ?? id;

/**
 * The de-duplicated equipment list the solver searches over: alias variants
 * (trouver-locked, broken, recolours) are collapsed onto their base item.
 */
export const canonicalEquipment: EquipmentPiece[] = availableEquipment.filter((e) => !variantIds.has(e.id));

const bySlot = new Map<Slot, EquipmentPiece[]>();
for (const slot of SLOTS) bySlot.set(slot, []);
for (const item of canonicalEquipment) {
  bySlot.get(item.slot as Slot)?.push(item);
}

export const equipmentBySlot = (slot: Slot): EquipmentPiece[] => bySlot.get(slot) ?? [];

export const itemById = new Map<number, EquipmentPiece>(availableEquipment.map((e) => [e.id, e]));

/**
 * Items with little/no stats whose engine effect makes them potential picks anyway.
 * Stat-based pruning must never drop these.
 */
const SPECIAL_NAME_PREFIXES = [
  'Slayer helmet',
  'Black mask',
  'Salve amulet',
  'Void knight',
  'Void ranger helm',
  'Void mage helm',
  'Void melee helm',
  'Elite void',
  'Amulet of avarice',
  'Amulet of the damned',
  'Tome of fire',
  'Tome of water',
  'Tome of earth',
  "Efaritay's aid",
  'Berserker necklace',
  'Brimstone ring',
  'Crystal helm',
  'Crystal body',
  'Crystal legs',
  'Obsidian helmet',
  'Obsidian platebody',
  'Obsidian platelegs',
  'Virtus',
];

export const isSpecialItem = (item: EquipmentPiece): boolean => SPECIAL_NAME_PREFIXES.some((p) => item.name.startsWith(p));

/**
 * Items from other game modes or restricted minigames that should never be
 * recommended for the main game (mirrors dps.osrs.wiki's picker filter, plus
 * Deadman/Bounty Hunter variants).
 */
const MODE_VARIANT_RE = /\((Deadman Mode|bh|Last Man Standing|historical|beta|Wilderness Wars|Emir's Arena|Soul Wars|Trailblazer|Shattered Relics|League|wrapped)\)$/i;
const BLOCKED_NAMES_RE = /(Fine mesh net|Wilderness champion amulet|^Crystal .* \(i\)$|^(Koriff|Maoma|Saika)'s |calamity (breeches|chest))/i;

/**
 * Gear main-game players cannot obtain (league rewards, Deadman seasonal
 * items, discontinued content), detected from wiki categories by
 * scripts/sync-reqs.mjs. Unlike isModeRestricted these are only excluded when
 * the player doesn't own them - whoever has one can still wear it.
 */
const unobtainableNames = new Set(unobtainableJson as string[]);

export const isUnobtainable = (item: EquipmentPiece): boolean => unobtainableNames.has(item.name);

export interface GearProtectionRule {
  slot: Slot;
  /** the mechanic the gear blocks, e.g. "icy breath" */
  reason: string;
  /** the only items that block it */
  items: string[];
  /** advisory rules warn but don't restrict the search (diary-skippable etc.) */
  advisory?: boolean;
}

const SLAYER_HELMETS = ['Slayer helmet', 'Slayer helmet (i)'];

/**
 * Monsters you do not fight without specific protective gear: no prayer or
 * potion substitutes exist, so the solver locks those slots (and, for shields,
 * drops two-handed weapons) and warns when nothing owned qualifies. Dragons
 * are deliberately absent - antifire potions cover dragonfire, so their setups
 * stay unconstrained.
 */
const MONSTER_PROTECTIONS: { monster: RegExp; rules: GearProtectionRule[] }[] = [
  {
    monster: /wyvern/i,
    rules: [{
      slot: 'shield',
      reason: 'icy breath',
      items: ['Elemental shield', 'Mind shield', 'Dragonfire shield', 'Dragonfire ward', 'Ancient wyvern shield'],
    }],
  },
  {
    monster: /basilisk|cockatrice/i,
    rules: [{ slot: 'shield', reason: 'petrifying gaze', items: ['Mirror shield', "V's shield"] }],
  },
  {
    monster: /aberrant spectre|deviant spectre/i,
    rules: [{ slot: 'head', reason: 'noxious fumes', items: ['Nose peg', ...SLAYER_HELMETS] }],
  },
  {
    monster: /dust devil|smoke devil/i,
    rules: [{ slot: 'head', reason: 'choking clouds', items: ['Facemask', ...SLAYER_HELMETS] }],
  },
  {
    monster: /banshee/i,
    rules: [{ slot: 'head', reason: 'piercing scream', items: ['Earmuffs', ...SLAYER_HELMETS] }],
  },
  {
    monster: /cave horror/i,
    rules: [{ slot: 'neck', reason: 'gaze', items: ['Witchwood icon'] }],
  },
  {
    monster: /sourhog/i,
    rules: [{ slot: 'head', reason: 'foul stench', items: ['Reinforced goggles', ...SLAYER_HELMETS] }],
  },
  {
    monster: /^(drake|alchemical hydra|hydra|wyrm|wyrmling)/i,
    rules: [{
      slot: 'feet',
      reason: 'searing Karuulm floor (skippable with the Kourend elite diary)',
      items: ['Boots of stone', 'Boots of brimstone', 'Granite boots'],
      advisory: true,
    }],
  },
];

export const protectionRulesFor = (monsterName: string): GearProtectionRule[] => MONSTER_PROTECTIONS
  .filter((p) => p.monster.test(monsterName))
  .flatMap((p) => p.rules);

/** the slayer krakens surface only for magic - melee and ranged cannot touch them */
export const isMagicOnlyTarget = (monsterName: string): boolean => /^(Cave kraken|Kraken)$/.test(monsterName);
/** Barbarian Assault attacker arrows (125 ranged str, unusable outside BA) */
const BLOCKED_IDS = new Set([22227, 22228, 22229, 22230]);

export const isModeRestricted = (item: EquipmentPiece): boolean => MODE_VARIANT_RE.test(item.name)
  || BLOCKED_NAMES_RE.test(item.name)
  || BLOCKED_IDS.has(item.id)
  || /^(Broken|Inactive|Locked)$/.test(item.version);

/** Gauntlet-only weapons/armour, e.g. "Crystal halberd (perfected)" */
export const isGauntletItem = (item: EquipmentPiece): boolean => /^(Crystal|Corrupted) .*\((basic|attuned|perfected)\)$/.test(item.name);

/** dart options for the toxic/blazing blowpipe, best first */
export const DART_NAMES = ['Dragon dart', 'Amethyst dart', 'Rune dart', 'Adamant dart', 'Mithril dart', 'Atlatl dart'];

export const dartByName = (name: string): EquipmentPiece | undefined => canonicalEquipment.find((e) => e.name === name);

/** staves that can autocast the Ancient Magicks spellbook */
export const ANCIENT_AUTOCAST_WEAPONS = [
  'Ancient staff',
  'Ancient sceptre',
  'Smoke ancient sceptre',
  'Shadow ancient sceptre',
  'Blood ancient sceptre',
  'Ice ancient sceptre',
  'Kodai wand',
  'Master wand',
  'Nightmare staff',
  'Volatile nightmare staff',
  'Eldritch nightmare staff',
  'Blue moon spear',
];

/** weapons that can cast Magic Dart */
export const MAGIC_DART_WEAPONS = [
  "Slayer's staff",
  "Slayer's staff (e)",
  'Staff of the dead',
  'Toxic staff of the dead',
  'Staff of light',
  'Staff of balance',
];

export const IBAN_BLAST_WEAPONS = ["Iban's staff", "Iban's staff (u)"];

export const AUTOCAST_CATEGORIES = [
  EquipmentCategory.STAFF,
  EquipmentCategory.BLADED_STAFF,
  EquipmentCategory.POLESTAFF,
];

export const POWERED_CATEGORIES = [
  EquipmentCategory.POWERED_STAFF,
  EquipmentCategory.POWERED_WAND,
];
