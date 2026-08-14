import { EquipmentPiece, PlayerEquipment } from '@/types/Player';
import { Monster } from '@/types/Monster';
import { PlayerCombatStyle, CombatStyleType } from '@/types/PlayerCombatStyle';
import { Spell, spellByName } from '@/types/Spell';
import { MonsterAttribute } from '@/enums/MonsterAttribute';
import { getCombatStylesForCategory } from '@/utils';
import { AmmoApplicability, ammoApplicability } from '@/lib/Equipment';
import { BLOWPIPE_IDS } from '@/lib/constants';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import {
  ANCIENT_AUTOCAST_WEAPONS,
  DART_NAMES,
  IBAN_BLAST_WEAPONS,
  MAGIC_DART_WEAPONS,
  POWERED_CATEGORIES,
  GearProtectionRule,
  Slot,
  SLOTS,
  canonicalIdOf,
  dartByName,
  equipmentBySlot,
  isGauntletItem,
  isMagicOnlyTarget,
  isModeRestricted,
  isSpecialItem,
  isUnobtainable,
  itemById,
  protectionRulesFor,
} from './data';
import { CORRUPTED_GAUNTLET_MONSTER_IDS, GAUNTLET_MONSTER_IDS } from '@/lib/constants';
import NPCVsPlayerCalc from '@/lib/NPCVsPlayerCalc';
import {
  PriceMap, TrainedSkill, consumableCostPerHour, xpPerDamage, xpPerHour,
} from './xp';
import {
  COMBO_TEMPLATES, ComboTemplate, comboOf, equipmentByName, pieceOptions, resolveByName,
} from './combos';
import { meetsRequirements } from './requirements';
import {
  LoadoutConfig,
  blowpipeWithDart,
  bestStandardSpell,
  buildMonster,
  buildPlayer,
  styleGroupOf,
} from './loadout';
import {
  GearLoadout,
  ResultItem,
  SlotAlternative,
  SolveRequest,
  SolveResult,
  SolvedSetup,
  StyleGroup,
  StyleResult,
  UpgradeSuggestion,
} from './types';

const ARMOUR_SLOTS: Slot[] = ['head', 'body', 'legs', 'neck', 'cape', 'hands', 'feet', 'ring', 'shield', 'ammo'];

interface WeaponVariant {
  weapon: EquipmentPiece;
  style: PlayerCombatStyle;
  spell: Spell | null;
  group: StyleGroup;
}

interface OptimisedEntry {
  v: WeaponVariant;
  eq: Partial<PlayerEquipment>;
  style: PlayerCombatStyle;
  setup: SolvedSetup;
}

type ProgressFn = (pct: number, label: string) => void;

const offensiveDim = (item: EquipmentPiece, t: CombatStyleType): number => {
  if (!t) return 0;
  return item.offensive[t] ?? 0;
};

const strengthDim = (item: EquipmentPiece, t: CombatStyleType): number => {
  if (t === 'ranged') return item.bonuses.ranged_str;
  if (t === 'magic') return item.bonuses.magic_str;
  return item.bonuses.str;
};

/** whether the item is any better than an empty slot (arrows on a mage are not) */
const contributes = (item: EquipmentPiece, t: CombatStyleType): boolean => offensiveDim(item, t) > 0
  || strengthDim(item, t) > 0
  || item.bonuses.prayer > 0
  || Object.values(item.defensive).some((v) => v > 0);

export class Solver {
  private cfg: LoadoutConfig;

  private monster: Monster;

  private request: SolveRequest;

  /** canonicalised owned ids (badge display); null = no bank imported */
  private owned: Set<number> | null;

  /** when true, unowned items are excluded from the search entirely */
  private restrictToOwned: boolean;

  private excluded: Set<number>;

  private memo = new Map<string, { dps: number; speed: number }>();

  private candidateCache = new Map<string, EquipmentPiece[]>();

  /** gauntlet-only items are allowed only against the Hunllef */
  private inGauntlet: boolean;

  /** base slayer level for slayer-gated gear (not part of PlayerSkills) */
  private slayerLevel: number;

  /** protective gear the target makes mandatory (wyvern breath, spectre fumes...) */
  private protections: GearProtectionRule[];

  /** hard slot locks derived from the non-advisory protection rules */
  private lockedSlots: Map<Slot, Set<string>>;

  private loggedEvalError = false;

  /** winning optimised entry per style group, kept for the upgrade advisor */
  private bestEntries: Partial<Record<StyleGroup, OptimisedEntry>> = {};

  private mode: 'boss' | 'training';

  private trainedSkill: TrainedSkill;

  private downtime: number;

  private prices: PriceMap | null;

  evals = 0;

  constructor(request: SolveRequest) {
    this.request = request;
    this.cfg = {
      skills: request.skills,
      potionPreset: request.potionPreset,
      usePrayers: request.usePrayers,
      onSlayerTask: request.onSlayerTask,
      playerHpCurrent: request.playerHpCurrent,
    };
    this.monster = buildMonster(request.monsterId, request.monsterVersion, request.monsterInputs);
    this.inGauntlet = GAUNTLET_MONSTER_IDS.includes(this.monster.id)
      || CORRUPTED_GAUNTLET_MONSTER_IDS.includes(this.monster.id);
    this.mode = request.mode ?? 'boss';
    this.trainedSkill = request.trainedSkill ?? 'str';
    this.downtime = request.downtimeSeconds ?? (this.mode === 'training' ? 5 : 0);
    this.prices = request.prices ?? null;
    this.owned = request.ownedIds === null ? null : new Set(request.ownedIds.map(canonicalIdOf));
    this.restrictToOwned = request.restrictToOwned && this.owned !== null;
    this.excluded = new Set(request.excludedIds.map(canonicalIdOf));
    this.slayerLevel = request.slayerLevel ?? 99;
    this.protections = protectionRulesFor(this.monster.name);
    this.lockedSlots = new Map(this.protections
      .filter((r) => !r.advisory)
      .map((r) => [r.slot, new Set(r.items)]));
  }

  /** allowed ignoring ownership (mode/gauntlet/exclusion/level filters only) */
  private isAllowedBase(item: EquipmentPiece): boolean {
    if (this.excluded.has(item.id)) return false;
    if (isModeRestricted(item)) return false;
    if (isGauntletItem(item) && !this.inGauntlet) return false;
    // seasonal/discontinued gear is only suggested to players who have it
    if (isUnobtainable(item) && !this.owned?.has(item.id)) return false;
    // gauntlet gear has no requirements inside the gauntlet
    if (!this.inGauntlet && !meetsRequirements(item, this.cfg.skills, this.slayerLevel)) return false;
    return true;
  }

  private isAllowed(item: EquipmentPiece): boolean {
    if (!this.isAllowedBase(item)) return false;
    if (!this.restrictToOwned) return true;
    return this.owned!.has(item.id);
  }

  /** when the target mandates protective gear, nothing else may fill the slot */
  private protectionFilter(slot: Slot, list: EquipmentPiece[]): EquipmentPiece[] {
    const allowed = this.lockedSlots.get(slot);
    if (!allowed) return list;
    return list.filter((i) => allowed.has(i.name));
  }

  /** all allowed items for a slot, without stat pruning */
  private allowedForSlot(slot: Slot): EquipmentPiece[] {
    const key = `all|${slot}`;
    let list = this.candidateCache.get(key);
    if (!list) {
      list = this.protectionFilter(slot, equipmentBySlot(slot).filter((i) => this.isAllowed(i)));
      this.candidateCache.set(key, list);
    }
    return list;
  }

  /** all base-allowed items for a slot, ignoring ownership (for the upgrade advisor) */
  private baseAllowedForSlot(slot: Slot): EquipmentPiece[] {
    const key = `base|${slot}`;
    let list = this.candidateCache.get(key);
    if (!list) {
      list = this.protectionFilter(slot, equipmentBySlot(slot).filter((i) => this.isAllowedBase(i)));
      this.candidateCache.set(key, list);
    }
    return list;
  }

  /**
   * Candidates worth trying for a slot given an attack type. In "all items" mode
   * this prunes to the pareto frontier over (attack bonus, strength bonus, prayer)
   * plus special-effect items; owned mode keeps everything the player has.
   */
  private candidatesFor(slot: Slot, t: CombatStyleType): EquipmentPiece[] {
    const key = `${slot}|${t}`;
    const cached = this.candidateCache.get(key);
    if (cached) return cached;

    const all = this.allowedForSlot(slot);
    // mandatory protective gear is a handful of mostly statless items - prune nothing
    if (this.lockedSlots.has(slot)) {
      this.candidateCache.set(key, all);
      return all;
    }
    let result: EquipmentPiece[];
    if (this.restrictToOwned && all.length <= 80) {
      result = all;
    } else {
      const statsy = all.filter((i) => isSpecialItem(i)
        || offensiveDim(i, t) > 0 || strengthDim(i, t) > 0 || i.bonuses.prayer > 0);
      const dims = (i: EquipmentPiece) => [offensiveDim(i, t), strengthDim(i, t), i.bonuses.prayer];
      result = statsy.filter((i) => {
        if (isSpecialItem(i)) return true;
        const di = dims(i);
        return !statsy.some((j) => {
          if (j === i) return false;
          const dj = dims(j);
          return dj[0] >= di[0] && dj[1] >= di[1] && dj[2] >= di[2]
            && (dj[0] > di[0] || dj[1] > di[1] || dj[2] > di[2]);
        });
      });
    }
    this.candidateCache.set(key, result);
    return result;
  }

  private loadoutKey(eq: Partial<PlayerEquipment>, style: PlayerCombatStyle, spell: Spell | null): string {
    const ids = SLOTS.map((s) => eq[s]?.id ?? 0).join(',');
    const dart = eq.weapon?.itemVars?.blowpipeDartId ?? 0;
    return `${ids}|${dart}|${style.name}|${style.stance}|${spell?.name ?? ''}`;
  }

  private evalLite(eq: Partial<PlayerEquipment>, style: PlayerCombatStyle, spell: Spell | null): { dps: number; speed: number } {
    const key = this.loadoutKey(eq, style, spell);
    const cached = this.memo.get(key);
    if (cached !== undefined) return cached;
    let result = { dps: 0, speed: 4 };
    try {
      const player = buildPlayer(this.cfg, this.monster, eq, style, spell);
      const calc = new PlayerVsNPCCalc(player, this.monster, { loadoutName: 'solver' });
      const dps = calc.getDps();
      result = { dps: Number.isFinite(dps) ? dps : 0, speed: player.attackSpeed };
    } catch (err) {
      if (!this.loggedEvalError) {
        this.loggedEvalError = true;
        // eslint-disable-next-line no-console
        console.warn('[solver] loadout eval failed (first occurrence)', err);
      }
    }
    this.evals += 1;
    this.memo.set(key, result);
    return result;
  }

  private dps(eq: Partial<PlayerEquipment>, style: PlayerCombatStyle, spell: Spell | null): number {
    return this.evalLite(eq, style, spell).dps;
  }

  /** the ranking metric: dps in boss mode, xp/hr in the trained skill otherwise */
  private score(eq: Partial<PlayerEquipment>, style: PlayerCombatStyle, spell: Spell | null): number {
    const { dps, speed } = this.evalLite(eq, style, spell);
    return this.metricOf(dps, speed, style, spell);
  }

  private metricOf(dps: number, speed: number, style: PlayerCombatStyle, spell: Spell | null): number {
    if (this.mode !== 'training') return dps;
    return xpPerHour({
      skill: this.trainedSkill,
      style,
      spell,
      dps,
      attackSpeedTicks: speed,
      monsterHp: this.monster.skills.hp,
      downtimeSeconds: this.downtime,
    });
  }

  /**
   * Whether a stance is worth considering. Boss mode skips defensive stances;
   * training mode instead requires the style to award XP in the trained skill
   * (which brings Defensive/Controlled/Longrange stances into play).
   */
  private stanceEligible(style: PlayerCombatStyle, isSalamander: boolean): boolean {
    if (!style.type || !style.stance) return false;
    if (style.stance === 'Manual Cast') return false;
    if (this.mode === 'training') {
      return xpPerDamage(style, this.trainedSkill) > 0;
    }
    if (isSalamander) return true;
    return style.stance !== 'Defensive' && style.stance !== 'Longrange' && style.stance !== 'Defensive Autocast';
  }

  private isCastStance(stance: string | null): boolean {
    return stance === 'Autocast' || stance === 'Defensive Autocast';
  }

  /** enumerate (weapon, style, spell) variants for a style group */
  private weaponVariants(group: StyleGroup, unrestricted = false): WeaponVariant[] {
    const pool = (unrestricted ? this.baseAllowedForSlot('weapon') : this.allowedForSlot('weapon'))
      // a mandatory shield rules out every two-handed weapon
      .filter((w) => !(this.lockedSlots.has('shield') && w.isTwoHanded));
    return pool.flatMap((w) => this.variantsForWeapon(w, group, { unrestricted }));
  }

  /** the eligible (style, spell) variants of a single weapon within a style group */
  private variantsForWeapon(
    weapon: EquipmentPiece,
    group: StyleGroup,
    opts: { unrestricted?: boolean; styleTypes?: CombatStyleType[]; anyStance?: boolean } = {},
  ): WeaponVariant[] {
    // novelty/unknown weapons carry speed -1 in the data, which the engine
    // clamps to 1 tick and turns into nonsense DPS
    if (weapon.speed <= 0) return [];
    const out: WeaponVariant[] = [];
    const magicLevel = this.cfg.skills.magic;
    const styles = getCombatStylesForCategory(weapon.category);
    const isSalamander = weapon.category === EquipmentCategory.SALAMANDER;
    const seenStyles = new Set<string>();

    for (const style of styles) {
      if (!opts.anyStance && !this.stanceEligible(style, isSalamander)) continue;
      if (opts.anyStance && (!style.type || !style.stance || style.stance === 'Manual Cast')) continue;
      if (styleGroupOf(style) !== group) continue;
      if (opts.styleTypes && (!style.type || !opts.styleTypes.includes(style.type))) continue;
      const styleKey = `${style.name}|${style.type}|${style.stance}`;
      if (seenStyles.has(styleKey)) continue;
      seenStyles.add(styleKey);

      if (this.isCastStance(style.stance)) {
        // needs a spell; enumerate the sensible ones for this weapon
        for (const spell of this.spellsFor(weapon, magicLevel)) {
          out.push({
            weapon, style, spell, group,
          });
        }
        continue;
      }

      if (style.type === 'magic' && !POWERED_CATEGORIES.includes(weapon.category) && !isSalamander) {
        // non-powered magic styles without autocast are useless
        continue;
      }

      if (BLOWPIPE_IDS.includes(weapon.id)) {
        const dart = this.bestOwnedDart() ?? (opts.unrestricted ? dartByName(DART_NAMES[0]) : undefined);
        if (!dart) continue;
        out.push({
          weapon: blowpipeWithDart(weapon, dart), style, spell: null, group,
        });
        continue;
      }

      out.push({
        weapon, style, spell: null, group,
      });
    }
    return out;
  }

  private bestOwnedDart(): EquipmentPiece | undefined {
    for (const name of DART_NAMES) {
      const dart = dartByName(name);
      if (dart && this.isAllowed(dart)) return dart;
    }
    return undefined;
  }

  private spellsFor(weapon: EquipmentPiece, magicLevel: number): Spell[] {
    const out: Spell[] = [];
    const push = (s: Spell | null) => { if (s) out.push(s); };

    if (IBAN_BLAST_WEAPONS.includes(weapon.name)) {
      if (magicLevel >= 50) push(spellByName('Iban Blast'));
      return out;
    }
    if (MAGIC_DART_WEAPONS.includes(weapon.name) && magicLevel >= 50) {
      push(spellByName('Magic Dart'));
    }
    push(bestStandardSpell(magicLevel));
    if (ANCIENT_AUTOCAST_WEAPONS.includes(weapon.name)) {
      if (magicLevel >= 94) push(spellByName('Ice Barrage'));
      else if (magicLevel >= 92) push(spellByName('Blood Barrage'));
    }
    if (this.monster.attributes.includes(MonsterAttribute.DEMON) && magicLevel >= 82) {
      push(spellByName('Dark Demonbane'));
    }
    return out.filter((s, ix) => out.findIndex((o) => o.name === s.name) === ix);
  }

  /** best INCLUDED ammo for a weapon by static ranged strength (phase A heuristic) */
  private quickAmmoFor(weapon: EquipmentPiece): EquipmentPiece | null {
    let best: EquipmentPiece | null = null;
    for (const ammo of this.allowedForSlot('ammo')) {
      if (ammoApplicability(weapon.id, ammo.id) !== AmmoApplicability.INCLUDED) continue;
      if (!best || ammo.bonuses.ranged_str > best.bonuses.ranged_str) best = ammo;
    }
    return best;
  }

  private weaponNeedsAmmo(weapon: EquipmentPiece): boolean {
    // INVALID for undefined ammo means the weapon requires ammo
    return ammoApplicability(weapon.id, undefined) === AmmoApplicability.INVALID;
  }

  private ammoCandidates(weapon: EquipmentPiece, t: CombatStyleType): EquipmentPiece[] {
    const needsAmmo = this.weaponNeedsAmmo(weapon);
    const pool = needsAmmo ? this.allowedForSlot('ammo') : this.candidatesFor('ammo', t);
    return pool.filter((a) => {
      const ap = ammoApplicability(weapon.id, a.id);
      return needsAmmo ? ap === AmmoApplicability.INCLUDED : ap !== AmmoApplicability.INVALID;
    });
  }

  /** coordinate-ascent the armour slots for a fixed weapon variant; locked slots are kept as-is */
  private optimiseArmour(variant: WeaponVariant, lockedPieces?: Partial<PlayerEquipment>): Partial<PlayerEquipment> {
    const { weapon, style, spell } = variant;
    const t = style.type;
    const eq: Partial<PlayerEquipment> = { weapon, ...lockedPieces };
    const locked = new Set(Object.keys(lockedPieces ?? {}) as Slot[]);

    if (!locked.has('ammo')) {
      const initialAmmo = this.quickAmmoFor(weapon);
      if (initialAmmo) eq.ammo = initialAmmo;
      if (this.weaponNeedsAmmo(weapon) && !initialAmmo) return eq; // unusable, will score 0
    }

    for (let pass = 0; pass < 3; pass += 1) {
      let changed = false;
      for (const slot of ARMOUR_SLOTS) {
        if (locked.has(slot)) continue;
        if (slot === 'shield' && weapon.isTwoHanded) continue;
        const candidates = slot === 'ammo'
          ? this.ammoCandidates(weapon, t)
          : this.candidatesFor(slot, t);

        let bestItem: EquipmentPiece | null = eq[slot] ?? null;
        let bestDps = this.dps(eq, style, spell);
        // try empty slot too, in case current item has net-negative bonuses -
        // except mandatory protective gear, which never comes off
        if (eq[slot] && slot !== 'ammo' && !this.lockedSlots.has(slot)) {
          const d = this.dps({ ...eq, [slot]: null }, style, spell);
          if (d > bestDps) { bestDps = d; bestItem = null; }
        }
        // mandatory protective gear goes on even when it costs dps (a DFS on a mage)
        if (this.lockedSlots.has(slot) && bestItem === null) bestDps = -Infinity;
        for (const cand of candidates) {
          if (cand.id === eq[slot]?.id) continue;
          const d = this.dps({ ...eq, [slot]: cand }, style, spell);
          // on a dps tie, fill the slot only with something that actually adds
          // anything (defence/prayer count; arrows on a mage stay out)
          if (d > bestDps || (d === bestDps && bestItem === null && contributes(cand, t))) { bestDps = d; bestItem = cand; }
        }
        if ((bestItem?.id ?? null) !== (eq[slot]?.id ?? null)) {
          changed = true;
          eq[slot] = bestItem;
        }
      }
      if (!changed) break;
    }
    return eq;
  }

  /** after armour has settled, re-check which of the weapon's styles is best */
  private bestStyleFor(
    weapon: EquipmentPiece,
    group: StyleGroup,
    eq: Partial<PlayerEquipment>,
    spell: Spell | null,
    styleTypes?: CombatStyleType[],
  ): PlayerCombatStyle {
    const isSalamander = weapon.category === EquipmentCategory.SALAMANDER;
    const styles = getCombatStylesForCategory(weapon.category).filter((s) => {
      if (!this.stanceEligible(s, isSalamander)) return false;
      if (styleTypes && (!s.type || !styleTypes.includes(s.type))) return false;
      if (spell !== null) return this.isCastStance(s.stance);
      if (this.isCastStance(s.stance)) return false;
      return styleGroupOf(s) === group;
    });
    let best = styles[0];
    let bestScore = -1;
    for (const s of styles) {
      const d = this.score(eq, s, spell);
      if (d > bestScore) { bestScore = d; best = s; }
    }
    return best;
  }

  /** a template's locked pieces from the allowed pool; null if any piece is unavailable */
  private resolveComboPieces(tpl: ComboTemplate, base = false): Partial<PlayerEquipment> | null {
    const allowed = (i: EquipmentPiece) => (base ? this.isAllowedBase(i) : this.isAllowed(i));
    const pieces: Partial<PlayerEquipment> = {};
    for (const [slot, piece] of Object.entries(tpl.pieces) as [Slot, string | string[]][]) {
      const item = pieceOptions(piece).map((n) => resolveByName(n, allowed)).find((i) => i !== null) ?? null;
      if (!item) return null;
      pieces[slot] = item;
    }
    return pieces;
  }

  /** candidate weapons for a combo, best stance each, scored with the locked pieces worn */
  private comboWeaponVariants(
    tpl: ComboTemplate,
    shortlist: WeaponVariant[],
    pieces: Partial<PlayerEquipment>,
    base = false,
  ): WeaponVariant[] {
    const allowed = (i: EquipmentPiece) => (base ? this.isAllowedBase(i) : this.isAllowed(i));
    const weapons = new Map<number, EquipmentPiece>();
    for (const name of tpl.weapons ?? []) {
      const w = resolveByName(name, allowed);
      if (w) weapons.set(w.id, w);
    }
    if (!tpl.weapons || tpl.alsoShortlist) {
      for (const v of shortlist) weapons.set(v.weapon.id, v.weapon);
    }

    const perWeapon: { v: WeaponVariant; score: number }[] = [];
    for (const w of weapons.values()) {
      if (this.lockedSlots.has('shield') && w.isTwoHanded) continue;
      let best: { v: WeaponVariant; score: number } | null = null;
      for (const v of this.variantsForWeapon(w, tpl.group, { styleTypes: tpl.styleTypes, unrestricted: base })) {
        const eq: Partial<PlayerEquipment> = { ...pieces, weapon: v.weapon };
        if (v.weapon.isTwoHanded) eq.shield = null;
        const ammo = this.quickAmmoFor(v.weapon);
        if (ammo) eq.ammo = ammo;
        if (this.weaponNeedsAmmo(v.weapon) && !ammo) continue;
        const score = this.score(eq, v.style, v.spell);
        if (score > 0 && (!best || score > best.score)) best = { v, score };
      }
      if (best) perWeapon.push(best);
    }
    perWeapon.sort((a, b) => b.score - a.score);
    return perWeapon.slice(0, 3).map((p) => p.v);
  }

  /**
   * Full-set combo entries: each template's pieces locked, remaining slots
   * optimised. This is what surfaces sets the per-slot search can't reach
   * (no single piece improves the setup until the whole set is worn).
   */
  /** whether the solve assumes reduced current hp (NMZ absorption method) */
  private isLowHp(): boolean {
    return this.cfg.playerHpCurrent !== undefined && this.cfg.playerHpCurrent < this.cfg.skills.hp;
  }

  private comboEntries(group: StyleGroup, shortlist: WeaponVariant[], lowHpOnly = false): OptimisedEntry[] {
    const out: OptimisedEntry[] = [];
    for (const tpl of COMBO_TEMPLATES) {
      if (tpl.group !== group) continue;
      if (tpl.requiresLowHp && !this.isLowHp()) continue;
      if (lowHpOnly && !tpl.requiresLowHp) continue;
      const pieces = this.resolveComboPieces(tpl);
      if (!pieces) continue;
      for (const v of this.comboWeaponVariants(tpl, shortlist, pieces)) {
        const eq = this.optimiseArmour(v, pieces);
        const style = this.bestStyleFor(v.weapon, group, eq, v.spell, tpl.styleTypes);
        const setup = this.finalise(eq, style, v.spell, group);
        if (setup.dps <= 0.0001 || setup.metric <= 0.0001) continue;
        out.push({
          v, eq, style, setup,
        });
      }
    }
    return out;
  }

  private toResultItem(item: EquipmentPiece, slot: string): ResultItem {
    return {
      id: item.id,
      name: item.name,
      version: item.version,
      image: item.image,
      slot,
      owned: this.owned === null ? true : this.owned.has(item.id),
      detail: item.itemVars?.blowpipeDartName,
    };
  }

  private finalise(eq: Partial<PlayerEquipment>, style: PlayerCombatStyle, spell: Spell | null, group: StyleGroup): SolvedSetup {
    const combo = comboOf(group, eq.weapon?.name, style.type, (slot) => eq[slot]?.name);
    const unmet = this.protections
      .filter((r) => !r.items.includes(eq[r.slot]?.name ?? ''))
      .map((r) => `${r.reason} needs ${r.items.join(' / ')}`);
    const warning = unmet.length > 0 ? `${this.monster.name}: ${unmet.join('; ')}` : null;
    const player = buildPlayer(this.cfg, this.monster, eq, style, spell);
    const calc = new PlayerVsNPCCalc(player, this.monster, { loadoutName: 'solver' });
    const items: SolvedSetup['items'] = {};
    for (const slot of SLOTS) {
      const item = eq[slot];
      if (item) items[slot] = this.toResultItem(item, slot);
    }
    if (spell && items.weapon) items.weapon.detail = spell.name;

    const dps = calc.getDps();
    const metric = this.metricOf(dps, player.attackSpeed, style, spell);

    let dmgTakenHr: number | null = null;
    try {
      const npcDps = new NPCVsPlayerCalc(player, this.monster, { loadoutName: 'solver' }).getDps();
      if (Number.isFinite(npcDps)) dmgTakenHr = npcDps * 3600;
    } catch {
      dmgTakenHr = null;
    }

    let costHr: number | null = null;
    let costParts: string[] = [];
    if (this.prices && eq.weapon) {
      const ttkApprox = dps > 0 ? this.monster.skills.hp / dps : 0;
      const uptime = this.downtime > 0 && ttkApprox > 0 ? ttkApprox / (ttkApprox + this.downtime) : 1;
      const cost = consumableCostPerHour({
        prices: this.prices,
        weapon: eq.weapon,
        ammo: eq.ammo,
        cape: eq.cape,
        spell,
        attackSpeedTicks: player.attackSpeed,
        uptime,
      });
      if (cost) {
        costHr = cost.gpPerHour;
        costParts = cost.parts;
      }
    }

    return {
      styleGroup: group,
      dps,
      maxHit: calc.getMax(),
      accuracy: calc.getHitChance(),
      ttk: calc.getTtk(),
      attackSpeed: player.attackSpeed,
      styleName: style.name,
      styleStance: style.stance ?? '',
      spellName: spell?.name ?? null,
      combo,
      warning,
      items,
      metric,
      xpHr: this.mode === 'training' ? metric : null,
      dmgTakenHr,
      foodHr: dmgTakenHr !== null ? dmgTakenHr / 20 : null,
      costHr,
      costParts,
    };
  }

  /**
   * Evaluates a hand-picked loadout exactly as given (no slot optimisation).
   * Without an explicit style choice, every eligible stance/spell of the weapon
   * is tried and the best by the ranking metric wins; an explicit choice is
   * honoured even for stances the solver would skip (e.g. defensive).
   */
  evaluateLoadout(loadout: GearLoadout): SolvedSetup | null {
    const eq: Partial<PlayerEquipment> = {};
    for (const [slot, id] of Object.entries(loadout.items)) {
      if (!id) continue;
      const item = itemById.get(id);
      if (item) eq[slot as Slot] = item;
    }
    const rawWeapon = eq.weapon;
    if (!rawWeapon) return null;
    if (BLOWPIPE_IDS.includes(rawWeapon.id)) {
      const dart = (loadout.dartName ? dartByName(loadout.dartName) : undefined) ?? dartByName(DART_NAMES[0]);
      if (dart) eq.weapon = blowpipeWithDart(rawWeapon, dart);
    }
    if (rawWeapon.isTwoHanded) eq.shield = null;

    const explicit = loadout.styleName !== undefined;
    const groups: StyleGroup[] = ['melee', 'ranged', 'magic'];
    const variants = groups
      .flatMap((g) => this.variantsForWeapon(rawWeapon, g, { unrestricted: true, anyStance: explicit }))
      .filter((v) => !explicit
        || (v.style.name === loadout.styleName && (loadout.styleStance === undefined || v.style.stance === loadout.styleStance)));

    let best: SolvedSetup | null = null;
    for (const v of variants) {
      const setup = this.finalise(eq, v.style, v.spell, v.group);
      if (!best || setup.metric > best.metric) best = setup;
    }
    return best;
  }

  /** styles that physically cannot reach the target, regardless of gear */
  private styleUnreachable(group: StyleGroup): boolean {
    if (group === 'melee' && this.monster.attributes.includes(MonsterAttribute.FLYING)) return true;
    if (group !== 'magic' && isMagicOnlyTarget(this.monster.name)) return true;
    return false;
  }

  solveStyle(group: StyleGroup, progress?: ProgressFn, progressBase = 0, progressSpan = 1, light = false): StyleResult {
    const report = (frac: number, label: string) => progress?.(progressBase + frac * progressSpan, label);
    const K = this.request.weaponsPerStyle ?? 8;

    if (this.styleUnreachable(group)) {
      return {
        styleGroup: group, immune: true, best: null, setups: [], combos: [], alternatives: {},
      };
    }

    // Phase A: rank every weapon variant with just weapon (+ammo) equipped
    report(0.05, `${group}: ranking weapons`);
    const variants = this.weaponVariants(group);
    const scored = variants.map((v) => {
      const eq: Partial<PlayerEquipment> = { weapon: v.weapon };
      const ammo = this.quickAmmoFor(v.weapon);
      if (ammo) eq.ammo = ammo;
      if (this.weaponNeedsAmmo(v.weapon) && !ammo) return { v, score: 0 };
      return { v, score: this.score(eq, v.style, v.spell) };
    }).filter((s) => s.score > 0);
    scored.sort((a, b) => b.score - a.score);

    // best variant per weapon (collapsing same-name versions), then top K weapons
    const seen = new Set<string>();
    const shortlist: WeaponVariant[] = [];
    for (const s of scored) {
      if (seen.has(s.v.weapon.name)) continue;
      seen.add(s.v.weapon.name);
      shortlist.push(s.v);
      if (shortlist.length >= K) break;
    }

    if (shortlist.length === 0) {
      return {
        styleGroup: group, immune: true, best: null, setups: [], combos: [], alternatives: {},
      };
    }

    // Phase B: optimise armour per shortlisted weapon
    const entries: OptimisedEntry[] = [];
    const optimiseVariant = (v: WeaponVariant): OptimisedEntry => {
      const eq = this.optimiseArmour(v);
      const style = this.bestStyleFor(v.weapon, group, eq, v.spell);
      return {
        v, eq, style, setup: this.finalise(eq, style, v.spell, group),
      };
    };
    shortlist.forEach((v, ix) => {
      report(0.1 + 0.5 * (ix / shortlist.length), `${group}: optimising ${v.weapon.name}`);
      entries.push(optimiseVariant(v));
    });

    // light mode (training-spot ranking): best setup only, no alternatives. Combos
    // are skipped for speed, except low-hp sets (Dharok's) on low-hp solves - the
    // per-slot ascent can never assemble them and they decide the NMZ rows.
    if (light) {
      if (this.isLowHp()) entries.push(...this.comboEntries(group, shortlist, true));
      entries.sort((a, b) => b.setup.metric - a.setup.metric);
      const lightBest = entries[0].setup;
      if (lightBest.dps <= 0.0001 || lightBest.metric <= 0.0001) {
        return {
          styleGroup: group, immune: true, best: null, setups: [], combos: [], alternatives: {},
        };
      }
      return {
        styleGroup: group, immune: false, best: lightBest, setups: [lightBest], combos: [], alternatives: {},
      };
    }

    // full-set combos compete alongside the per-weapon entries
    report(0.62, `${group}: full-set combos`);
    entries.push(...this.comboEntries(group, shortlist));
    const comboBest = new Map<string, SolvedSetup>();
    for (const e of entries) {
      if (!e.setup.combo) continue; // the per-slot ascent can also land on a full set
      const cur = comboBest.get(e.setup.combo.name);
      if (!cur || e.setup.metric > cur.metric) comboBest.set(e.setup.combo.name, e.setup);
    }
    const combos = [...comboBest.values()].sort((a, b) => b.metric - a.metric);

    // Phase C: per-slot alternatives against the winning setup. If the weapon
    // ranking (now computed against real armour) surfaces a weapon that beats
    // the chosen best, promote it through a full optimisation pass and redo.
    let alternatives: StyleResult['alternatives'] = {};
    let best: SolvedSetup;
    for (let round = 0; ; round += 1) {
      entries.sort((a, b) => b.setup.metric - a.setup.metric);
      best = entries[0].setup;
      if (best.dps <= 0.0001 || best.metric <= 0.0001) {
        return {
          styleGroup: group, immune: true, best: null, setups: [], combos: [], alternatives: {},
        };
      }
      report(0.7 + round * 0.1, `${group}: ranking alternatives`);
      alternatives = this.buildAlternatives(entries[0], variants, best);
      const topAlt = alternatives.weapon?.[0];
      const shouldPromote = round < 2 && topAlt
        && topAlt.metric > best.metric * 1.002
        && !entries.some((e) => e.v.weapon.id === topAlt.id);
      if (!shouldPromote) break;
      for (const v of variants.filter((vv) => vv.weapon.id === topAlt.id)) {
        entries.push(optimiseVariant(v));
      }
    }
    // the combo path and the per-slot ascent can converge on the same loadout
    const seenLoadouts = new Set<string>();
    const sortedSetups = entries
      .filter((e) => {
        const key = this.loadoutKey(e.eq, e.style, e.v.spell);
        if (seenLoadouts.has(key)) return false;
        seenLoadouts.add(key);
        return true;
      })
      .map((e) => e.setup);
    [this.bestEntries[group]] = entries;

    report(1, `${group}: done`);
    return {
      styleGroup: group,
      immune: false,
      best,
      setups: sortedSetups.slice(0, 5),
      combos,
      alternatives,
    };
  }

  /**
   * Ranks unowned items by how much they would improve the owned best setup,
   * with GE price and gain-per-gp. Only meaningful after an owned-restricted solve.
   */
  /** GE price with same-name variant fallback (a charged scythe prices as the uncharged one) */
  private upgradePrice(item: EquipmentPiece): number | null {
    for (const variant of [item, ...equipmentByName(item.name)]) {
      const p = this.prices?.[variant.id];
      if (typeof p === 'number' && p > 0) return p;
    }
    return null;
  }

  private buildUpgrades(): UpgradeSuggestion[] | null {
    if (!this.restrictToOwned || !this.owned || !this.prices) return null;
    const byName = new Map<string, UpgradeSuggestion>();

    const push = (item: EquipmentPiece, slot: string, metric: number, bestMetric: number, group: StyleGroup, detail?: string) => {
      const gainPct = ((metric - bestMetric) / bestMetric) * 100;
      if (gainPct < 0.3) return;
      const price = this.upgradePrice(item);
      const existing = byName.get(item.name);
      if (existing && existing.gainPct >= gainPct) return;
      byName.set(item.name, {
        ...this.toResultItem(item, slot),
        detail,
        owned: false,
        styleGroup: group,
        metric,
        gainPct,
        price,
        gainPerM: price !== null ? gainPct / (price / 1_000_000) : null,
      });
    };

    for (const group of Object.keys(this.bestEntries) as StyleGroup[]) {
      const entry = this.bestEntries[group];
      if (!entry) continue;
      const { eq: bestEq, style: bestStyle, v: bestVariant } = entry;
      const bestMetric = entry.setup.metric;
      if (bestMetric <= 0) continue;

      // weapons: every unowned variant against the owned best armour
      for (const v of this.weaponVariants(group, true)) {
        if (this.owned.has(v.weapon.id)) continue;
        const eq: Partial<PlayerEquipment> = { ...bestEq, weapon: v.weapon };
        if (v.weapon.isTwoHanded) eq.shield = null;
        if (this.weaponNeedsAmmo(v.weapon)) {
          const currentOk = eq.ammo && ammoApplicability(v.weapon.id, eq.ammo.id) === AmmoApplicability.INCLUDED;
          if (!currentOk) {
            const ammo = this.quickAmmoFor(v.weapon);
            if (!ammo) continue;
            eq.ammo = ammo;
          }
        }
        const { dps, speed } = this.evalLite(eq, v.style, v.spell);
        if (dps <= 0) continue;
        const metric = this.metricOf(dps, speed, v.style, v.spell);
        push(v.weapon, 'weapon', metric, bestMetric, group, v.spell?.name ?? v.weapon.itemVars?.blowpipeDartName);
      }

      // armour: top unowned candidates per slot by raw stats, plus specials
      const t = bestStyle.type;
      for (const slot of ARMOUR_SLOTS) {
        if (slot === 'shield' && bestVariant.weapon.isTwoHanded) continue;
        let pool = this.baseAllowedForSlot(slot).filter((i) => !this.owned!.has(i.id));
        if (slot === 'ammo') {
          const needsAmmo = this.weaponNeedsAmmo(bestVariant.weapon);
          pool = pool.filter((a) => {
            const ap = ammoApplicability(bestVariant.weapon.id, a.id);
            return needsAmmo ? ap === AmmoApplicability.INCLUDED : ap !== AmmoApplicability.INVALID;
          });
        }
        const ranked = pool
          .filter((i) => isSpecialItem(i) || offensiveDim(i, t) > 0 || strengthDim(i, t) > 0 || i.bonuses.prayer > 0)
          .sort((a, b) => (offensiveDim(b, t) + strengthDim(b, t) * 2) - (offensiveDim(a, t) + strengthDim(a, t) * 2))
          .slice(0, 30);
        for (const cand of ranked) {
          const { dps, speed } = this.evalLite({ ...bestEq, [slot]: cand }, bestStyle, bestVariant.spell);
          if (dps <= 0) continue;
          const metric = this.metricOf(dps, speed, bestStyle, bestVariant.spell);
          push(cand, slot, metric, bestMetric, group);
        }
      }
    }

    // full-set bundles: price the missing pieces of each combo against the owned best
    for (const group of Object.keys(this.bestEntries) as StyleGroup[]) {
      const entry = this.bestEntries[group];
      if (!entry || entry.setup.metric <= 0) continue;
      const bestMetric = entry.setup.metric;
      for (const tpl of COMBO_TEMPLATES) {
        if (tpl.group !== group) continue;
        if (tpl.requiresLowHp && !this.isLowHp()) continue;
        const pieces = this.resolveComboPieces(tpl, true);
        if (!pieces) continue;
        for (const v of this.comboWeaponVariants(tpl, [entry.v], pieces, true).slice(0, 1)) {
          const lockedItems = [v.weapon, ...Object.values(pieces)] as EquipmentPiece[];
          const missing = lockedItems.filter((i) => !this.owned!.has(canonicalIdOf(i.id)));
          if (missing.length === 0) continue; // fully owned: already in the main results
          const missingPrices = missing.map((m) => this.upgradePrice(m));
          const price = missingPrices.every((p): p is number => p !== null)
            ? missingPrices.reduce((a, b) => a + b, 0)
            : null;

          const eq = this.optimiseArmour(v, pieces);
          const style = this.bestStyleFor(v.weapon, group, eq, v.spell, tpl.styleTypes);
          const { dps, speed } = this.evalLite(eq, style, v.spell);
          if (dps <= 0) continue;
          const metric = this.metricOf(dps, speed, style, v.spell);
          const gainPct = ((metric - bestMetric) / bestMetric) * 100;
          if (gainPct < 0.3) continue;
          const existing = byName.get(tpl.name);
          if (existing && existing.gainPct >= gainPct) continue;
          byName.set(tpl.name, {
            id: missing[0].id,
            name: tpl.name,
            version: '',
            image: missing[0].image,
            slot: 'set',
            owned: false,
            detail: missing.map((m) => m.name).join(' + '),
            styleGroup: group,
            metric,
            gainPct,
            price,
            gainPerM: price !== null ? gainPct / (price / 1_000_000) : null,
          });
        }
      }
    }

    // the advisor is first a shopping list: buyable rows lead, with a handful
    // of untradeable standouts (fire capes, demonbane upgrades) mixed in so
    // the biggest gains are never silently absent
    const all = [...byName.values()].sort((a, b) => b.gainPct - a.gainPct);
    const priced = all.filter((u) => u.price !== null).slice(0, 30);
    const unpriced = all.filter((u) => u.price === null).slice(0, 8);
    return [...priced, ...unpriced].sort((a, b) => b.gainPct - a.gainPct);
  }

  /** per-slot alternative rankings holding the rest of the best setup fixed */
  private buildAlternatives(
    bestEntry: OptimisedEntry,
    variants: WeaponVariant[],
    best: SolvedSetup,
  ): StyleResult['alternatives'] {
    const { eq: bestEq, style: bestStyle, v: bestVariant } = bestEntry;
    const alternatives: StyleResult['alternatives'] = {};

    // weapon alternatives: every variant re-evaluated against the winning armour.
    // If the winning weapon was two-handed, one-handed candidates get a static
    // best-guess shield so they are not unfairly ranked shieldless.
    const fillShield = !bestEq.shield && !bestVariant.weapon.isTwoHanded ? null
      : this.staticBestShield(bestStyle.type);
    const weaponAlts = new Map<string, SlotAlternative>();
    for (const v of variants) {
      const eq: Partial<PlayerEquipment> = { ...bestEq, weapon: v.weapon };
      if (v.weapon.isTwoHanded) {
        eq.shield = null;
      } else if (!eq.shield && fillShield) {
        eq.shield = fillShield;
      }
      const needsAmmo = this.weaponNeedsAmmo(v.weapon);
      if (needsAmmo) {
        const currentOk = eq.ammo && ammoApplicability(v.weapon.id, eq.ammo.id) === AmmoApplicability.INCLUDED;
        if (!currentOk) {
          const ammo = this.quickAmmoFor(v.weapon);
          if (!ammo) continue;
          eq.ammo = ammo;
        }
      }
      const { dps, speed } = this.evalLite(eq, v.style, v.spell);
      if (dps <= 0) continue;
      const metric = this.metricOf(dps, speed, v.style, v.spell);
      if (metric <= 0) continue;
      // collapse charged/uncharged and cosmetic versions that share a display name
      const altKey = v.weapon.name;
      const existing = weaponAlts.get(altKey);
      if (!existing || metric > existing.metric) {
        const item = this.toResultItem(v.weapon, 'weapon');
        if (v.spell) item.detail = v.spell.name;
        weaponAlts.set(altKey, {
          ...item, dps, metric, deltaPct: ((metric - best.metric) / best.metric) * 100,
        });
      }
    }
    alternatives.weapon = [...weaponAlts.values()].sort((a, b) => b.metric - a.metric).slice(0, 40);

    for (const slot of ARMOUR_SLOTS) {
      if (slot === 'shield' && bestVariant.weapon.isTwoHanded) {
        alternatives[slot] = [];
        continue;
      }
      const pool = slot === 'ammo'
        ? this.ammoCandidates(bestVariant.weapon, bestStyle.type)
        : this.altPool(slot, bestStyle.type);
      const bySlotName = new Map<string, SlotAlternative>();
      for (const cand of pool) {
        const { dps, speed } = this.evalLite({ ...bestEq, [slot]: cand }, bestStyle, bestVariant.spell);
        if (dps <= 0) continue;
        const metric = this.metricOf(dps, speed, bestStyle, bestVariant.spell);
        const existing = bySlotName.get(cand.name);
        if (existing && existing.metric >= metric) continue;
        bySlotName.set(cand.name, {
          ...this.toResultItem(cand, slot),
          dps,
          metric,
          deltaPct: ((metric - best.metric) / best.metric) * 100,
        });
      }
      const alts = [...bySlotName.values()].sort((a, b) => b.metric - a.metric);
      // make it explicit when leaving the slot empty is the best option
      // (e.g. melee armour with ranged penalties in an owned-only search)
      if (!bestEq[slot] && alts.length > 0 && alts[0].metric < best.metric) {
        alts.unshift({
          id: -1, name: 'Nothing (leave empty)', version: '', image: '', slot, owned: true, dps: best.dps, metric: best.metric, deltaPct: 0,
        });
      }
      alternatives[slot] = alts.slice(0, 40);
    }

    return alternatives;
  }

  /** highest raw-stat shield for a style, used to fair-rank 1h weapons when the best setup is 2h */
  private staticBestShield(t: CombatStyleType): EquipmentPiece | null {
    const pool = this.candidatesFor('shield', t);
    let best: EquipmentPiece | null = null;
    let bestScore = -Infinity;
    for (const s of pool) {
      const score = offensiveDim(s, t) + strengthDim(s, t) * 2;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  /** pool of items worth showing in the alternatives table for a slot */
  private altPool(slot: Slot, t: CombatStyleType): EquipmentPiece[] {
    if (this.restrictToOwned) return this.allowedForSlot(slot);
    // all-items mode: pareto set + specials, topped up with the highest raw-stat items
    const pruned = this.candidatesFor(slot, t);
    if (pruned.length >= 40) return pruned;
    const extra = this.allowedForSlot(slot)
      .filter((i) => !pruned.includes(i) && (offensiveDim(i, t) > 0 || strengthDim(i, t) > 0))
      .sort((a, b) => (offensiveDim(b, t) + strengthDim(b, t) * 2) - (offensiveDim(a, t) + strengthDim(a, t) * 2))
      .slice(0, 40 - pruned.length);
    return [...pruned, ...extra];
  }

  solve(progress?: ProgressFn): SolveResult {
    const started = Date.now();
    const groups: StyleGroup[] = ['melee', 'ranged', 'magic'];
    const styles = groups.map((g, ix) => this.solveStyle(g, progress, ix / 3, 1 / 3));
    const withBest = styles.filter((s) => s.best !== null);
    withBest.sort((a, b) => (b.best?.metric ?? 0) - (a.best?.metric ?? 0));
    const upgrades = this.request.includeUpgrades ? this.buildUpgrades() : null;
    return {
      monsterId: this.request.monsterId,
      monsterVersion: this.request.monsterVersion,
      styles,
      bestStyle: withBest[0]?.styleGroup ?? null,
      mode: this.mode,
      trainedSkill: this.mode === 'training' ? this.trainedSkill : null,
      upgrades,
      elapsedMs: Date.now() - started,
      evals: this.evals,
    };
  }
}

export function solve(request: SolveRequest, progress?: ProgressFn): SolveResult {
  return new Solver(request).solve(progress);
}
